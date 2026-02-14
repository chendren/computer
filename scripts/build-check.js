#!/usr/bin/env node

/**
 * Pre-start build check
 *
 * Verifies that clawdbot's dist/ exists. If missing, runs pnpm build.
 * This ensures the gateway binary is available before Computer starts.
 */

import { existsSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLAWDBOT_ROOT = path.resolve(__dirname, '..', '..', '..', 'clawdbot');
const DIST_ENTRY = path.join(CLAWDBOT_ROOT, 'dist', 'index.js');

function main() {
  // Check if clawdbot repo exists
  if (!existsSync(CLAWDBOT_ROOT)) {
    console.warn('[build-check] clawdbot not found at %s', CLAWDBOT_ROOT);
    console.warn('[build-check] OpenClaw integration will be unavailable');
    process.exit(0); // Non-fatal — Computer still works without gateway
  }

  // Check if dist exists
  if (existsSync(DIST_ENTRY)) {
    console.log('[build-check] clawdbot dist/ found');
    return;
  }

  // Build it
  console.log('[build-check] clawdbot dist/ not found, building...');
  try {
    execSync('pnpm build', {
      cwd: CLAWDBOT_ROOT,
      stdio: 'inherit',
      timeout: 120000,
    });
    console.log('[build-check] Build complete');
  } catch (err) {
    console.error('[build-check] Build failed:', err.message);
    console.warn('[build-check] OpenClaw integration will be unavailable');
    // Non-fatal
  }
}

main();
