/**
 * Computer App — LCARS UI application shell.
 *
 * Bootstraps all UI panels, services, and WebSocket event routing.
 * Defers WebSocket connection until the auth token is fetched to avoid 401s.
 *
 * Key behaviors:
 *   - Voice panel lock: prevents background events from stealing focus during
 *     voice playback (voice_panel_switch / voice_done lifecycle)
 *   - Quick action buttons: one-tap access to common voice commands
 *   - Text command bar: type commands instead of speaking them
 *   - Ambient audio integration: procedural background sound presets
 *   - Timer countdown: live updating timer display in the status bar
 *   - Auto-panel switching: WebSocket data pushes activate the relevant panel
 */
import { WebSocketClient } from './services/websocket-client.js';
import { ApiClient } from './services/api-client.js';
import { AudioPlayer } from './services/audio-player.js';
import { TranscriptPanel } from './components/transcript-panel.js';
import { VoiceInput } from './components/voice-input.js';
import { ChartPanel } from './components/chart-panel.js';
import { AnalysisPanel } from './components/analysis-panel.js';
import { SearchPanel } from './components/search-panel.js';
import { CommandInput } from './components/command-input.js';
import { StatusBar } from './components/status-bar.js';
import { LogPanel } from './components/log-panel.js';
import { MonitorPanel } from './components/monitor-panel.js';
import { ComparisonPanel } from './components/comparison-panel.js';
import { DashboardPanel } from './components/dashboard-panel.js';
import { KnowledgePanel } from './components/knowledge-panel.js';
// OpenClaw integration panels
import { ChannelsPanel } from './components/channels-panel.js';
import { GatewayPanel } from './components/gateway-panel.js';
import { PluginsPanel } from './components/plugins-panel.js';
import { CronPanel } from './components/cron-panel.js';
import { BrowserPanel } from './components/browser-panel.js';
import { NodesPanel } from './components/nodes-panel.js';
import { SecurityPanel } from './components/security-panel.js';
import { VoiceAssistantUI } from './components/voice-assistant-ui.js';
import { AmbientAudio } from './services/ambient-audio.js';

