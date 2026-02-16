/**
 * Gmail Service — Direct Google Gmail API integration
 *
 * Bypasses the OpenClaw gateway entirely. Uses the googleapis npm package
 * for OAuth2 authentication and Gmail API calls.
 *
 * Credentials: data/google-oauth.json  { clientId, clientSecret }
 * Tokens:      data/oauth-tokens/gmail.json  (auto-created after OAuth flow)
 */

import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const CREDS_PATH = path.join(DATA_DIR, 'google-oauth.json');
const TOKENS_PATH = path.join(DATA_DIR, 'oauth-tokens', 'gmail.json');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/userinfo.email',
];

let _oauth2Client = null;
let _gmail = null;
let _userEmail = null;

function loadCredentials() {
  try {
    const raw = fs.readFileSync(CREDS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function loadTokens() {
  try {
    const raw = fs.readFileSync(TOKENS_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  const dir = path.dirname(TOKENS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

function getOAuth2Client() {
  if (_oauth2Client) return _oauth2Client;

  const creds = loadCredentials();
  if (!creds || !creds.clientId || !creds.clientSecret) {
    return null;
  }

  _oauth2Client = new google.auth.OAuth2(
    creds.clientId,
    creds.clientSecret,
    'http://localhost:3141/api/gmail/auth/callback'
  );

  // Load existing tokens if available
  const tokens = loadTokens();
  if (tokens) {
    _oauth2Client.setCredentials(tokens);
  }

  // Auto-save refreshed tokens
  _oauth2Client.on('tokens', (newTokens) => {
    const existing = loadTokens() || {};
    const merged = { ...existing, ...newTokens };
    saveTokens(merged);
    console.log('[gmail] Tokens refreshed and saved');
  });

  return _oauth2Client;
}

function getGmailClient() {
  if (_gmail) return _gmail;

  const auth = getOAuth2Client();
  if (!auth) return null;

  _gmail = google.gmail({ version: 'v1', auth });
  return _gmail;
}

// ── OAuth2 Flow ──────────────────────────────────────

export function hasCredentials() {
  const creds = loadCredentials();
  return !!(creds && creds.clientId && creds.clientSecret);
}

export function getAuthUrl() {
  const client = getOAuth2Client();
  if (!client) return null;

  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
}

export async function handleCallback(code) {
  const client = getOAuth2Client();
  if (!client) throw new Error('No OAuth credentials configured');

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  saveTokens(tokens);

  // Reset cached gmail client so it picks up new tokens
  _gmail = null;

  // Fetch user email
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    _userEmail = data.email;
  } catch {
    _userEmail = null;
  }

  console.log('[gmail] OAuth complete, tokens saved');
  return { connected: true, email: _userEmail };
}

export async function getStatus() {
  const creds = loadCredentials();
  if (!creds || !creds.clientId) {
    return { connected: false, hasCredentials: false, email: null };
  }

  const tokens = loadTokens();
  if (!tokens || !tokens.access_token) {
    return { connected: false, hasCredentials: true, email: null };
  }

  // Check if token is valid by fetching user profile
  if (!_userEmail) {
    try {
      const client = getOAuth2Client();
      const oauth2 = google.oauth2({ version: 'v2', auth: client });
      const { data } = await oauth2.userinfo.get();
      _userEmail = data.email;
    } catch {
      // Token may be expired — try refresh
      try {
        const client = getOAuth2Client();
        await client.getAccessToken();
        const oauth2 = google.oauth2({ version: 'v2', auth: client });
        const { data } = await oauth2.userinfo.get();
        _userEmail = data.email;
      } catch {
        return { connected: false, hasCredentials: true, email: null };
      }
    }
  }

  return { connected: true, hasCredentials: true, email: _userEmail };
}

export async function revoke() {
  const client = getOAuth2Client();
  if (client) {
    try {
      await client.revokeCredentials();
    } catch {
      // Token may already be invalid
    }
  }

  // Delete stored tokens
  try {
    fs.unlinkSync(TOKENS_PATH);
  } catch {}

  // Reset state
  _oauth2Client = null;
  _gmail = null;
  _userEmail = null;

  return { connected: false };
}

// ── Gmail API Methods ─────────────────────────────────

function parseMessageHeaders(headers) {
  const result = {};
  for (const h of headers || []) {
    const name = h.name.toLowerCase();
    if (name === 'from') result.from = h.value;
    else if (name === 'to') result.to = h.value;
    else if (name === 'subject') result.subject = h.value;
    else if (name === 'date') result.date = h.value;
    else if (name === 'message-id') result.messageId = h.value;
    else if (name === 'in-reply-to') result.inReplyTo = h.value;
  }
  return result;
}

function decodeBody(part) {
  if (!part || !part.body || !part.body.data) return '';
  return Buffer.from(part.body.data, 'base64url').toString('utf8');
}

function extractBody(payload) {
  // Simple message — body is directly on payload
  if (payload.body && payload.body.data) {
    return { text: decodeBody(payload), html: null };
  }

  // Multipart message — find text/plain and text/html parts
  let text = '';
  let html = '';

  function walk(parts) {
    for (const part of parts || []) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        text = decodeBody(part);
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        html = decodeBody(part);
      } else if (part.parts) {
        walk(part.parts);
      }
    }
  }

  walk(payload.parts);
  return { text, html };
}

function extractAttachments(payload) {
  const attachments = [];

  function walk(parts) {
    for (const part of parts || []) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          id: part.body.attachmentId,
          name: part.filename,
          type: part.mimeType,
          size: part.body.size,
        });
      }
      if (part.parts) walk(part.parts);
    }
  }

  walk(payload.parts);
  return attachments;
}

