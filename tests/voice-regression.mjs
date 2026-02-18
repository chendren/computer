#!/usr/bin/env node
/**
 * Voice Pipeline Regression Test Suite
 *
 * Tests all voice features end-to-end against the running server.
 * Run with: node tests/voice-regression.mjs
 *
 * Coverage:
 *  1.  Server health (Ollama, VectorDB, gateway)
 *  2.  Moshi sidecar running and reachable
 *  3.  TTS endpoint generates audio
 *  4.  WebSocket: voice_start → voice_mode_changed:moshi → moshi_handshake
 *  5.  WebSocket: voice_command → voice_thinking → voice_response → voice_done
 *  6.  Wake word detection logic (unit test — no mic needed)
 *  7.  VAD WASM libs served with correct MIME types
 *  8.  LOG SPAM FIX: Ollama check logs only on status change
 *  9.  DUAL-AUDIO FIX: onAudio gated on voiceMode === 'moshi'
 * 10.  WAKE WORD LOOP FIX: onText guarded in Computer mode
 * 11.  THINKING PAUSE FIX: VAD pauses on THINKING state
 * 12.  Voice config API
 * 13.  Runtime log spam check
 */

import { readFileSync, existsSync } from 'fs';
import { WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER = 'http://localhost:3141';
const WS_URL = 'ws://localhost:3141';
const AUTH_TOKEN_FILE = path.join(ROOT, 'data', '.auth-token');

// ── Helpers ────────────────────────────────────────────────

const token = existsSync(AUTH_TOKEN_FILE)
  ? readFileSync(AUTH_TOKEN_FILE, 'utf-8').trim()
  : '';

const authHeaders = {
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

let passed = 0;
let failed = 0;
const results = [];

function pass(name, detail = '') {
  passed++;
  results.push({ status: 'PASS', name, detail });
  console.log(`  ✓ ${name}${detail ? '  — ' + detail : ''}`);
}

function fail(name, reason) {
  failed++;
  results.push({ status: 'FAIL', name, reason });
  console.log(`  ✗ ${name}  — ${reason}`);
}

async function apiFetch(urlPath, { method = 'GET', body = null, useAuth = true } = {}) {
  const res = await fetch(`${SERVER}${urlPath}`, {
    method,
    headers: useAuth ? authHeaders : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
}

function readSource(relPath) {
  return readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// Connect a WebSocket, collect messages for timeout ms, then close
// Server authenticates via ?token= query param on the upgrade request
function wsCollect(timeoutMs, onOpen) {
  return new Promise((resolve) => {
    const messages = [];
    const url = token ? `${WS_URL}?token=${token}` : WS_URL;
    const ws = new WebSocket(url);
    const timer = setTimeout(() => { ws.close(); resolve(messages); }, timeoutMs);
    ws.on('open', () => onOpen && onOpen(ws));
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        try { messages.push(JSON.parse(data.toString())); } catch {}
      }
    });
    ws.on('close', () => { clearTimeout(timer); resolve(messages); });
    ws.on('error', () => { clearTimeout(timer); resolve(messages); });
  });
}

// ── Test groups ────────────────────────────────────────────

async function testServerHealth() {
  console.log('\n── 1. Server Health ─────────────────────────────────');
  try {
    const { status, body } = await apiFetch('/api/health');
    if (status !== 200) return fail('GET /api/health', `HTTP ${status}`);
    pass('Server online', `uptime ${Math.round(body.uptime)}s`);

    if (body.ollama === 'online') pass('Ollama online');
    else fail('Ollama online', `status: ${body.ollama}`);

    if (body.vectordb === 'online') pass('VectorDB online');
    else fail('VectorDB online', `status: ${body.vectordb}`);

    // Verify Moshi is registered in health (voice model info lives in /api/gateway/models)
    if (body.moshi && body.moshi.running) pass('Moshi registered in health', `pid ${body.moshi.pid}`);
    else fail('Voice system in health', `moshi.running not true — got: ${JSON.stringify(body.moshi)}`);
  } catch (err) {
    fail('Server health check', err.message);
  }
}

async function testMoshiStatus() {
  console.log('\n── 2. Moshi Sidecar ─────────────────────────────────');
  try {
    const { status, body } = await apiFetch('/api/voice/moshi/status');
    if (status !== 200) return fail('GET /api/voice/moshi/status', `HTTP ${status}`);

    if (body.running) pass('Moshi process running', `pid ${body.pid}`);
    else fail('Moshi process', 'not running — start it with scripts/start-moshi.sh');

    if (body.ready) pass('Moshi HTTP reachable', `port ${body.port}`);
    else fail('Moshi HTTP', 'process running but HTTP not yet responding');

    // Verify Moshi WebSocket is directly accessible
    const moshiWs = new WebSocket('ws://localhost:8998/api/chat');
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => { moshiWs.close(); reject(new Error('timeout')); }, 5000);
      moshiWs.on('open', () => { clearTimeout(t); moshiWs.close(); resolve(); });
      moshiWs.on('error', (e) => { clearTimeout(t); reject(e); });
    });
    pass('Moshi WebSocket (port 8998) reachable');
  } catch (err) {
    fail('Moshi WebSocket', err.message);
  }
}

