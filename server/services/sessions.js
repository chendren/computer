/**
 * Sessions service — tracks voice assistant conversation sessions.
 * The voice-assistant.js maintains an in-memory sessions Map.
 * This service provides the API layer for listing/viewing/managing them.
 */

// Session storage — shared with voice-assistant via registerSession()
const sessions = new Map();

/**
 * Register or update a session from voice-assistant.
 * Called after each voice command is processed.
 */
export function registerSession(sessionId, history) {
  sessions.set(sessionId, {
    key: sessionId,
    history: history || [],
    lastActive: Date.now(),
  });
}

export function listSessions() {
  const result = [];
  for (const [key, s] of sessions) {
    result.push({
      key,
      messageCount: s.history.length,
      lastActive: s.lastActive,
    });
  }
  // Sort by most recently active
  result.sort((a, b) => b.lastActive - a.lastActive);
  return result;
}

export function getSessionHistory(key) {
  const s = sessions.get(key);
  if (!s) return [];
  return s.history;
}

export function resetSession(key) {
  sessions.delete(key);
  return { ok: true };
}

export function getSessionCost(key) {
  const s = sessions.get(key);
  if (!s) return { tokens: 0, estimated: 0 };
  // Rough estimate: ~4 chars per token
  let totalChars = 0;
  for (const msg of s.history) {
    const content = msg.content || msg.text || '';
    totalChars += typeof content === 'string' ? content.length : JSON.stringify(content).length;
  }
  const tokens = Math.ceil(totalChars / 4);
  return { tokens, messages: s.history.length, estimated: tokens * 0.000001 };
}
