import { Router } from 'express';
import { transcripts, analyses, sessions, logs, monitors, comparisons } from '../services/storage.js';
import { broadcast } from '../services/websocket.js';
import { notify, notifyAlert, notifyComplete } from '../services/notifications.js';

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

// Captain's Logs
router.get('/logs', async (req, res) => {
  res.json(await logs.list());
});

router.post('/logs', async (req, res) => {
  const item = await logs.save(req.body);
  broadcast('log', item);
  res.json(item);
});

// Monitors
router.get('/monitors', async (req, res) => {
  res.json(await monitors.list());
});

router.post('/monitors', async (req, res) => {
  const item = await monitors.save(req.body);
  broadcast('monitor', item);
  res.json(item);
});

// Comparisons
router.get('/comparisons', async (req, res) => {
  res.json(await comparisons.list());
});

router.post('/comparisons', async (req, res) => {
  const item = await comparisons.save(req.body);
  broadcast('comparison', item);
  res.json(item);
});

// Notifications — wire into existing endpoints
// Override analysis POST to also notify
const _origAnalysis = router.stack.find(r => r.route?.path === '/analysis' && r.route?.methods?.post);
if (_origAnalysis) {
  const origHandler = _origAnalysis.route.stack[0].handle;
  _origAnalysis.route.stack[0].handle = async (req, res) => {
    await origHandler(req, res);
    notifyComplete('Computer', `Analysis complete: ${req.body.title || 'New analysis'}`);
  };
}

// Override monitor POST to notify on alerts
const _origMonitor = router.stack.find(r => r.route?.path === '/monitors' && r.route?.methods?.post);
if (_origMonitor) {
  const origHandler = _origMonitor.route.stack[0].handle;
  _origMonitor.route.stack[0].handle = async (req, res) => {
    await origHandler(req, res);
    const status = req.body.status || 'updated';
    if (status === 'alert' || status === 'triggered') {
      notifyAlert('Monitor Alert', `${req.body.name || 'Monitor'}: ${req.body.message || status}`);
    } else {
      notify('Monitor', `${req.body.name || 'Monitor'}: ${status}`);
    }
  };
}

export default router;