async function testTTS() {
  console.log('\n── 3. TTS Endpoint ──────────────────────────────────');
  try {
    const { status, body } = await apiFetch('/api/tts/speak', {
      method: 'POST',
      body: { text: 'Computer online. All systems nominal.' },
    });
    if (status !== 200) return fail('POST /api/tts/speak', `HTTP ${status}: ${JSON.stringify(body)}`);
    if (!body.audioUrl) return fail('TTS returns audioUrl', `got: ${JSON.stringify(body)}`);
    pass('TTS generates audio', body.audioUrl);

    // Verify the audio file is actually fetchable
    const audioRes = await fetch(`${SERVER}${body.audioUrl}`, { headers: authHeaders });
    if (audioRes.ok) pass('TTS audio file served', audioRes.headers.get('content-type') || 'no content-type');
    else fail('TTS audio file', `HTTP ${audioRes.status}`);
  } catch (err) {
    fail('TTS endpoint', err.message);
  }
}

async function testWebSocketVoiceStart() {
  console.log('\n── 4. WebSocket: voice_start → Moshi ───────────────');
  try {
    const messages = await wsCollect(6000, (ws) => {
      // Wait for initial status, then send voice_start
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'voice_start', data: {} }));
      }, 300);
    });

    const modeChanged = messages.find(
      (m) => m.type === 'voice_mode_changed' && m.data && m.data.mode === 'moshi'
    );
    if (modeChanged) pass('voice_mode_changed:moshi received');
    else fail('voice_mode_changed:moshi', `got: ${messages.map((m) => m.type).join(', ')}`);

    const handshake = messages.find((m) => m.type === 'moshi_handshake');
    if (handshake) pass('moshi_handshake received');
    else fail('moshi_handshake', 'not received within 6s');

    const welcome = messages.find((m) => m.type === 'status' && m.data && m.data.connected);
    if (welcome) pass('WebSocket welcome message received');
    else fail('WebSocket welcome', 'no connected:true status message');
  } catch (err) {
    fail('WebSocket voice_start', err.message);
  }
}

async function testWebSocketVoiceCommand() {
  console.log('\n── 5. WebSocket: voice_command → response ───────────');
  console.log('  (waiting up to 45s for LLM response...)');
  try {
    const messages = await wsCollect(45000, (ws) => {
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'voice_command', data: { text: 'what time is it' } }));
      }, 300);
    });

    const thinking = messages.find((m) => m.type === 'voice_thinking');
    if (thinking) pass('voice_thinking received');
    else fail('voice_thinking', 'not received');

    const response = messages.find((m) => m.type === 'voice_response');
    if (!response) return fail('voice_response', `got: ${messages.map((m) => m.type).join(', ')}`);
    pass('voice_response received');

    if (response.data && response.data.text && response.data.text.length > 0)
      pass('Response has text', `"${response.data.text.slice(0, 60)}"`);
    else fail('Response text', 'empty or missing');

    if (response.data && response.data.audioUrl)
      pass('Response has audioUrl', response.data.audioUrl);
    else fail('Response audioUrl', 'missing — TTS may have failed');

    const done = messages.find((m) => m.type === 'voice_done');
    if (done) pass('voice_done received');
    else fail('voice_done', 'not received');
  } catch (err) {
    fail('WebSocket voice_command', err.message);
  }
}

async function testWakeWordDetection() {
  console.log('\n── 6. Wake Word Detection Logic (unit tests) ────────');

  // Inline the same logic as server/services/websocket.js detectWakeWord — no regex
  const WAKE_WORDS = ['computer,', 'computer.', 'computer!', 'computer '];
  function detectWakeWord(text) {
    const lower = text.toLowerCase().trim();
    if (lower === 'computer') return { detected: true, command: '' };
    for (const wake of WAKE_WORDS) {
      const idx = lower.indexOf(wake);
      if (idx !== -1) {
        const command = text.slice(idx + wake.length).trim();
        return { detected: true, command };
      }
    }
    return { detected: false, command: '' };
  }

  const cases = [
    ['computer, what time is it', true, 'what time is it'],
    ['Computer. report status', true, 'report status'],
    ['computer! red alert', true, 'red alert'],
    ['hello computer what day is it', true, 'what day is it'],
    ['computer', true, ''],
    ['hey computer', false, ''],        // no punctuation/space after
    ['computerized system', false, ''], // no separator
    ['', false, ''],
    ['what is the time', false, ''],
  ];

  let allPassed = true;
  for (const [input, expectedDetected, expectedCommand] of cases) {
    const { detected, command } = detectWakeWord(input);
    if (detected !== expectedDetected || (expectedDetected && command !== expectedCommand)) {
      fail(
        `detectWakeWord("${input}")`,
        `expected detected=${expectedDetected} cmd="${expectedCommand}", got detected=${detected} cmd="${command}"`
      );
      allPassed = false;
    }
  }
  if (allPassed) pass('All 9 wake word detection cases correct');
}

