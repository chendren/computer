import { escapeHtml } from '../utils/formatters.js';
import { clearEmpty } from '../utils/lcars-helpers.js';

export class PluginsPanel {
  constructor(api, ws) {
    this.api = api;
    this.ws = ws;
    this.container = document.getElementById('plugins-content');
    this.plugins = [];
    this.hooks = [];
    this.tools = [];
    this.activeTab = 'plugins'; // plugins | hooks | tools
  }

  async loadHistory() {
    await Promise.allSettled([
      this.loadPlugins(),
      this.loadHooks(),
      this.loadTools(),
    ]);
    this.render();
  }

  async loadPlugins() {
    try {
      const data = await this.api.get('/gateway/plugins');
      this.plugins = data.plugins || [];
    } catch { this.plugins = []; }
  }

  async loadHooks() {
    try {
      const data = await this.api.get('/gateway/hooks');
      this.hooks = data.hooks || [];
    } catch { this.hooks = []; }
  }

  async loadTools() {
    try {
      const data = await this.api.get('/gateway/tools');
      this.tools = data.tools || [];
    } catch { this.tools = []; }
  }

  switchTab(tab) {
    this.activeTab = tab;
    this.render();
  }

  render() {
    if (!this.container) return;
    clearEmpty(this.container);

    const tabs = `<div class="knowledge-tabs">
      <button class="knowledge-tab ${this.activeTab === 'plugins' ? 'active' : ''}" data-tab="plugins">Plugins (${this.plugins.length})</button>
      <button class="knowledge-tab ${this.activeTab === 'hooks' ? 'active' : ''}" data-tab="hooks">Hooks (${this.hooks.length})</button>
      <button class="knowledge-tab ${this.activeTab === 'tools' ? 'active' : ''}" data-tab="tools">Tools (${this.tools.length})</button>
    </div>`;

    let content;
    switch (this.activeTab) {
      case 'hooks': content = this.renderHooks(); break;
      case 'tools': content = this.renderTools(); break;
      default: content = this.renderPlugins();
    }

    this.container.innerHTML = tabs + content;

    // Tab click handlers
    this.container.querySelectorAll('.knowledge-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });
  }

  renderPlugins() {
    if (!Array.isArray(this.plugins) || this.plugins.length === 0) {
      return `<div class="empty-state"><div class="empty-state-text">No plugins detected</div></div>`;
    }

    return `<div class="plugin-grid">${this.plugins.map(p => {
      const name = typeof p === 'string' ? p : (p.id || p.name || 'unknown');
      const enabled = typeof p === 'object' ? (p.enabled !== false) : true;
      const desc = typeof p === 'object' ? (p.description || '') : '';
      const hookCount = typeof p === 'object' && Array.isArray(p.hooks) ? p.hooks.length : 0;
      const toolCount = typeof p === 'object' && Array.isArray(p.tools) ? p.tools.length : 0;
      return `<div class="plugin-card ${enabled ? 'enabled' : 'disabled'}">
        <div class="plugin-header">
          <div class="plugin-name">${escapeHtml(name)}</div>
          <div class="plugin-status-badge">${enabled ? 'ACTIVE' : 'DISABLED'}</div>
        </div>
        ${desc ? `<div class="plugin-desc">${escapeHtml(desc)}</div>` : ''}
        <div class="plugin-meta">
          ${hookCount > 0 ? `<span class="plugin-meta-badge">${hookCount} hooks</span>` : ''}
          ${toolCount > 0 ? `<span class="plugin-meta-badge">${toolCount} tools</span>` : ''}
        </div>
      </div>`;
    }).join('')}</div>`;
  }

  renderHooks() {
    if (!Array.isArray(this.hooks) || this.hooks.length === 0) {
      return `<div class="empty-state"><div class="empty-state-text">No hooks registered</div></div>`;
    }

    return `<div class="hooks-list">${this.hooks.map(h => {
      const name = typeof h === 'string' ? h : (h.name || h.event || 'unknown');
      const plugin = typeof h === 'object' ? (h.plugin || h.source || '') : '';
      const priority = typeof h === 'object' ? (h.priority || 'normal') : 'normal';
      return `<div class="hook-item">
        <span class="hook-name">${escapeHtml(name)}</span>
        ${plugin ? `<span class="hook-plugin">${escapeHtml(plugin)}</span>` : ''}
        <span class="hook-priority">${escapeHtml(priority)}</span>
      </div>`;
    }).join('')}</div>`;
  }

  renderTools() {
    if (!Array.isArray(this.tools) || this.tools.length === 0) {
      return `<div class="empty-state"><div class="empty-state-text">No tools registered</div></div>`;
    }

    return `<div class="tools-list">${this.tools.map(t => {
      const name = typeof t === 'string' ? t : (t.name || t.id || 'unknown');
      const desc = typeof t === 'object' ? (t.description || '') : '';
      const plugin = typeof t === 'object' ? (t.plugin || t.source || '') : '';
      return `<div class="tool-item">
        <div class="tool-name">${escapeHtml(name)}</div>
        ${desc ? `<div class="tool-desc">${escapeHtml(desc)}</div>` : ''}
        ${plugin ? `<div class="tool-plugin">from ${escapeHtml(plugin)}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
  }

  renderOffline() {
    if (!this.container) return;
    this.container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">&#9670;</div>
      <div class="empty-state-text">Gateway not connected — plugins unavailable</div>
    </div>`;
  }
}
