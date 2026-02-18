/**
 * Transcription Service — Whisper-based speech-to-text.
 *
 * Wraps the command-line `whisper` binary (OpenAI Whisper, installed via Homebrew
 * or pip). Two entry points:
 *
 * transcribeChunk(buffer, format):
 *   For real-time voice commands. Uses the 'tiny' model (39M params) for speed.
 *   Audio is written to a temp file → whisper processes it → JSON result read back → cleanup.
 *   Typical latency: 0.5-1.5 seconds on Apple Silicon.
 *
 *   NOTE: The 'tiny' model has higher error rates than 'base' or 'small', especially
 *   for technical vocabulary and the wake word "Computer". If you're getting frequent
 *   misrecognitions, switch the --model flag to 'base' (140M params, ~2x slower).
 *
 * transcribeFile(filePath):
 *   For full audio file transcription (from the /computer:transcribe command).
 *   Uses the 'base' model for higher accuracy. Returns the full Whisper JSON output
 *   including word-level timestamps and segment data.
 *
 * Environment variables:
 *   WHISPER_PATH: Path to the whisper binary (default: /opt/homebrew/bin/whisper)
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { generateId } from '../utils/helpers.js';

// Location of the OpenAI Whisper CLI binary
// Install: pip install openai-whisper, or brew install openai-whisper (if packaged)
const WHISPER_PATH = process.env.WHISPER_PATH || '/opt/homebrew/bin/whisper';

/**
 * Transcribe a short audio chunk from the voice pipeline.
 *
 * Writes the audio buffer to a temp file (because Whisper CLI only accepts file paths,
 * not stdin), spawns Whisper, reads the JSON output, then cleans up both temp files.
 *
 * The 'tiny' model is used here for speed — acceptable for short wake-word phrases.
 * Switch to 'base' if accuracy is more important than latency.
 *
 * @param {Buffer} audioBuffer - Raw audio data (WAV, WebM, MP3, etc.)
 * @param {string} format - File extension for the temp file (determines Whisper's decoder)
 * @returns {Promise<string>} Transcribed text, or empty string if nothing was heard
 */
export async function transcribeChunk(audioBuffer, format = 'webm') {
  const chunkId = generateId();
  const tmpDir = os.tmpdir();
  const tmpPath = path.join(tmpDir, `computer-chunk-${chunkId}.${format}`);
  const outputDir = path.join(tmpDir, `computer-chunk-${chunkId}-out`);

  await fs.writeFile(tmpPath, audioBuffer);
  await fs.mkdir(outputDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const proc = spawn(WHISPER_PATH, [
      tmpPath,
      '--model', 'tiny',
      '--language', 'en',
      '--output_format', 'json',
      '--output_dir', outputDir,
    ]);

    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', async (code) => {
      try {
        if (code !== 0) {
          reject(new Error(`Whisper chunk failed: ${stderr.slice(-300)}`));
          return;
        }

        const files = await fs.readdir(outputDir);
        const jsonFile = files.find(f => f.endsWith('.json'));
        if (!jsonFile) {
          resolve('');
          return;
        }

        const content = await fs.readFile(path.join(outputDir, jsonFile), 'utf-8');
        const result = JSON.parse(content);

        // Cleanup
        await fs.unlink(tmpPath).catch(() => {});
        await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});

        resolve(result.text?.trim() || '');
      } catch (err) {
        reject(err);
      }
    });
    proc.on('error', reject);
  });
}

/**
 * Transcribe an entire audio file (used by /computer:transcribe command).
 *
 * Unlike transcribeChunk, this:
 *   - Accepts an existing file path (the caller manages the file)
 *   - Uses the 'base' model for higher accuracy
 *   - Returns the full Whisper JSON output (with segments and word timestamps)
 *     rather than just the text string
 *
 * @param {string} filePath - Absolute path to the audio file to transcribe
 * @returns {Promise<object>} Full Whisper JSON result with .text, .segments, etc.
 */
export async function transcribeFile(filePath) {
  const outputDir = path.join(os.tmpdir(), `computer-transcribe-${generateId()}`);
  await fs.mkdir(outputDir, { recursive: true });

  return new Promise((resolve, reject) => {
    const proc = spawn(WHISPER_PATH, [
      filePath,
      '--model', 'base',
      '--output_format', 'json',
      '--output_dir', outputDir,
    ]);

    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    proc.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error(`Whisper failed: ${stderr}`));
        return;
      }

      try {
        const files = await fs.readdir(outputDir);
        const jsonFile = files.find(f => f.endsWith('.json'));
        if (!jsonFile) {
          reject(new Error('No JSON output from Whisper'));
          return;
        }
        const content = await fs.readFile(path.join(outputDir, jsonFile), 'utf-8');
        const result = JSON.parse(content);

        // Cleanup
        await fs.rm(outputDir, { recursive: true, force: true });

        resolve(result);
      } catch (err) {
        reject(err);
      }
    });

    proc.on('error', reject);
  });
}