async function testVADLibs() {
  console.log('\n── 7. VAD WASM Libs ─────────────────────────────────');
  const libs = [
    { path: '/lib/silero_vad.onnx', minBytes: 1_000_000, mustInclude: null },
    { path: '/lib/vad.worklet.bundle.min.js', minBytes: 1000, mustInclude: 'javascript' },
    { path: '/lib/ort-wasm-simd-threaded.wasm', minBytes: 1000, mustInclude: null },
  ];

  for (const lib of libs) {
    try {
      const res = await fetch(`${SERVER}${lib.path}`);
      if (!res.ok) { fail(lib.path, `HTTP ${res.status}`); continue; }
      const ct = res.headers.get('content-type') || '';
      const buf = await res.arrayBuffer();
      const bytes = buf.byteLength;
      if (bytes < lib.minBytes) {
        fail(`${lib.path} size`, `${bytes} bytes (min ${lib.minBytes})`);
        continue;
      }
      if (lib.mustInclude && !ct.includes(lib.mustInclude)) {
        fail(`${lib.path} MIME`, `got "${ct}", expected to include "${lib.mustInclude}"`);
        continue;
      }
      pass(lib.path, `${Math.round(bytes / 1024)} KB  ${ct}`);
    } catch (err) {
      fail(lib.path, err.message);
    }
  }
}

// ── Static source regression tests ─────────────────────────

async function testLogSpamFix() {
  console.log('\n── 8. Regression: Log spam fix ──────────────────────');
  try {
    const src = readSource('server/services/voice-assistant.js');

    if (src.includes('_lastLoggedAvailable'))
      pass('_lastLoggedAvailable guard variable present');
    else
      fail('Log spam fix', '_lastLoggedAvailable not found in voice-assistant.js');

    if (src.includes('_ollamaAvailable !== _lastLoggedAvailable'))
      pass('Status-change-only logging condition present');
    else
      fail('Log spam fix', 'status-change condition not found');
  } catch (err) {
    fail('Log spam fix (source check)', err.message);
  }
}

async function testDualAudioFix() {
  console.log('\n── 9. Regression: Dual-audio fix ────────────────────');
  try {
    const src = readSource('server/services/websocket.js');

    // Find the onAudio block and verify the mode guard is inside it
    const onAudioIdx = src.indexOf('bridge.onAudio');
    if (onAudioIdx === -1) return fail('Dual-audio fix', 'bridge.onAudio not found in websocket.js');

    // Find the closing of the onAudio callback (next bridge. call)
    const onTextIdx = src.indexOf('bridge.onText', onAudioIdx);
    const onAudioBlock = onTextIdx !== -1 ? src.slice(onAudioIdx, onTextIdx) : src.slice(onAudioIdx, onAudioIdx + 400);

    if (onAudioBlock.includes("state.voiceMode === 'moshi'"))
      pass("bridge.onAudio gated on voiceMode === 'moshi'");
    else
      fail('Dual-audio fix', "onAudio block missing voiceMode === 'moshi' guard");

    // Guard must appear before ws.send in that block
    const guardPos = onAudioBlock.indexOf("state.voiceMode === 'moshi'");
    const sendPos = onAudioBlock.indexOf('ws.send(frame)');
    if (guardPos !== -1 && sendPos !== -1 && guardPos < sendPos)
      pass('Mode guard appears before ws.send in onAudio');
    else
      fail('Dual-audio guard position', 'guard not before ws.send in onAudio block');
  } catch (err) {
    fail('Dual-audio fix (source check)', err.message);
  }
}

