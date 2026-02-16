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

class ComputerApp {
  constructor() {
    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocketClient(`${wsProtocol}//${location.host}`);
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

    // WebSocket handlers — auto-switch to relevant panel on data push
    this.ws.on('transcript', (data) => {
      this.transcript.addEntry(data);
      this.switchPanel('transcript');
    });

    this.ws.on('analysis', (data) => {
      this.analysis.display(data);
      this.switchPanel('analysis');
      if (data.chartSpec) {
        this.charts.render(data.chartSpec);
      }
    });

    this.ws.on('chart', (data) => {
      this.charts.render(data);
      this.switchPanel('charts');
    });

    this.ws.on('search', (data) => {
      this.search.display(data);
      this.switchPanel('search');
    });

    this.ws.on('log', (data) => {
      this.log.addEntry(data);
      this.switchPanel('log');
    });

    this.ws.on('monitor', (data) => {
      this.monitor.display(data);
      this.switchPanel('monitor');
    });

    this.ws.on('comparison', (data) => {
      this.comparison.display(data);
      this.switchPanel('compare');
      if (data.chartSpec) {
        this.charts.render(data.chartSpec);
      }
    });

    this.ws.on('knowledge', (data) => {
      this.knowledge.addEntry(data);
      this.switchPanel('knowledge');
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
        this.browser.navigate();
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

    // Panel switching via sidebar buttons
    const buttons = document.querySelectorAll('.lcars-button[data-panel]');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => this.switchPanel(btn.dataset.panel));
    });

    // Auth first, then load data
    this._initAuth(wsProtocol).then(() => this.loadHistory());
  }

  async _initAuth(wsProtocol) {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      if (data.authToken) {
        this.authToken = data.authToken;
        this.api.setAuthToken(data.authToken);
        // Reconnect WS with auth token
        this.ws.setUrl(`${wsProtocol}//${location.host}?token=${data.authToken}`);
      }
    } catch {
      // Health endpoint unreachable — will retry on reconnect
    }
  }

  async _speak(text) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;
      const res = await fetch('/api/tts/speak', {
        method: 'POST',
        headers,
        body: JSON.stringify({ text }),
      });
      const result = await res.json();
      if (result.audioUrl) {
        this.audio.speak(result.audioUrl);
      }
    } catch {}
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
