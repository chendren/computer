import { escapeHtml } from '../utils/formatters.js';
import { clearEmpty } from '../utils/lcars-helpers.js';

export class SecurityPanel {
  constructor(api, ws) {
    this.api = api;
    this.ws = ws;
    this.container = document.getElementById('security-content');
  }

  async loadHistory() {
    try {
      const stats = await this.api.get('/security/stats');
      this.render(stats);
    } catch {
      this.renderOffline();
    }
  }

  render(stats) {
    if (!this.container) return;
    clearEmpty(this.container);

    const total = stats.total_redactions || stats.totalRedactions || 0;
    const recent = stats.recent_redactions || stats.recentRedactions || [];

    this.container.innerHTML = `
      <div class="security-score-display">
        <div class="shield-gauge">
          <div class="shield-value">${total}</div>
          <div class="shield-label">Threats Neutralized</div>
        </div>
      </div>
      <div class="security-stats-grid">
        <div class="stat-card"><div class="stat-label">Total Scans</div><div class="stat-value">${total}</div></div>
        <div class="stat-card"><div class="stat-label">Patterns Active</div><div class="stat-value">${stats.patterns_loaded || stats.patternCount || 26}</div></div>
        <div class="stat-card"><div class="stat-label">Recent Events</div><div class="stat-value">${recent.length}</div></div>
      </div>
      <div class="lcars-divider"></div>
      <div class="lcars-label">Recent Redactions</div>
      <div class="security-log">
        ${recent.length > 0 ? recent.slice(0, 20).map(r => `
          <div class="security-log-item">
            <span class="log-time">${new Date(r.timestamp).toLocaleTimeString()}</span>
            <span class="log-pattern">${escapeHtml(r.pattern || r.type || 'secret')}</span>
            <span class="log-path">${escapeHtml(r.path || '')}</span>
          </div>`).join('') : '<div class="empty-state"><div class="empty-state-text">No redactions recorded</div></div>'}
      </div>
    `;
  }

  renderOffline() {
    if (!this.container) return;
    this.container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">&#9670;</div>
      <div class="empty-state-text">Security stats unavailable</div>
    </div>`;
  }
}
