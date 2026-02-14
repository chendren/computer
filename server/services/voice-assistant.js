/**
 * Voice Assistant Service
 *
 * Uses Claude Haiku 4.5 via @anthropic-ai/sdk with tool use to process
 * voice commands. Maintains per-session conversation history and provides
 * an agentic tool loop for multi-step operations.
 */

import Anthropic from '@anthropic-ai/sdk';

let client = null;

function getClient() {
  if (!client) {
    client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  }
  return client;
}

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
- ALWAYS use web_search FIRST to find current data. Never guess or estimate. Search, find the data, then report it.
- After searching, use web_fetch on the most promising result URL to get detailed data.
- The search results snippets often contain the answer directly — extract numbers/data from snippets when possible.
- For prices, stocks, commodities: search for "ITEM spot price today" or "ITEM price February 2026".
- For charts: first search and fetch real data points, then use generate_chart with actual numbers and date labels.
- If a web_fetch returns mostly JavaScript garbage, try a different URL from the search results. Prefer news sites, data aggregators, and text-heavy pages.
- NEVER fabricate data, estimates, or approximate values. Only report data you actually retrieved from a source. If you cannot find the data, say so honestly.
- Do not apologize about technical limitations. Just try alternative approaches silently.`;
}

const TOOLS = [
  {
    name: 'search_knowledge',
    description: 'Search the ship knowledge base using semantic vector search. Use for questions about stored information, facts, documents.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'store_knowledge',
    description: 'Store new information in the knowledge base for future retrieval.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Information to store' },
        title: { type: 'string', description: 'Title for the entry' },
      },
      required: ['text'],
    },
  },
  {
    name: 'create_log',
    description: "Create a captain's log entry.",
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Log entry content' },
      },
      required: ['text'],
    },
  },
  {
    name: 'display_on_screen',
    description: 'Switch the main LCARS viewscreen to a specific panel. Use when user says "on screen" or "show me".',
    input_schema: {
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
  {
    name: 'send_message',
    description: 'Send a message through the communications gateway to a messaging channel.',
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel (e.g., slack, discord, email, telegram)' },
        target: { type: 'string', description: 'Recipient (channel name, user, email)' },
        text: { type: 'string', description: 'Message content' },
      },
      required: ['channel', 'target', 'text'],
    },
  },
  {
    name: 'list_channels',
    description: 'List all communication channels and their connection status.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'get_status',
    description: 'Get overall system health and status including gateway, vectordb, ollama.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'search_transcripts',
    description: 'Search through voice transcript history.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term' },
      },
      required: ['query'],
    },
  },
  {
    name: 'create_monitor',
    description: 'Set up a monitoring watch on a URL, file, or endpoint.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Monitor name' },
        target: { type: 'string', description: 'URL or target to monitor' },
      },
      required: ['name', 'target'],
    },
  },
  {
    name: 'get_briefing',
    description: 'Get an activity summary/briefing of recent transcripts, logs, and analyses.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'generate_chart',
    description: 'Generate and display a chart on the viewscreen.',
    input_schema: {
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
  {
    name: 'browse_url',
    description: 'Open a URL on the viewscreen browser panel.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
      },
      required: ['url'],
    },
  },
  {
    name: 'analyze_text',
    description: 'Run AI analysis on text (sentiment, topics, key points, action items).',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to analyze' },
        title: { type: 'string', description: 'Title for the analysis' },
      },
      required: ['text'],
    },
  },
  {
    name: 'web_search',
    description: 'Search the web using DuckDuckGo. Returns search result titles and snippets. Use this FIRST when you need current data like prices, news, weather, or any real-time information. Then use web_fetch on promising result URLs if needed.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query — be specific, include dates when relevant' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_fetch',
    description: 'Fetch content from a specific URL. Returns extracted text content. Use after web_search to get details from a specific page, or to hit known API endpoints that return JSON.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch content from' },
      },
      required: ['url'],
    },
  },
];

/**
 * Process a voice command through Claude Haiku with tool use.
 *
 * @param {string} sessionId - Unique session identifier
 * @param {string} userText - Transcribed voice command (wake word stripped)
 * @param {function} toolExecutor - async (toolName, input) => result
 * @returns {{ text: string, toolsUsed: string[], panelSwitch: string|null }}
 */
export async function processVoiceCommand(sessionId, userText, toolExecutor) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const session = getOrCreateSession(sessionId);
  session.messages.push({ role: 'user', content: userText });

  // Trim history
  if (session.messages.length > MAX_HISTORY) {
    session.messages = session.messages.slice(-MAX_HISTORY);
  }

  const anthropic = getClient();
  console.log(`[voice-ai] Calling Claude: "${userText}"`);
  let response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: getSystemPrompt(),
    tools: TOOLS,
    messages: session.messages,
  });
  console.log(`[voice-ai] Response stop_reason: ${response.stop_reason}`);

  const toolsUsed = [];
  let panelSwitch = null;

  // Agentic loop — keep processing until no more tool_use
  while (response.stop_reason === 'tool_use') {
    const assistantContent = response.content;
    session.messages.push({ role: 'assistant', content: assistantContent });

    const toolUseBlocks = assistantContent.filter(b => b.type === 'tool_use');
    const toolResultBlocks = [];

    for (const toolUse of toolUseBlocks) {
      toolsUsed.push(toolUse.name);
      console.log(`[voice-ai] Tool call: ${toolUse.name}(${JSON.stringify(toolUse.input).slice(0, 200)})`);

      try {
        const result = await toolExecutor(toolUse.name, toolUse.input);
        console.log(`[voice-ai] Tool result: ${JSON.stringify(result).slice(0, 200)}`);

        if (toolUse.name === 'display_on_screen') {
          panelSwitch = toolUse.input.panel;
        }

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result).slice(0, 10000),
        });
      } catch (err) {
        console.error(`[voice-ai] Tool error: ${toolUse.name}: ${err.message}`);
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify({ error: err.message }),
          is_error: true,
        });
      }
    }

    session.messages.push({ role: 'user', content: toolResultBlocks });

    response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: getSystemPrompt(),
      tools: TOOLS,
      messages: session.messages,
    });
    console.log(`[voice-ai] Loop response stop_reason: ${response.stop_reason}`);
  }

  // Extract final text
  const textBlocks = response.content.filter(b => b.type === 'text');
  const responseText = textBlocks.map(b => b.text).join(' ');
  console.log(`[voice-ai] Final response: "${responseText.slice(0, 200)}", tools: [${toolsUsed.join(', ')}]`);

  session.messages.push({ role: 'assistant', content: response.content });

  return { text: responseText, toolsUsed, panelSwitch };
}

/**
 * Check if voice assistant is available (API key set).
 */
export function isVoiceAvailable() {
  return !!process.env.ANTHROPIC_API_KEY;
}

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