export async function getInbox(maxResults = 20, query = '') {
  const gmail = getGmailClient();
  if (!gmail) throw new Error('Gmail not connected');

  const q = query ? `in:inbox ${query}` : 'in:inbox';
  const { data } = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q,
  });

  if (!data.messages || data.messages.length === 0) {
    return { messages: [], total: data.resultSizeEstimate || 0 };
  }

  // Fetch message details in parallel (metadata only for speed)
  const details = await Promise.all(
    data.messages.map(m =>
      gmail.users.messages.get({
        userId: 'me',
        id: m.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      }).then(r => r.data)
    )
  );

  const messages = details.map(msg => {
    const headers = parseMessageHeaders(msg.payload?.headers);
    return {
      id: msg.id,
      threadId: msg.threadId,
      from: headers.from || '',
      to: headers.to || '',
      subject: headers.subject || '(no subject)',
      date: headers.date || '',
      snippet: msg.snippet || '',
      unread: (msg.labelIds || []).includes('UNREAD'),
      hasAttachments: (msg.payload?.parts || []).some(p => p.filename),
      labels: msg.labelIds || [],
    };
  });

  return { messages, total: data.resultSizeEstimate || messages.length };
}

export async function getMessage(id) {
  const gmail = getGmailClient();
  if (!gmail) throw new Error('Gmail not connected');

  const { data } = await gmail.users.messages.get({
    userId: 'me',
    id,
    format: 'full',
  });

  const headers = parseMessageHeaders(data.payload?.headers);
  const body = extractBody(data.payload);
  const attachments = extractAttachments(data.payload);

  return {
    id: data.id,
    threadId: data.threadId,
    from: headers.from || '',
    to: headers.to || '',
    subject: headers.subject || '',
    date: headers.date || '',
    messageId: headers.messageId || '',
    inReplyTo: headers.inReplyTo || '',
    snippet: data.snippet || '',
    body: body.text || body.html || '',
    bodyHtml: body.html || '',
    attachments,
    labels: data.labelIds || [],
    unread: (data.labelIds || []).includes('UNREAD'),
  };
}

export async function getThread(threadId) {
  const gmail = getGmailClient();
  if (!gmail) throw new Error('Gmail not connected');

  const { data } = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'full',
  });

  const messages = (data.messages || []).map(msg => {
    const headers = parseMessageHeaders(msg.payload?.headers);
    const body = extractBody(msg.payload);
    const attachments = extractAttachments(msg.payload);

    return {
      id: msg.id,
      from: headers.from || '',
      to: headers.to || '',
      subject: headers.subject || '',
      date: headers.date || '',
      body: body.text || body.html || '',
      bodyHtml: body.html || '',
      attachments,
      labels: msg.labelIds || [],
    };
  });

  // Thread subject from first message
  const subject = messages.length > 0 ? messages[0].subject : '';

  return { threadId, subject, messages };
}

export async function getLabels() {
  const gmail = getGmailClient();
  if (!gmail) throw new Error('Gmail not connected');

  const { data } = await gmail.users.labels.list({ userId: 'me' });

  return (data.labels || []).map(l => ({
    id: l.id,
    name: l.name,
    type: l.type,
    messagesTotal: l.messagesTotal,
    messagesUnread: l.messagesUnread,
  }));
}

export async function markRead(id) {
  const gmail = getGmailClient();
  if (!gmail) throw new Error('Gmail not connected');

  await gmail.users.messages.modify({
    userId: 'me',
    id,
    requestBody: { removeLabelIds: ['UNREAD'] },
  });
  return { ok: true };
}

export async function markUnread(id) {
  const gmail = getGmailClient();
  if (!gmail) throw new Error('Gmail not connected');

  await gmail.users.messages.modify({
    userId: 'me',
    id,
    requestBody: { addLabelIds: ['UNREAD'] },
  });
  return { ok: true };
}

export async function sendMessage({ to, subject, body, inReplyTo, threadId }) {
  const gmail = getGmailClient();
  if (!gmail) throw new Error('Gmail not connected');

  const email = _userEmail || 'me';
  const lines = [
    `From: ${email}`,
    `To: ${to}`,
    `Subject: ${subject || ''}`,
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  lines.push('Content-Type: text/plain; charset=utf-8');
  lines.push('');
  lines.push(body || '');

  const raw = Buffer.from(lines.join('\r\n')).toString('base64url');

  const params = { userId: 'me', requestBody: { raw } };
  if (threadId) params.requestBody.threadId = threadId;

  const { data } = await gmail.users.messages.send(params);
  return { id: data.id, threadId: data.threadId };
}

export async function searchMessages(query, maxResults = 20) {
  const gmail = getGmailClient();
  if (!gmail) throw new Error('Gmail not connected');

  const { data } = await gmail.users.messages.list({
    userId: 'me',
    maxResults,
    q: query,
  });

  if (!data.messages || data.messages.length === 0) {
    return { messages: [], total: 0 };
  }

  const details = await Promise.all(
    data.messages.map(m =>
      gmail.users.messages.get({
        userId: 'me',
        id: m.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      }).then(r => r.data)
    )
  );

  const messages = details.map(msg => {
    const headers = parseMessageHeaders(msg.payload?.headers);
    return {
      id: msg.id,
      threadId: msg.threadId,
      from: headers.from || '',
      subject: headers.subject || '(no subject)',
      date: headers.date || '',
      snippet: msg.snippet || '',
      unread: (msg.labelIds || []).includes('UNREAD'),
    };
  });

  return { messages, total: data.resultSizeEstimate || messages.length };
}