async function testWakeWordLoopFix() {
  console.log('\n── 10. Regression: Wake word loop fix ───────────────');
  try {
    const src = readSource('server/services/websocket.js');

    // Check onText guard
    const guard = "state.voiceMode !== 'moshi') return";
    if (src.includes(guard))
      pass("bridge.onText guarded — Computer mode blocks wake word re-detection");
    else
      fail('Wake word loop fix', "onText missing 'voiceMode !== moshi' guard");

    // Verify voice_cancel case does NOT reset voiceMode
    // voice_cancel is the last case before default — use 'default:' as end boundary
    const cancelStart = src.indexOf("case 'voice_cancel'");
    const defaultIdx = src.indexOf('default:', cancelStart > -1 ? cancelStart : 0);
    if (cancelStart !== -1) {
      const endIdx = defaultIdx !== -1 ? defaultIdx : cancelStart + 500;
      const cancelBlock = src.slice(cancelStart, endIdx);
      if (cancelBlock.includes("voiceMode = 'computer'"))
        fail("voice_cancel mode preservation", "voice_cancel still resets voiceMode to 'computer'");
      else
        pass("voice_cancel preserves voiceMode (no mode reset)");
    } else {
      fail("voice_cancel block", "could not locate voice_cancel case in websocket.js");
    }
  } catch (err) {
    fail('Wake word loop fix (source check)', err.message);
  }
}

async function testThinkingPauseFix() {
  console.log('\n── 11. Regression: THINKING pause fix ───────────────');
  try {
    const src = readSource('ui/js/components/voice-assistant-ui.js');

    // THINKING should trigger VAD pause
    if (src.includes('STATES.SPEAKING || newState === STATES.THINKING'))
      pass('VAD paused on both SPEAKING and THINKING states');
    else
      fail('THINKING pause fix', 'STATES.THINKING not in VAD pause condition in _setState');

    // Default voiceMode must be 'moshi'
    const constructorStart = src.indexOf('constructor(');
    const constructorBody = constructorStart !== -1 ? src.slice(constructorStart, constructorStart + 600) : '';
    if (constructorBody.includes("voiceMode = 'moshi'"))
      pass("Default voiceMode is 'moshi'");
    else
      fail('Default voiceMode', "constructor does not set voiceMode = 'moshi'");

    // Mode button must default to MOSHI text
    if (constructorBody.includes("'MOSHI'") || src.includes("textContent = 'MOSHI'"))
      pass("Mode button defaults to 'MOSHI' label");
    else
      fail('Mode button default', "mode button not labeled 'MOSHI' by default");
  } catch (err) {
    fail('THINKING pause fix (source check)', err.message);
  }
}

async function testVoiceConfig() {
  console.log('\n── 12. Voice Config API ─────────────────────────────');
  try {
    const { status, body } = await apiFetch('/api/voice/config');
    if (status !== 200) return fail('GET /api/voice/config', `HTTP ${status}`);
    pass('Voice config reachable');

    if (body.vad) pass('VAD config present', JSON.stringify(body.vad).slice(0, 80));
    else fail('VAD config', 'vad field missing from response');

    if (body.stt) pass('STT config present');
    if (body.moshi) pass('Moshi config present');
  } catch (err) {
    fail('Voice config API', err.message);
  }
}

async function testRuntimeLogSpam() {
  console.log('\n── 13. Runtime: Log spam check ──────────────────────');
  try {
    const logFile = path.join(ROOT, 'data', 'server.log');
    if (!existsSync(logFile)) return fail('server.log', 'file not found at data/server.log');

    const log = readFileSync(logFile, 'utf-8');

    // Find the last server startup line — all logs after that are from current run
    const startupMarker = 'Express listening';
    const lastStartIdx = log.lastIndexOf(startupMarker);
    const currentRunLog = lastStartIdx !== -1 ? log.slice(lastStartIdx) : log;

    // Count occurrences by splitting on the marker string
    const spamMarker = '[voice-ai] Ollama available';
    const occurrences = currentRunLog.split(spamMarker).length - 1;

    if (occurrences <= 1)
      pass(`Ollama log: ${occurrences} occurrence(s) since server start`, '(expected ≤ 1)');
    else
      fail('Log spam', `${occurrences} "Ollama available" lines since server start — fix not active`);
  } catch (err) {
    fail('Log spam check', err.message);
  }
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Voice Pipeline Regression Test Suite');
  console.log(`  Server: ${SERVER}`);
  console.log(`  Auth:   ${token ? 'token present' : 'NO TOKEN — some tests may fail'}`);
  console.log('═══════════════════════════════════════════════════════');

  await testServerHealth();
  await testMoshiStatus();
  await testTTS();
  await testWebSocketVoiceStart();
  await testWebSocketVoiceCommand(); // slowest — waits for LLM (~30-45s)
  await testWakeWordDetection();
  await testVADLibs();
  await testLogSpamFix();
  await testDualAudioFix();
  await testWakeWordLoopFix();
  await testThinkingPauseFix();
  await testVoiceConfig();
  await testRuntimeLogSpam();

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════\n');

  if (failed > 0) {
    console.log('FAILURES:');
    for (const r of results.filter((r) => r.status === 'FAIL')) {
      console.log(`  ✗ ${r.name}`);
      console.log(`    ${r.reason}`);
    }
    process.exit(1);
  } else {
    console.log('All tests passed. Voice pipeline is fully operational.\n');
  }
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
