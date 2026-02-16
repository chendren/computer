/**
 * Gmail Intelligence Service — LLM-powered email analysis
 *
 * Uses Llama 4 Scout (via Ollama) for four distinct analysis modes:
 * 1. Inbox Summary — bird's-eye view of what's in the inbox
 * 2. Priority Triage — classify each message by urgency
 * 3. Follow-up Detection — find threads needing attention
 * 4. Thread Summary — condense a conversation thread
 */

const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434';
const VOICE_MODEL = process.env.VOICE_MODEL || 'llama4:scout';

/**
 * Extract email domain from a From header using string methods.
 * "Name <user@domain.com>" → "domain.com"
 */
function extractDomain(from) {
  const atIdx = (from || '').indexOf('@');
  if (atIdx === -1) return '';
  const afterAt = from.slice(atIdx + 1);
  const endIdx = afterAt.indexOf('>');
  return endIdx !== -1 ? afterAt.slice(0, endIdx).trim() : afterAt.trim();
}

/**
 * Call Ollama with assistant prefill to force JSON output.
 * The assistant message starts with '{' so the model continues the JSON object.
 */
async function callLLM(systemPrompt, userContent, maxTokens = 1024) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  console.log(`[gmail-intel] LLM call starting (max_tokens=${maxTokens})`);

  try {
    const res = await fetch(OLLAMA_BASE + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: VOICE_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        stream: false,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[gmail-intel] LLM HTTP ${res.status}: ${errText.slice(0, 200)}`);
      return {};
    }

    const json = await res.json();
    const raw = (json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content) || '{}';
    console.log(`[gmail-intel] LLM response (${raw.length} chars): ${raw.slice(0, 300)}`);

    // Parse JSON, handling various model output quirks
    let cleaned = raw.trim();

    // Strip code fences if present
    if (cleaned.startsWith('```')) {
      const firstNL = cleaned.indexOf('\n');
      if (firstNL !== -1) cleaned = cleaned.slice(firstNL + 1);
      const lastFence = cleaned.lastIndexOf('```');
      if (lastFence !== -1) cleaned = cleaned.slice(0, lastFence);
      cleaned = cleaned.trim();
    }

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      console.warn(`[gmail-intel] JSON parse failed: ${e.message}`);
      // Try extracting the outermost { ... }
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try { return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)); } catch {}
      }
      console.error(`[gmail-intel] Could not parse: ${cleaned.slice(0, 300)}`);
      return {};
    }
  } catch (err) {
    clearTimeout(timeout);
    console.error(`[gmail-intel] LLM call failed: ${err.message}`);
    return {};
  }
}

// ── Inbox Summary ──────────────────────────────────
//
// Goal: Give a quick bird's-eye overview of the inbox.
// Persona: A ship's communications officer reporting to the captain.
// Output: Natural language summary + categorized highlights.

export async function summarizeInbox(messages) {
  const unreadCount = messages.filter(m => m.unread).length;

  const emailList = messages.slice(0, 25).map(m => {
    const from = (m.from || '').split('<')[0].trim() || 'unknown';
    const status = m.unread ? 'NEW' : 'read';
    const labels = (m.labels || []).filter(l => l.startsWith('CATEGORY_')).map(l => l.replace('CATEGORY_', '').toLowerCase());
    return `[${status}] ${from}: "${m.subject || '(no subject)'}" ${labels.length ? '(' + labels.join(', ') + ')' : ''}`;
  }).join('\n');

  const system = `You are a communications officer delivering a briefing on incoming messages.
Analyze the email list below. Your briefing should be genuinely useful — not just "you have emails."

Write a natural, specific summary that tells the reader exactly what matters:
- Count how many are promotional/automated noise vs real correspondence
- Name specific senders and subjects that stand out
- If it is mostly promotional, say so clearly and mention any non-promotional items by name
- If there are important emails, lead with those

keyTopics: 3-5 specific phrases (not generic words like "updates" — use actual topics from the emails)
urgentItems: anything time-sensitive. If nothing is truly urgent, leave this empty.
needsReply: emails where someone appears to expect a response

Respond with ONLY this JSON, no other text:
{"summary":"...","keyTopics":["..."],"urgentItems":[{"from":"...","subject":"...","reason":"..."}],"needsReply":[{"from":"...","subject":"..."}]}`;

  const user = `${unreadCount} unread of ${messages.length} total messages:\n\n${emailList}`;

  const result = await callLLM(system, user, 1024);

  return {
    summary: result.summary || 'No summary available',
    keyTopics: Array.isArray(result.keyTopics) ? result.keyTopics : [],
    urgentItems: Array.isArray(result.urgentItems) ? result.urgentItems : [],
    needsReply: Array.isArray(result.needsReply) ? result.needsReply : [],
    unreadCount,
    totalCount: messages.length,
  };
}

// ── Priority Triage ────────────────────────────────
//
// Goal: Tag every message with a priority level for sorting.
// Persona: An email triage system classifying messages.
// Output: Each message ID mapped to a priority + reason.

