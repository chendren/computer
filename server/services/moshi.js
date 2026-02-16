/**
 * Moshi Speech-to-Speech Service
 *
 * Manages the Moshi MLX sidecar process and provides a WebSocket bridge
 * for full-duplex voice conversation with ~200ms latency.
 *
 * Protocol (from moshi_mlx):
 *   WebSocket at ws://localhost:8998/api/chat
 *   Binary messages with 1-byte kind prefix:
 *     0x00 = Handshake (server→client, contains config JSON)
 *     0x01 = Opus audio frame (bidirectional, 24kHz mono)
 *     0x02 = UTF-8 text token (server→client)
 */

import { spawn } from 'child_process';
import { WebSocket } from 'ws';
import path from 'path';

const MOSHI_PORT = parseInt(process.env.MOSHI_PORT || '8998', 10);
const MOSHI_URL = `ws://localhost:${MOSHI_PORT}/api/chat`;
const MOSHI_HEALTH_URL = `http://localhost:${MOSHI_PORT}`;
const VENV_PYTHON = path.resolve(process.env.MOSHI_VENV || path.join(process.cwd(), 'moshi-env', 'bin', 'python'));

let moshiProcess = null;
let moshiReady = false;
let startAttempts = 0;

// Message kind bytes
const KIND_HANDSHAKE = 0x00;
const KIND_AUDIO = 0x01;
const KIND_TEXT = 0x02;

/**
 * Start the Moshi MLX process as a sidecar.
 * Non-fatal — if Python or moshi_mlx isn't available, logs and returns false.
 */
export async function startMoshi(pluginRoot) {
  if (moshiProcess) {
    console.log('[moshi] Already running (pid ' + moshiProcess.pid + ')');
    return true;
  }

  const pythonPath = pluginRoot
    ? path.join(pluginRoot, 'moshi-env', 'bin', 'python')
    : VENV_PYTHON;

  console.log('[moshi] Starting sidecar: ' + pythonPath + ' -m moshi_mlx.local_web -q 4');
  startAttempts++;

  return new Promise((resolve) => {
    try {
      moshiProcess = spawn(pythonPath, ['-m', 'moshi_mlx.local_web', '-q', '4', '--hf-repo', 'kyutai/moshika-mlx-q4'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, MOSHI_PORT: String(MOSHI_PORT) },
      });

      let resolved = false;

      moshiProcess.stdout.on('data', (data) => {
        const line = data.toString().trim();
        if (line) console.log('[moshi] ' + line);
        // Moshi prints something like "Running on http://0.0.0.0:8998" when ready
        if (!resolved && (line.includes('Running on') || line.includes('Listening') || line.includes(':' + MOSHI_PORT))) {
          moshiReady = true;
          resolved = true;
          console.log('[moshi] Ready on port ' + MOSHI_PORT);
          resolve(true);
        }
      });

      moshiProcess.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line) console.log('[moshi:err] ' + line);
        // Some frameworks log startup info to stderr
        if (!resolved && (line.includes('Running on') || line.includes('Listening') || line.includes(':' + MOSHI_PORT))) {
          moshiReady = true;
          resolved = true;
          console.log('[moshi] Ready on port ' + MOSHI_PORT);
          resolve(true);
        }
      });

      moshiProcess.on('error', (err) => {
        console.error('[moshi] Failed to start: ' + err.message);
        moshiProcess = null;
        moshiReady = false;
        if (!resolved) { resolved = true; resolve(false); }
      });

      moshiProcess.on('exit', (code) => {
        console.log('[moshi] Process exited with code ' + code);
        moshiProcess = null;
        moshiReady = false;
        if (!resolved) { resolved = true; resolve(false); }
      });

      // Timeout: if not ready in 120s (model download may take time on first run),
      // resolve false but leave process running
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          // Check if process is still alive — it might be downloading the model
          if (moshiProcess && !moshiProcess.killed) {
            console.log('[moshi] Startup timeout — process still running (likely downloading model). Will check health later.');
            resolve(false);
          } else {
            resolve(false);
          }
        }
      }, 120000);
    } catch (err) {
      console.error('[moshi] Spawn error: ' + err.message);
      moshiProcess = null;
      resolve(false);
    }
  });
}

/**
 * Stop the Moshi process gracefully.
 */
