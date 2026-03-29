/**
 * TTS Service — Kokoro-based text-to-speech via kokoro-js (local ONNX).
 *
 * Uses the Kokoro 82M model running locally through ONNX Runtime.
 * The model is loaded once on server startup and kept warm in memory.
 *
 * Voice: configurable via KOKORO_VOICE env var (default: af_heart)
 * Model: onnx-community/Kokoro-82M-v1.0-ONNX (q8 quantized, ~92MB)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const TTS_OUTPUT_DIR = path.join(PLUGIN_ROOT, 'data', 'tts-cache');
const DEFAULT_VOICE = process.env.KOKORO_VOICE || 'af_heart';

await fs.mkdir(TTS_OUTPUT_DIR, { recursive: true });

// Lazy-loaded KokoroTTS instance — loaded on first use to avoid blocking server startup
let ttsInstance = null;
let ttsLoading = false;
let ttsError = null;

async function getTTS() {
  if (ttsInstance) return ttsInstance;
  if (ttsLoading) {
    // Wait for in-progress load
    while (ttsLoading) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (ttsInstance) return ttsInstance;
    throw new Error(ttsError || 'TTS failed to load');
  }

  ttsLoading = true;
  try {
    const { KokoroTTS } = await import('kokoro-js');
    console.log('[tts] Loading Kokoro model (first use — downloading if needed)...');
    ttsInstance = await KokoroTTS.from_pretrained(
      'onnx-community/Kokoro-82M-v1.0-ONNX',
      { dtype: 'q8', device: 'cpu' },
    );
    console.log('[tts] Kokoro model loaded');
    return ttsInstance;
  } catch (err) {
    ttsError = err.message;
    console.error('[tts] Failed to load Kokoro:', err.message);
    throw err;
  } finally {
    ttsLoading = false;
  }
}

// Sequential queue — only one TTS generation at a time (CPU-heavy)
let ttsQueue = Promise.resolve();

/**
 * Generate speech from text using Kokoro TTS.
 *
 * @param {string} text - Text to synthesize
 * @param {string} voice - Kokoro voice ID (default: af_heart)
 * @returns {Promise<{id: string, path: string, filename: string}>}
 */
export function generateSpeech(text, voice = DEFAULT_VOICE) {
  const promise = ttsQueue.then(() => _generate(text, voice));
  ttsQueue = promise.catch(() => {});
  return promise;
}

let idCounter = 0;

async function _generate(text, voice) {
  const tts = await getTTS();
  const id = `kokoro-${Date.now()}-${++idCounter}`;
  const filename = `${id}.wav`;
  const outPath = path.join(TTS_OUTPUT_DIR, filename);

  const audio = await tts.generate(text, { voice, speed: 1.0 });
  await audio.save(outPath);

  return { id, path: outPath, filename };
}

/**
 * List available Kokoro voices.
 */
export function getVoices() {
  return [
    { id: 'af_heart', name: 'Heart (American Female)', accent: 'american' },
    { id: 'af_bella', name: 'Bella (American Female)', accent: 'american' },
    { id: 'af_nova', name: 'Nova (American Female)', accent: 'american' },
    { id: 'af_sarah', name: 'Sarah (American Female)', accent: 'american' },
    { id: 'af_sky', name: 'Sky (American Female)', accent: 'american' },
    { id: 'af_nicole', name: 'Nicole (American Female)', accent: 'american' },
    { id: 'am_adam', name: 'Adam (American Male)', accent: 'american' },
    { id: 'am_michael', name: 'Michael (American Male)', accent: 'american' },
    { id: 'am_echo', name: 'Echo (American Male)', accent: 'american' },
    { id: 'am_eric', name: 'Eric (American Male)', accent: 'american' },
    { id: 'am_liam', name: 'Liam (American Male)', accent: 'american' },
    { id: 'bf_emma', name: 'Emma (British Female)', accent: 'british' },
    { id: 'bf_isabella', name: 'Isabella (British Female)', accent: 'british' },
    { id: 'bm_daniel', name: 'Daniel (British Male)', accent: 'british' },
    { id: 'bm_george', name: 'George (British Male)', accent: 'british' },
  ];
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