export async function prioritizeMessages(messages) {
  const emailList = messages.slice(0, 30).map(m => {
    const from = (m.from || '').split('<')[0].trim() || 'unknown';
    const domain = extractDomain(m.from || '');
    const labels = (m.labels || []).filter(l => l.startsWith('CATEGORY_')).map(l => l.replace('CATEGORY_', '').toLowerCase());
    return `ID:${m.id} | From: ${from} (${domain}) | Subject: ${m.subject || '(none)'} | Labels: ${labels.join(',')} | ${m.unread ? 'UNREAD' : 'read'}`;
  }).join('\n');

  const system = `Classify each email into exactly one priority tier. Use the sender domain and Gmail category labels as strong signals.

Tiers:
- urgent: deadlines, time-sensitive requests from real people
- action-required: needs a reply or action, but not time-critical
- fyi: informational from a real person, no action needed
- promotional: marketing, sales, newsletters, coupons, store emails (usually CATEGORY_PROMOTIONS)
- automated: system alerts, receipts, password resets, account notifications (usually CATEGORY_UPDATES)

For each email, output its ID and tier. Respond with ONLY this JSON:
{"prioritized":[{"id":"...","priority":"...","reason":"short reason"}]}`;

  const result = await callLLM(system, emailList, 2048);

  const prioritized = Array.isArray(result.prioritized) ? result.prioritized : [];
  const priorityMap = new Map();
  for (const p of prioritized) {
    if (p.id) priorityMap.set(p.id, { priority: p.priority || 'fyi', reason: p.reason || '' });
  }

  return messages.map(msg => ({
    ...msg,
    priority: priorityMap.get(msg.id)?.priority || 'fyi',
    priorityReason: priorityMap.get(msg.id)?.reason || '',
  }));
}

// ── Follow-up Detection ────────────────────────────
//
// Goal: Find threads that need the user's response or attention.
// Persona: A personal assistant reviewing correspondence for loose ends.
// Output: List of threads needing follow-up with reason and urgency.

export async function detectFollowups(messages) {
  // Filter to only potentially relevant messages (skip obvious promo/automated)
  const relevant = messages.filter(m => {
    const labels = (m.labels || []).join(' ');
    return !labels.includes('CATEGORY_PROMOTIONS') && !labels.includes('CATEGORY_SOCIAL');
  });

  if (relevant.length === 0) return [];

  const emailList = relevant.slice(0, 30).map(m => {
    const from = (m.from || '').split('<')[0].trim() || 'unknown';
    return `Thread:${m.threadId} | From: ${from} | Subject: ${m.subject || '(none)'} | ${m.unread ? 'UNREAD' : 'read'}\nSnippet: ${(m.snippet || '').slice(0, 120)}`;
  }).join('\n\n');

  const system = `You are a personal assistant checking for loose ends in the user's email.

Identify threads where:
- Someone asked a question and is waiting for a reply
- A commitment was made that needs follow-through
- A deadline or due date was mentioned
- An important conversation went quiet without resolution

Skip marketing, newsletters, and automated messages entirely.
If nothing needs follow-up, return an empty list.

Type: "unanswered" | "promised" | "deadline" | "stale"
Urgency: "high" | "medium" | "low"

Respond with ONLY this JSON:
{"followups":[{"threadId":"...","from":"...","subject":"...","type":"...","reason":"...","urgency":"..."}]}`;

  const result = await callLLM(system, emailList, 1024);

  return Array.isArray(result.followups) ? result.followups : [];
}

// ── Thread Summary ─────────────────────────────────
//
// Goal: Condense a multi-message email thread into key points.
// Persona: A briefing officer preparing a conversation digest.
// Output: Summary, participants, key points, decisions, action items, status.

export async function summarizeThread(threadMessages) {
  const conversation = threadMessages.map((msg, i) => {
    const from = (msg.from || '').split('<')[0].trim() || 'unknown';
    const date = msg.date || '';
    const body = (msg.body || msg.snippet || '').slice(0, 1500);
    return `--- Message ${i + 1} ---\nFrom: ${from} | Date: ${date}\n${body}`;
  }).join('\n\n');

  const system = `Summarize this email conversation thread into a briefing.

Extract:
- summary: 2-3 sentence overview of what the conversation is about
- participants: list of people involved (first names or short names)
- keyPoints: the most important things discussed
- decisions: anything that was agreed upon (empty array if none)
- actionItems: tasks assigned to specific people (empty array if none)
- status: "resolved" if concluded, "pending" if waiting, "needs-reply" if the user should respond, "informational" if just FYI

Respond with ONLY this JSON:
{"summary":"...","participants":["..."],"keyPoints":["..."],"decisions":["..."],"actionItems":[{"assignee":"...","action":"..."}],"status":"..."}`;

  const result = await callLLM(system, conversation, 768);

  return {
    summary: result.summary || 'No summary available',
    participants: Array.isArray(result.participants) ? result.participants : [],
    keyPoints: Array.isArray(result.keyPoints) ? result.keyPoints : [],
    decisions: Array.isArray(result.decisions) ? result.decisions : [],
    actionItems: Array.isArray(result.actionItems) ? result.actionItems : [],
    status: result.status || 'informational',
  };
}
