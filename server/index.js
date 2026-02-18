/**
 * Computer Server — Main Express + WebSocket entry point.
 *
 * Architecture:
 *   HTTP: Express server on port 3141 (COMPUTER_PORT env var)
 *   WebSocket: ws library sharing the same HTTP server (no separate port)
 *   UI: Static files served from /ui/ — the LCARS web interface
 *
 * Security layers:
 *   - Helmet: security headers (CSP, X-Frame-Options, etc.)
 *   - CORS: same-origin only (localhost:3141)
 *   - Rate limiting: 200 req/min general, 20 req/min for voice routes
 *   - Auth: Bearer token required for API routes + WebSocket upgrades
 *   - Request scanning: POST/PUT/PATCH bodies scanned for leaked secrets
 *   - Response scanning: outgoing JSON scanned to prevent secret leakage
 *
 * Service initialization order:
 *   1. Storage (SQLite for logs, transcripts, etc.)
 *   2. VectorDB (LanceDB for knowledge base)
 *   3. Auth token generation
 *   4. Express middleware stack
 *   5. API routes mounted under /api/
 *   6. WebSocket server (voice pipeline)
 *   7. Moshi MLX sidecar (optional, if installed)
 *   8. Gmail OAuth (optional, if configured)
 *   9. HTTP server listen on PORT
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { initStorage } from './services/storage.js';
import { initVectorDB } from './services/vectordb.js';
import { initWebSocket, broadcast } from './services/websocket.js';
import apiRoutes from './routes/api.js';
import knowledgeRoutes from './routes/knowledge.js';
import transcribeRoutes from './routes/transcribe.js';
import claudeRoutes from './routes/claude.js';
import ttsRoutes from './routes/tts.js';
import mediaRoutes from './routes/media.js';
import gatewayExtrasRoutes from './routes/gateway-extras.js';
import voiceRoutes from './routes/voice.js';
import { securityScan, responseScan, getSecurityStats } from './middleware/security.js';
import { initAuth, getAuthToken, requireAuth } from './middleware/auth.js';

// Local services — replace OpenClaw gateway
import { initConfig, getConfigSummary } from './services/config.js';
import { listModels } from './services/models.js';
import { listSessions } from './services/sessions.js';
import { initAgents } from './services/agents.js';
import { initCron, listJobs } from './services/cron-scheduler.js';
import { listNodes } from './services/node-local.js';
import { listPlugins } from './services/plugins.js';
import * as gmail from './services/gmail.js';
import { startMoshi, stopMoshi, getMoshiStatus } from './services/moshi.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const PORT = process.env.COMPUTER_PORT || 3141;

const app = express();
app.set('pluginRoot', PLUGIN_ROOT);

// Security headers (CSP, X-Frame-Options, etc.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", "blob:", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", `ws://localhost:${PORT}`, `ws://127.0.0.1:${PORT}`, "blob:", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      frameSrc: ["'self'"],
      objectSrc: ["'none'"],
      workerSrc: ["'self'", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      baseUri: ["'self'"],
    },
  },
}));

// CORS: only allow same-origin (LCARS UI)
app.use(cors({
  origin: [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`],
}));

// General rate limit: 200 req/min
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait.' },
}));

app.use(express.json({ limit: '10mb' }));

// Security: scan all POST/PUT/PATCH bodies for tokens, keys, passwords
app.use(securityScan);

// Security: scan all outgoing JSON responses for leaked secrets
app.use(responseScan);

// Authentication: require bearer token on all /api/* routes
app.use(requireAuth);

app.use(express.static(path.join(PLUGIN_ROOT, 'ui'), {
  setHeaders: (res, filePath) => {
    // Ensure .mjs files get correct MIME type for ONNX Runtime
    if (filePath.endsWith('.mjs')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
    // Ensure .wasm files get correct MIME type
    if (filePath.endsWith('.wasm')) {
      res.setHeader('Content-Type', 'application/wasm');
    }
  },
}));

await initStorage(PLUGIN_ROOT);
await initVectorDB(PLUGIN_ROOT);
await initAuth(PLUGIN_ROOT);

// Initialize local services
await initConfig(PLUGIN_ROOT);
await initAgents(PLUGIN_ROOT);
await initCron(PLUGIN_ROOT, broadcast);
console.log('[computer] Local services initialized');

// Start Moshi speech-to-speech sidecar (non-fatal)
startMoshi(PLUGIN_ROOT).then(ok => {
  if (ok) console.log('[computer] Moshi speech-to-speech ready');
  else console.log('[computer] Moshi not available (will retry on demand)');
}).catch(() => {});

// Stricter rate limit for sensitive endpoints
const sensitiveLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded on sensitive endpoint.' },
});

app.use('/api/knowledge', knowledgeRoutes);
app.use('/api', apiRoutes);
app.use('/api/transcribe', transcribeRoutes);
app.use('/api/claude', sensitiveLimit, claudeRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/gateway', gatewayExtrasRoutes);
app.use('/api/voice', voiceRoutes);

app.get('/api/health', async (req, res) => {
  const { isOllamaAvailable } = await import('./services/embeddings.js');
  let gmailStatus = { connected: false };
  try { gmailStatus = await gmail.getStatus(); } catch {}
  const response = {
    status: 'online',
    system: 'USS Enterprise Computer',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    vectordb: 'online',
    ollama: await isOllamaAvailable() ? 'online' : 'offline',
    gateway: {
      enabled: true,
      running: true,
      connected: true,
      mode: 'local',
    },
    gmail: gmailStatus,
    moshi: getMoshiStatus(),
    config: getConfigSummary(),
  };
  // Provide auth token to same-origin UI (strict origin check)
  const origin = req.get('origin') || '';
  if (!origin || origin === `http://localhost:${PORT}` || origin === `http://127.0.0.1:${PORT}`) {
    response.authToken = getAuthToken();
  }
  res.json(response);
});

app.get('/api/security/stats', (req, res) => {
  res.json(getSecurityStats());
});

// ── Local Service Endpoints (same paths as old gateway) ──────────

app.get('/api/gateway/status', (req, res) => {
  res.json({
    process: { running: true, pid: process.pid, port: PORT, uptime: Math.floor(process.uptime() * 1000), mode: 'local' },
    client: { connected: true },
    config: getConfigSummary(),
  });
});

app.get('/api/gateway/channels', async (req, res) => {
  try {
    let gmailStatus = { connected: false };
    try { gmailStatus = await gmail.getStatus(); } catch {}
    const channels = [];
    if (gmailStatus.connected) {
      channels.push({ id: 'gmail', name: 'Gmail', type: 'email', connected: true, email: gmailStatus.email });
    }
    res.json({ channels, connected: true });
  } catch {
    res.json({ channels: [], connected: true });
  }
});

app.get('/api/gateway/sessions', async (req, res) => {
  try {
    const sessions = listSessions();
    res.json({ sessions, connected: true });
  } catch (err) {
    res.json({ sessions: [], connected: true, error: err.message });
  }
});

app.get('/api/gateway/nodes', async (req, res) => {
  try {
    const nodes = listNodes();
    res.json({ nodes, connected: true });
  } catch (err) {
    res.json({ nodes: [], connected: true, error: err.message });
  }
});

app.get('/api/gateway/models', async (req, res) => {
  try {
    const models = await listModels();
    res.json({ models, connected: true });
  } catch (err) {
    res.json({ models: [], connected: true, error: err.message });
  }
});

app.get('/api/gateway/cron', async (req, res) => {
  try {
    const jobs = listJobs();
    res.json({ jobs, connected: true });
  } catch (err) {
    res.json({ jobs: [], connected: true, error: err.message });
  }
});

app.post('/api/gateway/send', sensitiveLimit, async (req, res) => {
  const { channel, target, text, subject, attachments, replyTo, threadId } = req.body;
  if (!channel || !target || !text) {
    return res.status(400).json({ error: 'channel, target, and text are required' });
  }

  // Route to Gmail for email sends
  if (channel === 'gmail' || channel === 'email') {
    try {
      const result = await gmail.sendMessage({
        to: target,
        subject: subject || '',
        body: text,
        inReplyTo: replyTo || threadId,
      });
      return res.json({ ok: true, result });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  }

  res.status(400).json({ ok: false, error: 'Channel ' + channel + ' not available. Supported: gmail' });
});

app.get('/api/gateway/plugins', async (req, res) => {
  try {
    const plugins = listPlugins();
    res.json({ plugins, connected: true });
  } catch (err) {
    res.json({ plugins: [], connected: true, error: err.message });
  }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(PLUGIN_ROOT, 'ui', 'index.html'));
});

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });
initWebSocket(wss, `http://localhost:${PORT}`);

// Authenticate WebSocket upgrade requests before completing handshake
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  const expected = getAuthToken();
  if (!expected || token !== expected) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

server.listen(PORT, () => {
  const token = getAuthToken();
  console.log(`\n  ============================`);
  console.log(`  COMPUTER ONLINE`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Auth Token: ${token.slice(0, 8)}...`);
  console.log(`  Token file: data/.auth-token`);
  console.log(`  Mode: LOCAL (self-contained)`);
  console.log(`  ============================\n`);
});

// ── Graceful Shutdown ─────────────────────────────────────

async function shutdown(signal) {
  console.log(`\n[computer] Received ${signal}, shutting down...`);
  stopMoshi();
  server.close(() => {
    console.log('[computer] Server closed');
    process.exit(0);
  });
  // Force exit after 10s
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
