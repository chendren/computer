/**
 * Calendar Service — Google Calendar API integration
 *
 * Reuses the same OAuth credentials as Gmail (data/google-oauth.json)
 * but stores tokens separately at data/oauth-tokens/calendar.json.
 *
 * Users must complete a one-time OAuth flow to grant Calendar access.
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const CREDS_PATH = path.join(DATA_DIR, 'google-oauth.json');
const TOKENS_PATH = path.join(DATA_DIR, 'oauth-tokens', 'calendar.json');

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/calendar.events',
];

let _oauth2Client = null;
let _calendar = null;

function loadCredentials() {
  try { return JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8')); }
  catch { return null; }
}

function loadTokens() {
  try { return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf8')); }
  catch { return null; }
}

function saveTokens(tokens) {
  const dir = path.dirname(TOKENS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

function getOAuth2Client() {
  if (_oauth2Client) return _oauth2Client;
  const creds = loadCredentials();
  if (!creds) return null;

  const clientId = creds.clientId || creds.installed?.client_id || creds.web?.client_id;
  const clientSecret = creds.clientSecret || creds.installed?.client_secret || creds.web?.client_secret;
  const redirectUri = creds.redirectUri || 'http://localhost:3141/api/calendar/auth/callback';

  if (!clientId || !clientSecret) return null;

  _oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const tokens = loadTokens();
  if (tokens) {
    _oauth2Client.setCredentials(tokens);
    _oauth2Client.on('tokens', (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      saveTokens(merged);
    });
    _calendar = google.calendar({ version: 'v3', auth: _oauth2Client });
  }

  return _oauth2Client;
}

export function hasCredentials() {
  return !!loadCredentials();
}

export function getAuthUrl() {
  const client = getOAuth2Client();
  if (!client) return null;
  return client.generateAuthUrl({ access_type: 'offline', scope: SCOPES, prompt: 'consent' });
}

export async function handleCallback(code) {
  const client = getOAuth2Client();
  if (!client) throw new Error('No OAuth credentials');
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  saveTokens(tokens);
  _calendar = google.calendar({ version: 'v3', auth: client });
  return { connected: true };
}

export async function revoke() {
  try { fs.unlinkSync(TOKENS_PATH); } catch {}
  _oauth2Client = null;
  _calendar = null;
}

export function getStatus() {
  const hasCreds = hasCredentials();
  const hasTokens = !!loadTokens();
  return { connected: hasCreds && hasTokens, hasCredentials: hasCreds };
}

export async function listEvents(timeMin, timeMax) {
  if (!_calendar) {
    getOAuth2Client();
    if (!_calendar) throw new Error('Calendar not connected — complete OAuth at /api/calendar/auth/start');
  }
  const res = await _calendar.events.list({
    calendarId: 'primary',
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 20,
  });
  return (res.data.items || []).map(e => ({
    id: e.id,
    summary: e.summary || '(no title)',
    startTime: e.start?.dateTime
      ? new Date(e.start.dateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : e.start?.date || '',
    endTime: e.end?.dateTime
      ? new Date(e.end.dateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : e.end?.date || '',
    location: e.location || '',
    description: e.description || '',
  }));
}

export async function createEvent({ summary, startTime, durationMinutes = 60, description = '' }) {
  if (!_calendar) {
    getOAuth2Client();
    if (!_calendar) throw new Error('Calendar not connected — complete OAuth at /api/calendar/auth/start');
  }

  // Parse start time — handle "2pm", "14:00", full ISO, etc.
  const now = new Date();
  let start;
  if (startTime.includes('T') || startTime.includes('-')) {
    start = new Date(startTime);
  } else {
    // Parse time-only strings like "2pm", "14:00", "3:30pm"
    let hours = 0, minutes = 0;
    const lower = startTime.toLowerCase().trim();
    const isPM = lower.includes('pm');
    const isAM = lower.includes('am');
    const timeStr = lower.split('am').join('').split('pm').join('').trim();
    if (timeStr.includes(':')) {
      const parts = timeStr.split(':');
      hours = parseInt(parts[0], 10);
      minutes = parseInt(parts[1], 10) || 0;
    } else {
      hours = parseInt(timeStr, 10);
    }
    if (isPM && hours < 12) hours += 12;
    if (isAM && hours === 12) hours = 0;
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
    // If the time has already passed today, schedule for tomorrow
    if (start < now) start.setDate(start.getDate() + 1);
  }

  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);

  const event = await _calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary,
      description,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
    },
  });

  return {
    created: true,
    id: event.data.id,
    summary,
    startTime: start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    endTime: end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  };
}
