/**
 * Voice Assistant Service — Dual-Model Architecture
 *
 * Uses two local Ollama models:
 * - xLAM 8B F16 (Salesforce Large Action Model): deterministic tool selection/routing
 * - Llama 4 Scout (Meta MoE 16x17B): conversational response generation + analysis
 *
 * Flow: user input → xLAM picks tools → execute tools → Scout generates response
 */

const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434';
const VOICE_MODEL = process.env.VOICE_MODEL || 'llama4:scout';
const ACTION_MODEL = process.env.ACTION_MODEL || 'hf.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf:F16';

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
- If no tool is needed, respond with a brief spoken answer.
- Never output API keys, tokens, passwords, or sensitive data.
- Only report numbers that appear verbatim in tool results. NEVER fabricate, estimate, or round data.
- Do not apologize about technical limitations. Just try alternative approaches silently.`;
}

function getActionSystemPrompt() {
  return `You are a tool-routing agent. Given the user's request, determine which tools to call. Only select tools when the request clearly maps to a tool's purpose. For general conversation or questions that don't need tools, return an empty array.

IMPORTANT: Any request involving charts, graphs, plots, tables, visualizations, comparisons of data, stock prices, trends, statistics, or "show me data" MUST use the generate_chart tool. Pass the user's full request as the query parameter.`;
}

// OpenAI-compatible tool definitions
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
      description: "Create a log entry. Use when user says 'log', 'captains log', 'captain\\'s log', 'log entry', 'record', or 'make a note'.",
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
      description: 'Switch the viewscreen to a panel. Use when user says "on screen", "show me", "display", "open", "switch to", or "pull up".',
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
      description: 'Display a chart, graph, plot, table, or any data visualization on screen. MUST be used when user says chart, graph, plot, table, visualize, compare, trend, show data, show prices, display statistics, or any request to see data visually. Also use for stock prices, population, revenue, rankings, or any numeric data display. Pass the full user request as query.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The user\'s full visualization request in natural language' },
        },
        required: ['query'],
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
      description: 'Search the web using DuckDuckGo. Returns search result titles and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch content from a specific URL. Returns extracted text content.',
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
      description: 'Search the web AND automatically fetch and read the top result pages. Use for any query needing real current data: prices, weather, news, sports scores, stock quotes.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          num_results: { type: 'number', description: 'Number of pages to read (default 3, max 5)' },
        },
        required: ['query'],
      },
    },
  },
];

const MAX_TOOL_LOOPS = 10;



/**
 * Call Salesforce xLAM action model for deterministic tool selection.
 * Uses standard OpenAI tool_calls format — finish_reason: "tool_calls"
 * with message.tool_calls array of {id, function: {name, arguments}}.
 */
