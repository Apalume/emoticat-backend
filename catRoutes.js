const express = require('express');
const { OpenAI } = require('openai');
const { pool } = require('./db');
const r2Client = require('./r2Client');
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const { authenticateToken } = require('./authMiddleware');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'emoticat';
const upload = multer({ storage: multer.memoryStorage() });


async function analyzeCatEmotion(base64Image) {
    const prompt = `You are an AI picture analysis assistant that helps me figure out the emotion of a cat based off of a given picture which I have provided. First check to see if the animal is a cat. If the animal is a cat, only send back a one word response of the emotion of the cat from the following categories: ["Content", "Happy", "Curious", "Affectionate", "Scared", "Aggressive", "Annoyed", "Anxious", "Sad", "Bored", "Sleepy"]
    
    If the animal is not a cat, send back this message strictly: 'ERROR: not a cat'`;
    
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                "url": `data:image/jpeg;base64,${base64Image}`,
                "detail": "low"
              },
            },
          ],
        },
      ],
      max_tokens: 300
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

router.post('/analyze', authenticateToken,  upload.single('image'), async (req, res) => {
  const { image, petId } = req.body;

  if (!image || !petId) {
    return res.status(400).json({ error: 'Image and petId are required' });
  }

  try {
    const result = await analyzeCatEmotion(image);
    
    // Store the image in R2
    if (image) {
      const fileBuffer = image.buffer;
      const filename = `${uuidv4()}.jpg`;
      imageKey = `pet-images/${filename}`;

      const uploadParams = {
        Bucket: BUCKET_NAME,
        Key: imageKey,
        Body: fileBuffer,
        ContentType: req.file.mimetype,
      };

      await r2Client.send(new PutObjectCommand(uploadParams));

    // Store the emotion record in the database
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      const emotionRecordResult = await client.query(
        'INSERT INTO emotion_records (pet_id, emotion, image_key) VALUES ($1, $2, $3) RETURNING id',
        [petId, result, imageKey]
      );
      const emotionRecordId = emotionRecordResult.rows[0].id;

      // Get emotion details
      const emotionDetails = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [{
          role: "user",
          content: `Return only a valid JSON object with the following structure, and no other text:
          {
            "description": "A sentence of what it means for a cat to be ${result} and how to identify it.",
            "tipsAndRecs": ["Tip 1", "Tip 2", "Tip 3"]
          }
          The tips and recommendations should be about what to do when a cat is in this emotional state.`
        }]
      });

      const parsedEmotionDetails = JSON.parse(emotionDetails.choices[0].message.content);

      // Update emotion record with description
      await client.query(
        'UPDATE emotion_records SET emotion_text = $1 WHERE id = $2',
        [parsedEmotionDetails.description, emotionRecordId]
      );

      // Store tips and recommendations
      for (const tip of parsedEmotionDetails.tipsAndRecs) {
        await client.query(
          'INSERT INTO tips_and_recs (emotion_record_id, tip) VALUES ($1, $2)',
          [emotionRecordId, tip]
        );
      }

      await client.query('COMMIT');
      res.json({ 
        message: result, 
        emotionDetails: parsedEmotionDetails,
        imageKey: imageKey // Include the imageKey in the response
      });
    } catch (dbError) {
      await client.query('ROLLBACK');
      throw dbError;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while analyzing the image', details: error.message });
  }
});

router.post('/get-emotion-details', authenticateToken, async (req, res) => {
  const { emotion } = req.body;

  if (!emotion) {
    return res.status(400).json({ error: 'Emotion is required' });
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: `Return only a valid JSON object with the following structure, and no other text:
        {
          "description": "A sentence of what it means for a cat to be ${emotion} and how to identify it.",
          "tipsAndRecs": ["Tip 1", "Tip 2", "Tip 3"]
        }
        The tips and recommendations should be about what to do when a cat is in this emotional state.`
      }]
    });

    const result = JSON.parse(response.choices[0].message.content);
    res.json(result);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while getting emotion details', details: error.message });
  }
});

module.exports = router;