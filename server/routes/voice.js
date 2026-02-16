import { Router } from 'express';
import { isVoiceAvailable } from '../services/voice-assistant.js';
import { getMoshiStatus, startMoshi, stopMoshi, isMoshiRunning } from '../services/moshi.js';

const router = Router();

router.get('/status', async (req, res) => {
  const voiceModel = process.env.VOICE_MODEL || 'llama4:scout';
  const actionModel = process.env.ACTION_MODEL || 'hf.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf:F16';
  const moshi = getMoshiStatus();
  res.json({
    available: isVoiceAvailable(),
    models: {
      voice: voiceModel,
      action: actionModel,
    },
    provider: 'ollama',
    architecture: 'dual-model',
    features: ['deterministic_routing', 'tool_use', 'conversation_history', 'tts', 'panel_switching', 'moshi_speech_to_speech'],
    moshi,
  });
});

router.get('/config', (req, res) => {
  res.json({
    wakeWord: 'computer',
    vad: {
      positiveSpeechThreshold: 0.8,
      redemptionFrames: 15,
      preSpeechPadFrames: 10,
    },
    modes: {
      moshi: { description: 'Full-duplex speech-to-speech via Moshi (~200ms latency)', default: true },
      computer: { description: 'Tool-augmented voice commands via xLAM + Llama Scout' },
    },
  });
});

// ── Moshi Control ──────────────────────────────────────

router.get('/moshi/status', async (req, res) => {
  const running = await isMoshiRunning();
  res.json({ ...getMoshiStatus(), running });
});

router.post('/moshi/start', async (req, res) => {
  try {
    const pluginRoot = req.app.get('pluginRoot');
    const ok = await startMoshi(pluginRoot);
    res.json({ ok, ...getMoshiStatus() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/moshi/stop', (req, res) => {
  stopMoshi();
  res.json({ ok: true, ...getMoshiStatus() });
});

export default router;