async function callActionModel(userText) {
  const body = {
    model: ACTION_MODEL,
    messages: [
      { role: 'system', content: getActionSystemPrompt() },
      { role: 'user', content: userText },
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
    throw new Error(`xLAM API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];

  // Format 1: Standard OpenAI tool_calls array (preferred)
  if (choice?.message?.tool_calls?.length > 0) {
    return choice.message.tool_calls.map(tc => ({
      name: tc.function?.name,
      arguments: tc.function?.arguments,
    }));
  }

  // Format 2: xLAM sometimes returns tool calls as JSON in content field
  // e.g. [{"name": "...", "parameters": {...}}] or {"tool_calls": [...]}
  const content = (choice?.message?.content || '').trim();
  if (content.startsWith('[') || content.startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      const calls = Array.isArray(parsed) ? parsed
        : parsed.tool_calls ? parsed.tool_calls
        : [];
      if (calls.length > 0 && calls[0].name) {
        return calls.map(c => ({
          name: c.name,
          arguments: c.arguments || c.parameters,
        }));
      }
    } catch {}
  }

  return [];
}

/**
 * Call Llama 4 Scout for conversational response generation.
 * No tools — just generates a natural language response given context.
 */
async function callResponseModel(messages, systemPrompt) {
  const body = {
    model: VOICE_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
    stream: false,
    max_tokens: 200,
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

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Process a voice command using dual-model architecture.
 *
 * 1. xLAM determines which tools to call (deterministic routing)
 * 2. Tools are executed server-side
 * 3. qwen2.5-7b generates a conversational response from the results
 *
 * @param {string} sessionId - Unique session identifier
 * @param {string} userText - Transcribed voice command (wake word stripped)
 * @param {function} toolExecutor - async (toolName, input) => result
 * @returns {{ text: string, toolsUsed: string[], panelSwitch: string|null }}
 */
export async function processVoiceCommand(sessionId, userText, toolExecutor) {
  const session = getOrCreateSession(sessionId);
  const toolsUsed = [];
  let panelSwitch = null;
  const toolResults = [];

  // Auto-search: detect queries needing current data and pre-fetch
  const searchKeywords = ['price', 'cost', 'worth', 'stock', 'quote', 'weather', 'forecast',
    'temperature', 'score', 'result', 'news', 'latest', 'current', 'today', 'right now',
    'how much is', 'spot price', 'market', 'exchange rate', 'rate of', 'bitcoin', 'btc',
    'eth', 'gold', 'silver', 'platinum', 'oil', 'nasdaq', 'dow', 's&p', 'crypto'];
  const lowerText = userText.toLowerCase();
  const needsSearch = searchKeywords.some(kw => lowerText.includes(kw));

  let enrichedText = userText;
  let directAnswer = null; // If set, skip nemotron and use this directly
  if (needsSearch) {
    console.log(`[voice-ai] Auto-search triggered for: "${userText}"`);
    try {
      const searchResult = await toolExecutor('web_search_and_read', { query: userText, num_results: 3 });

      // Check for structured price data (from Swissquote or similar APIs)
      if (searchResult.pages?.length) {
        for (const p of searchResult.pages) {
          if (!p.content) continue;
          const marker = 'Live ';
          const suffix = ' spot price: $';
          const idx1 = p.content.indexOf(marker);
          if (idx1 === -1) continue;
          const idx2 = p.content.indexOf(suffix, idx1);
          if (idx2 === -1) continue;
          const commodity = p.content.slice(idx1 + marker.length, idx2);
          const afterDollar = p.content.slice(idx2 + suffix.length);
          const endIdx = afterDollar.indexOf(' USD');
          if (endIdx === -1) continue;
          const price = afterDollar.slice(0, endIdx);
          directAnswer = `The current spot price of ${commodity} is $${price} per troy ounce.`;
          console.log(`[voice-ai] Direct answer from structured data: ${directAnswer}`);
          break;
        }
      }

      if (!directAnswer) {
        const keyFacts = [];
        if (searchResult.instantAnswer) keyFacts.push(searchResult.instantAnswer);

        const _hasNumericData = (text) => text.includes('$') || text.includes('%');

        if (searchResult.pages?.length) {
          for (const p of searchResult.pages) {
            if (!p.content) continue;
            const lines = p.content.split('\n').filter(l => _hasNumericData(l));
            for (const line of lines.slice(0, 5)) {
              const trimmed = line.trim().slice(0, 200);
              if (trimmed.length > 5) keyFacts.push(trimmed);
            }
          }
        }

        if (searchResult.searchResults?.length) {
          for (const r of searchResult.searchResults.slice(0, 3)) {
            if (_hasNumericData(r.snippet)) {
              keyFacts.push(`${r.title}: ${r.snippet}`);
            }
          }
        }

        if (keyFacts.length > 0) {
          const factStr = keyFacts.slice(0, 10).join('\n');
          enrichedText = `${userText}\n\nFACTS FROM WEB (use these exact numbers):\n${factStr}`;
          console.log(`[voice-ai] Injected ${keyFacts.length} key facts (${factStr.length} chars)`);
        } else {
          const rawBits = [];
          for (const p of (searchResult.pages || [])) {
            if (p.content) rawBits.push(`[${p.url}]: ${p.content.slice(0, 500)}`);
          }
          if (rawBits.length > 0) {
            enrichedText = `${userText}\n\nWEB DATA:\n${rawBits.join('\n').slice(0, 2000)}`;
            console.log(`[voice-ai] Injected raw web data`);
          }
        }
      }

      toolsUsed.push('web_search_and_read');
      toolResults.push({ tool: 'web_search_and_read', result: directAnswer || 'Web data injected' });
    } catch (err) {
      console.warn(`[voice-ai] Auto-search failed: ${err.message}`);
    }
  }

  // If we have a direct answer from structured data, skip LLM entirely
  // BUT NOT if the user wants a visualization — let xLAM route to generate_chart
  const vizKeywords = ['chart', 'graph', 'plot', 'table', 'visualiz', 'trend', 'show me', 'show the', 'show data', 'display data', 'compare data', 'comparison', 'versus', ' vs '];
  const wantsViz = vizKeywords.some(kw => lowerText.includes(kw));
  if (directAnswer && !wantsViz) {
    console.log(`[voice-ai] Using direct answer (bypassing LLM): "${directAnswer}"`);
    session.messages.push({ role: 'user', content: userText });
    session.messages.push({ role: 'assistant', content: directAnswer });
    if (session.messages.length > MAX_HISTORY) session.messages = session.messages.slice(-MAX_HISTORY);
    return { text: directAnswer, toolsUsed, panelSwitch };
  }

  // Step 1: Ask xLAM what tools to call (deterministic routing)
  console.log(`[voice-ai] [xLAM] Routing: "${userText}"`);
  let actionToolCalls = [];
  try {
    actionToolCalls = await callActionModel(userText);
    console.log(`[voice-ai] [xLAM] Selected ${actionToolCalls.length} tool(s): ${actionToolCalls.map(t => t.name).join(', ') || 'none'}`);
  } catch (err) {
    console.warn(`[voice-ai] [xLAM] Routing failed, falling back to no tools: ${err.message}`);
  }

  // xLAM safety net: if it didn't route to generate_chart but user clearly wants visualization, force it
  const hasChartCall = actionToolCalls.some(tc => tc.name === 'generate_chart');
  if (!hasChartCall && wantsViz) {
    console.log(`[voice-ai] [xLAM] Forcing generate_chart — user request contains visualization keyword`);
    actionToolCalls.push({ name: 'generate_chart', arguments: { query: userText } });
  }

  // Step 2: Execute xLAM-selected tools
  let loops = 0;
  for (const toolCall of actionToolCalls) {
    if (++loops > MAX_TOOL_LOOPS) {
      console.warn('[voice-ai] Max tool loop iterations reached');
      break;
    }

    const fnName = toolCall.name;
    let fnArgs = {};
    try {
      fnArgs = typeof toolCall.arguments === 'string'
        ? JSON.parse(toolCall.arguments)
        : toolCall.arguments || {};
    } catch {
      fnArgs = {};
    }

    // generate_chart: always pass original user text as query — xLAM can't be trusted to do this
    if (fnName === 'generate_chart') {
      fnArgs = { query: userText };
    }

    // Skip web_search_and_read if auto-search already ran
    if (fnName === 'web_search_and_read' && needsSearch && toolsUsed.includes('web_search_and_read')) {
      console.log(`[voice-ai] Skipping duplicate web_search_and_read (auto-search already ran)`);
      continue;
    }

    toolsUsed.push(fnName);
    console.log(`[voice-ai] Tool call: ${fnName}(${JSON.stringify(fnArgs).slice(0, 200)})`);

    try {
      const result = await toolExecutor(fnName, fnArgs);
      console.log(`[voice-ai] Tool result: ${JSON.stringify(result).slice(0, 200)}`);

      if (fnName === 'display_on_screen') {
        panelSwitch = fnArgs.panel;
      } else if (fnName === 'generate_chart') {
        panelSwitch = 'charts';
      } else if (fnName === 'analyze_text') {
        panelSwitch = 'analysis';
      }

      toolResults.push({ tool: fnName, args: fnArgs, result });
    } catch (err) {
      console.error(`[voice-ai] Tool error: ${fnName}: ${err.message}`);
      toolResults.push({ tool: fnName, args: fnArgs, error: err.message });
    }
  }

  // Step 3: Generate spoken response
  // For generate_chart, bypass LLM — use the summary directly to avoid hallucinated numbers
  const chartResult = toolResults.find(tr => tr.tool === 'generate_chart' && !tr.error);
  if (chartResult && chartResult.result?.summary) {
    const spokenText = `Displaying ${chartResult.result.summary}`;
    console.log(`[voice-ai] [chart-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // For analyze_text, bypass LLM — use structured result summary to avoid hallucination
  const analysisResult = toolResults.find(tr => tr.tool === 'analyze_text' && !tr.error);
  if (analysisResult && analysisResult.result) {
    const r = analysisResult.result;
    let spokenText = 'Analysis complete.';
    if (r.sentiment && r.sentiment.overall) {
      spokenText += ' Sentiment is ' + r.sentiment.overall;
      if (r.sentiment.confidence) {
        spokenText += ' with ' + Math.round(r.sentiment.confidence * 100) + ' percent confidence';
      }
      spokenText += '.';
    }
    if (r.topics && r.topics.length) {
      spokenText += ' Found ' + r.topics.length + ' topic' + (r.topics.length === 1 ? '' : 's') + '.';
    }
    if (r.actionItems && r.actionItems.length) {
      spokenText += ' ' + r.actionItems.length + ' action item' + (r.actionItems.length === 1 ? '' : 's') + ' identified.';
    }
    console.log('[voice-ai] [analysis-shortcut] Spoken: "' + spokenText + '"');
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // For all other tools, ask qwen2.5-7b to generate the response
  let responsePrompt = enrichedText;
  if (toolResults.length > 0) {
    const toolContext = toolResults.map(tr => {
      if (tr.error) {
        return `[${tr.tool}] Error: ${tr.error}`;
      }
      const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
      return `[${tr.tool}] Result:\n${resultStr.slice(0, 5000)}`;
    }).join('\n\n');

    responsePrompt = `User request: ${userText}\n\nTool results:\n${toolContext}\n\nRespond to the user based on the tool results above. Be concise — this will be spoken aloud. Do not add action tags, sound effects, or markdown.`;
  }

  session.messages.push({ role: 'user', content: responsePrompt });

  // Trim history
  if (session.messages.length > MAX_HISTORY) {
    session.messages = session.messages.slice(-MAX_HISTORY);
  }

  const systemPrompt = getSystemPrompt();
  console.log(`[voice-ai] [nemotron] Generating response for: "${userText}"`);

  const responseText = await callResponseModel(session.messages, systemPrompt);
  console.log(`[voice-ai] [nemotron] Response: "${responseText.slice(0, 200)}", tools: [${toolsUsed.join(', ')}]`);

  session.messages.push({ role: 'assistant', content: responseText });

  return { text: responseText, toolsUsed, panelSwitch };
}

/**
 * Check if voice assistant is available (Ollama reachable with required models).
 */
let _ollamaAvailable = false;
let _checkPromise = checkOllama(); // start immediately on import

export function isVoiceAvailable() {
  return _ollamaAvailable;
}

/**
 * Async version — awaits the Ollama check before returning.
 * Use this in handlers that need an accurate answer on cold start.
 */
export async function ensureVoiceChecked() {
  await _checkPromise;
  return _ollamaAvailable;
}

async function checkOllama() {
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/tags`);
    if (res.ok) {
      const data = await res.json();
      const models = (data.models || []).map(m => m.name);
      const hasVoice = models.some(m => m === VOICE_MODEL || m.startsWith(VOICE_MODEL));
      const hasAction = models.some(m => m === ACTION_MODEL || m.startsWith(ACTION_MODEL));
      _ollamaAvailable = hasVoice && hasAction;
      if (_ollamaAvailable) {
        console.log(`[voice-ai] Ollama available — voice: ${VOICE_MODEL}, action: ${ACTION_MODEL}`);
      } else {
        const missing = [];
        if (!hasVoice) missing.push(VOICE_MODEL);
        if (!hasAction) missing.push(ACTION_MODEL);
        console.warn(`[voice-ai] Ollama online but missing models: ${missing.join(', ')}. Available: ${models.join(', ')}`);
      }
    }
  } catch {
    console.warn('[voice-ai] Ollama not reachable');
    _ollamaAvailable = false;
  }
}

// Re-check Ollama availability every 30 seconds
setInterval(() => checkOllama(), 30000);

// Keep models warm in VRAM — send keep_alive every 10 minutes
async function keepModelsWarm() {
  try {
    await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: VOICE_MODEL, keep_alive: '30m', prompt: '' }),
    });
    await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ACTION_MODEL, keep_alive: '30m', prompt: '' }),
    });
  } catch {}
}
keepModelsWarm();
setInterval(keepModelsWarm, 10 * 60 * 1000);

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
