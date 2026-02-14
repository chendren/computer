import { escapeHtml, nowTime } from '../utils/formatters.js';
import { clearEmpty } from '../utils/lcars-helpers.js';

export class DashboardPanel {
  constructor(api, ws) {
    this.api = api;
    this.ws = ws;
    this.container = document.getElementById('dashboard-content');
    this.activity = [];
    this.maxActivity = 20;

    // Track all incoming events as activity
    const types = ['transcript', 'analysis', 'chart', 'search', 'log', 'monitor', 'comparison', 'knowledge'];
    types.forEach(type => {
      this.ws.on(type, (data) => {
        this.addActivity(type, data);
        this.render();
      });
    });
  }

  addActivity(type, data) {
    this.activity.unshift({
      type,
      title: data.title || data.name || data.fact || data.text?.slice(0, 60) || type,
      timestamp: data.timestamp || new Date().toISOString(),
    });
    if (this.activity.length > this.maxActivity) this.activity.pop();
  }

  async loadHistory() {
    try {
      const [analyses, logs, monitors, knowledge] = await Promise.allSettled([
        this.api.get('/analyses'),
        this.api.get('/logs'),
        this.api.get('/monitors'),
        this.api.get('/knowledge'),
      ]);
      this.cachedData = {
        analyses: analyses.status === 'fulfilled' ? analyses.value : [],
        logs: logs.status === 'fulfilled' ? logs.value : [],
        monitors: monitors.status === 'fulfilled' ? monitors.value : [],
        knowledge: knowledge.status === 'fulfilled' ? knowledge.value : [],
      };
      this.render();
    } catch {}
  }

  render() {
    if (!this.container) return;
    clearEmpty(this.container);
    const d = this.cachedData || { analyses: [], logs: [], monitors: [], knowledge: [] };

    const activeMonitors = d.monitors.filter(m => m.status === 'active' || m.status === 'watching');
    const alertMonitors = d.monitors.filter(m => m.status === 'alert' || m.status === 'triggered');
    const recentLogs = d.logs.slice(0, 5);
    const recentAnalyses = d.analyses.slice(0, 3);

    this.container.innerHTML = `
      <div class="dash-grid">
        <div class="dash-card dash-status">
          <div class="dash-card-title">System Status</div>
          <div class="dash-stat-row">
            <div class="dash-stat">
              <div class="dash-stat-value">${d.analyses.length}</div>
              <div class="dash-stat-label">Analyses</div>
            </div>
            <div class="dash-stat">
              <div class="dash-stat-value">${d.logs.length}</div>
              <div class="dash-stat-label">Log Entries</div>
            </div>
            <div class="dash-stat">
              <div class="dash-stat-value">${d.monitors.length}</div>
              <div class="dash-stat-label">Monitors</div>
            </div>
            <div class="dash-stat">
              <div class="dash-stat-value">${d.knowledge.length}</div>
              <div class="dash-stat-label">Knowledge</div>
            </div>
          </div>
        </div>

        <div class="dash-card dash-monitors">
          <div class="dash-card-title">Monitor Status</div>
          ${alertMonitors.length > 0 ? `
            <div class="dash-alert">${alertMonitors.length} ALERT${alertMonitors.length > 1 ? 'S' : ''}</div>
          ` : ''}
          <div class="dash-monitor-summary">
            <span class="dash-monitor-active">${activeMonitors.length} active</span>
            <span class="dash-monitor-total">${d.monitors.length} total</span>
          </div>
          ${d.monitors.slice(0, 4).map(m => `
            <div class="dash-monitor-item">
              <span class="dash-dot" style="background:${m.status === 'alert' ? 'var(--lcars-red)' : m.status === 'active' || m.status === 'watching' ? 'var(--lcars-green)' : 'var(--lcars-text-dim)'}"></span>
              <span class="dash-monitor-name">${escapeHtml(m.name || 'Monitor')}</span>
            </div>
          `).join('')}
        </div>

        <div class="dash-card dash-recent-logs">
          <div class="dash-card-title">Recent Logs</div>
          ${recentLogs.length === 0 ? '<div class="dash-empty">No log entries</div>' : ''}
          ${recentLogs.map(l => `
            <div class="dash-log-item">
              <span class="dash-log-time">${new Date(l.timestamp).toLocaleTimeString()}</span>
              <span class="dash-log-text">${escapeHtml((l.entry || l.text || '').slice(0, 80))}</span>
            </div>
          `).join('')}
        </div>

        <div class="dash-card dash-recent-analyses">
          <div class="dash-card-title">Recent Analyses</div>
          ${recentAnalyses.length === 0 ? '<div class="dash-empty">No analyses</div>' : ''}
          ${recentAnalyses.map(a => `
            <div class="dash-analysis-item">
              <span class="dash-analysis-title">${escapeHtml(a.title || 'Analysis')}</span>
              <span class="dash-analysis-time">${new Date(a.timestamp).toLocaleDateString()}</span>
            </div>
          `).join('')}
        </div>

        <div class="dash-card dash-activity">
          <div class="dash-card-title">Activity Feed</div>
          ${this.activity.length === 0 ? '<div class="dash-empty">No recent activity</div>' : ''}
          ${this.activity.slice(0, 10).map(a => `
            <div class="dash-activity-item">
              <span class="dash-activity-type">${a.type}</span>
              <span class="dash-activity-title">${escapeHtml(String(a.title).slice(0, 50))}</span>
              <span class="dash-activity-time">${new Date(a.timestamp).toLocaleTimeString()}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
}
