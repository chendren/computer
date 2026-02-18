/**
 * TTS Route — Text-to-Speech synthesis.
 *
 * Endpoints:
 *   POST /api/tts/speak    — synthesize text to a WAV file, return its URL
 *   GET  /api/tts/audio/*  — serve the generated WAV files as static assets
 *   GET  /api/tts/providers — list available TTS engines
 *   GET  /api/tts/voices    — list available voices
 *
 * TTS engine: Kokoro TTS (local, runs in-process via the tts.js service).
 * Output: WAV files cached in data/tts-cache/ and served as /api/tts/audio/<filename>.
 *
 * The voice pipeline flow:
 *   voice-assistant.js generates response text
 *   → websocket.js POSTs to /api/tts/speak
 *   → returns { audioUrl: "/api/tts/audio/xyz.wav" }
 *   → browser AudioPlayer loads and plays the URL
 */

import { Router } from 'express';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateSpeech } from '../services/tts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');

const router = Router();

// Serve the WAV files that Kokoro TTS generates.
// Files are named with a content hash so identical text reuses the cached file.
router.use('/audio', express.static(path.join(PLUGIN_ROOT, 'data', 'tts-cache')));

/**
 * POST /api/tts/speak
 * Synthesize text to speech and return the audio URL.
 *
 * The 300-character limit is a practical constraint:
 *   - Kokoro TTS synthesis time scales linearly with text length
 *   - Beyond ~300 chars, latency exceeds what feels acceptable for a voice interface
 *   - Voice assistant responses should be short and spoken-natural anyway
 *   - The AI models (Scout, xLAM) are instructed to stay under 200 chars
 *
 * If you get 400 errors from this endpoint, the response text is too long.
 * Check that the LLM system prompt constrains response length.
 */
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
