import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { generateId } from '../utils/helpers.js';

const TTS_PATH = '/opt/homebrew/bin/tts';
const TTS_MODEL = 'tts_models/en/ljspeech/vits';
const TTS_OUTPUT_DIR = '/tmp/computer-tts';

// Ensure output directory exists
await fs.mkdir(TTS_OUTPUT_DIR, { recursive: true });

// Sequential queue — only one TTS process at a time (CPU-heavy)
let ttsQueue = Promise.resolve();

export function generateSpeech(text) {
  const promise = ttsQueue.then(() => _generate(text));
  ttsQueue = promise.catch(() => {});
  return promise;
}

async function _generate(text) {
  const id = generateId();
  const outPath = path.join(TTS_OUTPUT_DIR, `${id}.wav`);

  const args = [
    '--model_name', TTS_MODEL,
    '--text', text,
    '--out_path', outPath,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(TTS_PATH, args);
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ id, path: outPath, filename: `${id}.wav` });
      } else {
        reject(new Error(`TTS failed: ${stderr.slice(-500)}`));
      }
    });
    proc.on('error', reject);
  });
}

// Cleanup files older than 5 minutes
export async function cleanupTTSFiles(maxAgeMs = 300000) {
  try {
    const files = await fs.readdir(TTS_OUTPUT_DIR);
    const now = Date.now();
    for (const file of files) {
      const filePath = path.join(TTS_OUTPUT_DIR, file);
      const stat = await fs.stat(filePath);
      if (now - stat.mtimeMs > maxAgeMs) {
        await fs.unlink(filePath).catch(() => {});
      }
    }
  } catch {}
}

// Auto-cleanup every 5 minutes
setInterval(() => cleanupTTSFiles(), 300000);
