import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { isGatewayConnected, callGateway } from '../services/gateway-client.js';
import { broadcast } from '../services/websocket.js';

const ALLOWED_MEDIA_TYPES = /^(image|video|audio)\//;
const upload = multer({
  dest: path.join(os.tmpdir(), 'computer-media'),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MEDIA_TYPES.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only image, video, and audio files are accepted.'));
    }
  },
});
const router = Router();

// List available media analysis providers
router.get('/providers', async (req, res) => {
  const providers = ['local'];
  if (isGatewayConnected()) {
    try {
      const result = await callGateway('models.list');
      const visionModels = (Array.isArray(result) ? result : []).filter(
        m => m.capabilities?.includes('vision') || m.id?.includes('vision') || m.id?.includes('4o')
      );
      if (visionModels.length > 0) providers.push('gateway');
    } catch {}
  }
  res.json({ providers });
});

// Analyze image via gateway vision model
router.post('/analyze', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const { prompt } = req.body;
  const analysisPrompt = prompt || 'Describe this image in detail.';

  try {
    // Read file as base64
    const fileBuffer = await fs.readFile(req.file.path);
    const base64 = fileBuffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/png';

    if (!isGatewayConnected()) {
      return res.status(503).json({ error: 'Gateway not connected — media analysis requires gateway' });
    }

    broadcast('status', { message: 'Analyzing media...', processing: true });

    const result = await callGateway('chat.send', {
      message: analysisPrompt,
      attachments: [{ type: mimeType, data: base64 }],
    });

    broadcast('status', { message: 'Media analysis complete', processing: false });
    broadcast('analysis', {
      type: 'media_analysis',
      title: `Media: ${req.file.originalname}`,
      content: result?.text || result?.response || JSON.stringify(result),
      mimeType,
      timestamp: new Date().toISOString(),
    });

    res.json({
      ok: true,
      analysis: result?.text || result?.response || result,
      filename: req.file.originalname,
    });
  } catch (err) {
    broadcast('status', { message: 'Media analysis failed', processing: false });
    res.status(500).json({ error: 'Media analysis failed' });
  } finally {
    // Cleanup uploaded file
    await fs.unlink(req.file.path).catch(() => {});
  }
});

// Extract frames from video (via gateway)
router.post('/video/frames', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  if (!isGatewayConnected()) {
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(503).json({ error: 'Gateway not connected' });
  }

  try {
    const fileBuffer = await fs.readFile(req.file.path);
    const base64 = fileBuffer.toString('base64');

    const result = await callGateway('media.extractFrames', {
      data: base64,
      mimeType: req.file.mimetype,
      frameCount: parseInt(req.body.frameCount) || 5,
    });

    res.json({ ok: true, frames: result });
  } catch (err) {
    res.status(500).json({ error: 'Video frame extraction failed' });
  } finally {
    await fs.unlink(req.file.path).catch(() => {});
  }
});

export default router;
