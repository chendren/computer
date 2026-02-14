import { escapeHtml, nowTime } from '../utils/formatters.js';
import { clearEmpty } from '../utils/lcars-helpers.js';

// Smart voice routing patterns — detect intent and suggest/auto-route commands
const VOICE_ROUTES = [
  { pattern: /^(computer,?\s+)?analyze\s+/i, command: '/computer:analyze', extract: (t) => t.replace(/^(computer,?\s+)?analyze\s+/i, '') },
  { pattern: /^(computer,?\s+)?search\s+(for\s+)?/i, command: '/computer:search', extract: (t) => t.replace(/^(computer,?\s+)?search\s+(for\s+)?/i, '') },
  { pattern: /^(computer,?\s+)?compare\s+/i, command: '/computer:compare', extract: (t) => t.replace(/^(computer,?\s+)?compare\s+/i, '') },
  { pattern: /^(computer,?\s+)?summarize\s+/i, command: '/computer:summarize', extract: (t) => t.replace(/^(computer,?\s+)?summarize\s+/i, '') },
  { pattern: /^(computer,?\s+)?monitor\s+/i, command: '/computer:monitor', extract: (t) => t.replace(/^(computer,?\s+)?monitor\s+/i, '') },
  { pattern: /^(computer,?\s+)?translate\s+/i, command: '/computer:translate', extract: (t) => t.replace(/^(computer,?\s+)?translate\s+/i, '') },
  { pattern: /^(computer,?\s+)?explain\s+/i, command: '/computer:explain', extract: (t) => t.replace(/^(computer,?\s+)?explain\s+/i, '') },
  { pattern: /^(computer,?\s+)?(captain'?s?\s+)?log[\s:,]+/i, command: '/computer:log', extract: (t) => t.replace(/^(computer,?\s+)?(captain'?s?\s+)?log[\s:,]+/i, '') },
  { pattern: /^(computer,?\s+)?remember\s+/i, command: '/computer:know', extract: (t) => `remember ${t.replace(/^(computer,?\s+)?remember\s+/i, '')}` },
  { pattern: /^(computer,?\s+)?what do (we|you) know about\s+/i, command: '/computer:know', extract: (t) => t.replace(/^(computer,?\s+)?/i, '') },
  { pattern: /^(computer,?\s+)?brief(ing)?$/i, command: '/computer:brief', extract: () => '' },
  { pattern: /^(computer,?\s+)?status$/i, command: '/computer:status', extract: () => '' },
];

export class CommandInput {
  constructor(api, ws) {
    this.api = api;
    this.audioPlayer = null;
    this.display = document.getElementById('conversation-display');
    this.input = document.getElementById('command-input');
    this.sendBtn = document.getElementById('cmd-send');
    this.history = [];
    this.historyIndex = -1;
    this.processing = false;

    this.sendBtn.addEventListener('click', () => this.send());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      } else if (e.key === 'ArrowUp') {
        this.navigateHistory(-1);
      } else if (e.key === 'ArrowDown') {
        this.navigateHistory(1);
      }
    });
  }

  navigateHistory(dir) {
    if (this.history.length === 0) return;
    this.historyIndex = Math.max(-1, Math.min(this.history.length - 1, this.historyIndex + dir));
    this.input.value = this.historyIndex >= 0 ? this.history[this.historyIndex] : '';
  }

  addMessage(role, text) {
    clearEmpty(this.display);
    const msg = document.createElement('div');
    msg.className = `message ${role}`;
    msg.innerHTML = `
      <div class="message-label">${role === 'user' ? 'You' : 'Computer'} &mdash; ${nowTime()}</div>
      <div>${escapeHtml(text)}</div>
    `;
    this.display.appendChild(msg);
    this.display.scrollTop = this.display.scrollHeight;
    return msg;
  }

  async send() {
    const text = this.input.value.trim();
    if (!text || this.processing) return;

    this.history.unshift(text);
    this.historyIndex = -1;
    this.input.value = '';

    this.addMessage('user', text);
    this.processing = true;
    this.sendBtn.disabled = true;

    // Create computer response placeholder
    clearEmpty(this.display);
    const msg = document.createElement('div');
    msg.className = 'message computer';
    msg.innerHTML = `<div class="message-label">Computer &mdash; ${nowTime()}</div><div class="response-text"></div>`;
    this.display.appendChild(msg);
    const responseEl = msg.querySelector('.response-text');

    const systemPrompt = 'You are the USS Enterprise Computer. Respond concisely and helpfully. If the user asks for analysis, charts, or search, output structured JSON that can be parsed. Be direct and authoritative like the Star Trek computer.';

    try {
      await this.api.queryClaudeStream(text, systemPrompt, (chunk) => {
        responseEl.textContent += chunk;
        this.display.scrollTop = this.display.scrollHeight;
      });
    } catch (err) {
      responseEl.textContent = `Error: ${err.message}`;
    }

    // Speak short responses via TTS
    const fullResponse = responseEl.textContent;
    this._maybeSpeakResponse(fullResponse);

    this.processing = false;
    this.sendBtn.disabled = false;
    this.input.focus();
  }

  setInputText(text) {
    this.input.value = text;
    this.input.focus();
  }

  /**
   * Detect voice intent and return a route suggestion, or null.
   */
  detectVoiceRoute(text) {
    for (const route of VOICE_ROUTES) {
      if (route.pattern.test(text)) {
        return { command: route.command, args: route.extract(text) };
      }
    }
    return null;
  }

  /**
   * Set input from voice with smart routing hint.
   * Shows a suggestion badge if a command route is detected.
   */
  setInputFromVoice(text) {
    const route = this.detectVoiceRoute(text);
    if (route) {
      // Auto-populate with the detected command + args
      this.input.value = `${route.command} ${route.args}`.trim();
      this.input.focus();
      this._showRouteSuggestion(route.command);
    } else {
      this.input.value = text;
      this.input.focus();
    }
  }

  _showRouteSuggestion(command) {
    // Remove any existing suggestion
    const existing = document.querySelector('.voice-route-badge');
    if (existing) existing.remove();

    const badge = document.createElement('div');
    badge.className = 'voice-route-badge';
    badge.textContent = `Routed → ${command}`;
    this.input.parentElement.appendChild(badge);
    setTimeout(() => badge.remove(), 3000);
  }

  async _maybeSpeakResponse(text) {
    if (!this.audioPlayer || !this.audioPlayer.enabled) return;
    if (!text || text.length > 200 || text.startsWith('Error:')) return;

    try {
      const res = await fetch('/api/tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const result = await res.json();
      if (result.audioUrl) {
        this.audioPlayer.speak(result.audioUrl);
      }
    } catch {}
  }
}
