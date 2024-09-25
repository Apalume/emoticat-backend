const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id',
      [username, email, hashedPassword]
    );
    
    const token = jwt.sign(
      { id: result.rows[0].id, username },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    
    res.status(201).json({ 
      username, 
      token,
      message: 'User registered successfully' 
    });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'An error occurred while registering the user' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      if (await bcrypt.compare(password, user.password)) {
        const accessToken = jwt.sign(
          { id: user.id, email: user.email },
          process.env.JWT_SECRET,
          { expiresIn: '15m' }
        );
        const refreshToken = jwt.sign(
          { id: user.id, email: user.email },
          process.env.JWT_REFRESH_SECRET,
          { expiresIn: '7d' }
        );

        // Store refresh token in database
        await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, user.id]);

        res.json({ 
          accessToken, 
          refreshToken,
          username: user.username,
          email: user.email
        });
      } else {
        res.status(400).json({ error: 'Invalid password' });
      }
    } else {
      res.status(400).json({ error: 'User not found' });
    }
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'An error occurred while logging in: ' + error.message });
  }
});

router.post('/refresh-token', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token is required' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const result = await pool.query('SELECT * FROM users WHERE id = $1 AND refresh_token = $2', [decoded.id, refreshToken]);

    if (result.rows.length > 0) {
      const user = result.rows[0];
      const newAccessToken = jwt.sign(
        { id: user.id, email: user.email },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
      );

      res.json({ accessToken: newAccessToken });
    } else {
      res.status(401).json({ error: 'Invalid refresh token' });
    }
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Refresh token expired' });
    }
    console.error('Error refreshing token:', error);
    res.status(500).json({ error: 'An error occurred while refreshing the token' });
  }
});

module.exports = router;