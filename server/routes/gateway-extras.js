/**
 * Additional gateway endpoints for sessions, agents, hooks, tools, and node actions.
 */
import { Router } from 'express';
import { isGatewayConnected, callGateway } from '../services/gateway-client.js';

const router = Router();

// ── Sessions ─────────────────────────────────────────

router.get('/sessions/:key/history', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  try {
    const result = await callGateway('sessions.history', { key: req.params.key });
    res.json({ ok: true, history: result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/sessions/:key/reset', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  try {
    const result = await callGateway('sessions.reset', { key: req.params.key });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/sessions/:key/cost', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  try {
    const result = await callGateway('sessions.cost', { key: req.params.key });
    res.json({ ok: true, cost: result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Agents ───────────────────────────────────────────

router.get('/agents', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.json({ agents: [], connected: false });
  }
  try {
    const result = await callGateway('agents.list');
    res.json({ agents: result, connected: true });
  } catch (err) {
    res.json({ agents: [], connected: false, error: err.message });
  }
});

router.get('/agents/:id', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  try {
    const result = await callGateway('agents.get', { id: req.params.id });
    res.json({ ok: true, agent: result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/agents/:id/configure', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  try {
    const result = await callGateway('agents.configure', {
      id: req.params.id,
      ...req.body,
    });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Hooks ────────────────────────────────────────────

router.get('/hooks', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.json({ hooks: [], connected: false });
  }
  try {
    const result = await callGateway('hooks.list');
    res.json({ hooks: result, connected: true });
  } catch (err) {
    res.json({ hooks: [], connected: false, error: err.message });
  }
});

// ── Tools ────────────────────────────────────────────

router.get('/tools', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.json({ tools: [], connected: false });
  }
  try {
    const result = await callGateway('tools.list');
    res.json({ tools: result, connected: true });
  } catch (err) {
    res.json({ tools: [], connected: false, error: err.message });
  }
});

// ── Node Actions ─────────────────────────────────────

router.post('/nodes/:id/camera', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  try {
    const result = await callGateway('node.camera', { nodeId: req.params.id });
    res.json({ ok: true, image: result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/nodes/:id/screen', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  try {
    const result = await callGateway('node.screen', { nodeId: req.params.id });
    res.json({ ok: true, screenshot: result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/nodes/:id/execute', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  const { command } = req.body;
  if (!command) {
    return res.status(400).json({ error: 'command is required' });
  }
  try {
    const result = await callGateway('node.execute', {
      nodeId: req.params.id,
      command,
    });
    res.json({ ok: true, output: result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Channel Config ───────────────────────────────────

router.get('/channel-config', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.json({ channels: {}, connected: false });
  }
  try {
    const result = await callGateway('config.get', { key: 'channels' });
    res.json({ channels: result, connected: true });
  } catch (err) {
    res.json({ channels: {}, connected: false, error: err.message });
  }
});

router.post('/channel-config/:id', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  try {
    const result = await callGateway('config.set', {
      key: `channels.${req.params.id}`,
      value: req.body,
    });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── TTS Providers via Gateway ────────────────────────

router.get('/tts-providers', async (req, res) => {
  const providers = [{ id: 'coqui', name: 'Coqui TTS (Local)', available: true }];
  if (!isGatewayConnected()) {
    return res.json({ providers });
  }
  try {
    const result = await callGateway('tts.providers');
    if (Array.isArray(result)) {
      for (const p of result) {
        providers.push({ ...p, source: 'gateway' });
      }
    }
    res.json({ providers });
  } catch {
    res.json({ providers });
  }
});

router.get('/tts-voices', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.json({ voices: [], connected: false });
  }
  try {
    const result = await callGateway('tts.voices', {
      provider: req.query.provider || undefined,
    });
    res.json({ voices: result, connected: true });
  } catch (err) {
    res.json({ voices: [], connected: false, error: err.message });
  }
});

router.post('/tts-gateway', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  const { text, provider, voice } = req.body;
  if (!text) return res.status(400).json({ error: 'text is required' });
  try {
    const result = await callGateway('tts.speak', { text, provider, voice });
    res.json({ ok: true, audio: result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── STT Providers via Gateway ────────────────────────

router.get('/stt-providers', async (req, res) => {
  const providers = [{ id: 'whisper', name: 'Whisper (Local)', available: true }];
  if (!isGatewayConnected()) {
    return res.json({ providers });
  }
  try {
    const result = await callGateway('stt.providers');
    if (Array.isArray(result)) {
      for (const p of result) {
        providers.push({ ...p, source: 'gateway' });
      }
    }
    res.json({ providers });
  } catch {
    res.json({ providers });
  }
});

router.post('/stt-gateway', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  const { audio, provider, format } = req.body;
  if (!audio) return res.status(400).json({ error: 'audio (base64) is required' });
  try {
    const result = await callGateway('stt.transcribe', { audio, provider, format });
    res.json({ ok: true, text: result });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── OAuth Flows ─────────────────────────────────────

router.get('/oauth/status', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.json({ providers: {}, connected: false });
  }
  try {
    const result = await callGateway('oauth.status');
    res.json({ providers: result, connected: true });
  } catch (err) {
    res.json({ providers: {}, connected: false, error: err.message });
  }
});

router.post('/oauth/:provider/start', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  const { provider } = req.params;
  const { redirectUri, scopes } = req.body;
  try {
    const result = await callGateway('oauth.start', {
      provider,
      redirectUri: redirectUri || `${req.protocol}://${req.get('host')}/api/gateway/oauth/${provider}/callback`,
      scopes,
    });
    res.json({ ok: true, authUrl: result?.authUrl || result?.url || result, provider });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/oauth/:provider/callback', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.status(503).send('Gateway not connected');
  }
  const { provider } = req.params;
  const { code, state, error } = req.query;
  if (error) {
    return res.send(`<html><body><h2>OAuth Error</h2><p>${error}</p><script>window.close()</script></body></html>`);
  }
  try {
    await callGateway('oauth.callback', { provider, code, state });
    res.send(`<html><body style="background:#000;color:#ff9900;font-family:sans-serif;text-align:center;padding:60px">
      <h2>Authorization Complete</h2>
      <p>${provider} connected successfully. You can close this window.</p>
      <script>setTimeout(()=>window.close(),2000)</script>
    </body></html>`);
  } catch (err) {
    res.send(`<html><body style="background:#000;color:#ff3333;font-family:sans-serif;text-align:center;padding:60px">
      <h2>Authorization Failed</h2><p>${err.message}</p>
      <script>setTimeout(()=>window.close(),5000)</script>
    </body></html>`);
  }
});

router.post('/oauth/:provider/revoke', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  try {
    await callGateway('oauth.revoke', { provider: req.params.provider });
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ── Channel Inbox / Threads ─────────────────────────

router.get('/channels/:id/inbox', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  const { limit, offset, folder } = req.query;
  try {
    const result = await callGateway('channels.inbox', {
      channel: req.params.id,
      limit: parseInt(limit) || 25,
      offset: parseInt(offset) || 0,
      folder: folder || 'inbox',
    });
    res.json({ ok: true, messages: result?.messages || result || [], total: result?.total || 0 });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/channels/:id/threads/:threadId', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  try {
    const result = await callGateway('channels.thread', {
      channel: req.params.id,
      threadId: req.params.threadId,
    });
    res.json({ ok: true, messages: result?.messages || result || [], subject: result?.subject });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/channels/:id/folders', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.json({ folders: [], connected: false });
  }
  try {
    const result = await callGateway('channels.folders', { channel: req.params.id });
    res.json({ folders: result || [], connected: true });
  } catch (err) {
    res.json({ folders: [], connected: false, error: err.message });
  }
});

export default router;
