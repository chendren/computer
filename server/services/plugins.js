/**
 * Plugins service — lists local capabilities, hooks, and tools.
 */

// The voice assistant tool definitions — these are the available tools
const TOOLS = [
  { name: 'search_knowledge', description: 'Search the knowledge base', plugin: 'computer' },
  { name: 'store_knowledge', description: 'Store information in knowledge base', plugin: 'computer' },
  { name: 'create_log', description: 'Create a captain\'s log entry', plugin: 'computer' },
  { name: 'get_time', description: 'Get current time and stardate', plugin: 'computer' },
  { name: 'set_alert', description: 'Set ship alert level', plugin: 'computer' },
  { name: 'compare_data', description: 'Compare two data sets', plugin: 'computer' },
  { name: 'create_reminder', description: 'Set a timed reminder', plugin: 'computer' },
  { name: 'display_on_screen', description: 'Switch to a specific panel', plugin: 'computer' },
  { name: 'send_message', description: 'Send a message via channel', plugin: 'computer' },
  { name: 'list_channels', description: 'List connected channels', plugin: 'computer' },
  { name: 'get_status', description: 'Get system status', plugin: 'computer' },
  { name: 'search_transcripts', description: 'Search voice transcripts', plugin: 'computer' },
  { name: 'create_monitor', description: 'Create a system monitor', plugin: 'computer' },
  { name: 'get_briefing', description: 'Get daily briefing', plugin: 'computer' },
  { name: 'generate_chart', description: 'Generate data visualization', plugin: 'computer' },
  { name: 'browse_url', description: 'Open URL in browser', plugin: 'computer' },
  { name: 'analyze_text', description: 'Analyze text content', plugin: 'computer' },
  { name: 'web_fetch', description: 'Fetch and read a web page', plugin: 'computer' },
  { name: 'web_search', description: 'Search the web', plugin: 'computer' },
  { name: 'web_search_and_read', description: 'Search and read web results', plugin: 'computer' },
  { name: 'check_email', description: 'Check inbox for new email', plugin: 'gmail' },
  { name: 'summarize_inbox', description: 'Summarize email inbox', plugin: 'gmail' },
  { name: 'check_followups', description: 'Check for follow-up items', plugin: 'gmail' },
  { name: 'read_email', description: 'Read a specific email', plugin: 'gmail' },
  { name: 'send_email', description: 'Send an email', plugin: 'gmail' },
  { name: 'reply_email', description: 'Reply to an email', plugin: 'gmail' },
];

const HOOKS = [
  { name: 'voice.command', plugin: 'computer', priority: 'normal', description: 'Process voice commands' },
  { name: 'session.start', plugin: 'computer', priority: 'normal', description: 'Initialize voice session' },
  { name: 'security.scan', plugin: 'computer', priority: 'high', description: 'Scan requests for secrets' },
  { name: 'cron.fired', plugin: 'computer', priority: 'normal', description: 'Execute scheduled jobs' },
];

export function listPlugins() {
  return [
    {
      id: 'computer',
      name: 'LCARS Computer',
      enabled: true,
      description: 'Ship computer core systems — voice, knowledge, analysis, monitoring',
      hooks: HOOKS.filter(h => h.plugin === 'computer'),
      tools: TOOLS.filter(t => t.plugin === 'computer'),
    },
    {
      id: 'gmail',
      name: 'Gmail Integration',
      enabled: true,
      description: 'Email — inbox, threads, send, summarize, priorities, follow-ups',
      hooks: [],
      tools: TOOLS.filter(t => t.plugin === 'gmail'),
    },
  ];
}

export function listHooks() {
  return HOOKS;
}

export function listTools() {
  return TOOLS;
}
