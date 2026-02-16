import { clearEmpty } from '../utils/lcars-helpers.js';

export class TranscriptPanel {
  constructor(api) {
    this.list = document.getElementById('transcript-list');
    this.api = api;
    this.interimEl = null;

    // Session controls
    const saveBtn = document.getElementById('transcript-save-btn');
    const clearBtn = document.getElementById('transcript-clear-btn');
    this.saveStatus = document.getElementById('transcript-save-status');

    if (saveBtn) saveBtn.addEventListener('click', () => this.saveSession());
    if (clearBtn) clearBtn.addEventListener('click', () => this.clearList());
  }

  _computeStardate() {
    const now = new Date();
    const year = now.getFullYear();
    const startOfYear = new Date(year, 0, 1);
    const dayOfYear = Math.floor((now - startOfYear) / 86400000);
    const dayFraction = Math.floor((dayOfYear / 365) * 1000);
    return (year - 1924) + '.' + dayFraction;
  }

  _formatTime(timestamp) {
    if (timestamp) {
      return new Date(timestamp).toLocaleTimeString('en-US', { hour12: false });
    }
    return new Date().toLocaleTimeString('en-US', { hour12: false });
  }

  _buildEntry(text, stardate, time, markup) {
    const entry = document.createElement('div');
    entry.className = 'transcript-entry';

    // Header: Stardate + time
    const header = document.createElement('div');
    header.className = 'transcript-header';

    const sdSpan = document.createElement('span');
    sdSpan.className = 'transcript-stardate';
    sdSpan.textContent = 'Stardate ' + (stardate || this._computeStardate());
    header.appendChild(sdSpan);

    const timeSpan = document.createElement('span');
    timeSpan.className = 'transcript-time';
    timeSpan.textContent = time || this._formatTime();
    header.appendChild(timeSpan);

    entry.appendChild(header);

    // Text
    const textEl = document.createElement('div');
    textEl.className = 'transcript-text';
    textEl.textContent = text || '';
    entry.appendChild(textEl);

    // Markup container
    const markupEl = document.createElement('div');
    markupEl.className = 'log-markup';
    entry.appendChild(markupEl);

    // Render existing markup if provided
    if (markup) {
      this._renderMarkup(markupEl, markup);
    }

    return entry;
  }

  _renderMarkup(container, markup) {
    container.innerHTML = '';

    const sections = [
      { key: 'issues', label: 'ISSUE', cls: 'issue' },
      { key: 'actions', label: 'ACTION', cls: 'action' },
      { key: 'outcomes', label: 'OUTCOME', cls: 'outcome' },
    ];

    for (const section of sections) {
      const items = markup[section.key];
      if (!items || !items.length) continue;

      for (const item of items) {
        const tag = document.createElement('div');
        tag.className = 'markup-tag ' + section.cls;

        const label = document.createElement('span');
        label.className = 'markup-label';
        label.textContent = section.label;
        tag.appendChild(label);

        const text = document.createElement('span');
        text.className = 'markup-text';
        text.textContent = item;
        tag.appendChild(text);

        container.appendChild(tag);
      }
    }
  }

  _showMarkupSpinner(container) {
    container.innerHTML = '<div class="markup-spinner"><span class="lcars-loading"></span> Analyzing log entry...</div>';
  }

  async _fetchMarkup(text, markupContainer) {
    if (!text || text.trim().length < 10) return;

    this._showMarkupSpinner(markupContainer);

    try {
      const markup = await this.api.post('/transcripts/markup', { text });
      const hasContent = (markup.issues && markup.issues.length) ||
                         (markup.actions && markup.actions.length) ||
                         (markup.outcomes && markup.outcomes.length);
      if (hasContent) {
        this._renderMarkup(markupContainer, markup);
      } else {
        markupContainer.innerHTML = '';
      }
    } catch {
      markupContainer.innerHTML = '';
    }
  }

  addEntry(data) {
    clearEmpty(this.list);

    const stardate = data.stardate || null;
    const time = this._formatTime(data.timestamp);
    const text = data.text || '';

    const entry = this._buildEntry(text, stardate, time, data.markup || null);
    this.list.appendChild(entry);
    this.list.scrollTop = this.list.scrollHeight;
  }

