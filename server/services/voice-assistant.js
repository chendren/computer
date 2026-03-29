/**
 * Voice Assistant Service — Single-Model Architecture
 *
 * Uses one local Ollama model (llama3.1:8b) for both tool routing and response generation:
 *
 * 1. Tool routing: llama3.1 supports OpenAI-compatible tool_calls natively via
 *    Ollama's /v1/chat/completions endpoint. Given the user's command, it outputs
 *    tool calls in standard OpenAI tool_calls format.
 *
 * 2. Response generation: After tools execute, the same model synthesizes the results
 *    into a spoken response that sounds natural when read aloud by the TTS system.
 *
 * Processing pipeline per voice command:
 *   1. Auto-search: if the query needs current data (prices, weather, news),
 *      proactively fetch web results and inject them into the prompt as facts.
 *   2. Tool routing: ask llama3.1 which tools to call for this command.
 *   3. Safety nets: correct tool selection for known failure modes
 *      (email keywords, visualization keywords).
 *   4. Tool execution: run each selected tool via the tool executor (internal APIs).
 *   5. Shortcut responses: for predictable tool results (time, alerts, charts, email),
 *      bypass the response model and construct the spoken response directly.
 *   6. Response generation: for everything else, ask the model to generate a natural
 *      response from the tool results, staying under ~200 chars for TTS.
 */

const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://localhost:11434';
const VOICE_MODEL = process.env.VOICE_MODEL || 'llama3.1:8b';
const ACTION_MODEL = process.env.ACTION_MODEL || 'llama3.1:8b';

// Per-session conversation history
const sessions = new Map();
const MAX_HISTORY = 20;
const SESSION_TTL = 4 * 60 * 60 * 1000; // 4 hours — full shift

