const express = require('express');
const { OpenAI } = require('openai');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(express.json({ limit: '50mb' }));

app.post('/get-emotion-details', async (req, res) => {
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

app.post('/analyze-cat', async (req, res) => {
  const { image } = req.body;

  if (!image) {
    return res.status(400).json({ error: 'Image is required' });
  }

  try {
    const result = await analyzeCatEmotion(image);
    res.json({ message: result });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred while analyzing the image', details: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});