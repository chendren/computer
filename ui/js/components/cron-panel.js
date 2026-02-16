import { escapeHtml } from '../utils/formatters.js';
import { clearEmpty } from '../utils/lcars-helpers.js';

export class CronPanel {
  constructor(api, ws) {
    this.api = api;
    this.ws = ws;
    this.container = document.getElementById('cron-content');
    this.jobs = [];
    this.eventLog = [];

    this.ws.on('cron_event', (data) => {
      this.handleCronEvent(data);
    });
  }

  async loadHistory() {
    try {
      const data = await this.api.get('/gateway/cron');
      this.jobs = data.jobs || [];
      this.render();
    } catch {
      this.renderOffline();
    }
  }

  handleCronEvent(data) {
    if (!data || typeof data !== 'object') return;
    this.eventLog.unshift({
      time: new Date().toLocaleTimeString(),
      jobId: String(data.jobId || 'cron'),
      status: String(data.status || 'fired'),
    });
    if (this.eventLog.length > 50) this.eventLog.pop();
    this.renderEventLog();
  }

  render() {
    if (!this.container) return;
    clearEmpty(this.container);

    if (!Array.isArray(this.jobs) || this.jobs.length === 0) {
      this.container.innerHTML = `<div class="empty-state">
        <div class="empty-state-text">No cron jobs configured</div>
      </div>`;
      return;
    }

    const cards = this.jobs.map(j => {
      const id = j.id || j.name || 'unknown';
      const schedule = j.schedule || j.cron || '—';
      const active = j.enabled !== false;
      return `<div class="cron-card ${active ? '' : 'paused'}">
        <div class="cron-name">${escapeHtml(id)}</div>
        <div class="cron-schedule">${escapeHtml(schedule)}</div>
        <div class="cron-status">${active ? 'ACTIVE' : 'PAUSED'}</div>
      </div>`;
    }).join('');

    this.container.innerHTML = `
      <div class="cron-grid">${cards}</div>
      <div class="lcars-divider"></div>
      <div class="lcars-label">Event Log</div>
      <div class="cron-event-log" id="cron-event-log"></div>
    `;
    this.renderEventLog();
  }

  renderEventLog() {
    const log = document.getElementById('cron-event-log');
    if (!log) return;
    if (this.eventLog.length === 0) {
      log.innerHTML = '<div class="empty-state"><div class="empty-state-text">No events yet</div></div>';
      return;
    }
    log.innerHTML = this.eventLog.map(e =>
      `<div class="cron-event-item">
        <span class="cron-event-time">[${e.time}]</span>
        <span class="cron-event-id">${escapeHtml(e.jobId)}</span>
        <span class="cron-event-status">${escapeHtml(e.status)}</span>
      </div>`
    ).join('');
  }

  renderOffline() {
    if (!this.container) return;
    this.container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">&#9670;</div>
      <div class="empty-state-text">Gateway not connected</div>
    </div>`;
  }
}
