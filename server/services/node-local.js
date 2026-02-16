/**
 * Node service — local machine info, camera, and screenshot capture.
 */
import os from 'os';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { generateId } from '../utils/helpers.js';

const ALLOWED_COMMANDS = new Set([
  'ls', 'df', 'uptime', 'whoami', 'ps', 'free', 'uname', 'hostname',
  'date', 'cat /proc/meminfo', 'cat /proc/cpuinfo', 'sw_vers',
  'sysctl -n hw.memsize', 'top -l 1 -n 0',
]);

export function listNodes() {
  return [{
    id: 'local',
    name: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    capabilities: ['screen', 'execute'],
    cpus: os.cpus().length,
    memory: os.totalmem(),
    freeMemory: os.freemem(),
    uptime: os.uptime(),
  }];
}

export async function captureScreen() {
  const id = generateId();
  const tmpPath = path.join(os.tmpdir(), `computer-screen-${id}.png`);

  return new Promise((resolve, reject) => {
    // macOS screencapture
    const proc = spawn('screencapture', ['-x', tmpPath]);
    proc.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error('Screen capture failed'));
        return;
      }
      try {
        const buf = await fs.readFile(tmpPath);
        await fs.unlink(tmpPath).catch(() => {});
        resolve(buf.toString('base64'));
      } catch (err) {
        reject(err);
      }
    });
    proc.on('error', reject);
  });
}

export async function captureCamera() {
  const id = generateId();
  const tmpPath = path.join(os.tmpdir(), `computer-camera-${id}.jpg`);

  return new Promise((resolve, reject) => {
    // Try imagesnap (brew install imagesnap) or fall back to screencapture
    const proc = spawn('imagesnap', ['-w', '1', tmpPath]);
    proc.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error('Camera capture failed — install imagesnap: brew install imagesnap'));
        return;
      }
      try {
        const buf = await fs.readFile(tmpPath);
        await fs.unlink(tmpPath).catch(() => {});
        resolve(buf.toString('base64'));
      } catch (err) {
        reject(err);
      }
    });
    proc.on('error', () => {
      reject(new Error('imagesnap not found — install with: brew install imagesnap'));
    });
  });
}

export async function executeCommand(command) {
  const trimmed = command.trim();
  if (!ALLOWED_COMMANDS.has(trimmed)) {
    throw new Error('Command not permitted. Allowed: ' + [...ALLOWED_COMMANDS].join(', '));
  }

  return new Promise((resolve, reject) => {
    const parts = trimmed.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);
    const proc = spawn(cmd, args, { timeout: 10000 });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code !== 0 && !stdout) {
        reject(new Error(stderr || 'Command failed with exit code ' + code));
        return;
      }
      resolve(stdout || stderr);
    });
    proc.on('error', reject);
  });
}
