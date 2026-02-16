import { Router } from 'express';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateSpeech } from '../services/tts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');

const router = Router();

// Serve generated WAV files from data/tts-cache/
router.use('/audio', express.static(path.join(PLUGIN_ROOT, 'data', 'tts-cache')));

// Generate TTS — local Coqui
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
    res.json({ audioUrl: `/api/tts/audio/${result.filename}`, provider: 'coqui', source: 'local' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List available TTS providers
router.get('/providers', async (req, res) => {
  res.json({ providers: [{ id: 'coqui', name: 'Coqui TTS (Local)', available: true, source: 'local' }] });
});

// List available voices
router.get('/voices', async (req, res) => {
  res.json({ voices: [{ id: 'ljspeech', name: 'LJ Speech (English)', provider: 'coqui' }], connected: true });
});

export default router;
