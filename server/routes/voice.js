import { Router } from 'express';
import { isVoiceAvailable } from '../services/voice-assistant.js';

const router = Router();

router.get('/status', (req, res) => {
  const model = process.env.VOICE_MODEL || 'qwen2.5:7b-instruct-q4_K_M';
  res.json({
    available: isVoiceAvailable(),
    model,
    provider: 'ollama',
    features: ['tool_use', 'conversation_history', 'tts', 'panel_switching'],
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
  });
});

export default router;
