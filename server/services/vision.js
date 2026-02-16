/**
 * Vision service — image analysis via Ollama vision models.
 */
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { generateId } from '../utils/helpers.js';

const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434';
const VISION_MODEL = process.env.VISION_MODEL || 'llama4:scout';

/**
 * Analyze an image using Ollama's vision capabilities.
 * @param {string} base64Data — base64-encoded image data
 * @param {string} mimeType — image MIME type
 * @param {string} prompt — analysis prompt
 */
export async function analyzeImage(base64Data, mimeType, prompt) {
  const analysisPrompt = prompt || 'Describe this image in detail.';

  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{
        role: 'user',
        content: analysisPrompt,
        images: [base64Data],
      }],
      stream: false,
    }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error('Vision analysis failed: ' + (text || res.statusText));
  }

  const data = await res.json();
  return { text: data.message?.content || '' };
}

/**
 * Extract key frames from a video using ffmpeg, then analyze each.
 * @param {Buffer} videoBuffer — raw video data
 * @param {string} mimeType — video MIME type
 * @param {number} frameCount — number of frames to extract
 */
export async function extractVideoFrames(videoBuffer, mimeType, frameCount) {
  const count = frameCount || 5;
  const id = generateId();
  const tmpDir = path.join(os.tmpdir(), `computer-frames-${id}`);
  const videoPath = path.join(tmpDir, 'input.mp4');

  await fs.mkdir(tmpDir, { recursive: true });
  await fs.writeFile(videoPath, videoBuffer);

  // Extract frames via ffmpeg
  const frames = await new Promise((resolve, reject) => {
    const args = [
      '-i', videoPath,
      '-vf', `fps=1/${count}`,
      '-frames:v', String(count),
      '-q:v', '2',
      path.join(tmpDir, 'frame-%03d.jpg'),
    ];
    const proc = spawn('ffmpeg', args);
    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('close', async (code) => {
      if (code !== 0) {
        reject(new Error('ffmpeg frame extraction failed'));
        return;
      }
      try {
        const files = await fs.readdir(tmpDir);
        const frameFiles = files.filter(f => f.startsWith('frame-') && f.endsWith('.jpg'));
        frameFiles.sort();
        const results = [];
        for (const f of frameFiles) {
          const buf = await fs.readFile(path.join(tmpDir, f));
          results.push(buf.toString('base64'));
        }
        resolve(results);
      } catch (err) {
        reject(err);
      }
    });
    proc.on('error', reject);
  });

  // Cleanup
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

  return frames.map((base64, i) => ({
    index: i,
    data: base64,
    mimeType: 'image/jpeg',
  }));
}
