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
import { securityScan, getSecurityStats } from './middleware/security.js';

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

app.use('/api/knowledge', knowledgeRoutes);
app.use('/api', apiRoutes);
app.use('/api/transcribe', transcribeRoutes);
app.use('/api/claude', claudeRoutes);
app.use('/api/tts', ttsRoutes);

app.get('/api/health', async (req, res) => {
  const { isOllamaAvailable } = await import('./services/embeddings.js');
  res.json({
    status: 'online',
    system: 'USS Enterprise Computer',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    vectordb: 'online',
    ollama: await isOllamaAvailable() ? 'online' : 'offline',
  });
});

app.get('/api/security/stats', (req, res) => {
  res.json(getSecurityStats());
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
  console.log(`  ============================\n`);
});
