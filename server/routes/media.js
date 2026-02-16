import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { analyzeImage, extractVideoFrames } from '../services/vision.js';
import { listModels } from '../services/models.js';
import { broadcast } from '../services/websocket.js';

function isAllowedMediaType(mimetype) {
  return mimetype.startsWith('image/') ||
         mimetype.startsWith('video/') ||
         mimetype.startsWith('audio/');
}

const upload = multer({
  dest: path.join(os.tmpdir(), 'computer-media'),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    if (isAllowedMediaType(file.mimetype)) {
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
  try {
    const models = await listModels();
    const visionModels = models.filter(m =>
      Array.isArray(m.capabilities) && m.capabilities.indexOf('vision') !== -1
    );
    if (visionModels.length > 0) {
      providers.push('ollama');
    }
  } catch {}
  res.json({ providers });
});

// Analyze image via Ollama vision model
router.post('/analyze', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const { prompt } = req.body;
  const analysisPrompt = prompt || 'Describe this image in detail.';

  try {
    const fileBuffer = await fs.readFile(req.file.path);
    const base64 = fileBuffer.toString('base64');
    const mimeType = req.file.mimetype || 'image/png';

    broadcast('status', { message: 'Analyzing media...', processing: true });

    const result = await analyzeImage(base64, mimeType, analysisPrompt);

    broadcast('status', { message: 'Media analysis complete', processing: false });
    broadcast('analysis', {
      type: 'media_analysis',
      title: 'Media: ' + req.file.originalname,
      content: result.text,
      mimeType,
      timestamp: new Date().toISOString(),
    });

    res.json({
      ok: true,
      analysis: result.text,
      filename: req.file.originalname,
    });
  } catch (err) {
    broadcast('status', { message: 'Media analysis failed', processing: false });
    res.status(500).json({ error: 'Media analysis failed: ' + err.message });
  } finally {
    await fs.unlink(req.file.path).catch(() => {});
  }
});

// Extract frames from video
router.post('/video/frames', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  try {
    const fileBuffer = await fs.readFile(req.file.path);
    const frames = await extractVideoFrames(
      fileBuffer,
      req.file.mimetype,
      parseInt(req.body.frameCount) || 5
    );
    res.json({ ok: true, frames });
  } catch (err) {
    res.status(500).json({ error: 'Video frame extraction failed: ' + err.message });
  } finally {
    await fs.unlink(req.file.path).catch(() => {});
  }
});

export default router;
