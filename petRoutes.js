const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('./db');
const { authenticateToken } = require('./authMiddleware');
const r2Client = require('./r2Client');
const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require('uuid');

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'emoticat';
const upload = multer({ storage: multer.memoryStorage() });


router.get('/', authenticateToken, async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM pets WHERE user_id = $1', [req.user.id]);
    client.release();
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An error occurred while fetching pets' });
  }
});


// Add a pet
router.post('/add', authenticateToken, upload.single('image'), async (req, res) => {
  const { name, breed, birthday } = req.body;
  const userId = req.user.id;

  try {
    let imageKey = null;
    let base64Image = null;

    if (req.file) {
      const fileBuffer = req.file.buffer;
      const filename = `${uuidv4()}.jpg`;
      imageKey = `pet-images/${filename}`;

      const uploadParams = {
        Bucket: BUCKET_NAME,
        Key: imageKey,
        Body: fileBuffer,
        ContentType: req.file.mimetype,
      };

      await r2Client.send(new PutObjectCommand(uploadParams));
      
      // Convert file buffer to base64 for ChatGPT if needed
      base64Image = fileBuffer.toString('base64');
    }

    // Save pet data to database
    const client = await pool.connect();
    const result = await client.query(
      'INSERT INTO pets (user_id, name, breed, birthday, image_key) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [userId, name, breed, birthday, imageKey]
    );
    client.release();

    res.status(201).json({
      pet: result.rows[0],
      base64Image: base64Image // Include this if you need it on the client side
    });
  } catch (err) {
    console.error('Error adding pet:', err);
    res.status(500).json({ error: 'An error occurred while adding the pet', details: err.message });
  }
});

// Get pet details
router.get('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id; // Get user ID from authenticated token

  const client = await pool.connect();
  try {
    const petResult = await client.query('SELECT * FROM pets WHERE id = $1 AND user_id = $2', [id, userId]);
    
    if (petResult.rows.length === 0) {
      return res.status(404).json({ error: 'Pet not found' });
    }

    const pet = petResult.rows[0];

    const emotionRecordsResult = await client.query(
      'SELECT er.*, array_agg(tr.tip) as tips_and_recs FROM emotion_records er ' +
      'LEFT JOIN tips_and_recs tr ON er.id = tr.emotion_record_id ' +
      'WHERE er.pet_id = $1 ' +
      'GROUP BY er.id ' +
      'ORDER BY er.timestamp DESC',
      [id]
    );

    pet.emotionHistory = emotionRecordsResult.rows;

    res.json(pet);
  } catch (error) {
    console.error('Error fetching pet details:', error);
    res.status(500).json({ error: 'An error occurred while fetching pet details' });
  } finally {
    client.release();
  }
});

// New route to get pet image
router.get('/image/:imageKey', authenticateToken, async (req, res) => {
  const { imageKey } = req.params;
  const userId = req.user.id;

  try {
    // First, verify that the user has access to this image
    const petResult = await pool.query(
      'SELECT * FROM pets WHERE image_key = $1 AND user_id = $2',
      [imageKey, userId]
    );

    if (petResult.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // If access is granted, fetch the image from R2
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: imageKey,
    });

    const { Body, ContentType } = await r2Client.send(command);

    if (!Body) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Convert the readable stream to a buffer
    const chunks = [];
    for await (const chunk of Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // Convert buffer to base64
    const base64Image = buffer.toString('base64');

    // Send the base64 image data and content type
    res.json({ 
      imageData: `data:${ContentType};base64,${base64Image}`,
      contentType: ContentType
    });
  } catch (error) {
    console.error('Error fetching image:', error);
    res.status(500).json({ error: 'An error occurred while fetching the image' });
  }
});
module.exports = router;