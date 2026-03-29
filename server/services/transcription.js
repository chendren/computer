/**
 * Transcription Service — Voxtral-based speech-to-text via mlx-audio sidecar.
 *
 * Routes audio to the Voxtral STT sidecar (scripts/voxtral-stt-server.py)
 * running on port 8997. The sidecar keeps the Voxtral Mini 3B model warm
 * in memory for sub-second inference on Apple Silicon (Metal GPU).
 *
 * Two entry points:
 *
 * transcribeChunk(buffer, format):
 *   For real-time voice commands via WebSocket. Sends raw audio bytes
 *   to the sidecar for fast transcription (~1-3s on M-series).
 *
 * transcribeFile(filePath):
 *   For full audio file transcription (from the /computer:transcribe command).
 *   Reads the file and sends it to the sidecar. Returns structured result
 *   with text, timing, and token stats.
 */

import fs from 'fs/promises';
import { transcribeViaVoxtral } from './voxtral-stt.js';

/**
 * Transcribe a short audio chunk from the voice pipeline.
 *
 * @param {Buffer} audioBuffer - Raw audio data (WAV, WebM, etc.)
 * @param {string} format - Audio format hint (unused — sidecar auto-detects)
 * @returns {Promise<string>} Transcribed text, or empty string if nothing was heard
 */
export async function transcribeChunk(audioBuffer, format = 'wav') {
  const result = await transcribeViaVoxtral(audioBuffer, 'en', 128);
  return result.text || '';
}

/**
 * Transcribe an entire audio file (used by /computer:transcribe command).
 *
 * @param {string} filePath - Absolute path to the audio file to transcribe
 * @returns {Promise<object>} Result with .text, .generation_tokens, .total_time, etc.
 */
export async function transcribeFile(filePath) {
  const audioBuffer = await fs.readFile(filePath);
  const result = await transcribeViaVoxtral(audioBuffer, 'en', 4096);
  return {
    text: result.text || '',
    language: 'en',
    segments: [],
    provider: 'voxtral',
    generation_tokens: result.generation_tokens,
    total_time: result.total_time,
    latency_ms: result.latency_ms,
  };
}
