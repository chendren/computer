/**
 * Sound Effects Service — Pre-generated audio cues using Kokoro TTS.
 *
 * On first boot, generates short WAV files for key system events
 * (acknowledge, alerts, complete, error). Files are cached in data/tts-cache/
 * with "sfx-" prefix and never cleaned up by the TTS cleanup routine.
 *
 * Uses am_michael voice for a deeper, authoritative computer tone.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateSpeech } from './tts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const TTS_CACHE_DIR = path.join(PLUGIN_ROOT, 'data', 'tts-cache');

const SFX_VOICE = 'am_michael';

const SFX_DEFINITIONS = [
  { name: 'sfx-acknowledge', text: 'Acknowledged' },
  { name: 'sfx-alert-red', text: 'Red alert. Red alert.' },
  { name: 'sfx-alert-yellow', text: 'Yellow alert.' },
  { name: 'sfx-alert-blue', text: 'Attention.' },
  { name: 'sfx-complete', text: 'Complete.' },
  { name: 'sfx-error', text: 'Unable to comply.' },
];

const sfxPaths = new Map();

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize sound effects — generate any missing WAVs.
 * Call after TTS model is available (non-blocking, logs on completion).
 */
export async function initSoundEffects() {
  await fs.mkdir(TTS_CACHE_DIR, { recursive: true });

  let generated = 0;
  let cached = 0;

  for (const sfx of SFX_DEFINITIONS) {
    const filename = `${sfx.name}.wav`;
    const targetPath = path.join(TTS_CACHE_DIR, filename);

    if (await fileExists(targetPath)) {
      sfxPaths.set(sfx.name, `/api/tts/audio/${filename}`);
      cached++;
      continue;
    }

    try {
      const result = await generateSpeech(sfx.text, SFX_VOICE);
      // Rename from the generated filename to the predictable SFX filename
      await fs.rename(result.path, targetPath);
      sfxPaths.set(sfx.name, `/api/tts/audio/${filename}`);
      generated++;
      console.log(`[sfx] Generated: ${sfx.name}`);
    } catch (err) {
      console.error(`[sfx] Failed to generate ${sfx.name}: ${err.message}`);
    }
  }

  console.log(`[sfx] Sound effects ready: ${generated} generated, ${cached} cached`);
}

/**
 * Get the audio URL for a named sound effect.
 * @param {string} name - e.g. 'sfx-acknowledge', 'sfx-alert-red'
 * @returns {string|null} URL path like '/api/tts/audio/sfx-acknowledge.wav'
 */
export function getSoundEffect(name) {
  return sfxPaths.get(name) || null;
}

/**
 * Check if a filename is a sound effect (should not be cleaned up).
 * Used inline in tts.js cleanup via file.startsWith('sfx-').
 * @param {string} filename
 * @returns {boolean}
 */
export function isSfxFile(filename) {
  return filename.startsWith('sfx-');
}
