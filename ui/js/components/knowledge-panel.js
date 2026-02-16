import { escapeHtml } from '../utils/formatters.js';
import { clearEmpty } from '../utils/lcars-helpers.js';

export class KnowledgePanel {
  constructor(api) {
    this.api = api;
    this.container = document.getElementById('knowledge-list');
    this.searchInput = document.getElementById('knowledge-search');
    this.methodSelect = document.getElementById('knowledge-search-method');
    this.searchBtn = document.getElementById('knowledge-search-btn');
    this.resultCount = document.getElementById('knowledge-result-count');
    this.viewLabel = document.getElementById('knowledge-view-label');
    this.entries = [];
    this.searchResults = [];
    this.currentView = 'entries';

    this.bindEvents();
  }

  bindEvents() {
    this.searchBtn?.addEventListener('click', () => this.performSearch());
    this.searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.performSearch();
    });

    document.querySelectorAll('.knowledge-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchView(tab.dataset.view));
    });
  }

  switchView(view) {
    this.currentView = view;
    document.querySelectorAll('.knowledge-tab').forEach(t => t.classList.remove('active'));
    const activeTab = document.querySelector(`.knowledge-tab[data-view="${view}"]`);
    if (activeTab) activeTab.classList.add('active');

    if (view === 'entries') {
      this.viewLabel.textContent = 'Knowledge Base';
      this.renderEntries();
    } else if (view === 'results') {
      this.viewLabel.textContent = 'Search Results';
      this.renderResults();
    } else if (view === 'stats') {
      this.viewLabel.textContent = 'Statistics';
      this.loadStats();
    }
  }

  async performSearch() {
    const query = this.searchInput?.value?.trim();
    if (!query) return;

    const method = this.methodSelect?.value || 'hybrid';
    const source = document.getElementById('knowledge-filter-source')?.value;
    const confidence = document.getElementById('knowledge-filter-confidence')?.value;
    const tagsRaw = document.getElementById('knowledge-filter-tags')?.value;
    const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : undefined;

    const body = { query, method, limit: 20, metadata_filter: {} };
    if (source) body.metadata_filter.source = source;
    if (confidence) body.metadata_filter.confidence = confidence;
    if (tags?.length) body.metadata_filter.tags = tags;

    // Show loading
    this.container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Searching...</div></div>';

    try {
      const data = await this.api.post('/knowledge/search', body);
      this.searchResults = data.results || [];
      this.resultCount.textContent = `${this.searchResults.length} results`;
      this.switchView('results');
    } catch (err) {
      this.container.innerHTML = `<div class="empty-state"><div class="empty-state-text">Search error: ${escapeHtml(err.message)}</div></div>`;
    }
  }

  async loadHistory() {
    try {
      const data = await this.api.get('/knowledge');
      this.entries = Array.isArray(data) ? data : (data.entries || []);
      if (this.currentView === 'entries') this.renderEntries();
    } catch {}
  }

  addEntry(data) {
    // Push notification from WebSocket
    const idx = this.entries.findIndex(e => e.id === data.id);
    if (idx >= 0) {
      this.entries[idx] = data;
    } else {
      this.entries.unshift(data);
    }
    if (this.currentView === 'entries') this.renderEntries();
  }

  renderEntries() {
    if (!this.container) return;
    if (this.entries.length === 0) {
      this.container.innerHTML = '<div class="empty-state"><div class="empty-state-text">No knowledge entries</div></div>';
      return;
    }

    this.container.innerHTML = this.entries.map(e => {
      const tags = (e.tags || []).map(t =>
        `<span class="knowledge-tag">${escapeHtml(t)}</span>`
      ).join('');
      const confClass = e.confidence === 'high' ? 'conf-high' : e.confidence === 'low' ? 'conf-low' : 'conf-medium';

      return `
        <div class="knowledge-entry" data-id="${e.id}">
          <div class="knowledge-header">
            <span class="knowledge-confidence ${confClass}">${escapeHtml(e.confidence || 'medium')}</span>
            <span class="knowledge-source">${escapeHtml(e.source || 'unknown')}</span>
            <span class="knowledge-strategy-badge">${escapeHtml(e.chunk_strategy || 'n/a')}</span>
            <span class="knowledge-chunk-count">${e.chunk_count || '?'} chunks</span>
            <span class="knowledge-time">${new Date(e.created_at || e.timestamp).toLocaleString()}</span>
          </div>
          <div class="knowledge-fact">${escapeHtml(e.title || e.original_text?.slice(0, 200) || e.fact || '')}</div>
          ${tags ? `<div class="knowledge-tags">${tags}</div>` : ''}
          <div class="knowledge-actions">
            <button class="knowledge-delete-btn" data-id="${e.id}">Delete</button>
          </div>
        </div>
      `;
    }).join('');

    // Bind delete buttons
    this.container.querySelectorAll('.knowledge-delete-btn').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (btn.disabled) return;
        const id = btn.dataset.id;
        const entry = this.entries.find(e => e.id === id);
        const title = entry?.title || entry?.original_text?.slice(0, 40) || 'this entry';
        if (!confirm('Delete "' + title + '"?')) return;
        btn.disabled = true;
        btn.textContent = 'Deleting...';
        try {
          await this.api.delete(`/knowledge/${id}`);
          this.entries = this.entries.filter(e => e.id !== id);
          this.renderEntries();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Delete';
          console.error('Delete failed:', err);
        }
      });
    });
  }

  renderResults() {
    if (!this.container) return;
    if (this.searchResults.length === 0) {
      this.container.innerHTML = '<div class="empty-state"><div class="empty-state-text">No results found</div></div>';
      return;
    }

    this.container.innerHTML = this.searchResults.map(r => {
      const tags = (r.tags || []).map(t =>
        `<span class="knowledge-tag">${escapeHtml(t)}</span>`
      ).join('');
      const scorePercent = Math.round(r.score * 100);
      const scoreColor = scorePercent > 70 ? 'var(--lcars-green)' : scorePercent > 40 ? 'var(--lcars-gold)' : 'var(--lcars-red)';

      return `
        <div class="knowledge-entry knowledge-result">
          <div class="knowledge-header">
            <span class="knowledge-score" style="background:${scoreColor}">${scorePercent}%</span>
            <span class="knowledge-method-badge">${escapeHtml(r.chunk_strategy || '')}</span>
            <span class="knowledge-source">${escapeHtml(r.source || '')}</span>
            <span class="knowledge-chunk-count">chunk ${(r.chunk_index || 0) + 1}</span>
            <span class="knowledge-time">${new Date(r.created_at).toLocaleString()}</span>
          </div>
          <div class="knowledge-result-title">${escapeHtml(r.title || '')}</div>
          <div class="knowledge-fact knowledge-chunk-preview" data-expanded="false">${escapeHtml(r.text)}</div>
          ${tags ? `<div class="knowledge-tags">${tags}</div>` : ''}
        </div>
      `;
    }).join('');

    // Toggle text expansion on click
    this.container.querySelectorAll('.knowledge-chunk-preview').forEach(el => {
      el.addEventListener('click', () => {
        const expanded = el.dataset.expanded === 'true';
        el.dataset.expanded = expanded ? 'false' : 'true';
        el.classList.toggle('expanded', !expanded);
      });
    });
  }

  async loadStats() {
    if (!this.container) return;
    this.container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Loading stats...</div></div>';

    try {
      const stats = await this.api.get('/knowledge/stats');
      this.renderStats(stats);
    } catch (err) {
      this.container.innerHTML = `<div class="empty-state"><div class="empty-state-text">Error: ${escapeHtml(err.message)}</div></div>`;
    }
  }

  renderStats(stats) {
    if (!this.container) return;

    const strategyRows = Object.entries(stats.by_strategy || {}).map(([k, v]) =>
      `<div class="knowledge-stat-row"><span class="stat-label">${escapeHtml(k)}</span><span class="stat-value">${v}</span></div>`
    ).join('') || '<div class="dash-empty">None</div>';

    const sourceRows = Object.entries(stats.by_source || {}).map(([k, v]) =>
      `<div class="knowledge-stat-row"><span class="stat-label">${escapeHtml(k)}</span><span class="stat-value">${v}</span></div>`
    ).join('') || '<div class="dash-empty">None</div>';

    const confRows = Object.entries(stats.by_confidence || {}).map(([k, v]) =>
      `<div class="knowledge-stat-row"><span class="stat-label">${escapeHtml(k)}</span><span class="stat-value">${v}</span></div>`
    ).join('') || '<div class="dash-empty">None</div>';

    this.container.innerHTML = `
      <div class="knowledge-stats-grid">
        <div class="knowledge-stat-card">
          <div class="knowledge-stat-value">${stats.total_entries || 0}</div>
          <div class="knowledge-stat-label">Entries</div>
        </div>
        <div class="knowledge-stat-card">
          <div class="knowledge-stat-value">${stats.total_chunks || 0}</div>
          <div class="knowledge-stat-label">Chunks</div>
        </div>
        <div class="knowledge-stat-card">
          <div class="knowledge-stat-value">${stats.avg_chunks_per_entry || 0}</div>
          <div class="knowledge-stat-label">Avg Chunks/Entry</div>
        </div>
        <div class="knowledge-stat-card">
          <div class="knowledge-stat-value">${stats.vector_dimensions || 768}</div>
          <div class="knowledge-stat-label">Vector Dims</div>
        </div>
      </div>
      <div class="knowledge-stats-breakdown">
        <div class="knowledge-stats-section">
          <div class="knowledge-stats-title">By Strategy</div>
          ${strategyRows}
        </div>
        <div class="knowledge-stats-section">
          <div class="knowledge-stats-title">By Source</div>
          ${sourceRows}
        </div>
        <div class="knowledge-stats-section">
          <div class="knowledge-stats-title">By Confidence</div>
          ${confRows}
        </div>
      </div>
      <div class="knowledge-stats-footer">
        <span class="knowledge-stats-model">Model: ${escapeHtml(stats.embedding_model || 'nomic-embed-text')}</span>
        <span class="knowledge-stats-ollama">Ollama: ${stats.ollama_status || 'unknown'}</span>
      </div>
    `;
  }
}
