/**
 * Voice Assistant Service
 *
 * Uses Qwen 2.5 7B via local Ollama with OpenAI-compatible tool use to process
 * voice commands. Maintains per-session conversation history and provides
 * an agentic tool loop for multi-step operations.
 */

const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434';
const VOICE_MODEL = process.env.VOICE_MODEL || 'qwen2.5:7b-instruct-q4_K_M';

// Per-session conversation history
const sessions = new Map();
const MAX_HISTORY = 20;
const SESSION_TTL = 30 * 60 * 1000; // 30 min

function getSystemPrompt() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const isoDate = now.toISOString().split('T')[0];

  return `You are the USS Enterprise Computer, an advanced AI system aboard a Federation starship. You have access to ship systems including knowledge base, communications, sensors (monitoring), captain's log, viewscreen (browser/display), and data visualization.

Current stardate reference: Today is ${dateStr}, ${timeStr} (${isoDate}).
Use this date as the anchor for ALL time-relative requests. When the user says "last week", "past 3 days", "this month", etc., compute the exact date range from today's date. Always use specific dates in web searches, chart labels, and data queries — never use vague relative terms. For example, if asked for "the last 7 days", use dates ${new Date(now - 7 * 86400000).toISOString().split('T')[0]} through ${isoDate}.

Guidelines:
- Respond concisely — your responses will be spoken aloud via TTS. Keep responses under 200 characters when possible. Never use markdown formatting, lists, or special characters in your response — it will be read aloud.
- Be direct and authoritative, like the Star Trek computer. Use short declarative sentences.
- Use tools when the user's request maps to a ship system. Do not describe what you would do — actually do it.
- When the user says "on screen" or "show me", use the display_on_screen tool to switch the LCARS panel.
- For multi-step tasks, chain tool calls as needed. For data visualization, first use web_fetch to get real data, then use generate_chart with that data.
- If no tool is needed, respond with a brief spoken answer.
- Never output API keys, tokens, passwords, or sensitive data.

Web data retrieval:
- For ANY question requiring current/real-time data (prices, weather, news, scores, stock quotes), you MUST use web_search_and_read. This tool searches AND reads the top pages automatically, giving you actual content with real numbers.
- NEVER answer with prices, statistics, or current data from memory. ALWAYS use web_search_and_read first. Your training data is outdated.
- Only report numbers that appear verbatim in the tool results. Quote the exact figures from the page content.
- For charts: use web_search_and_read to get real data points, then generate_chart with the actual numbers from the results.
- If the first search doesn't return clear numbers, try a more specific query or use web_fetch on a different URL.
- NEVER fabricate, estimate, or round data. If you cannot find the exact number in the tool results, say "I could not find that data" — do not guess.
- Do not apologize about technical limitations. Just try alternative approaches silently.`;
}

