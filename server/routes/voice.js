import { Router } from 'express';
import { isVoiceAvailable } from '../services/voice-assistant.js';

const router = Router();

router.get('/status', (req, res) => {
  const voiceModel = process.env.VOICE_MODEL || 'llama4:scout';
  const actionModel = process.env.ACTION_MODEL || 'hf.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf:F16';
  res.json({
    available: isVoiceAvailable(),
    models: {
      voice: voiceModel,
      action: actionModel,
    },
    provider: 'ollama',
    architecture: 'dual-model',
    features: ['deterministic_routing', 'tool_use', 'conversation_history', 'tts', 'panel_switching'],
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
