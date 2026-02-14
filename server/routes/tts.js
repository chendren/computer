import { Router } from 'express';
import express from 'express';
import { generateSpeech } from '../services/tts.js';

const router = Router();

// Serve generated WAV files
router.use('/audio', express.static('/tmp/computer-tts'));

// Generate TTS and return audio URL
router.post('/speak', async (req, res) => {
  const { text } = req.body;
  if (!text || text.length === 0) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > 300) {
    return res.status(400).json({ error: 'Text too long for TTS (max 300 chars)' });
  }

  try {
    const result = await generateSpeech(text);
    res.json({ audioUrl: `/api/tts/audio/${result.filename}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