// OpenAI-compatible tool definitions for Ollama
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_knowledge',
      description: 'Search the ship knowledge base using semantic vector search. Use for questions about stored information, facts, documents.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          limit: { type: 'number', description: 'Max results (default 5)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'store_knowledge',
      description: 'Store new information in the knowledge base for future retrieval.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Information to store' },
          title: { type: 'string', description: 'Title for the entry' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_log',
      description: "Create a captain's log entry.",
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Log entry content' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'display_on_screen',
      description: 'Switch the main LCARS viewscreen to a specific panel. Use when user says "on screen" or "show me".',
      parameters: {
        type: 'object',
        properties: {
          panel: {
            type: 'string',
            enum: [
              'dashboard', 'transcript', 'analysis', 'charts', 'search', 'log',
              'monitor', 'compare', 'knowledge', 'channels', 'gateway', 'plugins',
              'cron', 'browser', 'nodes', 'security',
            ],
            description: 'Panel to display',
          },
        },
        required: ['panel'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_message',
      description: 'Send a message through the communications gateway to a messaging channel.',
      parameters: {
        type: 'object',
        properties: {
          channel: { type: 'string', description: 'Channel (e.g., slack, discord, email, telegram)' },
          target: { type: 'string', description: 'Recipient (channel name, user, email)' },
          text: { type: 'string', description: 'Message content' },
        },
        required: ['channel', 'target', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_channels',
      description: 'List all communication channels and their connection status.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_status',
      description: 'Get overall system health and status including gateway, vectordb, ollama.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_transcripts',
      description: 'Search through voice transcript history.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_monitor',
      description: 'Set up a monitoring watch on a URL, file, or endpoint.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Monitor name' },
          target: { type: 'string', description: 'URL or target to monitor' },
        },
        required: ['name', 'target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_briefing',
      description: 'Get an activity summary/briefing of recent transcripts, logs, and analyses.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_chart',
      description: 'Generate and display a chart on the viewscreen.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['bar', 'line', 'pie', 'doughnut', 'radar'] },
          title: { type: 'string', description: 'Chart title' },
          labels: { type: 'array', items: { type: 'string' } },
          data: { type: 'array', items: { type: 'number' } },
        },
        required: ['type', 'title', 'labels', 'data'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browse_url',
      description: 'Open a URL on the viewscreen browser panel.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_text',
      description: 'Run AI analysis on text (sentiment, topics, key points, action items).',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to analyze' },
          title: { type: 'string', description: 'Title for the analysis' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web using DuckDuckGo. Returns search result titles and snippets. Use this FIRST when you need current data like prices, news, weather, or any real-time information. Then use web_fetch on promising result URLs if needed.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query — be specific, include dates when relevant' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch content from a specific URL. Returns extracted text content. Use after web_search to get details from a specific page.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to fetch content from' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search_and_read',
      description: 'PREFERRED over web_search. Searches the web AND automatically fetches and reads the top result pages. Returns search snippets plus full extracted text content from the top pages. Use this for any query needing real current data: prices, weather, news, sports scores, stock quotes. Returns actual page content, not just snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query — be specific, include dates when relevant' },
          num_results: { type: 'number', description: 'Number of pages to read (default 3, max 5)' },
        },
        required: ['query'],
      },
    },
  },
];

const MAX_TOOL_LOOPS = 10;

/**
 * Call Ollama's OpenAI-compatible chat completions endpoint.
 */
async function callOllama(messages, systemPrompt) {
  const body = {
    model: VOICE_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    tools: TOOLS,
    stream: false,
  };

  const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Ollama API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  return await res.json();
}

/**
 * Process a voice command through Qwen 2.5 via Ollama with tool use.
 *
 * @param {string} sessionId - Unique session identifier
 * @param {string} userText - Transcribed voice command (wake word stripped)
 * @param {function} toolExecutor - async (toolName, input) => result
 * @returns {{ text: string, toolsUsed: string[], panelSwitch: string|null }}
 */