export function getSystemPrompt() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const isoDate = now.toISOString().split('T')[0];

  // Inject the current date/time so Scout can resolve relative time phrases
  // ("last week", "past 3 days") into exact date ranges for web searches and charts.
  // This is baked into every request so the model always has an accurate "now".
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
export const TOOLS = [
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
      description: 'Set a reminder or alarm. Use when user says "remind me", "set a reminder", "alert me in", "notify me at".',
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
  // ── New Tools ─────────────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'system_info',
      description: 'Get system information: memory, CPU, disk space, uptime. Use when user says "system info", "how much memory", "disk space", "CPU", "system resources", "how much RAM", "system status".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clipboard_read',
      description: 'Read the current clipboard contents. Use when user says "read clipboard", "what\'s on my clipboard", "clipboard contents", "what did I copy".',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clipboard_write',
      description: 'Copy text to the clipboard. Use when user says "copy to clipboard", "copy that", "put on clipboard", "save to clipboard".',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to copy to clipboard' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_timer',
      description: 'Start a countdown timer that announces when done. Use when user says "start a timer", "timer for", "set a timer", "countdown", "time me for". Different from reminders — timers count down and announce completion audibly.',
      parameters: {
        type: 'object',
        properties: {
          duration_seconds: { type: 'number', description: 'Duration in seconds (e.g. 300 for 5 minutes, 60 for 1 minute)' },
          label: { type: 'string', description: 'Optional label (e.g. "tea", "break")' },
        },
        required: ['duration_seconds'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather and forecast. Use when user says "weather", "temperature", "forecast", "is it going to rain", "how hot", "how cold", "weather in [city]".',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name (optional, defaults to current location via IP)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'calculate',
      description: 'Calculate math expressions or convert currency. Use when user says "calculate", "what is X plus Y", "X percent of Y", "convert X to Y", "how much is", "square root", or any arithmetic.',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression or conversion (e.g. "15% of 4500", "500 EUR to USD", "sqrt(144)")' },
        },
        required: ['expression'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'take_screenshot',
      description: 'Take a screenshot and describe what is on screen. Use when user says "screenshot", "what\'s on my screen", "capture screen", "what am I looking at", "describe my screen".',
      parameters: {
        type: 'object',
        properties: {
          describe: { type: 'boolean', description: 'Whether to analyze with vision AI (default true)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'translate_text',
      description: 'Translate text between languages. Use when user says "translate", "how do you say", "in Japanese", "in French", "in Spanish", "in German", or any translation request.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to translate' },
          target_language: { type: 'string', description: 'Target language (e.g. "Japanese", "French")' },
        },
        required: ['text', 'target_language'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'manage_schedule',
      description: 'List, create, or remove scheduled cron jobs. Use when user says "scheduled jobs", "list schedules", "run every", "recurring task", "cron", "stop the schedule", "scheduled tasks".',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'add', 'remove', 'toggle'], description: 'Action to perform' },
          name: { type: 'string', description: 'Job name (for add)' },
          schedule: { type: 'string', description: 'Cron expression like "*/5 * * * *" (for add)' },
          command: { type: 'string', description: 'Tool command to run (for add)' },
          job_id: { type: 'string', description: 'Job ID (for remove/toggle)' },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_calendar',
      description: 'Check calendar events. Use when user says "calendar", "what\'s on my schedule", "meetings today", "any appointments", "am I free at", "what\'s next on my calendar".',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date to check (e.g. "today", "tomorrow", "2026-03-28")' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_event',
      description: 'Create a calendar event. Use when user says "schedule a meeting", "add to calendar", "book a", "create an event", "put on my calendar".',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Event title' },
          start_time: { type: 'string', description: 'Start time (e.g. "2pm", "14:00")' },
          duration_minutes: { type: 'number', description: 'Duration in minutes (default 60)' },
          description: { type: 'string', description: 'Event description (optional)' },
        },
        required: ['summary', 'start_time'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_document',
      description: 'Analyze a document or file. Use when user says "analyze this document", "summarize this file", "what does this document say", "review this report", "analyze the uploaded file", "analyze the document", "read this file".',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path to analyze (optional — uses last uploaded file if not specified)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generate_report',
      description: 'Generate a daily activity report summarizing all voice commands, analyses, logs, and system activity. Use when user says "generate a report", "daily report", "activity report", "export report", "briefing report".',
      parameters: {
        type: 'object',
        properties: {
          timeframe: { type: 'string', description: 'Time range: "today", "yesterday", "this week" (default: today)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_news',
      description: 'Get latest news headlines. Use when user says "news", "headlines", "what\'s happening", "latest news", "tech news", "world news", "breaking news".',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'News topic or category (optional — e.g. "technology", "business", "sports")' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'define_word',
      description: 'Define a word or explain a term. Use when user says "define", "what does X mean", "definition of", "what is the meaning of", "explain the word".',
      parameters: {
        type: 'object',
        properties: {
          word: { type: 'string', description: 'The word or term to define' },
        },
        required: ['word'],
      },
    },
  },
];

// In-memory reminders (broadcast when due)
const _reminders = [];

const MAX_TOOL_LOOPS = 10;

/**
 * Split a chained voice command into individual sub-commands.
 * Splits on explicit chain delimiters like "then", "and then", "after that", etc.
 * Does NOT split on bare "and" — that's too ambiguous ("gold and silver" is one query).
 */
function splitChainedCommands(text) {
  const delimiters = [', and then ', '. and then ', ' and then ', ', then ', '. then ', ' then ', ', after that ', ' after that ', ', followed by ', ' followed by ', ', and also ', ' and also '];
  let parts = [text];
  for (const delim of delimiters) {
    const newParts = [];
    for (const part of parts) {
      const lower = part.toLowerCase();
      const idx = lower.indexOf(delim);
      if (idx !== -1) {
        newParts.push(part.slice(0, idx).trim());
        newParts.push(part.slice(idx + delim.length).trim());
      } else {
        newParts.push(part);
      }
    }
    parts = newParts;
  }
  return parts.filter(p => p.length > 0);
}

// Chain words to detect multi-step voice commands
const CHAIN_WORDS = [' then ', ' and then ', ' after that ', ' followed by ', ' and also '];


/**
 * Call action model (llama3.1) for tool selection.
 * Uses standard OpenAI tool_calls format — finish_reason: "tool_calls"
 * with message.tool_calls array of {id, function: {name, arguments}}.
 */
async function callActionModel(userText, recentHistory = []) {
  const body = {
    model: ACTION_MODEL,
    messages: [
      { role: 'system', content: getActionSystemPrompt() },
      ...recentHistory.slice(-4),
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
    throw new Error(`Action model API error ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];

  // Format 1: Standard OpenAI tool_calls array (preferred, most common)
  if (choice?.message?.tool_calls?.length > 0) {
    return choice.message.tool_calls.map(tc => ({
      name: tc.function?.name,
      arguments: tc.function?.arguments,
    }));
  }

  // Format 2: some models serialize tool calls as JSON in the content field
  // instead of the tool_calls array — this is a model quirk, not an API bug.
  // Examples seen in the wild:
  //   [{"name": "search_knowledge", "parameters": {"query": "..."}}]
  //   {"tool_calls": [{"name": "get_time", "arguments": {}}]}
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
  return (data.choices?.[0]?.message?.content || '').trim();
}

/**
 * Process a voice command using single-model architecture.
 *
 * 1. Action model determines which tools to call (tool routing)
 * 2. Tools are executed server-side
 * 3. Response model generates a conversational response from the results
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

  // Resolve pronouns using recent conversation context.
  // When the user says "chart that" or "search for it", inject the subject from the
  // last exchange so keyword detection and the LLM both know what "that" refers to.
  let resolvedText = userText;
  const pronouns = ['that', 'it', 'those', 'them', 'this', 'the same'];
  const hasPronouns = pronouns.some(p => userText.toLowerCase().includes(p));
  if (hasPronouns && session.messages.length >= 2) {
    const lastExchange = session.messages.slice(-2);
    const lastUserMsg = lastExchange.find(m => m.role === 'user');
    const lastAssistantMsg = lastExchange.find(m => m.role === 'assistant');
    if (lastUserMsg) {
      resolvedText = userText + ' (context: user previously asked "' + lastUserMsg.content.slice(0, 200) + '"';
      if (lastAssistantMsg) {
        resolvedText += ' and the computer replied "' + lastAssistantMsg.content.slice(0, 200) + '"';
      }
      resolvedText += ')';
      console.log(`[voice-ai] Pronoun resolved: "${resolvedText.slice(0, 150)}..."`);
    }
  }

  // Chain detection: detect multi-step commands ("search for X, then chart it")
  // Split into sub-commands and route each through the action model independently.
  // Uses original userText (not resolvedText which has appended context annotations).
  const lowerUserText = userText.toLowerCase();
  const hasChain = CHAIN_WORDS.some(w => lowerUserText.includes(w));
  let chainedSubCommands = null;
  if (hasChain) {
    const subCommands = splitChainedCommands(userText);
    if (subCommands.length > 1) {
      chainedSubCommands = subCommands;
      console.log('[voice-ai] Chain detected: ' + subCommands.length + ' sub-commands: ' + subCommands.join(' | '));
    }
  }

  // Auto-search: detect queries that need current data not in the model's training.
  // If these keywords appear, proactively fetch web results and inject the facts
  // into the prompt BEFORE calling the action model. This way the model has real data to
  // work with, rather than relying on possibly-stale parametric knowledge.
  // The alternative (letting the action model call web_search_and_read) is slower because
  // it requires an extra round-trip first.
  const searchKeywords = ['price', 'cost', 'worth', 'stock', 'quote', 'weather', 'forecast',
    'temperature', 'score', 'result', 'news', 'latest', 'current', 'today', 'right now',
    'how much is', 'spot price', 'market', 'exchange rate', 'rate of', 'bitcoin', 'btc',
    'eth', 'gold', 'silver', 'platinum', 'oil', 'nasdaq', 'dow', 's&p', 'crypto',
    'search for', 'look up', 'find out', 'information about', 'tell me about',
    'what is', 'who is', 'where is', 'when did', 'how many', 'population'];
  const lowerText = resolvedText.toLowerCase();
  const needsSearch = searchKeywords.some(kw => lowerText.includes(kw));

  let enrichedText = resolvedText;
  let directAnswer = null; // If set, skip Scout LLM and use this directly
  if (needsSearch) {
    console.log(`[voice-ai] Auto-search triggered for: "${userText}"`);
    try {
      const searchResult = await toolExecutor('web_search_and_read', { query: userText, num_results: 3 });

      // Fast path: check for structured price data from the Swissquote live feed.
      // The _webSearchAndRead executor adds a specially formatted line like:
      //   "Live gold spot price: $2400.50 USD per troy ounce"
      // We parse this deterministically — no LLM involved — so the price is always accurate.
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

  // If we have a direct answer from structured data (e.g. Swissquote price), skip LLM entirely.
  // Exception: if the user wants a visualization, let the full pipeline run so the action model
  // can call generate_chart ("show me gold prices as a chart" shouldn't just speak the price).
  const vizKeywords = ['chart', 'graph', 'plot', 'table', 'visualiz', 'trend', 'show me', 'show the', 'show data', 'display data', 'compare data', 'comparison', 'versus', ' vs '];
  const wantsViz = vizKeywords.some(kw => lowerText.includes(kw));
  if (directAnswer && !wantsViz) {
    console.log(`[voice-ai] Using direct answer (bypassing LLM): "${directAnswer}"`);
    session.messages.push({ role: 'user', content: userText });
    session.messages.push({ role: 'assistant', content: directAnswer });
    if (session.messages.length > MAX_HISTORY) session.messages = session.messages.slice(-MAX_HISTORY);
    return { text: directAnswer, toolsUsed, panelSwitch };
  }

  // Step 1: Ask action model what tools to call (tool routing)
  let actionToolCalls = [];

  if (chainedSubCommands) {
    // Multi-step chain: route each sub-command through the action model independently
    console.log(`[voice-ai] [action] Chain routing ${chainedSubCommands.length} sub-commands`);
    for (const sub of chainedSubCommands) {
      try {
        const subCalls = await callActionModel(sub, session.messages.slice(-4));
        console.log(`[voice-ai] [action] Sub-command "${sub}" -> ${subCalls.length} tool(s): ${subCalls.map(t => t.name).join(', ') || 'none'}`);
        actionToolCalls.push(...subCalls);
      } catch (err) {
        console.warn(`[voice-ai] [action] Sub-command "${sub}" routing failed: ${err.message}`);
      }
    }
    console.log(`[voice-ai] [action] Chain total: ${actionToolCalls.length} tool(s): ${actionToolCalls.map(t => t.name).join(', ')}`);
  } else {
    // Single command: normal routing
    console.log(`[voice-ai] [action] Routing: "${resolvedText}"`);
    try {
      actionToolCalls = await callActionModel(resolvedText, session.messages.slice(-4));
      console.log(`[voice-ai] [action] Selected ${actionToolCalls.length} tool(s): ${actionToolCalls.map(t => t.name).join(', ') || 'none'}`);
    } catch (err) {
      console.warn(`[voice-ai] [action] Routing failed, falling back to no tools: ${err.message}`);
    }
  }

  // Safety net #1: email tool routing.
  // The action model sometimes fails to select the correct email tool or selects none at all.
  // If the user's request contains email-related keywords but the model didn't pick
  // an email tool, we override and force the appropriate one based on intent signals.
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
    console.log(`[voice-ai] [action] Forcing ${emailTool} — user request contains email keyword`);
    actionToolCalls = [{ name: emailTool, arguments: emailArgs }];
  }

  // Safety net #2: chart routing.
  // The action model misses visualization requests fairly often. If the user's request contains
  // chart/graph/plot/table keywords but the model didn't select generate_chart, inject it.
  // Skip this if email tools are already selected (e.g. "show me my inbox" is not a chart).
  const hasChartCall = actionToolCalls.some(tc => tc.name === 'generate_chart');
  if (!hasChartCall && wantsViz && !wantsEmail) {
    console.log(`[voice-ai] [action] Forcing generate_chart — user request contains visualization keyword`);
    actionToolCalls.push({ name: 'generate_chart', arguments: { query: resolvedText } });
  }

  // Safety net #3: weather routing.
  const weatherKw = ['weather', 'temperature', 'forecast', 'is it going to rain', 'how hot', 'how cold'];
  if (weatherKw.some(kw => lowerText.includes(kw)) && !actionToolCalls.some(tc => tc.name === 'get_weather')) {
    console.log(`[voice-ai] [action] Forcing get_weather — user request contains weather keyword`);
    actionToolCalls.push({ name: 'get_weather', arguments: {} });
  }

  // Safety net #4: timer routing.
  const timerKw = ['start a timer', 'timer for', 'set a timer', 'countdown', 'time me for'];
  if (timerKw.some(kw => lowerText.includes(kw)) && !actionToolCalls.some(tc => tc.name === 'start_timer')) {
    console.log(`[voice-ai] [action] Forcing start_timer — user request contains timer keyword`);
    actionToolCalls.push({ name: 'start_timer', arguments: { duration_seconds: 60 } });
  }

  // Safety net #5: system info routing.
  const sysKeywords = ['system info', 'system resources', 'system status', 'how much memory', 'how much ram', 'disk space', 'cpu usage'];
  const wantsSys = sysKeywords.some(kw => lowerText.includes(kw));
  if (wantsSys && !actionToolCalls.some(tc => tc.name === 'system_info')) {
    console.log(`[voice-ai] [action] Forcing system_info — user request contains system keyword`);
    actionToolCalls.push({ name: 'system_info', arguments: {} });
  }

  // Safety net #6: calendar routing.
  const calendarKeywords = ['calendar', 'schedule a meeting', 'meetings today', 'appointment', 'what\'s on my schedule', 'am i free'];
  const wantsCalendar = calendarKeywords.some(kw => lowerText.includes(kw));
  const hasCalendarCall = actionToolCalls.some(tc => tc.name === 'check_calendar' || tc.name === 'create_event');
  if (wantsCalendar && !hasCalendarCall && !wantsEmail) {
    const createKw = ['schedule a', 'book a', 'create an event', 'add to calendar', 'put on my calendar'];
    const wantsCreate = createKw.some(kw => lowerText.includes(kw));
    const calTool = wantsCreate ? 'create_event' : 'check_calendar';
    console.log(`[voice-ai] [action] Forcing ${calTool} — user request contains calendar keyword`);
    actionToolCalls.push({ name: calTool, arguments: wantsCreate ? { summary: userText } : {} });
  }

  // Safety net #7: clipboard routing.
  const clipboardKw = ['clipboard', 'what did i copy', 'read clipboard', 'copy to clipboard', 'paste'];
  const wantsClipboard = clipboardKw.some(kw => lowerText.includes(kw));
  if (wantsClipboard && !actionToolCalls.some(tc => tc.name === 'clipboard_read' || tc.name === 'clipboard_write')) {
    const wantsRead = lowerText.includes('read') || lowerText.includes('what') || lowerText.includes('paste');
    const clipTool = wantsRead ? 'clipboard_read' : 'clipboard_write';
    console.log(`[voice-ai] [action] Forcing ${clipTool} — user request contains clipboard keyword`);
    actionToolCalls.push({ name: clipTool, arguments: {} });
  }

  // Safety net #8: translate routing.
  const translateKw = ['translate', 'how do you say', 'in japanese', 'in french', 'in spanish', 'in german', 'in chinese', 'in korean', 'in italian'];
  const wantsTranslate = translateKw.some(kw => lowerText.includes(kw));
  if (wantsTranslate && !actionToolCalls.some(tc => tc.name === 'translate_text')) {
    console.log(`[voice-ai] [action] Forcing translate_text — user request contains translate keyword`);
    actionToolCalls.push({ name: 'translate_text', arguments: { text: userText, target_language: '' } });
  }

  // Safety net #9: screenshot routing.
  const screenshotKw = ['screenshot', 'what\'s on my screen', 'capture screen', 'describe my screen', 'what am i looking at'];
  if (screenshotKw.some(kw => lowerText.includes(kw)) && !actionToolCalls.some(tc => tc.name === 'take_screenshot')) {
    console.log(`[voice-ai] [action] Forcing take_screenshot — user request contains screenshot keyword`);
    actionToolCalls.push({ name: 'take_screenshot', arguments: {} });
  }

  // Safety net #10: calculator routing.
  // Only trigger on math-specific phrases to avoid false positives with "what is" (too broad for general queries).
  const calcKw = ['percent of', 'calculate', 'square root', 'convert'];
  const currencyWords = ['dollars', 'euros', 'pounds', 'yen', 'rupees', 'currency'];
  const wantsCalc = calcKw.some(kw => lowerText.includes(kw)) && (
    !lowerText.includes('convert') || currencyWords.some(cw => lowerText.includes(cw))
  );
  if (wantsCalc && !actionToolCalls.some(tc => tc.name === 'calculate')) {
    console.log(`[voice-ai] [action] Forcing calculate — user request contains calculator keyword`);
    actionToolCalls.push({ name: 'calculate', arguments: { expression: userText } });
  }

  // Safety net #11: schedule management routing.
  const schedKw = ['scheduled jobs', 'list schedules', 'scheduled tasks', 'cron'];
  if (schedKw.some(kw => lowerText.includes(kw)) && !actionToolCalls.some(tc => tc.name === 'manage_schedule')) {
    console.log(`[voice-ai] [action] Forcing manage_schedule — user request contains schedule management keyword`);
    actionToolCalls.push({ name: 'manage_schedule', arguments: { action: 'list' } });
  }

  // Safety net #12: report generation routing.
  const reportKw = ['generate a report', 'daily report', 'activity report', 'export report', 'briefing report'];
  if (reportKw.some(kw => lowerText.includes(kw)) && !actionToolCalls.some(tc => tc.name === 'generate_report')) {
    console.log(`[voice-ai] [action] Forcing generate_report — user request contains report keyword`);
    actionToolCalls.push({ name: 'generate_report', arguments: {} });
  }

  // Safety net #13: news routing.
  const newsKw = ['news', 'headlines', 'what\'s happening', 'breaking news'];
  if (newsKw.some(kw => lowerText.includes(kw)) && !actionToolCalls.some(tc => tc.name === 'get_news')) {
    console.log(`[voice-ai] [action] Forcing get_news — user request contains news keyword`);
    actionToolCalls.push({ name: 'get_news', arguments: {} });
  }

  // Safety net #14: define/dictionary routing.
  const defineKw = ['define ', 'definition of', 'what does', 'meaning of', 'explain the word'];
  if (defineKw.some(kw => lowerText.includes(kw)) && !actionToolCalls.some(tc => tc.name === 'define_word')) {
    console.log(`[voice-ai] [action] Forcing define_word — user request contains define keyword`);
    actionToolCalls.push({ name: 'define_word', arguments: { word: userText } });
  }

  // Step 2: Execute action model-selected tools
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

    // generate_chart: always pass resolved user text as query so pronoun context flows through
    if (fnName === 'generate_chart') {
      fnArgs = { query: resolvedText };
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
      } else if (fnName === 'get_news') {
        panelSwitch = 'search';
      }

      toolResults.push({ tool: fnName, args: fnArgs, result });
    } catch (err) {
      console.error(`[voice-ai] Tool error: ${fnName}: ${err.message}`);
      toolResults.push({ tool: fnName, args: fnArgs, error: err.message });
    }
  }

  // Step 3: Generate the spoken response.
  //
  // For many tools, we bypass Scout entirely and construct the response directly.
  // This is intentional: Scout sometimes fabricates numbers or adds spurious detail
  // when it has real data in front of it. For predictable tools (time, alerts, charts,
  // email) we know exactly what the response should say, so we build it ourselves.
  //
  // For everything else (knowledge search, web search, complex queries), we pass
  // the tool results to Scout and let it generate a natural conversational response.

  // generate_chart: use the summary the chart executor returns — exact, no hallucination risk
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

  // For define_word, bypass LLM — speak the definition directly
  const defineResult = toolResults.find(tr => tr.tool === 'define_word' && !tr.error);
  if (defineResult && defineResult.result?.definition) {
    const spokenText = defineResult.result.definition;
    console.log(`[voice-ai] [define-shortcut] Spoken: "${spokenText}"`);
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

  // system_info shortcut
  const sysResult = toolResults.find(tr => tr.tool === 'system_info' && !tr.error);
  if (sysResult && sysResult.result) {
    const r = sysResult.result;
    const memUsed = r.totalMemoryGB - r.freeMemoryGB;
    let spokenText = `Memory: ${memUsed.toFixed(0)} of ${r.totalMemoryGB.toFixed(0)} GB in use. CPU: ${r.cpuCount} cores, ${r.cpuModel}. Uptime: ${r.uptimeHuman}.`;
    if (r.disk) spokenText += ` Disk: ${r.disk.free} free of ${r.disk.total}.`;
    console.log(`[voice-ai] [system-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // clipboard_read shortcut
  const clipReadResult = toolResults.find(tr => tr.tool === 'clipboard_read' && !tr.error);
  if (clipReadResult && clipReadResult.result) {
    const text = clipReadResult.result.text || '';
    const spokenText = text.length > 0
      ? `Clipboard contains: ${text.slice(0, 100)}${text.length > 100 ? '... ' + text.length + ' characters total.' : ''}`
      : 'Clipboard is empty.';
    console.log(`[voice-ai] [clipboard-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // clipboard_write shortcut
  const clipWriteResult = toolResults.find(tr => tr.tool === 'clipboard_write' && !tr.error);
  if (clipWriteResult && clipWriteResult.result) {
    const spokenText = `Copied to clipboard. ${clipWriteResult.result.length} characters.`;
    console.log(`[voice-ai] [clipboard-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // start_timer shortcut
  const timerResult = toolResults.find(tr => tr.tool === 'start_timer' && !tr.error);
  if (timerResult && timerResult.result) {
    const spokenText = `Timer set for ${timerResult.result.durationHuman}.`;
    console.log(`[voice-ai] [timer-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // get_weather shortcut
  const weatherResult = toolResults.find(tr => tr.tool === 'get_weather' && !tr.error);
  if (weatherResult && weatherResult.result?.current) {
    const r = weatherResult.result;
    const c = r.current;
    let spokenText = `Currently ${Math.round(c.temperature)} degrees and ${c.description} in ${r.location}.`;
    if (r.forecast?.length > 0) {
      const today = r.forecast[0];
      spokenText += ` High of ${Math.round(today.high)}, low of ${Math.round(today.low)} today.`;
    }
    console.log(`[voice-ai] [weather-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // calculate shortcut
  const calcResult = toolResults.find(tr => tr.tool === 'calculate' && !tr.error);
  if (calcResult && calcResult.result?.formatted) {
    const spokenText = calcResult.result.formatted;
    console.log(`[voice-ai] [calc-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // manage_schedule shortcut
  const schedResult = toolResults.find(tr => tr.tool === 'manage_schedule' && !tr.error);
  if (schedResult && schedResult.result) {
    const r = schedResult.result;
    let spokenText;
    if (r.jobs) {
      if (r.jobs.length === 0) {
        spokenText = 'No scheduled jobs.';
      } else {
        spokenText = `You have ${r.jobs.length} scheduled job${r.jobs.length > 1 ? 's' : ''}. `;
        spokenText += r.jobs.slice(0, 3).map(j => `${j.name} runs ${j.schedule}`).join('. ') + '.';
      }
    } else if (r.created) {
      spokenText = `Scheduled: ${r.created.name}.`;
    } else if (r.removed) {
      spokenText = 'Job removed.';
    } else if (r.toggled) {
      spokenText = `Job ${r.toggled.enabled ? 'enabled' : 'disabled'}.`;
    } else {
      spokenText = 'Schedule updated.';
    }
    console.log(`[voice-ai] [schedule-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch: 'cron' };
  }

  // check_calendar shortcut
  const calResult = toolResults.find(tr => tr.tool === 'check_calendar' && !tr.error);
  if (calResult && calResult.result) {
    const events = calResult.result.events || [];
    let spokenText;
    if (events.length === 0) {
      spokenText = `No events on your calendar${calResult.result.date ? ' for ' + calResult.result.date : ' today'}.`;
    } else {
      spokenText = `You have ${events.length} event${events.length > 1 ? 's' : ''}. `;
      spokenText += events.slice(0, 4).map(e => `${e.summary} at ${e.startTime}`).join('. ') + '.';
    }
    console.log(`[voice-ai] [calendar-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // create_event shortcut
  const eventResult = toolResults.find(tr => tr.tool === 'create_event' && !tr.error);
  if (eventResult && eventResult.result) {
    const r = eventResult.result;
    const spokenText = r.created
      ? `Event created: ${r.summary} at ${r.startTime}.`
      : (r.error || 'Could not create event. Calendar may not be connected.');
    console.log(`[voice-ai] [event-shortcut] Spoken: "${spokenText}"`);
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch };
  }

  // generate_report shortcut
  const reportResult = toolResults.find(tr => tr.tool === 'generate_report' && !tr.error);
  if (reportResult && reportResult.result?.summary) {
    const s = reportResult.result.summary;
    const spokenText = `Activity report for ${reportResult.result.timeframe}. ${s.voiceCommands} voice commands, ${s.analyses} analyses, ${s.logEntries} log entries, ${s.comparisons} comparisons.`;
    console.log('[voice-ai] [report-shortcut] Spoken: "' + spokenText + '"');
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch: 'compare' };
  }

  // For get_news, bypass LLM — speak top headlines directly
  const newsResult = toolResults.find(tr => tr.tool === 'get_news' && !tr.error);
  if (newsResult && newsResult.result?.headlines?.length > 0) {
    const h = newsResult.result.headlines;
    let spokenText = `${h.length} headlines. `;
    spokenText += h.slice(0, 3).map(item => item.title).join('. ') + '.';
    // Truncate for TTS
    if (spokenText.length > 300) spokenText = spokenText.slice(0, 297) + '...';
    console.log('[voice-ai] [news-shortcut] Spoken: "' + spokenText + '"');
    session.messages.push({ role: 'user', content: enrichedText });
    session.messages.push({ role: 'assistant', content: spokenText });
    return { text: spokenText, toolsUsed, panelSwitch: 'search' };
  }

  // For all other tools, ask the response model to generate a spoken answer.
  // Cap tool results to ~1500 chars total — small models choke on large prompts.
  let responsePrompt = resolvedText;
  if (toolResults.length > 0) {
    const maxPerTool = Math.floor(1500 / toolResults.length);
    const toolContext = toolResults.map(tr => {
      if (tr.error) {
        return `[${tr.tool}] Error: ${tr.error}`;
      }
      const resultStr = typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result);
      return `[${tr.tool}] Result:\n${resultStr.slice(0, maxPerTool)}`;
    }).join('\n\n');

    responsePrompt = `User request: ${resolvedText}\n\nTool results:\n${toolContext}\n\nRespond to the user based on the tool results above. Be concise — this will be spoken aloud. Do not add action tags, sound effects, or markdown.`;
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
let _lastLoggedAvailable = null; // track to suppress repeated log spam
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
      const hasAction = VOICE_MODEL === ACTION_MODEL ? hasVoice : models.some(m => m === ACTION_MODEL || m.startsWith(ACTION_MODEL));
      _ollamaAvailable = hasVoice && hasAction;
      // Only log when status changes — suppresses the every-30s spam
      if (_ollamaAvailable !== _lastLoggedAvailable) {
        _lastLoggedAvailable = _ollamaAvailable;
        if (_ollamaAvailable) {
          if (VOICE_MODEL === ACTION_MODEL) {
            console.log(`[voice-ai] Ollama available — single model: ${VOICE_MODEL}`);
          } else {
            console.log(`[voice-ai] Ollama available — voice: ${VOICE_MODEL}, action: ${ACTION_MODEL}`);
          }
        } else {
          const missing = [];
          if (!hasVoice) missing.push(VOICE_MODEL);
          if (!hasAction && VOICE_MODEL !== ACTION_MODEL) missing.push(ACTION_MODEL);
          console.warn(`[voice-ai] Ollama online but missing models: ${missing.join(', ')}. Available: ${models.join(', ')}`);
        }
      }
    }
  } catch {
    if (_lastLoggedAvailable !== false) {
      _lastLoggedAvailable = false;
      console.warn('[voice-ai] Ollama not reachable');
    }
    _ollamaAvailable = false;
  }
}

// Re-check Ollama availability every 30 seconds
setInterval(() => checkOllama(), 30000);

// Keep Ollama model(s) warm in GPU VRAM by sending no-op requests every 10 minutes.
// Without this, Ollama evicts models from VRAM after 5 minutes of inactivity.
// Eviction means the next voice command has a 5-30s cold-start delay while the model
// is loaded back. Keeping them warm ensures sub-second inference start times.
async function keepModelsWarm() {
  try {
    await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: VOICE_MODEL, keep_alive: '30m', prompt: '' }),
    });
    // Only send a second warm-up if action model differs from voice model
    if (ACTION_MODEL !== VOICE_MODEL) {
      await fetch(`${OLLAMA_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: ACTION_MODEL, keep_alive: '30m', prompt: '' }),
      });
    }
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
