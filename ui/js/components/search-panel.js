import { clearEmpty } from '../utils/lcars-helpers.js';

export class SearchPanel {
  constructor(api) {
    this.api = api;
    this.results = document.getElementById('search-results');
    this.searchInput = document.getElementById('search-input');
    this.searchBtn = document.getElementById('search-btn');

    if (this.searchBtn) {
      this.searchBtn.addEventListener('click', () => this.search());
    }
    if (this.searchInput) {
      this.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.search();
      });
    }
  }

  async search() {
    const query = this.searchInput?.value?.trim();
    if (!query) return;

    if (this.searchBtn) {
      this.searchBtn.disabled = true;
      this.searchBtn.textContent = 'Searching...';
    }

    try {
      const systemPrompt = 'You are a research assistant. Search the web for the query and return results as JSON: {"results": [{"title": "...", "url": "...", "snippet": "..."}], "summary": "brief synthesis"}';
      let response = '';
      await this.api.queryClaudeStream(
        'Search the web for: ' + query,
        systemPrompt,
        (chunk) => { response += chunk; }
      );

      // Try to extract JSON from the response
      const firstBrace = response.indexOf('{');
      const lastBrace = response.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
          this.displayResults(JSON.parse(response.slice(firstBrace, lastBrace + 1)));
        } catch {
          this.displayRaw(response);
        }
      } else {
        this.displayRaw(response);
      }
    } catch (err) {
      this.displayRaw('Search error: ' + err.message);
    }

    if (this.searchBtn) {
      this.searchBtn.disabled = false;
      this.searchBtn.textContent = 'Search';
    }
  }

  displayResults(data) {
    clearEmpty(this.results);
    this.results.innerHTML = '';

    if (data.query) {
      const header = document.createElement('div');
      header.className = 'lcars-label';
      header.textContent = 'Results for: ' + data.query;
      this.results.appendChild(header);
    }

    if (data.summary) {
      const summary = document.createElement('div');
      summary.className = 'analysis-card';
      const h3 = document.createElement('h3');
      h3.textContent = 'Summary';
      const p = document.createElement('p');
      p.textContent = data.summary;
      summary.appendChild(h3);
      summary.appendChild(p);
      this.results.appendChild(summary);
    }

    const items = data.results || data.keyFindings || data.sources || [];
    for (const item of items) {
      const el = document.createElement('div');
      el.className = 'search-result';

      // Title as clickable hyperlink
      const titleDiv = document.createElement('div');
      titleDiv.className = 'search-result-title';
      const link = document.createElement('a');
      link.href = item.url || '#';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = item.title || item.finding || 'Result';
      titleDiv.appendChild(link);
      el.appendChild(titleDiv);

      // Snippet
      if (item.snippet || item.finding) {
        const snippet = document.createElement('div');
        snippet.className = 'search-result-snippet';
        snippet.textContent = item.snippet || item.finding;
        el.appendChild(snippet);
      }

      // URL display as clickable link
      if (item.url) {
        const urlDiv = document.createElement('div');
        urlDiv.className = 'search-result-url';
        const urlLink = document.createElement('a');
        urlLink.href = item.url;
        urlLink.target = '_blank';
        urlLink.rel = 'noopener noreferrer';
        urlLink.textContent = item.url;
        urlDiv.appendChild(urlLink);
        el.appendChild(urlDiv);
      }

      this.results.appendChild(el);
    }
  }

  displayRaw(text) {
    clearEmpty(this.results);
    this.results.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'analysis-card';
    const pre = document.createElement('pre');
    pre.style.cssText = 'color:var(--lcars-light-blue); font-size:13px; white-space:pre-wrap;';

    // Linkify URLs using string scanning (no regex)
    const parts = [];
    let remaining = text;
    while (remaining.length > 0) {
      const httpIdx = remaining.indexOf('http://');
      const httpsIdx = remaining.indexOf('https://');
      let idx = -1;
      if (httpIdx === -1 && httpsIdx === -1) {
        break;
      } else if (httpIdx === -1) {
        idx = httpsIdx;
      } else if (httpsIdx === -1) {
        idx = httpIdx;
      } else {
        idx = Math.min(httpIdx, httpsIdx);
      }

      // Add text before URL
      if (idx > 0) {
        const textNode = document.createTextNode(remaining.slice(0, idx));
        pre.appendChild(textNode);
      }

      // Find end of URL (whitespace or certain punctuation)
      const urlStart = idx;
      let urlEnd = remaining.length;
      for (let i = idx; i < remaining.length; i++) {
        const c = remaining[i];
        if (c === ' ' || c === '\n' || c === '\t' || c === '"' || c === "'" || c === ')' || c === ']' || c === '>' || c === '<') {
          urlEnd = i;
          break;
        }
      }

      const url = remaining.slice(urlStart, urlEnd);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.style.color = 'var(--lcars-light-blue)';
      a.textContent = url;
      pre.appendChild(a);

      remaining = remaining.slice(urlEnd);
    }

    // Add any remaining text
    if (remaining.length > 0) {
      pre.appendChild(document.createTextNode(remaining));
    }

    el.appendChild(pre);
    this.results.appendChild(el);
  }

  display(data) {
    this.displayResults(data);
  }
}
