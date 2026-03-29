import { escapeHtml, nowTime } from '../utils/formatters.js';
import { clearEmpty } from '../utils/lcars-helpers.js';

export class DashboardPanel {
  constructor(api, ws) {
    this.api = api;
    this.ws = ws;
    this.container = document.getElementById('dashboard-content');
    this.activity = [];
    this.maxActivity = 20;

    // Live widget data
    this.widgetData = {
      system: null,
      weather: null,
      calendar: null,
      timers: null,
    };
    this._timerInterval = null;
    this._widgetIntervals = [];

    // Track all incoming events as activity
    const types = ['transcript', 'analysis', 'chart', 'search', 'log', 'monitor', 'comparison', 'knowledge'];
    types.forEach(type => {
      this.ws.on(type, (data) => {
        this.addActivity(type, data);
        this.render();
      });
    });

    // Track gateway events
    this.ws.on('channel_message', (data) => {
      this.addActivity('channel', data);
      this.render();
    });
    this.ws.on('cron_event', (data) => {
      this.addActivity('cron', data);
      this.render();
    });
    this.ws.on('node_event', (data) => {
      this.addActivity('node', data);
      this.render();
    });

    this._startWidgetRefresh();
  }

  addActivity(type, data) {
    this.activity.unshift({
      type,
      title: data.title || data.name || data.fact || data.text?.slice(0, 60) || type,
      timestamp: data.timestamp || new Date().toISOString(),
    });
    if (this.activity.length > this.maxActivity) this.activity.pop();
  }

  _startWidgetRefresh() {
    this._fetchSystemInfo();
    this._fetchWeather();
    this._fetchCalendar();
    this._fetchTimers();

    this._widgetIntervals.push(setInterval(() => this._fetchSystemInfo(), 30000));
    this._widgetIntervals.push(setInterval(() => this._fetchWeather(), 600000));
    this._widgetIntervals.push(setInterval(() => this._fetchCalendar(), 300000));
    this._widgetIntervals.push(setInterval(() => this._fetchTimers(), 2000));
  }

  async _fetchSystemInfo() {
    try {
      const data = await this.api.get('/system-info');
      this.widgetData.system = data;
      this._renderWidgets();
    } catch {}
  }

  async _fetchWeather() {
    try {
      const data = await this.api.get('/weather');
      if (!data.error) {
        this.widgetData.weather = data;
        this._renderWidgets();
      }
    } catch {}
  }

  async _fetchCalendar() {
    try {
      const data = await this.api.get('/calendar/next');
      this.widgetData.calendar = data;
      this._renderWidgets();
    } catch {}
  }

  async _fetchTimers() {
    try {
      const data = await this.api.get('/timers');
      this.widgetData.timers = data;
      this._renderWidgets();
    } catch {}
  }

