/**
 * Local service routes — replaces OpenClaw gateway RPC calls.
 * Keeps the same URL paths so UI panels need zero changes.
 */
import { Router } from 'express';
import { listSessions, getSessionHistory, resetSession, getSessionCost } from '../services/sessions.js';
import { listAgents, getAgent, configureAgent } from '../services/agents.js';
import { listHooks, listTools } from '../services/plugins.js';
import { listNodes, captureCamera, captureScreen, executeCommand } from '../services/node-local.js';
import { getConfig, setConfig } from '../services/config.js';
import { escapeHtml } from '../utils/sanitize.js';
import * as gmail from '../services/gmail.js';

const router = Router();

// ── Sessions ─────────────────────────────────────────

router.get('/sessions/:key/history', async (req, res) => {
  try {
    const history = getSessionHistory(req.params.key);
    res.json({ ok: true, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sessions/:key/reset', async (req, res) => {
  try {
    const result = resetSession(req.params.key);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sessions/:key/cost', async (req, res) => {
  try {
    const cost = getSessionCost(req.params.key);
    res.json({ ok: true, cost });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Agents ───────────────────────────────────────────

router.get('/agents', async (req, res) => {
  try {
    const agents = listAgents();
    res.json({ agents, connected: true });
  } catch (err) {
    res.json({ agents: [], connected: true, error: err.message });
  }
});

router.get('/agents/:id', async (req, res) => {
  try {
    const agent = await getAgent(req.params.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json({ ok: true, agent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/agents/:id/configure', async (req, res) => {
  try {
    const result = await configureAgent(req.params.id, req.body);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Hooks ────────────────────────────────────────────

router.get('/hooks', async (req, res) => {
  try {
    const hooks = listHooks();
    res.json({ hooks, connected: true });
  } catch (err) {
    res.json({ hooks: [], connected: true, error: err.message });
  }
});

// ── Tools ────────────────────────────────────────────

router.get('/tools', async (req, res) => {
  try {
    const tools = listTools();
    res.json({ tools, connected: true });
  } catch (err) {
    res.json({ tools: [], connected: true, error: err.message });
  }
});

// ── Node Actions ─────────────────────────────────────

router.post('/nodes/:id/camera', async (req, res) => {
  try {
    const image = await captureCamera();
    res.json({ ok: true, image });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/nodes/:id/screen', async (req, res) => {
  try {
    const screenshot = await captureScreen();
    res.json({ ok: true, screenshot });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/nodes/:id/execute', async (req, res) => {
  const { command } = req.body;
  if (!command) {
    return res.status(400).json({ error: 'command is required' });
  }
  try {
    const output = await executeCommand(command);
    res.json({ ok: true, output });
  } catch (err) {
    if (err.message.startsWith('Command not permitted')) {
      return res.status(403).json({ error: err.message });
    }
    res.status(500).json({ error: 'Command execution failed' });
  }
});

// ── Channel Config ───────────────────────────────────

router.get('/channel-config', async (req, res) => {
  try {
    const channels = getConfig('channels') || {};
    res.json({ channels, connected: true });
  } catch (err) {
    res.json({ channels: {}, connected: true, error: err.message });
  }
});

router.post('/channel-config/:id', async (req, res) => {
  try {
    const result = setConfig('channels.' + req.params.id, req.body);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── TTS Providers ────────────────────────────────────

router.get('/tts-providers', async (req, res) => {
  res.json({ providers: [{ id: 'coqui', name: 'Coqui TTS (Local)', available: true }] });
});

router.get('/tts-voices', async (req, res) => {
  res.json({ voices: [{ id: 'ljspeech', name: 'LJ Speech (English)', provider: 'coqui' }], connected: true });
});

router.post('/tts-gateway', async (req, res) => {
  // No external TTS — return guidance
  res.status(503).json({ error: 'External TTS not available — use local Coqui via /api/tts/speak' });
});

// ── STT Providers ────────────────────────────────────

router.get('/stt-providers', async (req, res) => {
  res.json({ providers: [{ id: 'whisper', name: 'Whisper (Local)', available: true }] });
});

router.post('/stt-gateway', async (req, res) => {
  res.status(503).json({ error: 'External STT not available — use local Whisper via /api/transcribe/file' });
});

// ── OAuth Flows ─────────────────────────────────────

router.get('/oauth/status', async (req, res) => {
  // Check Gmail OAuth status
  try {
    const gmailStatus = await gmail.getStatus();
    res.json({
      providers: { gmail: gmailStatus },
      connected: true,
    });
  } catch {
    res.json({ providers: {}, connected: true });
  }
});

router.post('/oauth/:provider/start', async (req, res) => {
  const { provider } = req.params;
  if (provider === 'google' || provider === 'gmail') {
    // Redirect to Gmail OAuth
    return res.json({ ok: true, authUrl: '/api/gmail/auth/start', provider: 'gmail' });
  }
  res.status(400).json({ error: 'Provider ' + escapeHtml(provider) + ' not supported. Available: gmail' });
});

router.get('/oauth/:provider/callback', async (req, res) => {
  // Gmail has its own callback at /api/gmail/auth/callback
  res.send('<html><body style="background:#000;color:#ff9900;font-family:sans-serif;text-align:center;padding:60px"><h2>Use Gmail OAuth</h2><p>OAuth flows are handled at /api/gmail/auth/callback</p><script>setTimeout(()=>window.close(),3000)</script></body></html>');
});

router.post('/oauth/:provider/revoke', async (req, res) => {
  const { provider } = req.params;
  if (provider === 'google' || provider === 'gmail') {
    try {
      await gmail.revoke();
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  res.status(400).json({ error: 'Provider not supported' });
});

// ── Channel Inbox / Threads ─────────────────────────

router.get('/channels/:id/inbox', async (req, res) => {
  const channelId = req.params.id;
  // Route Gmail channel to direct Gmail API
  if (channelId === 'gmail' || channelId === 'google') {
    try {
      const { limit } = req.query;
      const messages = await gmail.getInbox(parseInt(limit) || 25);
      return res.json({ ok: true, messages, total: messages.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  res.json({ ok: true, messages: [], total: 0 });
});

router.get('/channels/:id/threads/:threadId', async (req, res) => {
  const channelId = req.params.id;
  if (channelId === 'gmail' || channelId === 'google') {
    try {
      const thread = await gmail.getThread(req.params.threadId);
      return res.json({ ok: true, messages: thread.messages || thread || [], subject: thread.subject });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  res.json({ ok: true, messages: [], subject: '' });
});

router.get('/channels/:id/folders', async (req, res) => {
  const channelId = req.params.id;
  if (channelId === 'gmail' || channelId === 'google') {
    try {
      const labels = await gmail.getLabels();
      return res.json({ folders: labels || [], connected: true });
    } catch (err) {
      return res.json({ folders: [], connected: true, error: err.message });
    }
  }
  res.json({ folders: [], connected: true });
});

export default router;
