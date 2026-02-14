import { Router } from 'express';
import { isVoiceAvailable } from '../services/voice-assistant.js';

const router = Router();

router.get('/status', (req, res) => {
  res.json({
    available: isVoiceAvailable(),
    model: 'claude-haiku-4-5-20251001',
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
