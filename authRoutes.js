const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const axios = require('axios');
const { pool } = require('./db');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Function to generate Apple client secret
const generateAppleClientSecret = () => {
  return jwt.sign({}, process.env.APPLE_PRIVATE_KEY, {
    algorithm: 'ES256',
    expiresIn: '1h',
    audience: 'https://appleid.apple.com',
    issuer: process.env.APPLE_TEAM_ID,
    subject: process.env.APPLE_CLIENT_ID,
    keyid: process.env.APPLE_KEY_ID
  });
};

router.post('/google', async (req, res) => {
  const { token } = req.body;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email, name } = payload;

    let result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      // Create a new user if not exists
      result = await pool.query(
        'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, email, name',
        [email, name]
      );
    }
    const user = result.rows[0];

    // Set user information in session
    req.session.user = { id: user.id, email: user.email, name: user.name };

    res.json({ success: true, user: { email: user.email, name: user.name } });
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

router.post('/apple', async (req, res) => {
  const { code, fullName } = req.body;
  try {
    const clientSecret = generateAppleClientSecret();
    const tokenResponse = await fetch('https://appleid.apple.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.APPLE_CLIENT_ID,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: process.env.APPLE_REDIRECT_URI // Make sure this is set in your .env file
      })
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.text();
      console.error('Apple auth error response:', errorData);
      throw new Error(`HTTP error! status: ${tokenResponse.status}`);
    }

    const tokenData = await tokenResponse.json();
    const { id_token } = tokenData;
    const decodedToken = jwt.decode(id_token);
    const { email } = decodedToken;

    let result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      // Create a new user if not exists
      result = await pool.query(
        'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id, email, name',
        [email, fullName]
      );
    }
    const user = result.rows[0];

    // Set user information in session
    req.session.user = { id: user.id, email: user.email, name: user.name };

    res.json({ success: true, user: { email: user.email, name: user.name } });
  } catch (error) {
    console.error('Apple auth error:', error);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

module.exports = router;