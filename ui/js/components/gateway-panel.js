import { escapeHtml, formatUptime } from '../utils/formatters.js';
import { clearEmpty } from '../utils/lcars-helpers.js';

export class GatewayPanel {
  constructor(api, ws) {
    this.api = api;
    this.ws = ws;
    this.container = document.getElementById('gateway-content');
    this.status = null;
    this.activeTab = 'overview'; // overview | sessions | agents | models
    this.sessions = [];
    this.agents = [];
    this.models = [];
    this.selectedSession = null;
    this.sessionHistory = null;
    this.sessionCost = null;

    this.ws.on('gateway_status', (data) => {
      this.updateConnectionStatus(data);
    });

    this.ws.on('gateway_presence', (data) => {
      this.updatePresence(data);
    });
  }

  async loadHistory() {
    try {
      this.status = await this.api.get('/gateway/status');
    } catch {
      this.status = null;
    }
    await Promise.allSettled([
      this.loadSessions(),
      this.loadAgents(),
      this.loadModels(),
    ]);
    this.render();
  }

  async loadSessions() {
    try {
      const data = await this.api.get('/gateway/sessions');
      this.sessions = Array.isArray(data.sessions) ? data.sessions : [];
    } catch { this.sessions = []; }
  }

  async loadAgents() {
    try {
      const data = await this.api.get('/gateway/agents');
      this.agents = data.agents || [];
    } catch { this.agents = []; }
  }

  async loadModels() {
    try {
      const data = await this.api.get('/gateway/models');
      this.models = data.models || [];
    } catch { this.models = []; }
  }

  updateConnectionStatus(data) {
    if (!this.status) this.status = {};
    this.status.client = { connected: data.connected };
    this.render();
  }

  updatePresence(data) {
    if (this.status) {
      this.status.presence = data;
      this.render();
    }
  }

  async restart() {
    try {
      await this.api.post('/gateway/restart');
      setTimeout(() => this.loadHistory(), 5000);
    } catch (err) {
      console.error('Gateway restart failed:', err);
    }
  }

  async viewSessionHistory(sessionKey) {
    this.selectedSession = sessionKey;
    this.sessionHistory = null;
    this.sessionCost = null;
    this.render();
    try {
      const [histRes, costRes] = await Promise.allSettled([
        this.api.get(`/gateway/sessions/${encodeURIComponent(sessionKey)}/history`),
        this.api.get(`/gateway/sessions/${encodeURIComponent(sessionKey)}/cost`),
      ]);
      this.sessionHistory = histRes.status === 'fulfilled' ? histRes.value.history : null;
      this.sessionCost = costRes.status === 'fulfilled' ? costRes.value.cost : null;
    } catch {}
    this.render();
  }

  async resetSession(sessionKey) {
    try {
      await this.api.post(`/gateway/sessions/${encodeURIComponent(sessionKey)}/reset`);
      this.selectedSession = null;
      this.sessionHistory = null;
      await this.loadSessions();
      this.render();
    } catch (err) {
      console.error('Session reset failed:', err);
    }
  }

  switchTab(tab) {
    this.activeTab = tab;
    this.selectedSession = null;
    this.sessionHistory = null;
    this.render();
  }

