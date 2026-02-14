import { escapeHtml } from '../utils/formatters.js';
import { clearEmpty } from '../utils/lcars-helpers.js';

export class KnowledgePanel {
  constructor(api) {
    this.api = api;
    this.container = document.getElementById('knowledge-list');
    this.searchInput = document.getElementById('knowledge-search');
    this.entries = [];

    if (this.searchInput) {
      this.searchInput.addEventListener('input', () => this.filterAndRender());
    }
  }

  async loadHistory() {
    try {
      this.entries = await this.api.get('/knowledge');
      this.render();
    } catch {}
  }

  addEntry(data) {
    if (!this.container) return;
    clearEmpty(this.container);

    // Update existing or prepend
    const idx = this.entries.findIndex(e => e.id === data.id);
    if (idx >= 0) {
      this.entries[idx] = data;
    } else {
      this.entries.unshift(data);
    }
    this.render();
  }

  filterAndRender() {
    const query = (this.searchInput?.value || '').toLowerCase();
    if (!query) {
      this.render();
      return;
    }
    const filtered = this.entries.filter(e => {
      const text = `${e.fact || ''} ${(e.tags || []).join(' ')} ${e.source || ''}`.toLowerCase();
      return text.includes(query);
    });
    this._renderEntries(filtered);
  }

  render() {
    this._renderEntries(this.entries);
  }

  _renderEntries(entries) {
    if (!this.container) return;
    if (entries.length === 0) {
      this.container.innerHTML = '<div class="empty-state"><div class="empty-state-text">No knowledge entries</div></div>';
      return;
    }

    this.container.innerHTML = entries.map(e => {
      const tags = (e.tags || []).map(t =>
        `<span class="knowledge-tag">${escapeHtml(t)}</span>`
      ).join('');

      const confidenceClass = e.confidence === 'high' ? 'conf-high' : e.confidence === 'low' ? 'conf-low' : 'conf-medium';

      return `
        <div class="knowledge-entry">
          <div class="knowledge-header">
            <span class="knowledge-confidence ${confidenceClass}">${escapeHtml(e.confidence || 'medium')}</span>
            <span class="knowledge-source">${escapeHtml(e.source || 'unknown')}</span>
            <span class="knowledge-time">${new Date(e.timestamp).toLocaleString()}</span>
          </div>
          <div class="knowledge-fact">${escapeHtml(e.fact || e.text || JSON.stringify(e))}</div>
          ${tags ? `<div class="knowledge-tags">${tags}</div>` : ''}
        </div>
      `;
    }).join('');
  }
}
