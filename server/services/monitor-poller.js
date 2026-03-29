/**
 * Monitor poller — periodically checks URLs/endpoints and updates monitor status.
 * Reads monitors from storage, performs HTTP checks, updates results,
 * and broadcasts status changes via WebSocket.
 */
import fs from 'fs/promises';
import path from 'path';

let dataDir;
let broadcastFn = null;
let pollInterval = null;

// Track last known status per monitor to detect changes
const lastStatus = new Map();

export async function initMonitorPoller(pluginRoot, broadcast) {
  dataDir = path.join(pluginRoot, 'data', 'monitors');
  broadcastFn = broadcast;

  // Poll every 60 seconds
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(_pollAll, 60000);

  // Run first poll after a short delay to let server fully start
  setTimeout(_pollAll, 5000);
}

async function _pollAll() {
  let files;
  try {
    files = await fs.readdir(dataDir);
  } catch {
    return; // monitors dir doesn't exist yet
  }

  const jsonFiles = files.filter(f => f.endsWith('.json'));
  if (jsonFiles.length === 0) return;

  for (const file of jsonFiles) {
    try {
      const filePath = path.join(dataDir, file);
      const raw = await fs.readFile(filePath, 'utf-8');
      const monitor = JSON.parse(raw);

      // Skip monitors that aren't active
      if (monitor.status === 'stopped') continue;

      // Check if it's time to poll (respect interval)
      if (!_shouldPoll(monitor)) continue;

      const result = await _checkMonitor(monitor);
      await _updateMonitor(filePath, monitor, result);
    } catch (err) {
      console.error(`[monitor-poller] Error polling ${file}:`, err.message);
    }
  }
}

function _shouldPoll(monitor) {
  const interval = _parseInterval(monitor.interval || '60s');
  if (!monitor.lastCheck?.timestamp) return true;

  const elapsed = Date.now() - new Date(monitor.lastCheck.timestamp).getTime();
  return elapsed >= interval;
}

function _parseInterval(intervalStr) {
  const str = String(intervalStr).trim().toLowerCase();
  const num = parseInt(str, 10);
  if (isNaN(num) || num <= 0) return 60000;

  if (str.endsWith('m') || str.endsWith('min')) return num * 60000;
  if (str.endsWith('h')) return num * 3600000;
  // Default: seconds
  return num * 1000;
}

async function _checkMonitor(monitor) {
  const target = monitor.target;
  if (!target?.value) {
    return { status: 'error', detail: 'No target URL configured', responseTime: 0 };
  }

  let url = target.value;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { 'User-Agent': 'Computer-Monitor/1.0' },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    const responseTime = Date.now() - start;
    const httpStatus = res.status;

    if (httpStatus >= 200 && httpStatus < 400) {
      return { status: 'ok', detail: `HTTP ${httpStatus} (${responseTime}ms)`, httpStatus, responseTime };
    } else if (httpStatus >= 400 && httpStatus < 500) {
      return { status: 'warning', detail: `HTTP ${httpStatus} (${responseTime}ms)`, httpStatus, responseTime };
    } else {
      return { status: 'error', detail: `HTTP ${httpStatus} (${responseTime}ms)`, httpStatus, responseTime };
    }
  } catch (err) {
    const responseTime = Date.now() - start;
    const detail = err.name === 'AbortError' ? 'Timeout (15s)' : err.message;
    return { status: 'error', detail, responseTime };
  }
}

async function _updateMonitor(filePath, monitor, result) {
  const now = new Date().toISOString();

  // Build check record
  const check = {
    status: result.status,
    detail: result.detail,
    httpStatus: result.httpStatus || null,
    responseTime: result.responseTime || 0,
    timestamp: now,
  };

  // Update monitor
  monitor.lastCheck = check;

  // Maintain history (max 50 entries)
  if (!Array.isArray(monitor.history)) monitor.history = [];
  monitor.history.unshift(check);
  if (monitor.history.length > 50) monitor.history = monitor.history.slice(0, 50);

  // Update overall status based on check result
  const prevStatus = lastStatus.get(monitor.id);
  const newStatus = result.status;
  monitor.status = newStatus;

  // Persist
  await fs.writeFile(filePath, JSON.stringify(monitor, null, 2));

  // Broadcast updated monitor to UI
  if (broadcastFn) {
    broadcastFn('monitor', monitor);

    // Broadcast status change notification if status changed
    if (prevStatus && prevStatus !== newStatus) {
      const emoji = newStatus === 'ok' ? 'UP' : newStatus === 'warning' ? 'WARN' : 'DOWN';
      broadcastFn('status', {
        message: `Monitor "${monitor.name}": ${emoji} — ${result.detail}`,
      });
    }
  }

  lastStatus.set(monitor.id, newStatus);
}
