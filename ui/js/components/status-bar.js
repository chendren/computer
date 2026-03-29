import { formatUptime } from '../utils/formatters.js';

export class StatusBar {
  constructor(barSelector, indicatorSelector, ws) {
    this.barConnection = document.getElementById('status-connection');
    this.barUptime = document.getElementById('status-uptime');
    this.barActivity = document.getElementById('status-activity');
    this.barVoiceMode = document.getElementById('status-voice-mode');
    this.barTimer = document.getElementById('status-timer');
    this.barServices = document.getElementById('status-services');
    this.indicators = document.querySelector(indicatorSelector);
    this.startTime = Date.now();
    this._timerInterval = null;
    this._timerEndsAt = null;

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

  setVoiceMode(mode) {
    const labels = { computer: 'CMD', gemini: 'GEMINI', openai: 'OPENAI', nova: 'NOVA' };
    const colors = { computer: 'var(--lcars-blue)', gemini: 'var(--lcars-lavender)', openai: 'var(--lcars-green)', nova: 'var(--lcars-gold)' };
    const label = labels[mode] || mode.toUpperCase();
    this.barVoiceMode.textContent = label;
    this.barVoiceMode.style.color = colors[mode] || 'var(--lcars-text-dim)';
  }

  setTimer(endsAt, label) {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }

    if (!endsAt) {
      this.barTimer.textContent = '';
      this._timerEndsAt = null;
      return;
    }

    this._timerEndsAt = typeof endsAt === 'number' ? endsAt : new Date(endsAt).getTime();
    const prefix = label ? `${label}: ` : 'Timer: ';

    const tick = () => {
      const remaining = Math.max(0, Math.round((this._timerEndsAt - Date.now()) / 1000));
      if (remaining <= 0) {
        this.barTimer.textContent = '';
        this.barTimer.style.color = '';
        if (this._timerInterval) clearInterval(this._timerInterval);
        this._timerInterval = null;
        return;
      }
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      const display = m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
      this.barTimer.textContent = prefix + display;
      this.barTimer.style.color = remaining <= 10 ? 'var(--lcars-red)' : 'var(--lcars-gold)';
    };

    tick();
    this._timerInterval = setInterval(tick, 1000);
  }

  setServices(online, total) {
    this.barServices.textContent = `${online}/${total} Services`;
    this.barServices.style.color = online === total ? 'var(--lcars-green)' : 'var(--lcars-gold)';
  }
}
