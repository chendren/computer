import { nowTime } from '../utils/formatters.js';
import { clearEmpty } from '../utils/lcars-helpers.js';

export class TranscriptPanel {
  constructor(api) {
    this.list = document.getElementById('transcript-list');
    this.api = api;
    this.interimEl = null;
  }

  addEntry(data) {
    clearEmpty(this.list);
    const entry = document.createElement('div');
    entry.className = 'transcript-entry';

    const time = data.timestamp ? new Date(data.timestamp).toLocaleTimeString('en-US', { hour12: false }) : nowTime();
    const source = data.source === 'whisper' ? `[${data.filename || 'file'}]` : '';

    entry.innerHTML = `
      <span class="transcript-time">${time} ${source}</span>
      <span class="transcript-text">${escapeText(data.text || '')}</span>
    `;
    this.list.appendChild(entry);
    this.list.scrollTop = this.list.scrollHeight;
  }

  addLiveText(text, isFinal) {
    clearEmpty(this.list);

    if (isFinal) {
      // Finalize the interim element
      if (this.interimEl) {
        this.interimEl.querySelector('.transcript-text').textContent = text;
        this.interimEl.style.opacity = '1';
        this.interimEl = null;
      } else {
        this.addEntry({ text, source: 'voice' });
      }

      // Save to server
      this.api.post('/transcripts', { text, source: 'voice' }).catch(() => {});
    } else {
      // Update or create interim element
      if (!this.interimEl) {
        this.interimEl = document.createElement('div');
        this.interimEl.className = 'transcript-entry';
        this.interimEl.style.opacity = '0.5';
        this.interimEl.innerHTML = `
          <span class="transcript-time">${nowTime()}</span>
          <span class="transcript-text"></span>
        `;
        this.list.appendChild(this.interimEl);
      }
      this.interimEl.querySelector('.transcript-text').textContent = text;
      this.list.scrollTop = this.list.scrollHeight;
    }
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

function escapeText(text) {
  const div = document.createElement('span');
  div.textContent = text;
  return div.innerHTML;
}
