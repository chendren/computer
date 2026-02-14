import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { transcribeFile } from '../services/transcription.js';
import { transcripts } from '../services/storage.js';
import { broadcast } from '../services/websocket.js';
import { isGatewayConnected, callGateway } from '../services/gateway-client.js';

const upload = multer({ dest: path.join(os.tmpdir(), 'computer-uploads') });
const router = Router();

router.post('/file', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  const requestedProvider = req.body.provider;

  try {
    broadcast('status', { message: 'Transcribing audio...', processing: true });

    let result;
    let source = 'whisper';

    // If a specific gateway provider is requested
    if (requestedProvider && requestedProvider !== 'whisper') {
      if (!isGatewayConnected()) {
        return res.status(503).json({ error: `Provider '${requestedProvider}' requires gateway connection` });
      }
      const fileBuffer = await fs.readFile(req.file.path);
      const base64 = fileBuffer.toString('base64');
      const gwResult = await callGateway('stt.transcribe', {
        audio: base64,
        provider: requestedProvider,
        format: path.extname(req.file.originalname).slice(1) || 'wav',
      });
      result = { text: typeof gwResult === 'string' ? gwResult : gwResult?.text || '' };
      source = requestedProvider;
    } else {
      // Default: try gateway STT first (Deepgram/Google), fall back to local Whisper
      let gatewayUsed = false;
      if (isGatewayConnected()) {
        try {
          const fileBuffer = await fs.readFile(req.file.path);
          const base64 = fileBuffer.toString('base64');
          const gwResult = await callGateway('stt.transcribe', {
            audio: base64,
            format: path.extname(req.file.originalname).slice(1) || 'wav',
          });
          if (gwResult) {
            result = { text: typeof gwResult === 'string' ? gwResult : gwResult?.text || '' };
            source = 'gateway';
            gatewayUsed = true;
          }
        } catch {
          // Gateway STT failed — fall through to local
        }
      }

      if (!gatewayUsed) {
        result = await transcribeFile(req.file.path);
        source = 'whisper';
      }
    }

    const item = await transcripts.save({
      source,
      filename: req.file.originalname,
      text: result.text,
      segments: result.segments || [],
      language: result.language,
    });

    broadcast('transcript', item);
    broadcast('status', { message: 'Transcription complete', processing: false });
    res.json(item);
  } catch (err) {
    broadcast('status', { message: `Transcription failed: ${err.message}`, processing: false });
    res.status(500).json({ error: err.message });
  }
});

// List available STT providers
router.get('/providers', async (req, res) => {
  const providers = [{ id: 'whisper', name: 'Whisper (Local)', available: true, source: 'local' }];
  if (isGatewayConnected()) {
    try {
      const result = await callGateway('stt.providers');
      if (Array.isArray(result)) {
        for (const p of result) {
          providers.push({ ...p, source: 'gateway' });
        }
      }
    } catch {}
  }
  res.json({ providers });
});

export default router;
