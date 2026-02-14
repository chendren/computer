import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import path from 'path';
import cors from 'cors';
import { initStorage } from './services/storage.js';
import { initVectorDB } from './services/vectordb.js';
import { initWebSocket } from './services/websocket.js';
import apiRoutes from './routes/api.js';
import knowledgeRoutes from './routes/knowledge.js';
import transcribeRoutes from './routes/transcribe.js';
import claudeRoutes from './routes/claude.js';
import ttsRoutes from './routes/tts.js';
import mediaRoutes from './routes/media.js';
import gatewayExtrasRoutes from './routes/gateway-extras.js';
import { securityScan, getSecurityStats } from './middleware/security.js';
import {
  startGateway,
  stopGateway,
  getGatewayStatus,
  isGatewayAvailable,
} from './services/gateway-manager.js';
import {
  connectToGateway,
  disconnectFromGateway,
  callGateway,
  getClientStatus,
  isGatewayConnected,
} from './services/gateway-client.js';
import { initConfigBridge, getConfigSummary } from './services/config-bridge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const PORT = process.env.COMPUTER_PORT || 3141;

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Security: scan all POST/PUT/PATCH bodies for tokens, keys, passwords
app.use(securityScan);

app.use(express.static(path.join(PLUGIN_ROOT, 'ui')));

await initStorage(PLUGIN_ROOT);
await initVectorDB(PLUGIN_ROOT);

// Initialize OpenClaw integration (non-fatal if unavailable)
let gatewayEnabled = false;
try {
  await initConfigBridge();

  if (isGatewayAvailable()) {
    await startGateway();
    // Give gateway a moment to bind its port, then connect
    setTimeout(() => connectToGateway(), 3000);
    gatewayEnabled = true;
    console.log('[computer] OpenClaw gateway integration enabled');
  } else {
    console.log('[computer] OpenClaw gateway not available (dist not found)');
  }
} catch (err) {
  console.warn('[computer] OpenClaw integration failed:', err.message);
}

app.use('/api/knowledge', knowledgeRoutes);
app.use('/api', apiRoutes);
app.use('/api/transcribe', transcribeRoutes);
app.use('/api/claude', claudeRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/gateway', gatewayExtrasRoutes);

app.get('/api/health', async (req, res) => {
  const { isOllamaAvailable } = await import('./services/embeddings.js');
  const gwStatus = getGatewayStatus();
  const clientStatus = getClientStatus();
  res.json({
    status: 'online',
    system: 'USS Enterprise Computer',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    vectordb: 'online',
    ollama: await isOllamaAvailable() ? 'online' : 'offline',
    gateway: {
      enabled: gatewayEnabled,
      running: gwStatus.running,
      connected: clientStatus.connected,
      pid: gwStatus.pid,
      port: gwStatus.port,
      uptime: gwStatus.uptime,
    },
  });
});

app.get('/api/security/stats', (req, res) => {
  res.json(getSecurityStats());
});

// ── Gateway API Proxy ─────────────────────────────────────
// These endpoints proxy RPC calls to the OpenClaw gateway.

app.get('/api/gateway/status', (req, res) => {
  res.json({
    process: getGatewayStatus(),
    client: getClientStatus(),
    config: getConfigSummary(),
  });
});

app.post('/api/gateway/restart', async (req, res) => {
  try {
    const { restartGateway } = await import('./services/gateway-manager.js');
    await restartGateway();
    setTimeout(() => connectToGateway(), 3000);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/gateway/rpc', async (req, res) => {
  const { method, params } = req.body;
  if (!method) {
    return res.status(400).json({ error: 'method is required' });
  }
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  try {
    const result = await callGateway(method, params || {});
    res.json({ ok: true, payload: result });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message, code: err.code });
  }
});

// ── Convenience endpoints that wrap common gateway RPC calls ──

app.get('/api/gateway/channels', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.json({ channels: [], connected: false });
  }
  try {
    const result = await callGateway('channels.status');
    res.json({ channels: result, connected: true });
  } catch (err) {
    res.json({ channels: [], connected: false, error: err.message });
  }
});

app.get('/api/gateway/sessions', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.json({ sessions: [], connected: false });
  }
  try {
    const result = await callGateway('sessions.list');
    res.json({ sessions: result, connected: true });
  } catch (err) {
    res.json({ sessions: [], connected: false, error: err.message });
  }
});

app.get('/api/gateway/nodes', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.json({ nodes: [], connected: false });
  }
  try {
    const result = await callGateway('node.list');
    res.json({ nodes: result, connected: true });
  } catch (err) {
    res.json({ nodes: [], connected: false, error: err.message });
  }
});

app.get('/api/gateway/models', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.json({ models: [], connected: false });
  }
  try {
    const result = await callGateway('models.list');
    res.json({ models: result, connected: true });
  } catch (err) {
    res.json({ models: [], connected: false, error: err.message });
  }
});

app.get('/api/gateway/cron', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.json({ jobs: [], connected: false });
  }
  try {
    const result = await callGateway('cron.list');
    res.json({ jobs: result, connected: true });
  } catch (err) {
    res.json({ jobs: [], connected: false, error: err.message });
  }
});

app.post('/api/gateway/send', async (req, res) => {
  const { channel, target, text, subject, attachments, replyTo, threadId } = req.body;
  if (!channel || !target || !text) {
    return res.status(400).json({ error: 'channel, target, and text are required' });
  }
  if (!isGatewayConnected()) {
    return res.status(503).json({ error: 'Gateway not connected' });
  }
  try {
    const payload = { channel, target, text };
    if (subject) payload.subject = subject;
    if (replyTo) payload.replyTo = replyTo;
    if (threadId) payload.threadId = threadId;
    if (Array.isArray(attachments) && attachments.length > 0) {
      payload.attachments = attachments;
    }
    const result = await callGateway('send', payload);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

app.get('/api/gateway/plugins', async (req, res) => {
  if (!isGatewayConnected()) {
    return res.json({ plugins: [], connected: false });
  }
  try {
    const result = await callGateway('skills.status');
    res.json({ plugins: result, connected: true });
  } catch (err) {
    res.json({ plugins: [], connected: false, error: err.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(PLUGIN_ROOT, 'ui', 'index.html'));
});

const server = createServer(app);
const wss = new WebSocketServer({ server });
initWebSocket(wss);

server.listen(PORT, () => {
  console.log(`\n  ============================`);
  console.log(`  COMPUTER ONLINE`);
  console.log(`  http://localhost:${PORT}`);
  if (gatewayEnabled) {
    console.log(`  OpenClaw Gateway: ACTIVE`);
  }
  console.log(`  ============================\n`);
});

// ── Graceful Shutdown ─────────────────────────────────────

async function shutdown(signal) {
  console.log(`\n[computer] Received ${signal}, shutting down...`);

  disconnectFromGateway();
  await stopGateway();

  server.close(() => {
    console.log('[computer] Server closed');
    process.exit(0);
  });

  // Force exit after 10s
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
