const express = require('express');
const router = express.Router();
const { pool } = require('./db');
const authenticateToken = require('./middleware/authenticateToken');
const r2Client = require('./r2Client');
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { v4: uuidv4 } = require('uuid');

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
router.post('/add', authenticateToken, async (req, res) => {
  const { name, breed, birthday, image } = req.body;
  const userId = req.user.id;

  try {
    // Upload image to R2
    const imageKey = `pet-images/${uuidv4()}.jpg`;
    const imageBuffer = Buffer.from(image.replace(/^data:image\/\w+;base64,/, ""), 'base64');

    const uploadParams = {
      Bucket: BUCKET_NAME,
      Key: imageKey,
      Body: imageBuffer,
      ContentType: 'image/jpeg',
    };

    await r2Client.send(new PutObjectCommand(uploadParams));

    const imageUrl = `https://${BUCKET_NAME}.${process.env.R2_CUSTOM_DOMAIN}/${imageKey}`;

    // Save pet data to database
    const client = await pool.connect();
    const result = await client.query(
      'INSERT INTO pets (user_id, name, breed, birthday, image_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [userId, name, breed, birthday, imageUrl]
    );
    client.release();

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An error occurred while adding the pet' });
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

module.exports = router;