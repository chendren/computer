import { transcribeChunk } from './transcription.js';
import { getAuthToken } from '../middleware/auth.js';
import { processVoiceCommand, isVoiceAvailable } from './voice-assistant.js';

const clients = new Set();

// Limit concurrent Whisper chunk processes to 1
let whisperBusy = false;
const whisperQueue = [];

async function processChunk(ws, audioBuffer) {
  console.log(`[ws] processChunk: ${audioBuffer.length} bytes, whisperBusy: ${whisperBusy}, queue: ${whisperQueue.length}`);
  if (whisperBusy) {
    // Queue it — drop if queue is too long (avoid backlog)
    if (whisperQueue.length < 3) {
      whisperQueue.push({ ws, audioBuffer });
      console.log('[ws] Queued chunk (whisper busy)');
    } else {
      console.log('[ws] Dropped chunk (queue full)');
    }
    return;
  }

  whisperBusy = true;
  try {
    // Detect WAV vs webm from buffer header
    const format = detectAudioFormat(audioBuffer);
    console.log(`[ws] Transcribing chunk: format=${format}, size=${audioBuffer.length}`);
    const text = await transcribeChunk(audioBuffer, format);
    console.log(`[ws] Transcription result: "${text}"`);
    if (text && text.length > 0 && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'stt_result', data: { text } }));
      console.log(`[ws] Sent stt_result: "${text}"`);
    }
  } catch (err) {
    console.error(`[ws] Transcription error:`, err.message);
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

/**
 * Detect audio format from buffer header bytes.
 * WAV files start with "RIFF", everything else assumed webm.
 */
function detectAudioFormat(buffer) {
  if (buffer.length >= 4 &&
      buffer[0] === 0x52 && buffer[1] === 0x49 &&
      buffer[2] === 0x46 && buffer[3] === 0x46) {
    return 'wav';
  }
  return 'webm';
}

/**
 * Create a tool executor that maps voice-assistant tool calls
 * to internal API endpoints via localhost fetch.
 */
function createToolExecutor(baseUrl, ws) {
  return async (toolName, input) => {
    switch (toolName) {
      case 'search_knowledge': {
        const res = await fetch(`${baseUrl}/api/knowledge/search`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ query: input.query, limit: input.limit || 5 }),
        });
        return await res.json();
      }
      case 'store_knowledge': {
        const res = await fetch(`${baseUrl}/api/knowledge`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ text: input.text, title: input.title }),
        });
        return await res.json();
      }
      case 'create_log': {
        const res = await fetch(`${baseUrl}/api/logs`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ text: input.text }),
        });
        return await res.json();
      }
      case 'display_on_screen': {
        broadcast('voice_panel_switch', { panel: input.panel });
        return { ok: true, panel: input.panel };
      }
      case 'send_message': {
        const res = await fetch(`${baseUrl}/api/gateway/send`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ channel: input.channel, target: input.target, text: input.text }),
        });
        return await res.json();
      }
      case 'list_channels': {
        const res = await fetch(`${baseUrl}/api/gateway/channels`, { headers: authHeaders() });
        return await res.json();
      }
      case 'get_status': {
        const res = await fetch(`${baseUrl}/api/health`, { headers: authHeaders() });
        const data = await res.json();
        // Strip auth token from tool result
        delete data.authToken;
        return data;
      }
      case 'search_transcripts': {
        const res = await fetch(`${baseUrl}/api/transcripts?q=${encodeURIComponent(input.query)}`, {
          headers: authHeaders(),
        });
        return await res.json();
      }
      case 'create_monitor': {
        const res = await fetch(`${baseUrl}/api/monitors`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ name: input.name, target: input.target }),
        });
        return await res.json();
      }
      case 'get_briefing': {
        const [transcripts, logs] = await Promise.all([
          fetch(`${baseUrl}/api/transcripts?limit=10`, { headers: authHeaders() }).then(r => r.json()),
          fetch(`${baseUrl}/api/logs?limit=10`, { headers: authHeaders() }).then(r => r.json()),
        ]);
        return { transcripts, logs };
      }
      case 'generate_chart': {
        const chartConfig = {
          type: input.type,
          data: {
            labels: input.labels,
            datasets: [{ label: input.title, data: input.data }],
          },
          options: { plugins: { title: { display: true, text: input.title } } },
        };
        broadcast('chart', { chartConfig });
        return { ok: true, chart: input.title };
      }
      case 'browse_url': {
        broadcast('browser_navigate', { url: input.url });
        return { ok: true, url: input.url };
      }
      case 'analyze_text': {
        const res = await fetch(`${baseUrl}/api/analysis`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ text: input.text, title: input.title }),
        });
        return await res.json();
      }
      case 'web_fetch': {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          const res = await fetch(input.url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
            },
          });
          clearTimeout(timeout);
          const text = await res.text();
          // Try JSON first
          if (res.headers.get('content-type')?.includes('json')) {
            return { url: input.url, status: res.status, content: text.slice(0, 8000) };
          }
          // Strip script/style blocks first, then tags
          let clean = text.replace(/<script[\s\S]*?<\/script>/gi, '');
          clean = clean.replace(/<style[\s\S]*?<\/style>/gi, '');
          clean = clean.replace(/<nav[\s\S]*?<\/nav>/gi, '');
          clean = clean.replace(/<header[\s\S]*?<\/header>/gi, '');
          clean = clean.replace(/<footer[\s\S]*?<\/footer>/gi, '');
          clean = clean.replace(/<!--[\s\S]*?-->/g, '');
          clean = clean.replace(/<[^>]*>/g, ' ');
          clean = clean.replace(/&nbsp;/g, ' ');
          clean = clean.replace(/&amp;/g, '&');
          clean = clean.replace(/&lt;/g, '<');
          clean = clean.replace(/&gt;/g, '>');
          clean = clean.replace(/\s+/g, ' ').trim().slice(0, 8000);
          return { url: input.url, status: res.status, content: clean };
        } catch (err) {
          return { error: `Failed to fetch ${input.url}: ${err.message}` };
        }
      }
      case 'web_search': {
        try {
          const query = encodeURIComponent(input.query);
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          const res = await fetch(`https://html.duckduckgo.com/html/?q=${query}`, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            },
          });
          clearTimeout(timeout);
          const html = await res.text();
          // Extract search result snippets
          const results = [];
          const snippetRe = /<a[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
          let m;
          while ((m = snippetRe.exec(html)) !== null && results.length < 8) {
            const title = m[1].replace(/<[^>]*>/g, '').trim();
            const snippet = m[2].replace(/<[^>]*>/g, '').trim();
            if (title && snippet) results.push({ title, snippet });
          }
          if (results.length === 0) {
            // Fallback: extract all text from result blocks
            let clean = html.replace(/<script[\s\S]*?<\/script>/gi, '');
            clean = clean.replace(/<style[\s\S]*?<\/style>/gi, '');
            clean = clean.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
            return { query: input.query, results: [], rawText: clean };
          }
          return { query: input.query, results };
        } catch (err) {
          return { error: `Search failed: ${err.message}` };
        }
      }
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  };
}

