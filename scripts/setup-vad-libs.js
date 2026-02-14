/**
 * Post-install script: copies VAD and ONNX Runtime browser bundles
 * from node_modules to ui/lib/ for serving as static assets.
 */

import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const LIB = resolve(ROOT, 'ui', 'lib');

mkdirSync(LIB, { recursive: true });

const files = [
  // ONNX Runtime Web
  ['node_modules/onnxruntime-web/dist/ort.min.js', 'ort.min.js'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.mjs'],
  ['node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.wasm'],
  // VAD Web
  ['node_modules/@ricky0123/vad-web/dist/bundle.min.js', 'vad-bundle.min.js'],
  ['node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js', 'vad.worklet.bundle.min.js'],
  ['node_modules/@ricky0123/vad-web/dist/silero_vad.onnx', 'silero_vad.onnx'],
];

let copied = 0;
for (const [src, dest] of files) {
  const srcPath = resolve(ROOT, src);
  const destPath = resolve(LIB, dest);
  if (existsSync(srcPath)) {
    copyFileSync(srcPath, destPath);
    console.log(`  ✓ ${dest}`);
    copied++;
  } else {
    console.warn(`  ✗ ${src} not found — skipping`);
  }
}

console.log(`\n  VAD libs: ${copied}/${files.length} files copied to ui/lib/`);
