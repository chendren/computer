import { clearEmpty, getLcarsColor } from '../utils/lcars-helpers.js';
import { formatTime, formatDate, escapeHtml } from '../utils/formatters.js';

export class LogPanel {
  constructor(api) {
    this.api = api;
    this.container = document.getElementById('log-list');

    // Submit form
    this.input = document.getElementById('log-input');
    this.categorySelect = document.getElementById('log-category');
    this.submitBtn = document.getElementById('log-submit-btn');
    this.statusEl = document.getElementById('log-status');

    if (this.submitBtn) {
      this.submitBtn.addEventListener('click', () => this.submitLog());
    }
    if (this.input) {
      this.input.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') this.submitLog();
      });
    }
  }

  async submitLog() {
    const text = this.input?.value?.trim();
    if (!text) return;

    if (this.submitBtn) {
      this.submitBtn.disabled = true;
      this.submitBtn.textContent = 'Recording...';
    }
    if (this.statusEl) this.statusEl.innerHTML = '<span class="lcars-loading"></span>';

    try {
      await this.api.post('/logs', {
        text,
        category: this.categorySelect?.value || 'personal',
      });
      if (this.input) this.input.value = '';
      if (this.statusEl) {
        this.statusEl.textContent = 'RECORDED';
        this.statusEl.style.color = '#55CC55';
        setTimeout(() => { this.statusEl.textContent = ''; }, 2000);
      }
    } catch (err) {
      if (this.statusEl) {
        this.statusEl.textContent = 'ERROR';
        this.statusEl.style.color = '#CC4444';
      }
    }

    if (this.submitBtn) {
      this.submitBtn.disabled = false;
      this.submitBtn.textContent = 'Record Log';
    }
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

    const header = document.createElement('div');
    header.className = 'log-header';

    const sdSpan = document.createElement('span');
    sdSpan.className = 'log-stardate';
    sdSpan.style.color = color;
    sdSpan.textContent = 'Stardate ' + stardate;
    header.appendChild(sdSpan);

    const catSpan = document.createElement('span');
    catSpan.className = 'log-category';
    catSpan.style.background = color;
    catSpan.textContent = category;
    header.appendChild(catSpan);

    if (data.timestamp) {
      const tsSpan = document.createElement('span');
      tsSpan.className = 'log-timestamp';
      tsSpan.textContent = formatDate(data.timestamp) + ' ' + formatTime(data.timestamp);
      header.appendChild(tsSpan);
    }

    entry.appendChild(header);

    const textDiv = document.createElement('div');
    textDiv.className = 'log-text';
    textDiv.textContent = data.text || '';
    entry.appendChild(textDiv);

    if (data.tags && data.tags.length) {
      const tagsDiv = document.createElement('div');
      tagsDiv.className = 'log-tags';
      data.tags.forEach((tag, i) => {
        const tagSpan = document.createElement('span');
        tagSpan.className = 'topic-tag';
        tagSpan.style.background = getLcarsColor(i);
        tagSpan.textContent = tag;
        tagsDiv.appendChild(tagSpan);
      });
      entry.appendChild(tagsDiv);
    }

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
