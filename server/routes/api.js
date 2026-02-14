import { Router } from 'express';
import { transcripts, analyses, sessions } from '../services/storage.js';
import { broadcast } from '../services/websocket.js';

const router = Router();

// Transcripts
router.get('/transcripts', async (req, res) => {
  res.json(await transcripts.list());
});

router.get('/transcripts/:id', async (req, res) => {
  try {
    res.json(await transcripts.get(req.params.id));
  } catch {
    res.status(404).json({ error: 'Transcript not found' });
  }
});

router.post('/transcripts', async (req, res) => {
  const item = await transcripts.save(req.body);
  broadcast('transcript', item);
  res.json(item);
});

// Analyses
router.get('/analyses', async (req, res) => {
  res.json(await analyses.list());
});

router.post('/analysis', async (req, res) => {
  const item = await analyses.save(req.body);
  broadcast('analysis', item);
  res.json(item);
});

// Charts
router.post('/charts', async (req, res) => {
  broadcast('chart', req.body);
  res.json({ status: 'broadcast' });
});

// Search results
router.post('/search-results', async (req, res) => {
  broadcast('search', req.body);
  res.json({ status: 'broadcast' });
});

// Sessions
router.get('/sessions', async (req, res) => {
  res.json(await sessions.list());
});

router.post('/sessions', async (req, res) => {
  const item = await sessions.save(req.body);
  res.json(item);
});

export default router;