class ComputerApp {
  constructor() {
    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Defer WS connection until auth token is fetched (avoids 401 on initial connect)
    this.ws = new WebSocketClient(`${wsProtocol}//${location.host}`, { autoConnect: false });
    this.api = new ApiClient('/api');
    this.audio = new AudioPlayer();

    // Initialize components — command before voice so we can pass it
    this.statusBar = new StatusBar('#status-bar', '#status-indicators', this.ws);
    this.transcript = new TranscriptPanel(this.api);
    this.charts = new ChartPanel();
    this.analysis = new AnalysisPanel(this.api);
    this.search = new SearchPanel(this.api);
    this.log = new LogPanel(this.api);
    this.monitor = new MonitorPanel(this.api);
    this.comparison = new ComparisonPanel(this.api);
    this.knowledge = new KnowledgePanel(this.api);
    this.command = new CommandInput(this.api, this.ws);
    this.command.audioPlayer = this.audio;
    this.dashboard = new DashboardPanel(this.api, this.ws);
    this.voice = new VoiceInput(this.transcript, this.statusBar, this.ws, this.command);

    // OpenClaw integration panels
    this.channels = new ChannelsPanel(this.api, this.ws);
    this.gateway = new GatewayPanel(this.api, this.ws);
    this.plugins = new PluginsPanel(this.api, this.ws);
    this.cron = new CronPanel(this.api, this.ws);
    this.browser = new BrowserPanel(this.api, this.ws);
    this.nodes = new NodesPanel(this.api, this.ws);
    this.security = new SecurityPanel(this.api, this.ws);

    // Voice assistant (always-listening, wake word "Computer")
    this.voiceAssistant = new VoiceAssistantUI(this.ws, this.audio, this.statusBar);

    // Ambient audio — procedural background sounds
    this.ambient = new AmbientAudio();

    // WebSocket handlers — auto-switch to relevant panel on data push.
    // During voice interaction, only voice_panel_switch controls the active panel
    // (prevents background monitor/cron events from yanking focus away from charts).
    this._voiceLockPanel = false;

    this.ws.on('voice_panel_switch', () => {
      // voice_panel_switch sets a lock — hold this panel during voice playback
      this._voiceLockPanel = true;
    });
    this.ws.on('voice_done', () => {
      this._voiceLockPanel = false;
    });

    this.ws.on('transcript', (data) => {
      this.transcript.addEntry(data);
      if (!this._voiceLockPanel) this.switchPanel('transcript');
    });

    this.ws.on('analysis', (data) => {
      this.analysis.display(data);
      if (!this._voiceLockPanel) this.switchPanel('analysis');
      if (data.chartSpec) this.charts.render(data.chartSpec);
    });

    this.ws.on('chart', (data) => {
      this.charts.render(data);
      this.switchPanel('charts');
    });

    this.ws.on('search', (data) => {
      this.search.display(data);
      if (!this._voiceLockPanel) this.switchPanel('search');
    });

    this.ws.on('log', (data) => {
      this.log.addEntry(data);
      if (!this._voiceLockPanel) this.switchPanel('log');
    });

    this.ws.on('monitor', (data) => {
      this.monitor.display(data);
      // Never auto-switch to monitor — background poller fires constantly
    });

    this.ws.on('comparison', (data) => {
      this.comparison.display(data);
      if (!this._voiceLockPanel) this.switchPanel('compare');
      if (data.chartSpec) this.charts.render(data.chartSpec);
    });

    this.ws.on('knowledge', (data) => {
      this.knowledge.addEntry(data);
      if (!this._voiceLockPanel) this.switchPanel('knowledge');
    });

    // Sound effect cue from server — play through AudioPlayer queue
    this.ws.on('play_sound', (data) => {
      if (data.url) this.audio.speak(data.url);
    });

    // Ambient audio control — start/stop procedural background sounds
    this.ws.on('ambient_control', (data) => {
      if (data.action === 'stop') this.ambient.stop();
      else if (data.action === 'play') this.ambient.start(data.preset);
    });

    // Telegram incoming message — center popup + TTS announcement
    this.ws.on('telegram_message', (data) => {
      const from = data.from || 'Unknown';
      const text = data.text || '';
      console.log('[app] Telegram message from', from, ':', text.slice(0, 100));
      // Show center popup immediately
      this._showTelegramPopup(from, text, data.username);
      // Speak with "Captain, alert" prefix — truncate message for TTS
      const spokenMsg = `Captain, alert. Incoming message from ${from}. ${text.slice(0, 150)}`;
      this._speak(spokenMsg);
    });

    // Alert status — visual overlay for red/yellow/blue alert
    this.ws.on('alert_status', (data) => {
      this._setAlertStatus(data.level, data.reason);
    });

    this.ws.on('status', (data) => {
      if (data.message) this.statusBar.setActivity(data.message);
      // Speak short status messages when flagged
      if (data.speak && data.message && data.message.length < 100) {
        this._speak(data.message);
      }
    });

    // Voice assistant: browser navigation
    this.ws.on('browser_navigate', (data) => {
      if (data.url) {
        const urlInput = document.getElementById('browser-url-input');
        if (urlInput) urlInput.value = data.url;
        this.switchPanel('browser');
        this.browser.navigate(data.url);
      }
    });

    // Gateway status updates for footer
    this.ws.on('gateway_status', (data) => {
      const el = document.getElementById('status-gateway');
      if (el) {
        el.textContent = data.connected ? 'Gateway: Online' : 'Gateway: Offline';
        el.className = `status-segment ${data.connected ? 'status-online' : 'status-offline'}`;
      }
    });

    // Timer countdown — live update in status bar
    this.ws.on('timer_started', (data) => {
      if (data.endsAt) {
        this.statusBar.setTimer(data.endsAt, data.label || '');
      }
    });

    // Text command input — type commands instead of speaking
    const cmdInput = document.getElementById('text-command-input');
    if (cmdInput) {
      cmdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && cmdInput.value.trim().length > 0) {
          const cmd = cmdInput.value.trim();
          this.ws.send('voice_command', { text: cmd });
          this.statusBar?.setActivity('Command: ' + cmd);
          cmdInput.value = '';
        }
      });
    }

    // Quick action buttons — send voice commands via WebSocket
    const quickActions = document.getElementById('quick-actions');
    if (quickActions) {
      quickActions.addEventListener('click', (e) => {
        const btn = e.target.closest('.quick-action-btn');
        if (btn && btn.dataset.cmd) {
          this.ws.send('voice_command', { text: btn.dataset.cmd });
          this.statusBar?.setActivity('Command: ' + btn.dataset.cmd);
        }
      });
    }

    // Panel switching via sidebar buttons
    const buttons = document.querySelectorAll('.lcars-button[data-panel]');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => this.switchPanel(btn.dataset.panel));
    });

    // Auth first, then connect WS with token and load data
    this._initAuth(wsProtocol).then(() => {
      this.loadHistory();
      // Refresh services status every 30 seconds
      setInterval(() => this._refreshServices(), 30000);
    });
  }

  async _refreshServices() {
    try {
      const data = await this.api.get('/health');
      this._updateServicesFromHealth(data);
    } catch {}
  }

  _updateServicesFromHealth(data) {
    const isUp = (val) => {
      if (!val) return false;
      if (typeof val === 'string') return val === 'online' || val === 'ready';
      if (typeof val === 'object') return val.ready === true || val.running === true;
      return !!val;
    };
    const services = [
      { name: 'Ollama', up: isUp(data.ollama) },
      { name: 'VectorDB', up: isUp(data.vectordb) },
      { name: 'VoxtralSTT', up: isUp(data.voxtralStt) },
      { name: 'Moshi', up: isUp(data.moshi) },
    ];
    const online = services.filter(s => s.up).length;
    this.statusBar.setServices(online, services.length);
  }

  async _initAuth(wsProtocol) {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (data.authToken) {
        this.authToken = data.authToken;
        this.api.setAuthToken(data.authToken);
        this.ws.url = `${wsProtocol}//${location.host}?token=${data.authToken}`;
      }
      this._updateServicesFromHealth(data);
      this.statusBar.setVoiceMode('computer');
    } catch {
      // Health endpoint unreachable — connect without auth, will retry
    }
    // Connect WS (with or without token)
    this.ws.connect();
  }

  async _speak(text) {
    try {
      // TTS endpoint has 500 char limit — truncate if needed
      const truncated = text.length > 450 ? text.slice(0, 447) + '...' : text;
      const headers = { 'Content-Type': 'application/json' };
      if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;
      const res = await fetch('/api/tts/speak', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: truncated }),
      });
      const result = await res.json();
      if (result.audioUrl) {
        this.audio.speak(result.audioUrl);
      } else {
        console.error('[app] TTS returned no audioUrl:', result);
      }
    } catch (err) {
      console.error('[app] TTS _speak failed:', err.message);
    }
  }

  _showTelegramPopup(from, text, username) {
    // Remove existing popup if any
    const existing = document.getElementById('telegram-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = 'telegram-popup';
    popup.className = 'telegram-popup';

    const header = document.createElement('div');
    header.className = 'telegram-popup-header';
    header.textContent = 'INCOMING TRANSMISSION';
    popup.appendChild(header);

    const fromDiv = document.createElement('div');
    fromDiv.className = 'telegram-popup-from';
    fromDiv.textContent = from + (username ? ' (@' + username + ')' : '');
    popup.appendChild(fromDiv);

    const msgDiv = document.createElement('div');
    msgDiv.className = 'telegram-popup-text';
    msgDiv.textContent = text;
    popup.appendChild(msgDiv);

    const channelDiv = document.createElement('div');
    channelDiv.className = 'telegram-popup-channel';
    channelDiv.textContent = 'TELEGRAM';
    popup.appendChild(channelDiv);

    document.body.appendChild(popup);

    // Auto-dismiss after 12 seconds
    setTimeout(() => {
      popup.classList.add('telegram-popup-fade');
      setTimeout(() => popup.remove(), 1000);
    }, 12000);

    // Click to dismiss
    popup.addEventListener('click', () => {
      popup.classList.add('telegram-popup-fade');
      setTimeout(() => popup.remove(), 300);
    });
  }

  _setAlertStatus(level, reason) {
    // Remove any existing alert overlay
    const existing = document.getElementById('alert-overlay');
    if (existing) existing.remove();
    document.body.classList.remove('alert-red', 'alert-yellow', 'alert-blue');

    if (level === 'normal') return;

    document.body.classList.add(`alert-${level}`);
    const overlay = document.createElement('div');
    overlay.id = 'alert-overlay';
    overlay.className = `alert-overlay alert-${level}`;
    const label = document.createElement('div');
    label.className = 'alert-label';
    label.textContent = `${level.toUpperCase()} ALERT`;
    overlay.appendChild(label);
    if (reason) {
      const reasonEl = document.createElement('div');
      reasonEl.className = 'alert-reason';
      reasonEl.textContent = reason;
      overlay.appendChild(reasonEl);
    }
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'cmd-btn alert-dismiss';
    dismissBtn.textContent = 'Acknowledge';
    dismissBtn.addEventListener('click', () => {
      overlay.remove();
      document.body.classList.remove(`alert-${level}`);
    });
    overlay.appendChild(dismissBtn);
    document.body.appendChild(overlay);

    // Auto-dismiss after 30 seconds
    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.remove();
        document.body.classList.remove(`alert-${level}`);
      }
    }, 30000);
  }

  switchPanel(panelId) {
    const buttons = document.querySelectorAll('.lcars-button[data-panel]');
    buttons.forEach(b => b.classList.remove('active'));
    const target = document.querySelector(`.lcars-button[data-panel="${panelId}"]`);
    if (target) target.classList.add('active');

    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const panel = document.getElementById(`panel-${panelId}`);
    if (panel) panel.classList.add('active');
  }

  async loadHistory() {
    await Promise.allSettled([
      this.transcript.loadHistory(),
      this.analysis.loadHistory(this.api),
      this.log.loadHistory(),
      this.monitor.loadHistory(),
      this.comparison.loadHistory(this.api),
      this.knowledge.loadHistory(),
      this.dashboard.loadHistory(),
      // OpenClaw panels — non-fatal if gateway unavailable
      this.channels.loadHistory(),
      this.gateway.loadHistory(),
      this.plugins.loadHistory(),
      this.cron.loadHistory(),
      this.nodes.loadHistory(),
      this.security.loadHistory(),
    ]);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.computerApp = new ComputerApp();
});
