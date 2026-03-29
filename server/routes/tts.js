/**
 * TTS Route — Text-to-Speech synthesis via Kokoro (local ONNX).
 *
 * Endpoints:
 *   POST /api/tts/speak    — synthesize text to a WAV file, return its URL
 *   GET  /api/tts/audio/*  — serve the generated WAV files as static assets
 *   GET  /api/tts/providers — list available TTS engines
 *   GET  /api/tts/voices    — list available voices
 *
 * TTS engine: Kokoro 82M via kokoro-js (local ONNX Runtime, ~92MB q8 model).
 * Output: WAV files cached in data/tts-cache/ and served as /api/tts/audio/<filename>.
 */

import { Router } from 'express';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateSpeech, getVoices } from '../services/tts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');

const router = Router();

// Serve generated WAV files
router.use('/audio', express.static(path.join(PLUGIN_ROOT, 'data', 'tts-cache')));

/**
 * POST /api/tts/speak
 * Synthesize text to speech and return the audio URL.
 */
router.post('/speak', async (req, res) => {
  const { text, voice } = req.body;
  if (!text || text.length === 0) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > 500) {
    return res.status(400).json({ error: 'Text too long for TTS (max 500 chars)' });
  }

  try {
    const result = await generateSpeech(text, voice);
    res.json({ audioUrl: `/api/tts/audio/${result.filename}`, provider: 'kokoro', source: 'local' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List available TTS providers
router.get('/providers', async (req, res) => {
  res.json({ providers: [{ id: 'kokoro', name: 'Kokoro TTS (Local ONNX)', available: true, source: 'local' }] });
});

// List available voices
router.get('/voices', async (req, res) => {
  res.json({ voices: getVoices(), connected: true });
});

export default router;
