import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import os from 'os';
import { transcribeFile } from '../services/transcription.js';
import { transcripts } from '../services/storage.js';
import { broadcast } from '../services/websocket.js';

const upload = multer({ dest: path.join(os.tmpdir(), 'computer-uploads') });
const router = Router();

router.post('/file', upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  try {
    broadcast('status', { message: 'Transcribing audio...', processing: true });

    const result = await transcribeFile(req.file.path);
    const item = await transcripts.save({
      source: 'whisper',
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

export default router;
