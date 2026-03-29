/**
 * Voxtral STT Sidecar Service
 *
 * Manages the Voxtral STT Python sidecar process that provides local
 * speech-to-text via mlx-audio on Apple Silicon (Metal GPU acceleration).
 *
 * The sidecar loads the Voxtral Mini 3B model once and serves HTTP requests
 * for transcription. This avoids the ~5s model cold-start per request.
 *
 * Sidecar: scripts/voxtral-stt-server.py on port 8997
 */

import { spawn } from 'child_process';
import path from 'path';

const VOXTRAL_PORT = parseInt(process.env.VOXTRAL_STT_PORT || '8997', 10);
const VOXTRAL_URL = `http://127.0.0.1:${VOXTRAL_PORT}`;

let sidecarProcess = null;
let sidecarReady = false;

/**
 * Start the Voxtral STT sidecar process.
 * Non-fatal — if Python or mlx-audio isn't available, logs and returns false.
 */
export async function startVoxtralSTT(pluginRoot) {
  if (sidecarProcess) {
    console.log('[voxtral-stt] Already running (pid ' + sidecarProcess.pid + ')');
    return true;
  }

  // Check if sidecar is already running externally
  if (await isVoxtralReady()) {
    console.log('[voxtral-stt] External sidecar already running on port ' + VOXTRAL_PORT);
    sidecarReady = true;
    return true;
  }

  const scriptPath = path.join(pluginRoot, 'scripts', 'voxtral-stt-server.py');
  const python = process.env.VOXTRAL_PYTHON || 'python3';

  console.log('[voxtral-stt] Starting sidecar: ' + python + ' ' + scriptPath);

  return new Promise((resolve) => {
    try {
      sidecarProcess = spawn(python, [scriptPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          VOXTRAL_STT_PORT: String(VOXTRAL_PORT),
          HF_HOME: path.join(process.env.HOME || '/tmp', '.cache', 'huggingface'),
        },
      });

      let resolved = false;

      const onOutput = (data) => {
        const line = data.toString().trim();
        if (line) console.log('[voxtral-stt] ' + line);
        if (!resolved && line.includes('Ready for transcription')) {
          sidecarReady = true;
          resolved = true;
          resolve(true);
        }
      };

      sidecarProcess.stdout.on('data', onOutput);
      sidecarProcess.stderr.on('data', onOutput);

      sidecarProcess.on('error', (err) => {
        console.error('[voxtral-stt] Failed to start: ' + err.message);
        sidecarProcess = null;
        sidecarReady = false;
        if (!resolved) { resolved = true; resolve(false); }
      });

      sidecarProcess.on('exit', (code) => {
        console.log('[voxtral-stt] Process exited with code ' + code);
        sidecarProcess = null;
        sidecarReady = false;
        if (!resolved) { resolved = true; resolve(false); }
      });

      // Model load can take 10-30s on first run
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          console.log('[voxtral-stt] Startup timeout (model may still be loading)');
          resolve(false);
        }
      }, 120_000);

    } catch (err) {
      console.error('[voxtral-stt] Spawn error: ' + err.message);
      resolve(false);
    }
  });
}

/**
 * Stop the Voxtral STT sidecar process.
 */
export function stopVoxtralSTT() {
  if (sidecarProcess) {
    console.log('[voxtral-stt] Stopping sidecar (pid ' + sidecarProcess.pid + ')');
    sidecarProcess.kill('SIGTERM');
    sidecarProcess = null;
  }
  sidecarReady = false;
}

/**
 * Check if the sidecar HTTP server is responding.
 */
export async function isVoxtralReady() {
  try {
    const res = await fetch(VOXTRAL_URL + '/health', { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      return data.status === 'ready';
    }
  } catch {}
  return false;
}

/**
 * Get the current status of the Voxtral STT sidecar.
 */
export function getVoxtralSTTStatus() {
  return {
    running: sidecarProcess !== null,
    ready: sidecarReady,
    port: VOXTRAL_PORT,
    pid: sidecarProcess?.pid || null,
  };
}

/**
 * Transcribe an audio buffer by sending it to the sidecar.
 *
 * @param {Buffer} audioBuffer - Raw audio data (WAV preferred)
 * @param {string} language - Language code (default: 'en')
 * @param {number} maxTokens - Max tokens to generate (default: 256)
 * @returns {Promise<{text: string, latency_ms: number}>}
 */
export async function transcribeViaVoxtral(audioBuffer, language = 'en', maxTokens = 256) {
  if (!sidecarReady) {
    // Try a health check — sidecar may have started externally
    sidecarReady = await isVoxtralReady();
    if (!sidecarReady) {
      throw new Error('Voxtral STT sidecar not ready');
    }
  }

  const res = await fetch(VOXTRAL_URL + '/transcribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Language': language,
      'X-Max-Tokens': String(maxTokens),
    },
    body: audioBuffer,
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || 'Voxtral transcription failed');
  }

  return res.json();
}

export { VOXTRAL_PORT };
