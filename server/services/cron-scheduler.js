/**
 * Cron scheduler — local job scheduling with config in data/cron.json.
 * Uses setInterval with minute-level granularity. No external dependencies.
 */
import fs from 'fs/promises';
import path from 'path';
import { generateId } from '../utils/helpers.js';

let cronPath;
let jobs = [];
let checkInterval = null;
let broadcastFn = null;

export async function initCron(pluginRoot, broadcast) {
  cronPath = path.join(pluginRoot, 'data', 'cron.json');
  broadcastFn = broadcast;

  try {
    const raw = await fs.readFile(cronPath, 'utf-8');
    jobs = JSON.parse(raw);
    if (!Array.isArray(jobs)) jobs = [];
  } catch {
    jobs = [];
  }

  // Check every minute
  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(_checkJobs, 60000);
}

export function listJobs() {
  return jobs.map(j => ({
    id: j.id,
    name: j.name,
    schedule: j.schedule,
    enabled: j.enabled !== false,
    lastRun: j.lastRun || null,
    nextDescription: j.description || '',
  }));
}

export async function addJob(job) {
  const newJob = {
    id: job.id || generateId(),
    name: job.name || 'Untitled',
    schedule: job.schedule || '0 * * * *', // default: every hour
    enabled: job.enabled !== false,
    command: job.command || '',
    description: job.description || '',
    lastRun: null,
  };
  jobs.push(newJob);
  await _persist();
  return newJob;
}

export async function removeJob(id) {
  const idx = jobs.findIndex(j => j.id === id);
  if (idx === -1) return false;
  jobs.splice(idx, 1);
  await _persist();
  return true;
}

export async function toggleJob(id) {
  const job = jobs.find(j => j.id === id);
  if (!job) return null;
  job.enabled = !job.enabled;
  await _persist();
  return job;
}

function _checkJobs() {
  const now = new Date();
  const minute = now.getMinutes();
  const hour = now.getHours();
  const dayOfMonth = now.getDate();
  const month = now.getMonth() + 1;
  const dayOfWeek = now.getDay(); // 0=Sunday

  for (const job of jobs) {
    if (!job.enabled) continue;
    if (!job.schedule) continue;

    if (_matchesCron(job.schedule, minute, hour, dayOfMonth, month, dayOfWeek)) {
      job.lastRun = now.toISOString();
      if (broadcastFn) {
        broadcastFn('cron_event', { jobId: job.id, name: job.name, status: 'fired', timestamp: job.lastRun });
      }
    }
  }
}

/**
 * Simple cron expression matcher: "min hour dom month dow"
 * Supports: numbers, *, and comma-separated values. No regex.
 */
function _matchesCron(schedule, minute, hour, dayOfMonth, month, dayOfWeek) {
  const parts = schedule.trim().split(' ');
  if (parts.length < 5) return false;

  return _fieldMatches(parts[0], minute) &&
         _fieldMatches(parts[1], hour) &&
         _fieldMatches(parts[2], dayOfMonth) &&
         _fieldMatches(parts[3], month) &&
         _fieldMatches(parts[4], dayOfWeek);
}

function _fieldMatches(field, value) {
  if (field === '*') return true;

  // Handle comma-separated values: "1,5,10"
  const segments = field.split(',');
  for (const seg of segments) {
    const trimmed = seg.trim();
    // Handle range: "1-5"
    if (trimmed.indexOf('-') !== -1) {
      const rangeParts = trimmed.split('-');
      const low = parseInt(rangeParts[0], 10);
      const high = parseInt(rangeParts[1], 10);
      if (!isNaN(low) && !isNaN(high) && value >= low && value <= high) return true;
    }
    // Handle step: "*/5"
    else if (trimmed.startsWith('*/')) {
      const step = parseInt(trimmed.slice(2), 10);
      if (!isNaN(step) && step > 0 && value % step === 0) return true;
    }
    // Exact match
    else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num === value) return true;
    }
  }
  return false;
}

async function _persist() {
  if (!cronPath) return;
  await fs.writeFile(cronPath, JSON.stringify(jobs, null, 2));
}