  render() {
    if (!this.container || !this.status) { this.renderOffline(); return; }
    clearEmpty(this.container);
    const proc = this.status.process || {};
    const client = this.status.client || {};
    const config = this.status.config || {};

    const connected = client.connected;
    const statusText = connected ? 'CONNECTED' : proc.running ? 'RUNNING (not connected)' : 'OFFLINE';
    const statusClass = connected ? 'status-online' : proc.running ? 'status-warning' : 'status-offline';

    const tabs = `<div class="knowledge-tabs">
      <button class="knowledge-tab ${this.activeTab === 'overview' ? 'active' : ''}" data-tab="overview">Overview</button>
      <button class="knowledge-tab ${this.activeTab === 'sessions' ? 'active' : ''}" data-tab="sessions">Sessions (${this.sessions.length})</button>
      <button class="knowledge-tab ${this.activeTab === 'agents' ? 'active' : ''}" data-tab="agents">Agents (${this.agents.length})</button>
      <button class="knowledge-tab ${this.activeTab === 'models' ? 'active' : ''}" data-tab="models">Models (${this.models.length})</button>
    </div>`;

    let content;
    switch (this.activeTab) {
      case 'sessions': content = this.renderSessions(); break;
      case 'agents': content = this.renderAgents(); break;
      case 'models': content = this.renderModels(); break;
      default: content = this.renderOverview(proc, config);
    }

    this.container.innerHTML = `
      <div class="gateway-status-header">
        <div class="gateway-status-indicator ${statusClass}">
          <div class="warp-core ${connected ? 'active' : ''}"></div>
          <span>${statusText}</span>
        </div>
        <button class="cmd-btn" id="gateway-restart-btn">Restart</button>
      </div>
      ${tabs}
      ${content}
    `;

    document.getElementById('gateway-restart-btn')
      ?.addEventListener('click', () => this.restart());

    this.container.querySelectorAll('.knowledge-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });

    // Session action buttons
    this.container.querySelectorAll('.session-view-btn').forEach(btn => {
      btn.addEventListener('click', () => this.viewSessionHistory(btn.dataset.key));
    });
    this.container.querySelectorAll('.session-reset-btn').forEach(btn => {
      btn.addEventListener('click', () => this.resetSession(btn.dataset.key));
    });

    // Session detail back button
    const backBtn = document.getElementById('session-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.selectedSession = null;
        this.sessionHistory = null;
        this.render();
      });
    }
  }

  renderOverview(proc, config) {
    return `
      <div class="gateway-stats-grid">
        <div class="stat-card"><div class="stat-label">PID</div><div class="stat-value">${proc.pid || '—'}</div></div>
        <div class="stat-card"><div class="stat-label">Port</div><div class="stat-value">${proc.port || '—'}</div></div>
        <div class="stat-card"><div class="stat-label">Uptime</div><div class="stat-value">${proc.uptime ? formatUptime(proc.uptime) : '—'}</div></div>
        <div class="stat-card"><div class="stat-label">Channels</div><div class="stat-value">${config.channels || '—'}</div></div>
        <div class="stat-card"><div class="stat-label">Agents</div><div class="stat-value">${config.agents || this.agents.length || '—'}</div></div>
        <div class="stat-card"><div class="stat-label">Auth</div><div class="stat-value">${config.gateway?.auth || '—'}</div></div>
      </div>
      <div class="lcars-divider"></div>
      <div class="lcars-label">Connected Nodes</div>
      <div id="gateway-nodes-list" class="empty-state"><div class="empty-state-text">Loading nodes...</div></div>
    `;
  }

  renderSessions() {
    if (this.selectedSession && this.sessionHistory) {
      return this.renderSessionDetail();
    }

    if (this.sessions.length === 0) {
      return `<div class="empty-state"><div class="empty-state-text">No active sessions</div></div>`;
    }

    return this.sessions.slice(0, 30).map(s => {
      const key = typeof s === 'string' ? s : (s.key || s.id || 'unknown');
      const channel = typeof s === 'object' ? (s.channel || '') : '';
      const messages = typeof s === 'object' ? (s.messageCount || s.messages || '') : '';
      const tokens = typeof s === 'object' ? (s.totalTokens || s.tokens || '') : '';
      return `<div class="session-card">
        <div class="session-header">
          <span class="session-key">${escapeHtml(key)}</span>
          ${channel ? `<span class="session-channel">${escapeHtml(channel)}</span>` : ''}
        </div>
        <div class="session-meta">
          ${messages ? `<span>${messages} msgs</span>` : ''}
          ${tokens ? `<span>${tokens} tokens</span>` : ''}
        </div>
        <div class="session-actions">
          <button class="cmd-btn session-view-btn" data-key="${escapeHtml(key)}" style="font-size:11px;padding:4px 10px;">History</button>
          <button class="cmd-btn session-reset-btn" data-key="${escapeHtml(key)}" style="font-size:11px;padding:4px 10px;background:var(--lcars-red);">Reset</button>
        </div>
      </div>`;
    }).join('');
  }

  renderSessionDetail() {
    const history = Array.isArray(this.sessionHistory) ? this.sessionHistory : [];
    const cost = this.sessionCost;

    return `
      <div class="session-detail-header">
        <button class="cmd-btn" id="session-back-btn" style="font-size:11px;padding:4px 12px;">Back</button>
        <span class="lcars-label" style="margin:0">${escapeHtml(this.selectedSession)}</span>
        ${cost ? `<span class="session-cost">$${typeof cost === 'number' ? cost.toFixed(4) : (cost.total || cost.usd || '?')}</span>` : ''}
      </div>
      <div class="session-history">
        ${history.length === 0 ? '<div class="empty-state"><div class="empty-state-text">No history available</div></div>' : ''}
        ${history.slice(-30).map(m => {
          const role = m.role || 'unknown';
          const text = m.text || m.content || '';
          return `<div class="channel-message ${role === 'user' || role === 'human' ? 'incoming' : 'outgoing'}">
            <span class="channel-msg-from">${escapeHtml(role)}</span>
            <span class="channel-msg-text">${escapeHtml(typeof text === 'string' ? text.slice(0, 500) : JSON.stringify(text).slice(0, 500))}</span>
          </div>`;
        }).join('')}
      </div>
    `;
  }

  renderAgents() {
    if (this.agents.length === 0) {
      return `<div class="empty-state"><div class="empty-state-text">No agents configured</div></div>`;
    }

    return `<div class="plugin-grid">${this.agents.map(a => {
      const name = typeof a === 'string' ? a : (a.name || a.id || 'unknown');
      const model = typeof a === 'object' ? (a.model || '') : '';
      const channels = typeof a === 'object' && Array.isArray(a.channels) ? a.channels.join(', ') : '';
      return `<div class="plugin-card enabled">
        <div class="plugin-header">
          <div class="plugin-name">${escapeHtml(name)}</div>
          ${model ? `<div class="plugin-status-badge" style="background:var(--lcars-blue)">${escapeHtml(model)}</div>` : ''}
        </div>
        ${channels ? `<div class="plugin-desc">Channels: ${escapeHtml(channels)}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  renderModels() {
    if (this.models.length === 0) {
      return `<div class="empty-state"><div class="empty-state-text">No models available</div></div>`;
    }

    return `<div class="plugin-grid">${this.models.map(m => {
      const id = typeof m === 'string' ? m : (m.id || m.name || 'unknown');
      const provider = typeof m === 'object' ? (m.provider || '') : '';
      const caps = typeof m === 'object' && Array.isArray(m.capabilities) ? m.capabilities : [];
      return `<div class="plugin-card enabled" style="border-left-color:var(--lcars-blue)">
        <div class="plugin-header">
          <div class="plugin-name">${escapeHtml(id)}</div>
          ${provider ? `<div class="plugin-status-badge" style="background:var(--lcars-lavender)">${escapeHtml(provider)}</div>` : ''}
        </div>
        ${caps.length > 0 ? `<div class="plugin-desc">${caps.map(c => `<span class="channel-cap-badge">${escapeHtml(c)}</span>`).join('')}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  renderOffline() {
    if (!this.container) return;
    this.container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">&#9670;</div>
      <div class="empty-state-text">Gateway status unavailable</div>
    </div>`;
  }
}
