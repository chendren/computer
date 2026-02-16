import { escapeHtml } from '../utils/formatters.js';

export class BrowserPanel {
  constructor(api, ws) {
    this.api = api;
    this.ws = ws;
    this.container = document.getElementById('browser-content');
    this.iframe = document.getElementById('browser-iframe');
    this.textView = document.getElementById('browser-text-view');
    this.pageInfo = document.getElementById('browser-page-info');
    this.history = [];
    this.currentIndex = -1;
    this.viewMode = 'rendered'; // 'rendered' or 'text'
    this.lastTextData = null;

    const goBtn = document.getElementById('browser-go-btn');
    const urlInput = document.getElementById('browser-url-input');
    if (goBtn) goBtn.addEventListener('click', () => this.navigate());
    if (urlInput) urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.navigate();
    });

    // View toggle
    const toggleBtn = document.getElementById('browser-view-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        this.viewMode = this.viewMode === 'rendered' ? 'text' : 'rendered';
        toggleBtn.textContent = this.viewMode === 'rendered' ? 'Text' : 'Rendered';
        this._applyViewMode();
      });
    }

    // Back/forward
    const backBtn = document.getElementById('browser-back-btn');
    const fwdBtn = document.getElementById('browser-forward-btn');
    if (backBtn) backBtn.addEventListener('click', () => this.goBack());
    if (fwdBtn) fwdBtn.addEventListener('click', () => this.goForward());

    // Listen for navigation messages from proxied iframe
    window.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'browser-navigate' && e.data.url) {
        const urlInput = document.getElementById('browser-url-input');
        if (urlInput) urlInput.value = e.data.url;
        // Update history
        this.currentIndex++;
        this.history.splice(this.currentIndex);
        this.history.push(e.data.url);
        // Fetch text version in background
        this.api.post('/browse', { url: e.data.url }).then(data => {
          this._setPageInfo(data.url || e.data.url, data.status);
          this.lastTextData = data;
          this._renderTextView(data);
        }).catch(() => {});
      }
    });
  }

  async loadHistory() {}

  _applyViewMode() {
    if (this.viewMode === 'rendered') {
      this.iframe.style.display = 'block';
      this.textView.style.display = 'none';
    } else {
      this.iframe.style.display = 'none';
      this.textView.style.display = 'block';
    }
  }

  _setPageInfo(url, status) {
    if (!this.pageInfo) return;
    const color = status >= 200 && status < 400 ? '#55CC55' : '#CC4444';
    this.pageInfo.style.color = color;
    this.pageInfo.textContent = (status || '') + ' — ' + (url || '');
  }

  async navigate(url) {
    const urlInput = document.getElementById('browser-url-input');
    const targetUrl = url || urlInput?.value.trim();
    if (!targetUrl) return;

    if (urlInput) urlInput.value = targetUrl;

    // Reset to rendered mode for each new navigation
    this.viewMode = 'rendered';
    const toggleBtn = document.getElementById('browser-view-toggle');
    if (toggleBtn) toggleBtn.textContent = 'Text';
    this.iframe.style.display = 'block';
    this.textView.style.display = 'none';
    this.textView.innerHTML = '<div class="loading-indicator"><span class="loading-dots">Navigating</span></div>';
    if (this.pageInfo) this.pageInfo.textContent = 'Loading...';

    // Ensure protocol
    let normalizedUrl = targetUrl;
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    // Load iframe via proxy — the GET proxy endpoint returns raw HTML
    const token = this.api.authToken || '';
    const proxyUrl = '/api/browse/proxy?url=' + encodeURIComponent(normalizedUrl) + '&token=' + encodeURIComponent(token);
    this.iframe.src = proxyUrl;

    // Detect iframe load failure — auto-switch to reader mode only if blocked
    this.iframe.addEventListener('load', () => {
      try {
        const iframeDoc = this.iframe.contentDocument || this.iframe.contentWindow?.document;
        const bodyText = iframeDoc?.body?.innerText || '';
        // Only switch if the page is clearly blocked (Chrome shows specific blocked message)
        if (bodyText.indexOf('This content is blocked') !== -1 || bodyText.indexOf('ERR_BLOCKED') !== -1) {
          this._autoSwitchToText();
        }
      } catch {
        // Can't access iframe — leave as-is, user can toggle manually
      }
    }, { once: true });

    // Also fetch the structured text version in parallel
    try {
      const data = await this.api.post('/browse', { url: targetUrl });

      if (data.url && urlInput) urlInput.value = data.url;
      this._setPageInfo(data.url || targetUrl, data.status);

      // Store text data for text view
      this.lastTextData = data;
      this._renderTextView(data);

      // Auto-switch only for pages with zero extractable content
      if ((data.content || '').length < 100 && this.viewMode === 'rendered') {
        this._autoSwitchToText();
      }

      // Update history
      this.currentIndex++;
      this.history.splice(this.currentIndex);
      this.history.push(data.url || targetUrl);
    } catch (err) {
      this._setPageInfo(targetUrl, 'ERR');
      this.textView.innerHTML = '<div class="empty-state"><div class="empty-state-text">' + escapeHtml(err.message || 'Failed to load') + '</div></div>';
    }
  }

  _autoSwitchToText() {
    if (this.viewMode === 'text') return;
    this.viewMode = 'text';
    const toggleBtn = document.getElementById('browser-view-toggle');
    if (toggleBtn) toggleBtn.textContent = 'Rendered';
    this._applyViewMode();
  }

  _renderTextView(data) {
    if (!this.textView) return;

    let html = '<div class="browser-reader">';

    // Article header
    if (data.title) {
      html += '<div class="reader-title">' + escapeHtml(data.title) + '</div>';
    }
    if (data.description) {
      html += '<div class="reader-description">' + escapeHtml(data.description) + '</div>';
    }
    if (data.image) {
      html += '<div class="reader-image"><img src="' + escapeHtml(data.image) + '" alt="" /></div>';
    }
    if (data.url) {
      html += '<div class="reader-source"><a href="' + escapeHtml(data.url) + '" target="_blank" rel="noopener">' + escapeHtml(data.url) + '</a></div>';
    }

    const contentLen = (data.content || '').length;
    if (contentLen < 200) {
      html += '<div class="browser-spa-notice">';
      html += '<div class="spa-notice-icon">JS</div>';
      html += '<div class="spa-notice-text">This site uses JavaScript to render content. Limited server-side text available.</div>';
      html += '</div>';
    }

    if (data.content) {
      // Render content as formatted paragraphs instead of <pre>
      const escaped = escapeHtml(data.content);
      const lines = escaped.split('\n');
      let paragraphs = [];
      let current = '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          if (current.length > 0) {
            paragraphs.push(current);
            current = '';
          }
        } else {
          current += (current ? ' ' : '') + trimmed;
        }
      }
      if (current.length > 0) paragraphs.push(current);

      html += '<div class="reader-body">';
      for (const para of paragraphs) {
        // Linkify URLs in the text
        html += '<p>' + this._linkifyText(para) + '</p>';
      }
      html += '</div>';
    } else {
      html += '<div class="empty-state"><div class="empty-state-text">No extractable content</div></div>';
    }

    html += '</div>';
    this.textView.innerHTML = html;
  }

  _linkifyText(text) {
    // Find URLs in text and make them clickable
    let result = '';
    let i = 0;
    while (i < text.length) {
      const httpIdx = text.indexOf('http', i);
      if (httpIdx === -1) {
        result += text.slice(i);
        break;
      }
      const slice = text.slice(httpIdx);
      if (!slice.startsWith('http://') && !slice.startsWith('https://')) {
        result += text.slice(i, httpIdx + 4);
        i = httpIdx + 4;
        continue;
      }
      result += text.slice(i, httpIdx);
      const stopChars = [' ', '<', '>', '&', '"', "'", ')', ']', '\n', '\t'];
      let urlEnd = text.length;
      for (const ch of stopChars) {
        const idx = text.indexOf(ch, httpIdx);
        if (idx !== -1 && idx < urlEnd) urlEnd = idx;
      }
      const url = text.slice(httpIdx, urlEnd);
      result += '<a href="' + url + '" target="_blank" rel="noopener" style="color:var(--lcars-light-blue);">' + url + '</a>';
      i = urlEnd;
    }
    return result;
  }

  goBack() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this.navigate(this.history[this.currentIndex]);
    }
  }

  goForward() {
    if (this.currentIndex < this.history.length - 1) {
      this.currentIndex++;
      this.navigate(this.history[this.currentIndex]);
    }
  }

  // Called by voice browse_url tool via WebSocket event
  renderResult(data) {
    if (data.url) {
      this.navigate(data.url);
    } else if (data.payload?.content || data.payload?.text) {
      const content = data.payload.content || data.payload.text;
      this.textView.innerHTML = '<div class="browser-text-content"><pre>' + escapeHtml(content) + '</pre></div>';
      this.viewMode = 'text';
      this._applyViewMode();
    }
  }

  renderError(msg) {
    if (this.textView) {
      this.textView.innerHTML = '<div class="empty-state"><div class="empty-state-text">' + escapeHtml(msg) + '</div></div>';
    }
    if (this.pageInfo) {
      this.pageInfo.style.color = '#CC4444';
      this.pageInfo.textContent = 'Error';
    }
  }
}