  _formatTimerRemaining(secs) {
    if (secs <= 0) return 'COMPLETE';
    const m = Math.floor(secs / 60);
    const s = secs - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  _renderWidgets() {
    const container = this.container?.querySelector('.dash-widgets');
    if (!container) return;

    const sys = this.widgetData.system;
    const wx = this.widgetData.weather;
    const cal = this.widgetData.calendar;
    const tmr = this.widgetData.timers;

    let cpuShort = '';
    if (sys) {
      const model = sys.cpu.model;
      if (model.includes('Apple')) {
        cpuShort = model.split(' ').filter(p => p.startsWith('M') || p === 'Apple' || p === 'Pro' || p === 'Max' || p === 'Ultra').join(' ');
      } else {
        cpuShort = model.split(' ').slice(0, 3).join(' ');
      }
    }

    const dayName = (dateStr) => {
      const d = new Date(dateStr + 'T12:00:00');
      const today = new Date();
      if (d.toDateString() === today.toDateString()) return 'Today';
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      if (d.toDateString() === tomorrow.toDateString()) return 'Tmrw';
      return d.toLocaleDateString('en-US', { weekday: 'short' });
    };

    // Build each widget's content, then set via textContent where possible
    // and structured DOM for the rest (matches existing pattern in this file)
    const widgetEls = container.querySelectorAll('.dash-widget');
    const systemEl = container.querySelector('.dash-widget-system .dash-widget-body');
    const weatherEl = container.querySelector('.dash-widget-weather .dash-widget-body');
    const calendarEl = container.querySelector('.dash-widget-calendar .dash-widget-body');
    const timersEl = container.querySelector('.dash-widget-timers .dash-widget-body');

    if (systemEl) {
      if (sys) {
        this._setWidgetContent(systemEl, [
          { label: 'CPU', value: sys.cpu.cores + ' cores ' + cpuShort },
          { label: 'RAM', value: sys.memory.used + '/' + sys.memory.total + ' GB' },
          { label: 'Load', value: sys.loadAvg.join(' / ') },
          { label: 'Uptime', value: sys.uptime },
        ]);
      } else {
        systemEl.textContent = 'Scanning...';
        systemEl.className = 'dash-widget-body dash-widget-loading';
      }
    }

    if (weatherEl) {
      if (wx) {
        const rows = [];
        rows.push({ label: wx.current.temperature + '\u00B0F', value: wx.current.description, cls: 'dash-widget-weather-hero' });
        rows.push({ label: 'Location', value: wx.location });
        rows.push({ label: 'Feels', value: wx.current.feelsLike + '\u00B0F  Wind ' + wx.current.wind + ' mph' });
        if (wx.forecast.length > 0) {
          const fStr = wx.forecast.map(f => dayName(f.day) + ' ' + f.high + '\u00B0/' + f.low + '\u00B0').join('  ');
          rows.push({ label: 'Forecast', value: fStr });
        }
        this._setWidgetContent(weatherEl, rows);
      } else {
        weatherEl.textContent = 'Scanning...';
        weatherEl.className = 'dash-widget-body dash-widget-loading';
      }
    }

    if (calendarEl) {
      if (cal) {
        if (cal.error) {
          calendarEl.textContent = cal.error;
          calendarEl.className = 'dash-widget-body dash-widget-dim';
        } else if (cal.next) {
          const rows = [
            { label: 'Next', value: cal.next.summary + ' at ' + cal.next.startTime },
          ];
          if (cal.count > 1) {
            rows.push({ label: '', value: (cal.count - 1) + ' more event' + (cal.count > 2 ? 's' : '') + ' today' });
          }
          this._setWidgetContent(calendarEl, rows);
        } else {
          calendarEl.textContent = 'No upcoming events';
          calendarEl.className = 'dash-widget-body dash-widget-dim';
        }
      } else {
        calendarEl.textContent = 'Scanning...';
        calendarEl.className = 'dash-widget-body dash-widget-loading';
      }
    }

    if (timersEl) {
      if (tmr && tmr.count > 0) {
        const rows = tmr.timers.map(t => ({
          label: this._formatTimerRemaining(t.remainingSecs),
          value: t.label || 'Timer',
          cls: t.remainingSecs <= 10 ? 'dash-widget-timer-urgent' : '',
        }));
        this._setWidgetContent(timersEl, rows);
      } else {
        timersEl.textContent = 'No active timers';
        timersEl.className = 'dash-widget-body dash-widget-dim';
      }
    }
  }

  _setWidgetContent(el, rows) {
    el.className = 'dash-widget-body';
    while (el.firstChild) el.removeChild(el.firstChild);
    for (const row of rows) {
      const div = document.createElement('div');
      div.className = 'dash-widget-row' + (row.cls ? ' ' + row.cls : '');
      const labelSpan = document.createElement('span');
      labelSpan.className = 'dash-widget-label';
      labelSpan.textContent = row.label;
      const valueSpan = document.createElement('span');
      valueSpan.className = 'dash-widget-value';
      valueSpan.textContent = row.value;
      div.appendChild(labelSpan);
      div.appendChild(valueSpan);
      el.appendChild(div);
    }
  }

  async loadHistory() {
    try {
      const [analyses, logs, monitors, knowledge, health, security, gmail] = await Promise.allSettled([
        this.api.get('/analyses'),
        this.api.get('/logs'),
        this.api.get('/monitors'),
        this.api.get('/knowledge'),
        this.api.get('/health'),
        this.api.get('/security/stats'),
        this.api.get('/gmail/status'),
      ]);
      this.cachedData = {
        analyses: analyses.status === 'fulfilled' ? analyses.value : [],
        logs: logs.status === 'fulfilled' ? logs.value : [],
        monitors: monitors.status === 'fulfilled' ? monitors.value : [],
        knowledge: knowledge.status === 'fulfilled' ? knowledge.value : [],
        health: health.status === 'fulfilled' ? health.value : null,
        security: security.status === 'fulfilled' ? security.value : null,
        gmail: gmail.status === 'fulfilled' ? gmail.value : null,
      };

      // If Gmail connected, fetch inbox preview
      if (this.cachedData.gmail?.connected) {
        try {
          const inbox = await this.api.get('/gmail/inbox?max=5');
          this.cachedData.gmailInbox = inbox;
        } catch {
          this.cachedData.gmailInbox = null;
        }
      }
      this.render();
    } catch {}
  }

  render() {
    if (!this.container) return;
    clearEmpty(this.container);
    const d = this.cachedData || { analyses: [], logs: [], monitors: [], knowledge: [], health: null, security: null, gmail: null, gmailInbox: null };

    const activeMonitors = d.monitors.filter(m => m.status === 'active' || m.status === 'watching');
    const alertMonitors = d.monitors.filter(m => m.status === 'alert' || m.status === 'triggered');
    const recentLogs = d.logs.slice(0, 5);
    const recentAnalyses = d.analyses.slice(0, 3);

    const gw = d.health?.gateway || {};
    const sec = d.security || {};

    this.container.textContent = '';

    // Live widgets section
    const widgetSection = document.createElement('div');
    widgetSection.className = 'dash-widgets';

    const widgetNames = [
      { cls: 'dash-widget-system', title: 'System', dotColor: '' },
      { cls: 'dash-widget-weather', title: 'Weather', dotColor: 'var(--lcars-light-blue)' },
      { cls: 'dash-widget-calendar', title: 'Calendar', dotColor: 'var(--lcars-gold)' },
      { cls: 'dash-widget-timers', title: 'Timers', dotColor: 'var(--lcars-blue)' },
    ];

    for (const w of widgetNames) {
      const widget = document.createElement('div');
      widget.className = 'dash-widget ' + w.cls;

      const titleDiv = document.createElement('div');
      titleDiv.className = 'dash-widget-title';
      const dot = document.createElement('span');
      dot.className = 'dash-widget-dot';
      if (w.dotColor) dot.style.background = w.dotColor;
      titleDiv.appendChild(dot);
      titleDiv.appendChild(document.createTextNode(' ' + w.title));

      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'dash-widget-body dash-widget-loading';
      bodyDiv.textContent = 'Scanning...';

      widget.appendChild(titleDiv);
      widget.appendChild(bodyDiv);
      widgetSection.appendChild(widget);
    }

    this.container.appendChild(widgetSection);

    // Render widget data into the freshly created elements
    this._renderWidgets();

    // Main dashboard grid (existing content)
    const gridDiv = document.createElement('div');
    gridDiv.className = 'dash-grid';
    gridDiv.insertAdjacentHTML('beforeend', `
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

        <div class="dash-card dash-gateway">
          <div class="dash-card-title">Gateway</div>
          <div class="dash-stat-row">
            <div class="dash-stat">
              <div class="dash-stat-value" style="color: ${gw.connected ? 'var(--lcars-green)' : gw.running ? 'var(--lcars-gold)' : 'var(--lcars-red)'}">
                ${gw.connected ? 'ON' : gw.running ? 'RUN' : 'OFF'}
              </div>
              <div class="dash-stat-label">Status</div>
            </div>
            <div class="dash-stat">
              <div class="dash-stat-value">${sec.totalRedactions || 0}</div>
              <div class="dash-stat-label">Redacted</div>
            </div>
            <div class="dash-stat">
              <div class="dash-stat-value">${sec.patternCount || 26}</div>
              <div class="dash-stat-label">Patterns</div>
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

        ${d.gmail?.connected ? `
        <div class="dash-card dash-gmail" data-panel="channels">
          <div class="dash-gmail-header">
            <div class="dash-card-title">Communications</div>
            ${d.gmailInbox?.messages ? (() => {
              const unread = (d.gmailInbox.messages || []).filter(m => m.unread).length;
              return unread > 0
                ? `<div class="dash-gmail-badge">${unread} NEW</div>`
                : `<div class="dash-gmail-badge" style="color:var(--lcars-green);background:rgba(68,204,68,0.1)">CLEAR</div>`;
            })() : ''}
          </div>
          ${(() => {
            const inbox = d.gmailInbox;
            if (!inbox || !inbox.messages) return '<div class="dash-empty">Loading...</div>';
            const msgs = inbox.messages || [];
            const unread = msgs.filter(m => m.unread).length;
            const important = msgs.filter(m => {
              const labels = (m.labels || []).join(' ');
              return !labels.includes('CATEGORY_PROMOTIONS') && !labels.includes('CATEGORY_SOCIAL');
            });
            const display = important.length > 0 ? important.slice(0, 4) : msgs.slice(0, 3);
            return `
              <div class="dash-stat-row">
                <div class="dash-stat">
                  <div class="dash-stat-value" style="color: ${unread > 0 ? 'var(--lcars-gold)' : 'var(--lcars-green)'}">${unread}</div>
                  <div class="dash-stat-label">Unread</div>
                </div>
                <div class="dash-stat">
                  <div class="dash-stat-value">${inbox.total || msgs.length}</div>
                  <div class="dash-stat-label">Total</div>
                </div>
                <div class="dash-stat">
                  <div class="dash-stat-value">${msgs.length - important.length}</div>
                  <div class="dash-stat-label">Promos</div>
                </div>
              </div>
              ${display.map(m => {
                const from = (m.from || '').split('<')[0].trim() || 'unknown';
                const subject = (m.subject || '(no subject)').slice(0, 45);
                return `<div class="dash-gmail-msg">
                  <span class="dash-gmail-from" style="color: ${m.unread ? 'var(--lcars-gold)' : 'var(--lcars-text-dim)'}">${escapeHtml(from.slice(0, 18))}</span>
                  <span class="dash-gmail-subject">${escapeHtml(subject)}</span>
                </div>`;
              }).join('')}
            `;
          })()}
        </div>
        ` : ''}
    `);
    this.container.appendChild(gridDiv);

    // Click handler for Gmail card
    const gmailCard = this.container.querySelector('.dash-gmail[data-panel]');
    if (gmailCard) {
      gmailCard.style.cursor = 'pointer';
      gmailCard.addEventListener('click', () => {
        const btn = document.querySelector('.lcars-button[data-panel="channels"]');
        if (btn) btn.click();
      });
    }
  }
}
