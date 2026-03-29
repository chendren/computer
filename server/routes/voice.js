/**
 * Voice Route — Voice assistant status and sidecar lifecycle control.
 *
 * STT: Voxtral Mini 3B via mlx-audio (local, Metal GPU, port 8997)
 * TTS: Kokoro 82M via kokoro-js (local, ONNX, in-process)
 * S2S: Moshi MLX (local, full-duplex, port 8998)
 *
 * Endpoints:
 *   GET  /api/voice/status       — voice assistant availability and sidecar status
 *   GET  /api/voice/config       — client configuration (wake word, VAD thresholds, modes)
 *   GET  /api/voice/moshi/status — detailed Moshi sidecar status
 *   POST /api/voice/moshi/start  — start the Moshi MLX Python sidecar process
 *   POST /api/voice/moshi/stop   — stop the Moshi sidecar process
 */

import { Router } from 'express';
import { isVoiceAvailable } from '../services/voice-assistant.js';
import { getMoshiStatus, startMoshi, stopMoshi, isMoshiRunning } from '../services/moshi.js';
import { getVoxtralSTTStatus } from '../services/voxtral-stt.js';
import { getGeminiStatus, isGeminiAvailable } from '../services/gemini-live.js';
import { getOpenAIRealtimeStatus } from '../services/openai-realtime.js';
import { getNovaSonicStatus } from '../services/nova-sonic.js';

const router = Router();

/**
 * GET /api/voice/status
 * Returns the full voice assistant configuration including:
 *   - available: whether Ollama is up and required models are loaded
 *   - models: which Ollama models are configured
 *   - moshi: current Moshi sidecar status (running, port, pid)
 */
router.get('/status', async (req, res) => {
  const voiceModel = process.env.VOICE_MODEL || 'llama3.1:8b';
  const actionModel = process.env.ACTION_MODEL || 'llama3.1:8b';
  const moshi = getMoshiStatus();
  res.json({
    available: isVoiceAvailable(),
    models: {
      voice: voiceModel,
      action: actionModel,
    },
    provider: 'ollama',
    architecture: 'single-model',
    features: ['deterministic_routing', 'tool_use', 'conversation_history', 'tts', 'panel_switching', 'moshi_speech_to_speech', 'gemini_live_s2s'],
    stt: { provider: 'voxtral', ...getVoxtralSTTStatus() },
    tts: { provider: 'kokoro', source: 'local' },
    moshi,
    gemini: getGeminiStatus(),
    openai: getOpenAIRealtimeStatus(),
    nova: getNovaSonicStatus(),
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
      computer: { description: 'Tool-augmented voice commands via Voxtral STT → Llama 3.1 → Kokoro TTS', default: true },
      moshi: { description: 'Full-duplex speech-to-speech via Moshi (~200ms latency)' },
      gemini: { description: 'Gemini 3.1 Flash Live — cloud S2S with native tool calling' },
      openai: { description: 'OpenAI Realtime — GPT-4o S2S with semantic VAD and tool calling' },
      nova: { description: 'Nova Sonic — Amazon Bedrock S2S with polyglot voices and tool calling' },
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

// ── Gemini Control ──────────────────────────────────────

router.get('/gemini/status', (req, res) => {
  res.json(getGeminiStatus());
});

// ── OpenAI Realtime Control ─────────────────────────────

router.get('/openai/status', (req, res) => {
  res.json(getOpenAIRealtimeStatus());
});

// ── Nova Sonic Control ──────────────────────────────────

router.get('/nova/status', (req, res) => {
  res.json(getNovaSonicStatus());
});

export default router;