function authHeaders() {
  const token = getAuthToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Handle a voice command: Claude Haiku processing → TTS → response.
 */
async function handleVoiceCommand(ws, sessionId, text, baseUrl) {
  console.log(`[ws] handleVoiceCommand: sessionId=${sessionId}, text="${text}"`);
  try {
    sendTo(ws, 'voice_thinking', {});

    const toolExecutor = createToolExecutor(baseUrl, ws);
    const result = await processVoiceCommand(sessionId, text, toolExecutor);
    console.log(`[ws] Voice result: text="${result.text?.slice(0, 100)}", tools=[${result.toolsUsed?.join(', ')}], panel=${result.panelSwitch}`);

    // Generate TTS for the response
    let audioUrl = null;
    if (result.text) {
      try {
        const ttsRes = await fetch(`${baseUrl}/api/tts/speak`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ text: result.text }),
        });
        const ttsData = await ttsRes.json();
        audioUrl = ttsData.audioUrl || null;
        console.log(`[ws] TTS: audioUrl=${audioUrl}`);
      } catch (err) {
        console.error(`[ws] TTS failed:`, err.message);
      }
    }

    if (result.panelSwitch) {
      broadcast('voice_panel_switch', { panel: result.panelSwitch });
    }

    sendTo(ws, 'voice_response', {
      text: result.text,
      audioUrl,
      toolsUsed: result.toolsUsed,
      panelSwitch: result.panelSwitch,
    });
  } catch (err) {
    console.error(`[ws] handleVoiceCommand ERROR:`, err);
    sendTo(ws, 'voice_error', { error: err.message || 'Voice processing failed' });
  } finally {
    sendTo(ws, 'voice_done', {});
  }
}

function sendTo(ws, type, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type, data }));
  }
}

export function initWebSocket(wss, baseUrl) {
  wss.on('connection', (ws, req) => {
    // Authenticate WebSocket connections via query param
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const authToken = getAuthToken();
    if (authToken && token !== authToken) {
      ws.close(4001, 'Authentication required');
      return;
    }

    // Assign a session ID for voice conversation history
    const sessionId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));

    // Handle incoming messages (binary = audio chunk, text = JSON)
    ws.on('message', (message, isBinary) => {
      if (isBinary) {
        console.log(`[ws] Received binary message: ${message.byteLength} bytes`);
        processChunk(ws, Buffer.from(message));
        return;
      }

      // Parse JSON text messages
      const raw = message.toString();
      console.log(`[ws] Received text message: ${raw.slice(0, 200)}`);
      try {
        const msg = JSON.parse(raw);
        switch (msg.type) {
          case 'voice_command':
            console.log(`[ws] voice_command: "${msg.data?.text}", voiceAvailable: ${isVoiceAvailable()}`);
            if (msg.data?.text && isVoiceAvailable()) {
              handleVoiceCommand(ws, sessionId, msg.data.text, baseUrl);
            } else if (!isVoiceAvailable()) {
              sendTo(ws, 'voice_error', { error: 'ANTHROPIC_API_KEY not configured' });
            }
            break;
          case 'voice_start':
            console.log('[ws] voice_start received');
            sendTo(ws, 'status', { message: 'Voice assistant active' });
            break;
          case 'voice_cancel':
            console.log('[ws] voice_cancel received');
            sendTo(ws, 'status', { message: 'Voice assistant inactive' });
            break;
          default:
            console.log(`[ws] Unknown message type: ${msg.type}`);
            break;
        }
      } catch (err) {
        console.error('[ws] Failed to parse JSON message:', err.message);
      }
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
