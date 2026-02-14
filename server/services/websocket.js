import { transcribeChunk } from './transcription.js';

const clients = new Set();

// Limit concurrent Whisper chunk processes to 1
let whisperBusy = false;
const whisperQueue = [];

async function processChunk(ws, audioBuffer) {
  if (whisperBusy) {
    // Queue it — drop if queue is too long (avoid backlog)
    if (whisperQueue.length < 3) {
      whisperQueue.push({ ws, audioBuffer });
    }
    return;
  }

  whisperBusy = true;
  try {
    const text = await transcribeChunk(audioBuffer, 'webm');
    if (text && text.length > 0 && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'stt_result', data: { text } }));
    }
  } catch (err) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'stt_error', data: { error: err.message } }));
    }
  } finally {
    whisperBusy = false;
    // Process next queued chunk
    if (whisperQueue.length > 0) {
      const next = whisperQueue.shift();
      processChunk(next.ws, next.audioBuffer);
    }
  }
}

export function initWebSocket(wss) {
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));

    // Handle incoming messages (binary = audio chunk, text = JSON)
    ws.on('message', (message, isBinary) => {
      if (isBinary) {
        processChunk(ws, Buffer.from(message));
      }
      // Text messages reserved for future client-to-server JSON commands
    });

    // Send welcome
    ws.send(JSON.stringify({ type: 'status', data: { message: 'Computer online', connected: true } }));
  });

  // Heartbeat every 30s
  setInterval(() => {
    for (const ws of clients) {
      if (ws.readyState === 1) {
        ws.ping();
      } else {
        clients.delete(ws);
      }
    }
  }, 30000);
}

export function broadcast(type, data) {
  const message = JSON.stringify({ type, data });
  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(message);
    }
  }
}
