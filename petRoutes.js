const express = require('express');
const { pool } = require('./db');
const { authenticateToken } = require('./authMiddleware');

const router = express.Router();

// Add a pet
router.post('/add', authenticateToken, async (req, res) => {
  const { name, breed, birthday } = req.body;
  const userId = req.user.id;

  if (!name) {
    return res.status(400).json({ error: 'Pet name is required' });
  }

  const client = await pool.connect();
  try {
    const result = await client.query(
      'INSERT INTO pets (user_id, name, breed, birthday) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, name, breed, birthday]
    );
    res.status(201).json({ id: result.rows[0].id, message: 'Pet added successfully' });
  } catch (error) {
    console.error('Error adding pet:', error);
    res.status(500).json({ error: 'An error occurred while adding the pet', details: error.message });
  } finally {
    client.release();
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