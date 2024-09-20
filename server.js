const express = require('express');
require('dotenv').config();

const authRoutes = require('./authRoutes');
const petRoutes = require('./petRoutes');
const catRoutes = require('./catRoutes');
const { pool } = require('./db');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));

// Create an API router
const apiRouter = express.Router();

// Use routes
apiRouter.use('/auth', authRoutes);
apiRouter.use('/pets', petRoutes);
apiRouter.use('/cats', catRoutes);

// Mount the API router at the '/api' path
app.use('/api', apiRouter);
// Initialize database tables
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(100) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        name VARCHAR(100) NOT NULL,
        breed VARCHAR(100),
        birthday DATE
      );

      CREATE TABLE IF NOT EXISTS emotion_records (
        id SERIAL PRIMARY KEY,
        pet_id INTEGER REFERENCES pets(id),
        emotion VARCHAR(50) NOT NULL,
        emotion_text TEXT,
        image_url TEXT,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tips_and_recs (
        id SERIAL PRIMARY KEY,
        emotion_record_id INTEGER REFERENCES emotion_records(id),
        tip TEXT NOT NULL
      );
    `);
    console.log('Database initialized successfully');
  } catch (err) {
    console.error('Error initializing database:', err);
  } finally {
    client.release();
  }
}

initDatabase();

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});