  addLiveText(text, isFinal) {
    clearEmpty(this.list);

    if (isFinal) {
      const stardate = this._computeStardate();
      const time = this._formatTime();

      if (this.interimEl) {
        // Upgrade interim element to final
        this.interimEl.style.opacity = '1';

        // Add stardate to header
        let header = this.interimEl.querySelector('.transcript-header');
        if (!header) {
          header = document.createElement('div');
          header.className = 'transcript-header';
          this.interimEl.insertBefore(header, this.interimEl.firstChild);
        }
        if (!header.querySelector('.transcript-stardate')) {
          const sdSpan = document.createElement('span');
          sdSpan.className = 'transcript-stardate';
          sdSpan.textContent = 'Stardate ' + stardate;
          header.insertBefore(sdSpan, header.firstChild);
        }

        // Update text
        const textEl = this.interimEl.querySelector('.transcript-text');
        if (textEl) textEl.textContent = text;

        // Add markup container
        let markupEl = this.interimEl.querySelector('.log-markup');
        if (!markupEl) {
          markupEl = document.createElement('div');
          markupEl.className = 'log-markup';
          this.interimEl.appendChild(markupEl);
        }

        // Save to server and fetch markup
        this.api.post('/transcripts', { text, source: 'voice', stardate }).catch(() => {});
        this._fetchMarkup(text, markupEl);

        this.interimEl = null;
      } else {
        // No interim element — create final entry directly
        const entry = this._buildEntry(text, stardate, time);
        this.list.appendChild(entry);
        this.list.scrollTop = this.list.scrollHeight;

        // Save and fetch markup
        this.api.post('/transcripts', { text, source: 'voice', stardate }).catch(() => {});
        const markupEl = entry.querySelector('.log-markup');
        if (markupEl) this._fetchMarkup(text, markupEl);
      }
    } else {
      // Interim — show partial text at half opacity
      if (!this.interimEl) {
        this.interimEl = document.createElement('div');
        this.interimEl.className = 'transcript-entry';
        this.interimEl.style.opacity = '0.5';

        const header = document.createElement('div');
        header.className = 'transcript-header';
        const timeSpan = document.createElement('span');
        timeSpan.className = 'transcript-time';
        timeSpan.textContent = this._formatTime();
        header.appendChild(timeSpan);
        this.interimEl.appendChild(header);

        const textEl = document.createElement('div');
        textEl.className = 'transcript-text';
        this.interimEl.appendChild(textEl);

        this.list.appendChild(this.interimEl);
      }
      this.interimEl.querySelector('.transcript-text').textContent = text;
      this.list.scrollTop = this.list.scrollHeight;
    }
  }

  async saveSession() {
    const entries = this.list.querySelectorAll('.transcript-entry');
    if (!entries.length) return;

    const texts = [];
    entries.forEach(function(entry) {
      const textEl = entry.querySelector('.transcript-text');
      if (textEl && textEl.textContent.trim()) {
        const sdEl = entry.querySelector('.transcript-stardate');
        const prefix = sdEl ? sdEl.textContent + ': ' : '';
        texts.push(prefix + textEl.textContent.trim());
      }
    });

    if (!texts.length) return;

    const now = new Date();
    const title = "Captain's Log " + now.toLocaleDateString('en-US') + ' ' + now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

    if (this.saveStatus) this.saveStatus.textContent = 'Saving...';

    try {
      await this.api.post('/transcripts', {
        text: texts.join('\n\n'),
        source: 'session',
        title: title,
      });
      if (this.saveStatus) this.saveStatus.textContent = 'Logged';
    } catch {
      if (this.saveStatus) this.saveStatus.textContent = 'Error';
    }

    setTimeout(() => { if (this.saveStatus) this.saveStatus.textContent = ''; }, 3000);
  }

  clearList() {
    this.list.innerHTML = '<div class="empty-state"><div class="empty-state-text">No log entries recorded, Captain</div></div>';
    this.interimEl = null;
  }

  async loadHistory() {
    try {
      const items = await this.api.get('/transcripts');
      for (const item of items.reverse()) {
        this.addEntry(item);
      }
    } catch {
      // server may not be ready
    }
  }
}
