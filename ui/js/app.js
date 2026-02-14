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
    this.analysis = new AnalysisPanel();
    this.search = new SearchPanel(this.api);
    this.log = new LogPanel(this.api);
    this.monitor = new MonitorPanel(this.api);
    this.comparison = new ComparisonPanel();
    this.knowledge = new KnowledgePanel(this.api);
    this.command = new CommandInput(this.api, this.ws);
    this.command.audioPlayer = this.audio;
    this.dashboard = new DashboardPanel(this.api, this.ws);
    this.voice = new VoiceInput(this.transcript, this.statusBar, this.ws, this.command);

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
      this.charts.render(data.chartConfig || data);
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

    // Panel switching via sidebar buttons
    const buttons = document.querySelectorAll('.lcars-button[data-panel]');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => this.switchPanel(btn.dataset.panel));
    });

    // Load stored data
    this.loadHistory();
  }

  async _speak(text) {
    try {
      const res = await fetch('/api/tts/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    ]);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.computerApp = new ComputerApp();
});
