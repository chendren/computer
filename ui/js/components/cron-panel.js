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
      name: String(data.name || data.jobId || 'cron'),
      status: String(data.status || 'fired'),
    });
    if (this.eventLog.length > 50) this.eventLog.pop();
    this.renderEventLog();
  }

  async createJob() {
    const nameEl = document.getElementById('cron-name-input');
    const schedEl = document.getElementById('cron-schedule-input');
    const cmdEl = document.getElementById('cron-cmd-input');
    const descEl = document.getElementById('cron-desc-input');
    const statusEl = document.getElementById('cron-status-msg');

    const name = nameEl?.value.trim();
    const schedule = schedEl?.value.trim();
    const command = cmdEl?.value.trim();
    const description = descEl?.value.trim();

    if (!name || !schedule) {
      if (statusEl) { statusEl.textContent = 'Name and schedule required'; statusEl.style.color = 'var(--lcars-red)'; }
      return;
    }

    if (statusEl) { statusEl.textContent = 'Creating...'; statusEl.style.color = 'var(--lcars-gold)'; }

    try {
      await this.api.post('/gateway/cron', { name, schedule, command, description });
      if (nameEl) nameEl.value = '';
      if (schedEl) schedEl.value = '';
      if (cmdEl) cmdEl.value = '';
      if (descEl) descEl.value = '';
      if (statusEl) { statusEl.textContent = 'Created'; statusEl.style.color = 'var(--lcars-green)'; }
      await this.loadHistory();
    } catch (err) {
      if (statusEl) { statusEl.textContent = err.message || 'Failed'; statusEl.style.color = 'var(--lcars-red)'; }
    }
  }

  async deleteJob(id) {
    try {
      await this.api.delete('/gateway/cron/' + encodeURIComponent(id));
      await this.loadHistory();
    } catch (err) {
      console.error('Delete job failed:', err);
    }
  }

  async toggleJob(id) {
    try {
      await this.api.post('/gateway/cron/' + encodeURIComponent(id) + '/toggle');
      await this.loadHistory();
    } catch (err) {
      console.error('Toggle job failed:', err);
    }
  }

  render() {
    if (!this.container) return;
    clearEmpty(this.container);

    // All dynamic values below are escaped via escapeHtml() before insertion
    const form = `<div class="cron-submit-form">
      <div class="cron-input-row">
        <input type="text" id="cron-name-input" class="search-input" placeholder="Job name..." autocomplete="off">
        <input type="text" id="cron-schedule-input" class="search-input cron-schedule-field" placeholder="*/5 * * * *" autocomplete="off">
      </div>
      <div class="cron-input-row">
        <input type="text" id="cron-cmd-input" class="search-input" placeholder="Command (optional) e.g. check_email or web_search:{&quot;query&quot;:&quot;news&quot;}" autocomplete="off">
      </div>
      <div class="cron-input-row">
        <input type="text" id="cron-desc-input" class="search-input" placeholder="Description (optional)..." autocomplete="off">
        <button class="cmd-btn" id="cron-create-btn">Create Job</button>
        <span id="cron-status-msg" class="status-segment"></span>
      </div>
      <div class="cron-schedule-hint">Schedule: <code>min hour dom month dow</code> &mdash; Command: <code>tool_name</code> or <code>tool_name:{"key":"value"}</code></div>
    </div>`;

    let jobsHtml;
    if (!Array.isArray(this.jobs) || this.jobs.length === 0) {
      jobsHtml = '<div class="empty-state"><div class="empty-state-text">No cron jobs configured</div></div>';
    } else {
      jobsHtml = '<div class="cron-grid">' + this.jobs.map(j => {
        const id = j.id || j.name || 'unknown';
        const name = j.name || id;
        const schedule = j.schedule || j.cron || '\u2014';
        const active = j.enabled !== false;
        const desc = j.nextDescription || j.description || '';
        const cmd = j.command || '';
        const lastRun = j.lastRun ? new Date(j.lastRun).toLocaleString() : 'Never';
        const lastResult = j.lastResult;
        let resultHtml = '';
        if (lastResult) {
          const rColor = lastResult.ok ? 'var(--lcars-green)' : 'var(--lcars-red)';
          const rText = lastResult.ok
            ? (lastResult.summary || 'OK')
            : ('Error: ' + (lastResult.error || 'unknown'));
          resultHtml = '<div class="cron-last-result" style="color:' + rColor + ';">'
            + escapeHtml(rText.length > 120 ? rText.slice(0, 117) + '...' : rText)
            + '</div>';
        }
        return '<div class="cron-card ' + (active ? '' : 'paused') + '">'
          + '<div class="cron-card-header">'
          + '<div class="cron-name">' + escapeHtml(name) + '</div>'
          + '<div class="cron-status">' + (active ? 'ACTIVE' : 'PAUSED') + '</div>'
          + '</div>'
          + '<div class="cron-schedule">' + escapeHtml(schedule) + '</div>'
          + (cmd ? '<div class="cron-command">' + escapeHtml(cmd) + '</div>' : '')
          + (desc ? '<div class="cron-desc">' + escapeHtml(desc) + '</div>' : '')
          + '<div class="cron-last-run">Last: ' + escapeHtml(lastRun) + '</div>'
          + resultHtml
          + '<div class="cron-actions">'
          + '<button class="cmd-btn btn-small cron-toggle-btn" data-id="' + escapeHtml(id) + '">' + (active ? 'Pause' : 'Resume') + '</button>'
          + '<button class="cmd-btn btn-small cron-delete-btn" data-id="' + escapeHtml(id) + '" style="background:var(--lcars-red);">Delete</button>'
          + '</div>'
          + '</div>';
      }).join('') + '</div>';
    }

    this.container.innerHTML = form
      + '<div class="lcars-divider"></div>'
      + '<div class="lcars-label">Scheduled Jobs (' + this.jobs.length + ')</div>'
      + jobsHtml
      + '<div class="lcars-divider"></div>'
      + '<div class="lcars-label">Event Log</div>'
      + '<div class="cron-event-log" id="cron-event-log"></div>';

    // Bind create button
    document.getElementById('cron-create-btn')
      ?.addEventListener('click', () => this.createJob());

    // Enter key in inputs
    ['cron-name-input', 'cron-schedule-input', 'cron-cmd-input', 'cron-desc-input'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.createJob();
      });
    });

    // Bind toggle/delete buttons
    this.container.querySelectorAll('.cron-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => this.toggleJob(btn.dataset.id));
    });
    this.container.querySelectorAll('.cron-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => this.deleteJob(btn.dataset.id));
    });

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
      '<div class="cron-event-item">'
      + '<span class="cron-event-time">[' + e.time + ']</span>'
      + '<span class="cron-event-id">' + escapeHtml(e.name || e.jobId) + '</span>'
      + '<span class="cron-event-status">' + escapeHtml(e.status) + '</span>'
      + '</div>'
    ).join('');
  }

  renderOffline() {
    if (!this.container) return;
    this.container.innerHTML = '<div class="empty-state">'
      + '<div class="empty-state-icon">&#9670;</div>'
      + '<div class="empty-state-text">Gateway not connected</div>'
      + '</div>';
  }
}
