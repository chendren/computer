import { escapeHtml } from '../utils/formatters.js';

export class BrowserPanel {
  constructor(api, ws) {
    this.api = api;
    this.ws = ws;
    this.container = document.getElementById('browser-content');

    const goBtn = document.getElementById('browser-go-btn');
    const urlInput = document.getElementById('browser-url-input');
    if (goBtn) goBtn.addEventListener('click', () => this.navigate());
    if (urlInput) urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.navigate();
    });
  }

  async loadHistory() {
    // Browser panel loads on-demand, nothing to preload
  }

  async navigate() {
    const urlInput = document.getElementById('browser-url-input');
    const url = urlInput?.value.trim();
    if (!url) return;

    const viewport = this.container?.querySelector('.browser-viewport');
    if (viewport) {
      viewport.innerHTML = '<div class="loading-indicator"><span class="loading-dots">Navigating</span></div>';
    }

    try {
      const data = await this.api.post('/gateway/rpc', { method: 'browser.request', params: { action: 'navigate', url } });
      this.renderResult(data);
    } catch (err) {
      this.renderError(err.message);
    }
  }

  renderResult(data) {
    const viewport = this.container?.querySelector('.browser-viewport');
    if (!viewport) return;

    if (data.payload?.screenshot) {
      viewport.innerHTML = `<img class="browser-screenshot" src="data:image/png;base64,${data.payload.screenshot}" alt="Page screenshot">`;
    } else if (data.payload?.content || data.payload?.text) {
      const content = data.payload.content || data.payload.text;
      viewport.innerHTML = `<div class="browser-text-content"><pre>${escapeHtml(content)}</pre></div>`;
    } else {
      viewport.innerHTML = `<div class="browser-result"><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre></div>`;
    }
  }

  renderError(msg) {
    const viewport = this.container?.querySelector('.browser-viewport');
    if (viewport) {
      viewport.innerHTML = `<div class="empty-state"><div class="empty-state-text">${escapeHtml(msg)}</div></div>`;
    }
  }
}
