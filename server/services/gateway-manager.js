/**
 * Gateway Process Manager
 *
 * Manages the OpenClaw gateway as a supervised child process.
 * Provides start/stop/restart lifecycle and auto-restart on crash.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { redactString } from '../middleware/security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLAWDBOT_ROOT = path.resolve(__dirname, '..', '..', '..', '..', 'clawdbot');
const GATEWAY_ENTRY = path.join(CLAWDBOT_ROOT, 'dist', 'index.js');

const DEFAULT_PORT = 18789;
const RESTART_BACKOFF_BASE_MS = 2000;
const RESTART_BACKOFF_MAX_MS = 30000;
const MAX_RESTART_ATTEMPTS = 10;
const RESTART_WINDOW_MS = 60000; // Reset restart count after 60s of stability

let gatewayProcess = null;
let restartAttempts = 0;
let lastStartTime = 0;
let autoRestart = true;
let gatewayPort = DEFAULT_PORT;
let gatewayToken = null;

/**
 * Start the OpenClaw gateway as a child process.
 */
export async function startGateway(options = {}) {
  if (gatewayProcess && !gatewayProcess.killed) {
    console.log('[gateway-manager] Gateway already running (pid %d)', gatewayProcess.pid);
    return { pid: gatewayProcess.pid, port: gatewayPort };
  }

  gatewayPort = options.port || process.env.OPENCLAW_GATEWAY_PORT || DEFAULT_PORT;
  gatewayToken = options.token || process.env.OPENCLAW_GATEWAY_TOKEN || null;

  const args = ['gateway', 'run', '--port', String(gatewayPort)];

  const env = {
    ...process.env,
    OPENCLAW_GATEWAY_PORT: String(gatewayPort),
  };
  if (gatewayToken) {
    env.OPENCLAW_GATEWAY_TOKEN = gatewayToken;
  }

  console.log('[gateway-manager] Starting gateway on port %d ...', gatewayPort);

  gatewayProcess = spawn('node', [GATEWAY_ENTRY, ...args], {
    cwd: CLAWDBOT_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  lastStartTime = Date.now();

  gatewayProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      console.log('[gateway] %s', redactString(line));
    }
  });

  gatewayProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      console.error('[gateway] %s', redactString(line));
    }
  });

  gatewayProcess.on('exit', (code, signal) => {
    const pid = gatewayProcess?.pid;
    gatewayProcess = null;
    console.log('[gateway-manager] Gateway exited (code=%s signal=%s pid=%d)', code, signal, pid);

    if (autoRestart && code !== 0) {
      scheduleRestart();
    }
  });

  gatewayProcess.on('error', (err) => {
    console.error('[gateway-manager] Failed to start gateway:', err.message);
    gatewayProcess = null;
  });

  // Wait briefly to see if it crashes immediately
  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (gatewayProcess && !gatewayProcess.killed) {
    console.log('[gateway-manager] Gateway started (pid %d, port %d)', gatewayProcess.pid, gatewayPort);
    return { pid: gatewayProcess.pid, port: gatewayPort };
  }

  throw new Error('Gateway process failed to start');
}

/**
 * Stop the gateway process gracefully.
 */
export async function stopGateway() {
  autoRestart = false;

  if (!gatewayProcess || gatewayProcess.killed) {
    console.log('[gateway-manager] Gateway not running');
    return;
  }

  const pid = gatewayProcess.pid;
  console.log('[gateway-manager] Stopping gateway (pid %d) ...', pid);

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      if (gatewayProcess && !gatewayProcess.killed) {
        console.warn('[gateway-manager] Gateway did not stop gracefully, sending SIGKILL');
        gatewayProcess.kill('SIGKILL');
      }
      resolve();
    }, 5000);

    gatewayProcess.once('exit', () => {
      clearTimeout(timeout);
      console.log('[gateway-manager] Gateway stopped');
      resolve();
    });

    gatewayProcess.kill('SIGTERM');
  });
}

/**
 * Restart the gateway process.
 */
export async function restartGateway() {
  await stopGateway();
  autoRestart = true;
  restartAttempts = 0;
  return startGateway({ port: gatewayPort, token: gatewayToken });
}

/**
 * Get current gateway status.
 */
export function getGatewayStatus() {
  const running = gatewayProcess != null && !gatewayProcess.killed;
  return {
    running,
    pid: running ? gatewayProcess.pid : null,
    port: gatewayPort,
    uptime: running ? Math.floor((Date.now() - lastStartTime) / 1000) : 0,
    restartAttempts,
    autoRestart,
  };
}

/**
 * Get the gateway WebSocket URL for client connection.
 */
export function getGatewayWsUrl() {
  return `ws://localhost:${gatewayPort}`;
}

/**
 * Get the configured gateway token for authentication.
 */
export function getGatewayToken() {
  return gatewayToken;
}

/**
 * Check if the gateway dist binary exists.
 */
export function isGatewayAvailable() {
  return existsSync(GATEWAY_ENTRY);
}

function scheduleRestart() {
  // Reset restart count if gateway was stable for a while
  if (Date.now() - lastStartTime > RESTART_WINDOW_MS) {
    restartAttempts = 0;
  }

  restartAttempts++;

  if (restartAttempts > MAX_RESTART_ATTEMPTS) {
    console.error('[gateway-manager] Max restart attempts (%d) reached, giving up', MAX_RESTART_ATTEMPTS);
    autoRestart = false;
    return;
  }

  const delay = Math.min(
    RESTART_BACKOFF_BASE_MS * Math.pow(2, restartAttempts - 1),
    RESTART_BACKOFF_MAX_MS
  );

  console.log('[gateway-manager] Scheduling restart in %dms (attempt %d/%d)', delay, restartAttempts, MAX_RESTART_ATTEMPTS);

  setTimeout(() => {
    if (autoRestart) {
      startGateway({ port: gatewayPort, token: gatewayToken }).catch((err) => {
        console.error('[gateway-manager] Restart failed:', err.message);
      });
    }
  }, delay);
}
