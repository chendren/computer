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
const SESSION_TTL = 4 * 60 * 60 * 1000; // 4 hours — full shift

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
          stardate: { type: 'string', description: 'Stardate if specified by user (e.g. "2387.2")' },
          category: { type: 'string', enum: ['personal', 'mission', 'technical', 'observation'], description: 'Log category (default: personal)' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_time',
      description: 'Get the current time, date, and stardate. Use when user asks "what time is it", "current time", "what day", "what is the date", "current stardate".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_alert',
      description: 'Set ship alert status. Use when user says "red alert", "yellow alert", "blue alert", "alert status", "condition red", "stand down", "cancel alert", "all clear", or "normal operations".',
      parameters: {
        type: 'object',
        properties: {
          level: { type: 'string', enum: ['red', 'yellow', 'blue', 'normal'], description: 'Alert level' },
          reason: { type: 'string', description: 'Reason for alert (optional)' },
        },
        required: ['level'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compare_data',
      description: 'Compare two pieces of text using AI analysis. Use when user says "compare", "difference between", "how do X and Y differ", "contrast". Provide textA and textB, or just a description and the system will use the last two items.',
      parameters: {
        type: 'object',
        properties: {
          textA: { type: 'string', description: 'First text to compare' },
          textB: { type: 'string', description: 'Second text to compare' },
          nameA: { type: 'string', description: 'Label for first text' },
          nameB: { type: 'string', description: 'Label for second text' },
        },
        required: ['textA', 'textB'],
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
      description: "Search through the Captain's Log entries.",
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
  {
    type: 'function',
    function: {
      name: 'create_reminder',
      description: 'Set a reminder or alarm. Use when user says "remind me", "set a reminder", "alert me in", "timer for", "notify me at", "schedule".',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'What to remind about' },
          delay_minutes: { type: 'number', description: 'Minutes from now (e.g. 30 for "in 30 minutes")' },
          time: { type: 'string', description: 'Specific time like "14:00" or "2pm" (alternative to delay_minutes)' },
        },
        required: ['message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_email',
      description: 'Check recent emails, read inbox. Use when user says "check my email", "any new email", "check mail", "read my email", "what emails do I have".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'summarize_inbox',
      description: 'Get an AI summary of the email inbox. Use when user says "summarize my inbox", "email summary", "inbox summary", "what\'s in my email".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_followups',
      description: 'Check for email follow-ups needed. Use when user says "any follow-ups", "follow up", "emails I need to reply to", "what needs a response".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_email',
      description: 'Search for and read a specific email. Use when user says "read the email from", "find email about", "email from [person]".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (sender name, subject keywords)' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_email',
      description: 'Send or draft an email. Use when user says "send an email to", "email [person]", "write an email", "draft an email", "compose email".',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Recipient email address or name' },
          subject: { type: 'string', description: 'Email subject' },
          body: { type: 'string', description: 'Email body text' },
        },
        required: ['to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reply_email',
      description: 'Reply to a recent email. Use when user says "reply to", "respond to the email from", "write back to".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Sender name or subject to find the email to reply to' },
          body: { type: 'string', description: 'Reply text' },
        },
        required: ['query'],
      },
    },
  },
];

