const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
require('dotenv').config();

const authRoutes = require('./authRoutes');
const petRoutes = require('./petRoutes');
const catRoutes = require('./catRoutes');
const { pool } = require('./db');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));

// Session middleware
app.use(session({
  store: new pgSession({
    pool: pool,
    tableName: 'user_sessions'
  }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
}));

// Initialize database tables
async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(100)
      );

      CREATE TABLE IF NOT EXISTS user_sessions (
        sid VARCHAR NOT NULL COLLATE "default",
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL,
        PRIMARY KEY (sid)
      )
      WITH (OIDS=FALSE);

      CREATE INDEX IF NOT EXISTS IDX_session_expire ON user_sessions (expire);

      CREATE TABLE IF NOT EXISTS pets (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        name VARCHAR(100) NOT NULL,
        breed VARCHAR(100),
        birthday DATE,
        image_key TEXT
      );

      CREATE TABLE IF NOT EXISTS emotion_records (
        id SERIAL PRIMARY KEY,
        pet_id INTEGER REFERENCES pets(id),
        emotion VARCHAR(50) NOT NULL,
        emotion_text TEXT,
        image_key TEXT,
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

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Create an API router
const apiRouter = express.Router();

// Use routes
apiRouter.use('/auth', authRoutes);
apiRouter.use('/pets', isAuthenticated, petRoutes);
apiRouter.use('/cats', isAuthenticated, catRoutes);

// Mount the API router at the '/api' path
app.use('/api', apiRouter);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});