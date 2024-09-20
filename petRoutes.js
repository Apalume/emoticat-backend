const express = require('express');
const router = express.Router();
const multer = require('multer');
const { pool } = require('./db');
const { authenticateToken } = require('./authMiddleware');
const r2Client = require('./r2Client');
const { GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require('uuid');
const { OpenAI } = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

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
// Add a pet
router.post('/add', authenticateToken, upload.single('image'), async (req, res) => {
  const { name, breed, birthday } = req.body;
  const userId = req.user.id;

  try {
    let imageKey = null;
    let base64Image = null;
    let guessedBreed = null;

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
      
      // Convert file buffer to base64 for OpenAI
      base64Image = fileBuffer.toString('base64');

      // Only guess breed if it's not provided
      if (!breed) {
        const response = await openai.chat.completions.create({
          model: "gpt-4o",
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: "Give me your 1 guess on what this cat's breed is most likely. Do not give any other information, only provide me with the breed name you guess that is likely." },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
              ],
            },
          ],
        });

        guessedBreed = response.choices[0].message.content.trim();
      }
    }

    // Save pet data to database
    const client = await pool.connect();
    const result = await client.query(
      'INSERT INTO pets (user_id, name, breed, birthday, image_key) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [userId, name, breed || guessedBreed, birthday, imageKey]
    );
    client.release();

    res.status(201).json({
      pet: result.rows[0],
      guessedBreed: breed ? null : guessedBreed
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
    console.log(pet)
    res.json(pet);
  } catch (error) {
    console.error('Error fetching pet details:', error);
    res.status(500).json({ error: 'An error occurred while fetching pet details' });
  } finally {
    client.release();
  }
});

router.put('/update/:id', authenticateToken, upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const { name, breed, birthday } = req.body;
  const userId = req.user.id;

  try {
    let imageKey = null;

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
    }

    const client = await pool.connect();
    const updateQuery = `
      UPDATE pets 
      SET name = $1, breed = $2, birthday = $3${imageKey ? ', image_key = $4' : ''}
      WHERE id = $${imageKey ? '5' : '4'} AND user_id = $${imageKey ? '6' : '5'}
      RETURNING *
    `;
    const values = imageKey 
      ? [name, breed, birthday, imageKey, id, userId]
      : [name, breed, birthday, id, userId];

    const result = await client.query(updateQuery, values);
    client.release();

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pet not found or you do not have permission to update it' });
    }

    res.json({ pet: result.rows[0] });
  } catch (err) {
    console.error('Error updating pet:', err);
    res.status(500).json({ error: 'An error occurred while updating the pet', details: err.message });
  }
});

// New route to get pet image
router.get('/image/:imageKey', authenticateToken, async (req, res) => {
  const { imageKey } = req.params;
  const userId = req.user.id;

  console.log(`Received request for image ${imageKey} from user ${userId}`);

  try {

    const petResult = await pool.query(`
      SELECT 'pet' as source FROM pets 
      WHERE image_key = $1 AND user_id = $2
      UNION ALL
      SELECT 'emotion_record' as source FROM emotion_records er
      JOIN pets p ON er.pet_id = p.id
      WHERE er.image_key = $1 AND p.user_id = $2
    `, [imageKey, userId]);

    console.log('Query result:', petResult.rows);

    if (petResult.rows.length === 0) {
      console.log(`Access denied for user ${userId} to image ${imageKey}`);
      return res.status(403).json({ error: 'Access denied' });
    }

    console.log('Access granted, fetching image from R2');

    // Fetch the image from R2
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: imageKey,
    });

    const { Body, ContentType } = await r2Client.send(command);

    if (!Body) {
      console.log(`Image not found in R2: ${imageKey}`);
      return res.status(404).json({ error: 'Image not found' });
    }

    console.log(`Streaming image ${imageKey} to response`);

    // Stream the image data to the response
    res.set('Content-Type', ContentType);
    Body.pipe(res);
  } catch (error) {
    console.error('Error fetching image:', error);
    res.status(500).json({ error: 'An error occurred while fetching the image', details: error.message });
  }
});

module.exports = router;