import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { generateId } from '../utils/helpers.js';

const WHISPER_PATH = process.env.WHISPER_PATH || '/opt/homebrew/bin/whisper';

// Transcribe a short audio chunk (3s) — uses tiny model for speed
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