// In-memory reminders (broadcast when due)
const _reminders = [];

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify(body),
  });
  clearTimeout(timeout);

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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  const res = await fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
    body: JSON.stringify(body),
  });
  clearTimeout(timeout);

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
 * 3. Llama 4 Scout generates a conversational response from the results
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
    'eth', 'gold', 'silver', 'platinum', 'oil', 'nasdaq', 'dow', 's&p', 'crypto',
    'search for', 'look up', 'find out', 'information about', 'tell me about',
    'what is', 'who is', 'where is', 'when did', 'how many', 'population'];
  const lowerText = userText.toLowerCase();
  const needsSearch = searchKeywords.some(kw => lowerText.includes(kw));

  let enrichedText = userText;
  let directAnswer = null; // If set, skip Scout LLM and use this directly
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

  // xLAM safety net: email tool routing — if user mentions email/inbox/mail keywords, force the right email tool
  const emailKeywords = ['email', 'inbox', 'mail', 'gmail', 'follow-up', 'followup', 'unread'];
  const wantsEmail = emailKeywords.some(kw => lowerText.includes(kw));
  const allEmailTools = ['check_email', 'summarize_inbox', 'check_followups', 'read_email', 'send_email', 'reply_email'];
  const hasEmailCall = actionToolCalls.some(tc => allEmailTools.includes(tc.name));
  if (wantsEmail && !hasEmailCall) {
    let emailTool = 'check_email';
    let emailArgs = {};
    if (lowerText.includes('send') || lowerText.includes('compose') || lowerText.includes('draft') || lowerText.includes('write an email') || lowerText.includes('write email')) {
      emailTool = 'send_email';
      emailArgs = { to: '', subject: '', body: '' };
    } else if (lowerText.includes('reply') || lowerText.includes('respond') || lowerText.includes('write back')) {
      emailTool = 'reply_email';
      emailArgs = { query: userText, body: '' };
    } else if (lowerText.includes('summar')) {
      emailTool = 'summarize_inbox';
    } else if (lowerText.includes('follow')) {
      emailTool = 'check_followups';
    } else if (lowerText.includes('priorit')) {
      emailTool = 'summarize_inbox';
    } else if (lowerText.includes('read the') || lowerText.includes('read email from') || lowerText.includes('find email')) {
      emailTool = 'read_email';
      emailArgs = { query: userText };
    }
    console.log(`[voice-ai] [xLAM] Forcing ${emailTool} — user request contains email keyword`);
    actionToolCalls = [{ name: emailTool, arguments: emailArgs }];
  }

  // xLAM safety net: if it didn't route to generate_chart but user clearly wants visualization, force it
  // (skip if email tools already selected — "show me my email" is not a chart request)
  const hasChartCall = actionToolCalls.some(tc => tc.name === 'generate_chart');
  if (!hasChartCall && wantsViz && !wantsEmail) {
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
      } else if (fnName === 'compare_data') {
        panelSwitch = 'compare';
      } else if (fnName === 'browse_url') {
        panelSwitch = 'browser';
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

  // For get_time, bypass LLM — instant response
  const timeResult = toolResults.find(tr => tr.tool === 'get_time' && !tr.error);
  if (timeResult && timeResult.result) {
    const t = timeResult.result;
    const spokenText = `The time is ${t.time}. ${t.date}. Stardate ${t.stardate}.`;
    console.log(`[voice-ai] [time-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // For set_alert, bypass LLM — direct acknowledgment
  const alertResult = toolResults.find(tr => tr.tool === 'set_alert' && !tr.error);
  if (alertResult && alertResult.result) {
    const a = alertResult.result;
    const levelName = a.level === 'normal' ? 'Alert status: normal operations resumed.' : `${a.level} alert activated.`;
    const spokenText = levelName + (a.reason ? ' ' + a.reason + '.' : '');
    console.log(`[voice-ai] [alert-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // For compare_data, bypass LLM — use the structured verdict
  const compareResult = toolResults.find(tr => tr.tool === 'compare_data' && !tr.error);
  if (compareResult && compareResult.result) {
    const c = compareResult.result;
    let spokenText = 'Comparison complete.';
    if (c.verdict) spokenText += ' ' + c.verdict;
    if (c.similarityScore != null) spokenText += ' Similarity score: ' + Math.round(c.similarityScore * 100) + ' percent.';
    console.log(`[voice-ai] [compare-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // For create_reminder, bypass LLM — direct confirmation
  const reminderResult = toolResults.find(tr => tr.tool === 'create_reminder' && !tr.error);
  if (reminderResult && reminderResult.result) {
    const r = reminderResult.result;
    const spokenText = `Reminder set: ${r.message}. I will alert you in ${r.fireIn}.`;
    console.log(`[voice-ai] [reminder-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // For browse_url, bypass LLM — direct confirmation
  const browseResult = toolResults.find(tr => tr.tool === 'browse_url' && !tr.error);
  if (browseResult && browseResult.result) {
    const spokenText = `Navigating to ${browseResult.result.url}. On screen now.`;
    console.log(`[voice-ai] [browse-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // For check_email, bypass LLM — speak inbox overview with smart filtering
  const emailResult = toolResults.find(tr => tr.tool === 'check_email' && !tr.error);
  if (emailResult && emailResult.result) {
    const r = emailResult.result;
    const msgs = r.messages || [];
    let spokenText;
    if (msgs.length === 0) {
      spokenText = 'Your inbox is empty. No new messages.';
    } else {
      const unread = msgs.filter(m => m.unread).length;
      // Filter out promos for the spoken report
      const important = msgs.filter(m => {
        const labels = (m.labels || []).join(' ');
        return !labels.includes('CATEGORY_PROMOTIONS') && !labels.includes('CATEGORY_SOCIAL');
      });
      const promoCount = msgs.length - important.length;
      if (unread === 0) {
        spokenText = `You have ${msgs.length} messages, all read.`;
      } else {
        spokenText = `You have ${unread} unread message${unread > 1 ? 's' : ''}.`;
      }
      if (promoCount > 0) {
        spokenText += ` ${promoCount} are promotional.`;
      }
      // Report important messages
      const toReport = important.filter(m => m.unread).slice(0, 3);
      if (toReport.length === 0 && important.length > 0) {
        const top = important.slice(0, 2);
        for (const m of top) {
          const from = (m.from || '').split('<')[0].trim() || 'unknown';
          spokenText += ` ${from}: ${m.subject || 'no subject'}.`;
        }
      } else {
        for (const m of toReport) {
          const from = (m.from || '').split('<')[0].trim() || 'unknown';
          spokenText += ` ${from}: ${m.subject || 'no subject'}.`;
        }
      }
    }
    panelSwitch = 'channels';
    console.log(`[voice-ai] [email-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // For summarize_inbox, bypass LLM — speak the AI analysis
  const summaryResult = toolResults.find(tr => tr.tool === 'summarize_inbox' && !tr.error);
  if (summaryResult && summaryResult.result) {
    const r = summaryResult.result;
    let spokenText = r.summary || 'Unable to generate inbox summary.';
    if (r.urgentItems && r.urgentItems.length > 0) {
      spokenText += ` Attention: ${r.urgentItems.length} urgent item${r.urgentItems.length > 1 ? 's' : ''}.`;
      for (const u of r.urgentItems.slice(0, 2)) {
        spokenText += ` ${u.from || 'Unknown'}: ${u.reason || u.subject || ''}.`;
      }
    }
    if (r.needsReply && r.needsReply.length > 0) {
      spokenText += ` ${r.needsReply.length} message${r.needsReply.length > 1 ? 's need' : ' needs'} a reply.`;
    }
    panelSwitch = 'channels';
    console.log(`[voice-ai] [summary-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // For check_followups, bypass LLM — speak actionable follow-ups
  const followupResult = toolResults.find(tr => tr.tool === 'check_followups' && !tr.error);
  if (followupResult && followupResult.result) {
    const items = followupResult.result.followups || [];
    let spokenText;
    if (items.length === 0) {
      spokenText = 'No follow-ups needed. Your inbox is clear.';
    } else {
      const high = items.filter(f => f.urgency === 'high');
      if (high.length > 0) {
        spokenText = `${high.length} high priority follow-up${high.length > 1 ? 's' : ''}.`;
        for (const f of high.slice(0, 2)) {
          const from = (f.from || '').split('<')[0].trim() || 'someone';
          spokenText += ` ${from}: ${f.reason || f.subject || ''}.`;
        }
        const rest = items.length - high.length;
        if (rest > 0) spokenText += ` Plus ${rest} lower priority item${rest > 1 ? 's' : ''}.`;
      } else {
        spokenText = `${items.length} follow-up item${items.length > 1 ? 's' : ''}, none urgent.`;
        for (const f of items.slice(0, 2)) {
          const from = (f.from || '').split('<')[0].trim() || 'someone';
          spokenText += ` ${from}: ${f.reason || f.subject || ''}.`;
        }
      }
    }
    panelSwitch = 'channels';
    console.log(`[voice-ai] [followup-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // For read_email, bypass LLM — speak email content with smart truncation
  const readResult = toolResults.find(tr => tr.tool === 'read_email' && !tr.error);
  if (readResult && readResult.result) {
    const r = readResult.result;
    let spokenText;
    if (r.body) {
      const from = (r.from || '').split('<')[0].trim() || 'unknown';
      // Clean up body for TTS — strip HTML artifacts, excessive whitespace
      let body = (r.body || '');
      body = body.split('\n').join(' ').split('  ').join(' ').trim();
      // Cap at reasonable TTS length
      if (body.length > 500) body = body.slice(0, 500) + '... message truncated.';
      spokenText = `From ${from}. Subject: ${r.subject || 'none'}. ${body}`;
    } else if (r.messages && r.messages.length > 0) {
      const msg = r.messages[0];
      const from = (msg.from || '').split('<')[0].trim() || 'unknown';
      spokenText = `From ${from}. Subject: ${msg.subject || 'none'}. ${msg.snippet || ''}`;
    } else {
      spokenText = 'No matching email found for that search.';
    }
    panelSwitch = 'channels';
    console.log(`[voice-ai] [read-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // For send_email, bypass LLM — confirm the send or navigate to compose
  const sendResult = toolResults.find(tr => tr.tool === 'send_email' && !tr.error);
  if (sendResult && sendResult.result) {
    const r = sendResult.result;
    let spokenText;
    if (r.sent) {
      spokenText = `Email sent to ${r.to}. Subject: ${r.subject || 'none'}.`;
    } else if (r.drafted) {
      spokenText = `I have opened the compose screen with your draft to ${r.to}. Review and send when ready.`;
    } else {
      spokenText = 'Opening email compose. Tell me who to send to, the subject, and what to say.';
    }
    panelSwitch = 'channels';
    console.log(`[voice-ai] [send-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // For reply_email, bypass LLM — confirm the reply
  const replyResult = toolResults.find(tr => tr.tool === 'reply_email' && !tr.error);
  if (replyResult && replyResult.result) {
    const r = replyResult.result;
    let spokenText;
    if (r.sent) {
      const to = (r.to || '').split('<')[0].trim() || 'them';
      spokenText = `Reply sent to ${to}.`;
    } else if (r.found) {
      const from = (r.from || '').split('<')[0].trim() || 'them';
      spokenText = `Found the email from ${from}. Opening thread so you can compose your reply.`;
    } else {
      spokenText = 'Could not find a matching email to reply to.';
    }
    panelSwitch = 'channels';
    console.log(`[voice-ai] [reply-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // For all other tools, ask Scout to generate the response
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
  console.log(`[voice-ai] [scout] Generating response for: "${userText}"`);

  const responseText = await callResponseModel(session.messages, systemPrompt);
  console.log(`[voice-ai] [scout] Response: "${responseText.slice(0, 200)}", tools: [${toolsUsed.join(', ')}]`);

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