export async function processVoiceCommand(sessionId, userText, toolExecutor) {
  const session = getOrCreateSession(sessionId);

  // Auto-search: detect queries needing current data and pre-fetch results
  // so the model can't skip the search and hallucinate
  const lowerText = userText.toLowerCase();
  const needsSearch = /\b(price|cost|worth|stock|quote|weather|forecast|temperature|score|result|news|latest|current|today|right now|how much|what is the|spot price|market|exchange rate|rate of|bitcoin|btc|eth|gold|silver|platinum|oil|nasdaq|dow|s&p|crypto)\b/i.test(userText);

  let enrichedText = userText;
  if (needsSearch) {
    console.log(`[voice-ai] Auto-search triggered for: "${userText}"`);
    try {
      const searchResult = await toolExecutor('web_search_and_read', { query: userText, num_results: 3 });
      const searchContext = [];

      if (searchResult.instantAnswer) {
        searchContext.push(`Instant answer: ${searchResult.instantAnswer}`);
      }
      if (searchResult.searchResults?.length) {
        searchContext.push('Search results:');
        for (const r of searchResult.searchResults.slice(0, 5)) {
          searchContext.push(`- ${r.title}: ${r.snippet}`);
        }
      }
      if (searchResult.pages?.length) {
        searchContext.push('\nPage content:');
        for (const p of searchResult.pages) {
          if (p.content) {
            searchContext.push(`[${p.title}] (${p.url}):\n${p.content.slice(0, 2000)}`);
          }
        }
      }

      if (searchContext.length > 0) {
        const contextStr = searchContext.join('\n');
        enrichedText = `${userText}\n\n--- LIVE WEB DATA (use these numbers, do NOT make up your own) ---\n${contextStr}\n--- END WEB DATA ---\n\nAnswer using ONLY the data above. Quote exact numbers from the web data.`;
        console.log(`[voice-ai] Injected ${contextStr.length} chars of web data`);
      }
    } catch (err) {
      console.warn(`[voice-ai] Auto-search failed: ${err.message}`);
    }
  }

  session.messages.push({ role: 'user', content: enrichedText });

  // Trim history
  if (session.messages.length > MAX_HISTORY) {
    session.messages = session.messages.slice(-MAX_HISTORY);
  }

  const systemPrompt = getSystemPrompt();
  console.log(`[voice-ai] Calling Ollama (${VOICE_MODEL}): "${userText}"`);

  let response = await callOllama(session.messages, systemPrompt);
  let choice = response.choices?.[0];
  console.log(`[voice-ai] Response finish_reason: ${choice?.finish_reason}`);

  const toolsUsed = [];
  let panelSwitch = null;
  let loops = 0;

  // Agentic loop — keep processing until no more tool_calls
  while (choice?.finish_reason === 'tool_calls' || choice?.message?.tool_calls?.length > 0) {
    if (++loops > MAX_TOOL_LOOPS) {
      console.warn('[voice-ai] Max tool loop iterations reached');
      break;
    }

    const assistantMsg = choice.message;
    session.messages.push(assistantMsg);

    const toolCalls = assistantMsg.tool_calls || [];

    for (const toolCall of toolCalls) {
      const fnName = toolCall.function?.name;
      let fnArgs = {};
      try {
        fnArgs = typeof toolCall.function?.arguments === 'string'
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function?.arguments || {};
      } catch {
        fnArgs = {};
      }

      toolsUsed.push(fnName);
      console.log(`[voice-ai] Tool call: ${fnName}(${JSON.stringify(fnArgs).slice(0, 200)})`);

      try {
        const result = await toolExecutor(fnName, fnArgs);
        console.log(`[voice-ai] Tool result: ${JSON.stringify(result).slice(0, 200)}`);

        if (fnName === 'display_on_screen') {
          panelSwitch = fnArgs.panel;
        }

        session.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result).slice(0, 10000),
        });
      } catch (err) {
        console.error(`[voice-ai] Tool error: ${fnName}: ${err.message}`);
        session.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: err.message }),
        });
      }
    }

    response = await callOllama(session.messages, systemPrompt);
    choice = response.choices?.[0];
    console.log(`[voice-ai] Loop response finish_reason: ${choice?.finish_reason}`);
  }

  // Extract final text
  const responseText = choice?.message?.content || '';
  console.log(`[voice-ai] Final response: "${responseText.slice(0, 200)}", tools: [${toolsUsed.join(', ')}]`);

  session.messages.push({ role: 'assistant', content: responseText });

  return { text: responseText, toolsUsed, panelSwitch };
}

/**
 * Check if voice assistant is available (Ollama reachable).
 */
let _ollamaChecked = false;
let _ollamaAvailable = false;

export function isVoiceAvailable() {
  // Kick off async check on first call
  if (!_ollamaChecked) {
    _ollamaChecked = true;
    checkOllama();
  }
  return _ollamaAvailable;
}

async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (res.ok) {
      const data = await res.json();
      const models = (data.models || []).map(m => m.name);
      _ollamaAvailable = models.some(m => m.includes('qwen2.5'));
      if (_ollamaAvailable) {
        console.log(`[voice-ai] Ollama available with ${VOICE_MODEL}`);
      } else {
        console.warn(`[voice-ai] Ollama online but ${VOICE_MODEL} not found. Available: ${models.join(', ')}`);
      }
    }
  } catch {
    console.warn('[voice-ai] Ollama not reachable');
    _ollamaAvailable = false;
  }
}

// Re-check Ollama availability every 30 seconds
setInterval(() => checkOllama(), 30000);

function getOrCreateSession(sessionId) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { messages: [], lastActive: Date.now() });
  }
  const session = sessions.get(sessionId);
  session.lastActive = Date.now();
  return session;
}

// Cleanup expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActive > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}, 60000);
