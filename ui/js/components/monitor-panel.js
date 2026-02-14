import { clearEmpty } from '../utils/lcars-helpers.js';
import { formatTime, escapeHtml } from '../utils/formatters.js';

export class MonitorPanel {
  constructor(api) {
    this.api = api;
    this.container = document.getElementById('monitor-list');
    this.monitors = new Map();
  }

  display(data) {
    clearEmpty(this.container);

    const id = data.name || data.id;

    // Update existing monitor card or create new
    let card = this.monitors.get(id);
    if (card) {
      card.remove();
    }

    card = document.createElement('div');
    card.className = 'monitor-card';
    this.monitors.set(id, card);

    const statusColors = {
      active: '#55CC55',
      ok: '#55CC55',
      triggered: '#FFCC00',
      warning: '#FFCC00',
      alert: '#CC4444',
      error: '#CC4444',
      stopped: '#996600',
    };

    const status = data.status || (data.lastCheck && data.lastCheck.status) || 'active';
    const statusColor = statusColors[status] || '#996600';

    let html = `<div class="monitor-header">`;
    html += `<span class="monitor-status-dot" style="background:${statusColor}"></span>`;
    html += `<span class="monitor-name">${escapeHtml(data.name || id)}</span>`;
    html += `<span class="monitor-type">${escapeHtml(data.target?.type || 'unknown')}</span>`;
    html += `</div>`;

    html += `<div class="monitor-target">${escapeHtml(data.target?.value || '')}</div>`;

    if (data.interval) {
      html += `<div class="monitor-meta">Interval: ${escapeHtml(data.interval)}</div>`;
    }

    if (data.lastCheck) {
      const lc = data.lastCheck;
      html += `<div class="monitor-last-check">`;
      html += `<span class="monitor-check-status" style="color:${statusColors[lc.status] || '#996600'}">${escapeHtml(lc.status || 'unknown').toUpperCase()}</span>`;
      if (lc.timestamp) html += ` <span class="monitor-check-time">${formatTime(lc.timestamp)}</span>`;
      if (lc.detail) html += `<div class="monitor-check-detail">${escapeHtml(lc.detail)}</div>`;
      html += `</div>`;
    }

    if (data.conditions && data.conditions.length) {
      html += `<div class="monitor-conditions">`;
      data.conditions.forEach(c => {
        html += `<div class="monitor-condition">${escapeHtml(c.check)}: ${escapeHtml(c.threshold)}</div>`;
      });
      html += `</div>`;
    }

    if (data.history && data.history.length) {
      html += `<div class="monitor-history-label">Recent Checks</div>`;
      html += `<div class="monitor-history">`;
      data.history.slice(0, 10).forEach(h => {
        const hColor = statusColors[h.status] || '#996600';
        html += `<div class="monitor-history-item">`;
        html += `<span class="monitor-history-dot" style="background:${hColor}"></span>`;
        if (h.timestamp) html += `<span class="monitor-history-time">${formatTime(h.timestamp)}</span>`;
        html += `<span class="monitor-history-detail">${escapeHtml(h.detail || h.status)}</span>`;
        html += `</div>`;
      });
      html += `</div>`;
    }

    card.innerHTML = html;
    this.container.insertBefore(card, this.container.firstChild);
  }

  async loadHistory() {
    try {
      const items = await this.api.get('/monitors');
      for (const item of items) {
        this.display(item);
      }
    } catch {}
  }
}
