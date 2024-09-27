const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const { pool } = require('./db');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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
  const { code, id_token, fullName } = req.body;
  try {
    let email, name;

    if (id_token) {
      // Validate the ID token with Apple's public key
      const user = await appleSignin.verifyIdToken(id_token, {
        audience: process.env.APPLE_CLIENT_ID, // Your Apple Service ID
        ignoreExpiration: true, // Handle token expiration as needed
      });
      email = user.email;
    } else if (code) {
      // Exchange authorization code for tokens
      const clientSecret = generateAppleClientSecret();
      const tokenResponse = await appleSignin.getAuthorizationToken(code, {
        clientID: process.env.APPLE_CLIENT_ID,
        clientSecret,
        redirectUri: process.env.APPLE_REDIRECT_URI,
      });
      
      const { id_token: newIdToken } = tokenResponse;
      const decodedToken = jwt.decode(newIdToken);
      email = decodedToken.email;
    } else {
      throw new Error('Neither id_token nor code provided');
    }

    // Use fullName if provided, otherwise use email as name
    name = fullName || email.split('@')[0];

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
    console.error('Apple auth error:', error);
    res.status(401).json({ error: 'Authentication failed', details: error.message });
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