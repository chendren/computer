/**
 * Bearer token authentication middleware.
 *
 * Generates a random 256-bit token on first start, persists to data/.auth-token.
 * All /api/* routes require Authorization: Bearer <token> header.
 * Exempt: GET /api/health, static files.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

let authToken = null;
let tokenPath = null;

/**
 * Initialize auth — load or generate token.
 * @param {string} pluginRoot - Plugin root directory
 * @returns {string} The auth token
 */
export async function initAuth(pluginRoot) {
  tokenPath = path.join(pluginRoot, 'data', '.auth-token');

  try {
    authToken = (await fs.readFile(tokenPath, 'utf-8')).trim();
    if (authToken.length >= 32) {
      return authToken;
    }
  } catch {
    // File doesn't exist — generate new token
  }

  authToken = crypto.randomBytes(32).toString('hex');
  await fs.mkdir(path.dirname(tokenPath), { recursive: true });
  await fs.writeFile(tokenPath, authToken, { mode: 0o600 });
  return authToken;
}

/**
 * Get the current auth token.
 */
export function getAuthToken() {
  return authToken;
}

/**
 * Express middleware — require valid bearer token on API routes.
 */
export function requireAuth(req, res, next) {
  // Exempt: health endpoint, TTS audio files (UUID filenames), static files
  if (req.path === '/api/health' || req.path.startsWith('/api/tts/audio/')) {
    return next();
  }

  // Only protect /api/* routes
  if (!req.path.startsWith('/api/')) {
    return next();
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Provide Authorization: Bearer <token> header.' });
  }

  const token = header.slice(7);
  if (!authToken || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(authToken))) {
    return res.status(403).json({ error: 'Invalid authentication token.' });
  }

  next();
}
