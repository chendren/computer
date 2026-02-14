import { Router } from 'express';
import express from 'express';
import { generateSpeech } from '../services/tts.js';
import { isGatewayConnected, callGateway } from '../services/gateway-client.js';

const router = Router();

// Serve generated WAV files
router.use('/audio', express.static('/tmp/computer-tts'));

// Generate TTS — tries gateway providers first, falls back to local Coqui
router.post('/speak', async (req, res) => {
  const { text, provider, voice } = req.body;
  if (!text || text.length === 0) {
    return res.status(400).json({ error: 'text is required' });
  }
  if (text.length > 300) {
    return res.status(400).json({ error: 'Text too long for TTS (max 300 chars)' });
  }

  // If a specific gateway provider is requested, use it exclusively
  if (provider && provider !== 'coqui') {
    if (!isGatewayConnected()) {
      return res.status(503).json({ error: `Provider '${provider}' requires gateway connection` });
    }
    try {
      const result = await callGateway('tts.speak', { text, provider, voice });
      return res.json({ audioUrl: result.url || result.audioUrl, provider, source: 'gateway' });
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
  }

  // Default: try gateway first (better voices), fall back to local Coqui
  if (isGatewayConnected()) {
    try {
      const result = await callGateway('tts.speak', { text, voice });
      if (result?.url || result?.audioUrl) {
        return res.json({ audioUrl: result.url || result.audioUrl, provider: 'gateway', source: 'gateway' });
      }
    } catch {
      // Gateway TTS failed — fall through to local
    }
  }

  // Local Coqui TTS fallback
  try {
    const result = await generateSpeech(text);
    res.json({ audioUrl: `/api/tts/audio/${result.filename}`, provider: 'coqui', source: 'local' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List available TTS providers
router.get('/providers', async (req, res) => {
  const providers = [{ id: 'coqui', name: 'Coqui TTS (Local)', available: true, source: 'local' }];
  if (isGatewayConnected()) {
    try {
      const result = await callGateway('tts.providers');
      if (Array.isArray(result)) {
        for (const p of result) {
          providers.push({ ...p, source: 'gateway' });
        }
      }
    } catch {}
  }
  res.json({ providers });
});

// List available voices (for a specific provider)
router.get('/voices', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.json({ voices: [], connected: false });
  }
  try {
    const result = await callGateway('tts.voices', {
      provider: req.query.provider || undefined,
    });
    res.json({ voices: result || [], connected: true });
  } catch (err) {
    res.json({ voices: [], connected: false, error: err.message });
  }
});

export default router;
