import { spawn } from 'child_process';

/**
 * Send a macOS desktop notification via osascript.
 * @param {string} title - Notification title
 * @param {string} message - Notification body
 * @param {string} [sound='Glass'] - macOS sound name (Glass, Ping, Pop, Submarine, etc.)
 */
export function notify(title, message, sound = 'Glass') {
  const script = `display notification "${escape(message)}" with title "${escape(title)}" sound name "${sound}"`;
  spawn('osascript', ['-e', script], { stdio: 'ignore', detached: true }).unref();
}

/**
 * Send an alert notification (for monitor triggers and errors).
 */
export function notifyAlert(title, message) {
  notify(title, message, 'Submarine');
}

/**
 * Send a completion notification (for long-running tasks).
 */
export function notifyComplete(title, message) {
  notify(title, message, 'Glass');
}

function escape(str) {
  return String(str).replace(/"/g, '\\"').replace(/\n/g, ' ');
}
