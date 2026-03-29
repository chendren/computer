/**
 * Telegram Bot Service — Send and receive messages via Telegram Bot API.
 *
 * Uses long polling (getUpdates) to receive incoming messages and
 * broadcasts them to the LCARS UI via WebSocket. Outgoing messages
 * are sent via the sendMessage API.
 *
 * Credentials: data/telegram.json { botToken }
 * Bot: @chadcomputerbot
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'telegram.json');
const BASE_URL = 'https://api.telegram.org/bot';

let _botToken = null;
let _botInfo = null;
let _polling = false;
let _pollTimeout = null;
let _lastUpdateId = 0;
let _broadcast = null;
// Chat ID cache: name → chat_id (learned from incoming messages)
const _chatIds = new Map();
const CHAT_CACHE_PATH = path.join(DATA_DIR, 'telegram-chats.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return null; }
}

function loadChatCache() {
  try {
    const data = JSON.parse(fs.readFileSync(CHAT_CACHE_PATH, 'utf8'));
    for (const [name, id] of Object.entries(data)) _chatIds.set(name, id);
  } catch {}
}

function saveChatCache() {
  const obj = Object.fromEntries(_chatIds);
  fs.writeFileSync(CHAT_CACHE_PATH, JSON.stringify(obj, null, 2));
}

async function apiCall(method, params = {}) {
  if (!_botToken) throw new Error('Telegram bot not configured');
  const url = `${BASE_URL}${_botToken}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || 'Telegram API error');
  return data.result;
}

/**
 * Initialize the Telegram bot service.
 * @param {function} broadcastFn — WebSocket broadcast function
 */
export async function initTelegram(broadcastFn) {
  const config = loadConfig();
  if (!config?.botToken) {
    console.log('[telegram] No bot token found in data/telegram.json');
    return false;
  }
  _botToken = config.botToken;
  _broadcast = broadcastFn;
  loadChatCache();

  try {
    _botInfo = await apiCall('getMe');
    console.log(`[telegram] Bot online: @${_botInfo.username} (${_botInfo.first_name})`);
    startPolling();
    return true;
  } catch (err) {
    console.error('[telegram] Failed to connect:', err.message);
    return false;
  }
}

/**
 * Start long polling for incoming messages.
 */
function startPolling() {
  if (_polling) return;
  _polling = true;
  poll();
}

async function poll() {
  if (!_polling) return;
  try {
    const updates = await apiCall('getUpdates', {
      offset: _lastUpdateId + 1,
      timeout: 15,
      allowed_updates: ['message'],
    });

    for (const update of updates) {
      _lastUpdateId = update.update_id;
      if (update.message) {
        handleIncoming(update.message);
      }
    }
  } catch (err) {
    // Avoid log spam on network errors
    if (!err.message.includes('aborted')) {
      console.warn('[telegram] Poll error:', err.message);
    }
  }

  // Schedule next poll
  _pollTimeout = setTimeout(() => poll(), 1000);
}

function handleIncoming(msg) {
  const chatId = msg.chat.id;
  const from = msg.from?.first_name || msg.from?.username || 'Unknown';
  const username = msg.from?.username || '';
  const text = msg.text || '';

  // Cache the chat ID for sending replies
  if (username) _chatIds.set(username.toLowerCase(), chatId);
  if (from) _chatIds.set(from.toLowerCase(), chatId);
  _chatIds.set(String(chatId), chatId);
  saveChatCache();

  console.log(`[telegram] Incoming from ${from} (@${username}): "${text.slice(0, 100)}"`);

  // Broadcast to LCARS UI
  if (_broadcast) {
    _broadcast('telegram_message', {
      from,
      username,
      chatId,
      text,
      timestamp: new Date(msg.date * 1000).toISOString(),
    });
    _broadcast('status', { message: `Telegram from ${from}: ${text.slice(0, 50)}` });
  }
}

/**
 * Send a message via Telegram.
 * @param {string} target — username, first name, or chat ID
 * @param {string} text — message text
 */
export async function sendMessage(target, text) {
  if (!_botToken) throw new Error('Telegram bot not configured');

  // Resolve target to chat_id
  let chatId = null;
  const lowerTarget = target.toLowerCase().trim();

  // Direct chat ID (numeric)
  if (lowerTarget.split('').every(c => c >= '0' && c <= '9' || c === '-')) {
    chatId = parseInt(lowerTarget, 10);
  }

  // Lookup from cache
  if (!chatId) chatId = _chatIds.get(lowerTarget);

  // Try without @ prefix
  if (!chatId && lowerTarget.startsWith('@')) {
    chatId = _chatIds.get(lowerTarget.slice(1));
  }

  if (!chatId) {
    // List known contacts in the error
    const known = [..._chatIds.keys()].filter(k => !k.split('').every(c => c >= '0' && c <= '9' || c === '-'));
    throw new Error(`Unknown Telegram contact: "${target}". Send me a message on Telegram first so I learn your chat ID. Known contacts: ${known.join(', ') || 'none'}`);
  }

  const result = await apiCall('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
  });

  return { sent: true, chatId, messageId: result.message_id };
}

/**
 * Get recent messages (from polling cache — not API history).
 */
export function getRecentMessages() {
  return []; // Could cache recent messages if needed
}

export function getStatus() {
  return {
    connected: !!_botInfo,
    botUsername: _botInfo?.username || null,
    botName: _botInfo?.first_name || null,
    knownContacts: [..._chatIds.keys()].filter(k => !k.split('').every(c => c >= '0' && c <= '9' || c === '-')),
  };
}

export function stopPolling() {
  _polling = false;
  if (_pollTimeout) clearTimeout(_pollTimeout);
}
