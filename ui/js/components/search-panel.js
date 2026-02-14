import { clearEmpty } from '../utils/lcars-helpers.js';

export class SearchPanel {
  constructor(api) {
    this.api = api;
    this.results = document.getElementById('search-results');
    this.searchInput = document.getElementById('search-input');
    this.searchBtn = document.getElementById('search-btn');

    this.searchBtn.addEventListener('click', () => this.search());
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.search();
    });
  }

  async search() {
    const query = this.searchInput.value.trim();
    if (!query) return;

    this.searchBtn.disabled = true;
    this.searchBtn.textContent = 'Searching...';

    try {
      const systemPrompt = `You are a research assistant. Search the web for the query and return results as JSON: {"results": [{"title": "...", "url": "...", "snippet": "..."}], "summary": "brief synthesis"}`;
      let response = '';
      await this.api.queryClaudeStream(
        `Search the web for: ${query}`,
        systemPrompt,
        (chunk) => { response += chunk; }
      );

      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          this.displayResults(JSON.parse(jsonMatch[0]));
        } else {
          this.displayRaw(response);
        }
      } catch {
        this.displayRaw(response);
      }
    } catch (err) {
      this.displayRaw(`Search error: ${err.message}`);
    }

    this.searchBtn.disabled = false;
    this.searchBtn.textContent = 'Search';
  }

  displayResults(data) {
    clearEmpty(this.results);
    this.results.innerHTML = '';

    if (data.query) {
      const header = document.createElement('div');
      header.className = 'lcars-label';
      header.textContent = `Results for: ${data.query}`;
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
    // Linkify URLs in raw text
    const pre = document.createElement('pre');
    pre.style.cssText = 'color:var(--lcars-light-blue); font-size:13px; white-space:pre-wrap;';
    pre.innerHTML = linkifyText(text);
    el.appendChild(pre);
    this.results.appendChild(el);
  }

  display(data) {
    this.displayResults(data);
  }
}

function linkifyText(text) {
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(
    /(https?:\/\/[^\s<>"')\]]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--lcars-light-blue);">$1</a>'
  );
}
