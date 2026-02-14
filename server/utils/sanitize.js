/**
 * Shared sanitization utilities for security hardening.
 */

import path from 'path';

/**
 * HTML-encode a string to prevent XSS.
 */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Strip internal file paths and stack traces from error messages.
 * Returns a safe error string for API responses.
 */
export function safeError(err) {
  const msg = err?.message || String(err);
  // Strip file paths (anything that looks like /Users/... or /home/... or C:\...)
  return msg
    .replace(/\/(?:Users|home|var|tmp|opt|etc|private)[^\s:,)}\]'"]*/gi, '[path]')
    .replace(/[A-Z]:\\[^\s:,)}\]'"]+/gi, '[path]')
    .replace(/\bat\s+.+\(.+:\d+:\d+\)/g, '') // strip stack trace lines
    .slice(0, 500);
}

/**
 * Validate that a resolved file path stays within the allowed directory.
 * Prevents path traversal attacks.
 * @param {string} baseDir - The allowed base directory
 * @param {string} filePath - The path to validate
 * @throws {Error} If path escapes baseDir
 */
export function validatePath(baseDir, filePath) {
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
    throw new Error('Invalid path: access denied');
  }
}