export function stopMoshi() {
  if (!moshiProcess) return;
  console.log('[moshi] Stopping (pid ' + moshiProcess.pid + ')');
  moshiProcess.kill('SIGTERM');
  // Force kill after 5s
  const pid = moshiProcess.pid;
  setTimeout(() => {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }, 5000);
  moshiProcess = null;
  moshiReady = false;
}

/**
 * Check if Moshi is running and the WebSocket is reachable.
 */
export async function isMoshiRunning() {
  if (!moshiProcess || moshiProcess.killed) {
    moshiReady = false;
    return false;
  }
  // Quick HTTP health check
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(MOSHI_HEALTH_URL, { signal: controller.signal });
    clearTimeout(timeout);
    moshiReady = res.ok || res.status === 404; // Any response means it's alive
    return moshiReady;
  } catch {
    // Process alive but HTTP not responding yet
    return false;
  }
}

/**
 * Get Moshi status for API responses.
 */
export function getMoshiStatus() {
  return {
    running: !!(moshiProcess && !moshiProcess.killed),
    ready: moshiReady,
    pid: moshiProcess?.pid || null,
    port: MOSHI_PORT,
    url: MOSHI_URL,
    startAttempts,
  };
}

/**
 * Create a WebSocket bridge between a browser client and Moshi.
 *
 * Returns a bridge object with:
 *   - sendAudio(opusFrame): send Opus audio to Moshi
 *   - close(): close the bridge
 *   - onText(callback): register text token callback
 *   - onAudio(callback): register audio response callback
 *   - onClose(callback): register close callback
 *   - isOpen(): check if bridge is connected
 */
export function createMoshiBridge() {
  let moshiWs = null;
  let textCallback = null;
  let audioCallback = null;
  let closeCallback = null;
  let handshakeCallback = null;
  let connected = false;

  const bridge = {
    connect() {
      return new Promise((resolve, reject) => {
        try {
          moshiWs = new WebSocket(MOSHI_URL);
          moshiWs.binaryType = 'arraybuffer';

          moshiWs.on('open', () => {
            connected = true;
            console.log('[moshi-bridge] Connected to Moshi');
            resolve(true);
          });

          moshiWs.on('message', (data) => {
            if (data instanceof ArrayBuffer || Buffer.isBuffer(data)) {
              const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
              if (buf.length < 1) return;
              const kind = buf[0];
              const payload = buf.slice(1);

              switch (kind) {
                case KIND_HANDSHAKE:
                  console.log('[moshi-bridge] Handshake received');
                  if (handshakeCallback) {
                    try {
                      handshakeCallback(JSON.parse(payload.toString('utf-8')));
                    } catch {
                      handshakeCallback({});
                    }
                  }
                  break;
                case KIND_AUDIO:
                  if (audioCallback) audioCallback(payload);
                  break;
                case KIND_TEXT:
                  if (textCallback) textCallback(payload.toString('utf-8'));
                  break;
                default:
                  console.log('[moshi-bridge] Unknown kind: 0x' + kind.toString(16));
              }
            }
          });

          moshiWs.on('close', () => {
            connected = false;
            console.log('[moshi-bridge] Disconnected');
            if (closeCallback) closeCallback();
          });

          moshiWs.on('error', (err) => {
            console.error('[moshi-bridge] Error: ' + err.message);
            connected = false;
            reject(err);
          });

          // Timeout
          setTimeout(() => {
            if (!connected) {
              reject(new Error('Moshi connection timeout'));
            }
          }, 10000);
        } catch (err) {
          reject(err);
        }
      });
    },

    sendAudio(opusFrame) {
      if (!moshiWs || moshiWs.readyState !== WebSocket.OPEN) return false;
      // Prepend kind byte 0x01
      const frame = Buffer.alloc(1 + opusFrame.length);
      frame[0] = KIND_AUDIO;
      if (Buffer.isBuffer(opusFrame)) {
        opusFrame.copy(frame, 1);
      } else {
        Buffer.from(opusFrame).copy(frame, 1);
      }
      moshiWs.send(frame);
      return true;
    },

    close() {
      if (moshiWs) {
        try { moshiWs.close(); } catch {}
        moshiWs = null;
      }
      connected = false;
    },

    onText(cb) { textCallback = cb; },
    onAudio(cb) { audioCallback = cb; },
    onClose(cb) { closeCallback = cb; },
    onHandshake(cb) { handshakeCallback = cb; },

    isOpen() { return connected && moshiWs?.readyState === WebSocket.OPEN; },
  };

  return bridge;
}

export { KIND_HANDSHAKE, KIND_AUDIO, KIND_TEXT };
