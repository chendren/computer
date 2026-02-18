/**
 * Voice Route — Voice assistant status and Moshi lifecycle control.
 *
 * Endpoints:
 *   GET  /api/voice/status       — voice assistant availability and Moshi status
 *   GET  /api/voice/config       — client configuration (wake word, VAD thresholds, modes)
 *   GET  /api/voice/moshi/status — detailed Moshi sidecar status
 *   POST /api/voice/moshi/start  — start the Moshi MLX Python sidecar process
 *   POST /api/voice/moshi/stop   — stop the Moshi sidecar process
 *
 * The /config endpoint is fetched by the browser client on startup to configure
 * the VAD sensitivity thresholds. The values here should match what VadService
 * uses internally — if they diverge, update vad-service.js to fetch from this endpoint.
 */

import { Router } from 'express';
import { isVoiceAvailable } from '../services/voice-assistant.js';
import { getMoshiStatus, startMoshi, stopMoshi, isMoshiRunning } from '../services/moshi.js';

const router = Router();

/**
 * GET /api/voice/status
 * Returns the full voice assistant configuration including:
 *   - available: whether Ollama is up and required models are loaded
 *   - models: which Ollama models are configured
 *   - moshi: current Moshi sidecar status (running, port, pid)
 */
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

/**
 * GET /api/voice/config
 * Client-side configuration for VAD and voice modes.
 *
 * VAD threshold notes (these are suggestions — the client uses hardcoded defaults):
 *   positiveSpeechThreshold: 0.8 — higher than the client default (0.5) for noise robustness
 *   redemptionFrames: 15 — more silence required before ending a segment (prevents mid-word cuts)
 *   preSpeechPadFrames: 10 — more pre-speech context to capture word starts
 *
 * TODO: The client (VadService) currently uses its own hardcoded values and does not
 * fetch this endpoint. If you want centralized VAD config, update VadService.start()
 * to fetch /api/voice/config and call this.vad.configure() with the returned values.
 */
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
