import { nowTime } from '../utils/formatters.js';
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

  addEntry(data) {
    clearEmpty(this.list);
    const entry = document.createElement('div');
    entry.className = 'transcript-entry';

    const time = data.timestamp ? new Date(data.timestamp).toLocaleTimeString('en-US', { hour12: false }) : nowTime();
    const source = data.source === 'whisper' ? '[' + (data.filename || 'file') + ']' : '';
    const text = data.text || '';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'transcript-time';
    timeSpan.textContent = time + ' ' + source;

    const textSpan = document.createElement('span');
    textSpan.className = 'transcript-text';
    textSpan.textContent = text;

    const actions = document.createElement('div');
    actions.className = 'transcript-entry-actions';

    const analyzeBtn = document.createElement('button');
    analyzeBtn.className = 'analyze-btn';
    analyzeBtn.textContent = 'Analyze';
    analyzeBtn.addEventListener('click', () => this._analyzeEntry(text, analyzeBtn));
    actions.appendChild(analyzeBtn);

    entry.appendChild(timeSpan);
    entry.appendChild(textSpan);
    entry.appendChild(actions);

    this.list.appendChild(entry);
    this.list.scrollTop = this.list.scrollHeight;
  }

  async _analyzeEntry(text, btn) {
    if (!text.trim()) return;
    btn.disabled = true;
    btn.textContent = 'Analyzing...';

    try {
      const title = text.length > 50 ? text.slice(0, 50) + '...' : text;
      await this.api.post('/analysis', { text, title });
      btn.textContent = 'Done';
    } catch {
      btn.textContent = 'Error';
    }

    setTimeout(() => {
      btn.textContent = 'Analyze';
      btn.disabled = false;
    }, 3000);
  }

  addLiveText(text, isFinal) {
    clearEmpty(this.list);

    if (isFinal) {
      // Finalize the interim element
      if (this.interimEl) {
        this.interimEl.querySelector('.transcript-text').textContent = text;
        this.interimEl.style.opacity = '1';

        // Add analyze button if not present
        if (!this.interimEl.querySelector('.analyze-btn')) {
          const actions = document.createElement('div');
          actions.className = 'transcript-entry-actions';
          const analyzeBtn = document.createElement('button');
          analyzeBtn.className = 'analyze-btn';
          analyzeBtn.textContent = 'Analyze';
          analyzeBtn.addEventListener('click', () => this._analyzeEntry(text, analyzeBtn));
          actions.appendChild(analyzeBtn);
          this.interimEl.appendChild(actions);
        }

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

        const timeSpan = document.createElement('span');
        timeSpan.className = 'transcript-time';
        timeSpan.textContent = nowTime();

        const textSpan = document.createElement('span');
        textSpan.className = 'transcript-text';

        this.interimEl.appendChild(timeSpan);
        this.interimEl.appendChild(textSpan);
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
        texts.push(textEl.textContent.trim());
      }
    });

    if (!texts.length) return;

    const now = new Date();
    const title = 'Session ' + now.toLocaleDateString('en-US') + ' ' + now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

    if (this.saveStatus) this.saveStatus.textContent = 'Saving...';

    try {
      await this.api.post('/transcripts', {
        text: texts.join('\n\n'),
        source: 'session',
        title: title,
      });
      if (this.saveStatus) this.saveStatus.textContent = 'Saved';
    } catch {
      if (this.saveStatus) this.saveStatus.textContent = 'Error';
    }

    setTimeout(() => { if (this.saveStatus) this.saveStatus.textContent = ''; }, 3000);
  }

  clearList() {
    this.list.innerHTML = '<div class="empty-state"><div class="empty-state-text">No transcripts yet</div></div>';
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
