import { clearEmpty, getLcarsColor } from '../utils/lcars-helpers.js';
import { formatTime, formatDate, escapeHtml } from '../utils/formatters.js';

export class LogPanel {
  constructor(api) {
    this.api = api;
    this.container = document.getElementById('log-list');
  }

  addEntry(data) {
    clearEmpty(this.container);

    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const stardate = data.stardate || '';
    const category = data.category || 'personal';
    const categoryColors = {
      personal: '#FF9900',
      mission: '#9999FF',
      technical: '#CC99CC',
      observation: '#99CCFF',
    };
    const color = categoryColors[category] || '#FF9900';

    let html = `<div class="log-header">`;
    html += `<span class="log-stardate" style="color:${color}">Stardate ${escapeHtml(stardate)}</span>`;
    html += `<span class="log-category" style="background:${color}">${escapeHtml(category)}</span>`;
    if (data.timestamp) {
      html += `<span class="log-timestamp">${formatDate(data.timestamp)} ${formatTime(data.timestamp)}</span>`;
    }
    html += `</div>`;
    html += `<div class="log-text">${escapeHtml(data.text || '')}</div>`;

    if (data.tags && data.tags.length) {
      html += `<div class="log-tags">`;
      data.tags.forEach((tag, i) => {
        html += `<span class="topic-tag" style="background:${getLcarsColor(i)}">${escapeHtml(tag)}</span>`;
      });
      html += `</div>`;
    }

    entry.innerHTML = html;
    this.container.insertBefore(entry, this.container.firstChild);
  }

  async loadHistory() {
    try {
      const items = await this.api.get('/logs');
      for (const item of items) {
        this.addEntry(item);
      }
    } catch {}
  }
}
