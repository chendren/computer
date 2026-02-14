import { formatUptime } from '../utils/formatters.js';

export class StatusBar {
  constructor(barSelector, indicatorSelector, ws) {
    this.barConnection = document.getElementById('status-connection');
    this.barUptime = document.getElementById('status-uptime');
    this.barActivity = document.getElementById('status-activity');
    this.indicators = document.querySelector(indicatorSelector);
    this.startTime = Date.now();

    // Build status indicators
    this.indicators.innerHTML = `
      <div class="status-indicator">
        <span class="status-dot" id="dot-server"></span>
        <span>Server</span>
      </div>
      <div class="status-indicator">
        <span class="status-dot" id="dot-ws"></span>
        <span>WebSocket</span>
      </div>
      <div class="status-indicator">
        <span class="status-dot" id="dot-mic"></span>
        <span>Voice</span>
      </div>
    `;

    this.dotServer = document.getElementById('dot-server');
    this.dotWs = document.getElementById('dot-ws');
    this.dotMic = document.getElementById('dot-mic');

    ws.on('_connected', () => {
      this.barConnection.textContent = 'Connected';
      this.dotWs.className = 'status-dot online';
      this.dotServer.className = 'status-dot online';
    });

    ws.on('_disconnected', () => {
      this.barConnection.textContent = 'Disconnected';
      this.dotWs.className = 'status-dot';
      this.dotServer.className = 'status-dot';
    });

    // Update uptime
    setInterval(() => {
      const seconds = (Date.now() - this.startTime) / 1000;
      this.barUptime.textContent = `Uptime: ${formatUptime(seconds)}`;
    }, 1000);
  }

  setActivity(text) {
    this.barActivity.textContent = text;
  }

  setMicActive(active) {
    this.dotMic.className = active ? 'status-dot online' : 'status-dot';
  }
}
