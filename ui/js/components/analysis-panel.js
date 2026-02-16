import { clearEmpty, getLcarsColor } from '../utils/lcars-helpers.js';
import { formatTime } from '../utils/formatters.js';

export class AnalysisPanel {
  constructor(api) {
    this.container = document.getElementById('analysis-results');
    this.api = api;
    this.input = document.getElementById('analysis-input');
    this.submitBtn = document.getElementById('analysis-submit-btn');
    this.statusEl = document.getElementById('analysis-status');

    if (this.submitBtn) {
      this.submitBtn.addEventListener('click', () => this.submitAnalysis());
    }
    if (this.input) {
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          this.submitAnalysis();
        }
      });
    }
  }

  async submitAnalysis() {
    const text = this.input ? this.input.value.trim() : '';
    if (!text) return;

    this.submitBtn.disabled = true;
    this.statusEl.innerHTML = 'Analyzing<span class="lcars-loading"></span>';

    try {
      const title = text.length > 50 ? text.slice(0, 50) + '...' : text;
      await this.api.post('/analysis', { text, title });
      this.input.value = '';
      this.statusEl.textContent = 'Complete';
    } catch (err) {
      this.statusEl.textContent = 'Error: ' + (err.message || 'Failed');
    }

    this.submitBtn.disabled = false;
    setTimeout(() => { this.statusEl.textContent = ''; }, 4000);
  }

  display(data) {
    clearEmpty(this.container);

    const card = document.createElement('div');
    card.className = 'analysis-card';

    let html = '';

    // Timestamp
    if (data.timestamp) {
      html += '<div class="lcars-label" style="font-size:10px; margin-bottom:12px;">' + formatTime(data.timestamp) + '</div>';
    }

    // Raw Input — shown first, collapsible
    if (data.input) {
      html += '<h3>Input</h3>';
      html += '<details class="input-details">';
      html += '<summary class="input-summary">Original Text</summary>';
      html += '<pre class="input-text">' + linkify(escapeHtml(data.input)) + '</pre>';
      html += '</details>';
      html += '<div class="lcars-divider"></div>';
    }

    // Summary
    if (data.summary) {
      html += '<h3>Summary</h3><p>' + linkify(escapeHtml(data.summary)) + '</p><div class="lcars-divider"></div>';
    }

    // Sentiment
    if (data.sentiment) {
      const s = data.sentiment;
      html += '<h3>Sentiment: ' + escapeHtml(s.overall || 'unknown');
      if (s.confidence) html += ' <span style="font-size:12px; color:var(--lcars-text-dim);">(' + Math.round(s.confidence * 100) + '% confidence)</span>';
      html += '</h3>';
      if (s.breakdown) {
        const pos = (s.breakdown.positive || 0) * 100;
        const neg = (s.breakdown.negative || 0) * 100;
        const neu = (s.breakdown.neutral || 0) * 100;
        html += '<div class="sentiment-labels"><span class="sentiment-label-pos">Positive ' + Math.round(pos) + '%</span><span class="sentiment-label-neu">Neutral ' + Math.round(neu) + '%</span><span class="sentiment-label-neg">Negative ' + Math.round(neg) + '%</span></div>';
        html += '<div class="sentiment-bar">';
        html += '<div class="sentiment-positive" style="width:' + pos + '%"></div>';
        html += '<div class="sentiment-neutral" style="width:' + neu + '%"></div>';
        html += '<div class="sentiment-negative" style="width:' + neg + '%"></div>';
        html += '</div>';
      }
      html += '<div class="lcars-divider"></div>';
    }

    // Topics
    if (data.topics && data.topics.length) {
      html += '<h3>Topics</h3><div>';
      data.topics.forEach(function(t, i) {
        html += '<span class="topic-tag" style="background:' + getLcarsColor(i) + '">' + escapeHtml(t.name) + ' (' + Math.round((t.relevance || 0) * 100) + '%)</span>';
      });
      html += '</div><div class="lcars-divider"></div>';
    }

    // Action Items
    if (data.actionItems && data.actionItems.length) {
      html += '<h3>Action Items</h3><ul>';
      data.actionItems.forEach(function(item) {
        const priority = item.priority ? '[' + escapeHtml(item.priority) + ']' : '';
        html += '<li>' + priority + ' ' + linkify(escapeHtml(item.text)) + '</li>';
      });
      html += '</ul><div class="lcars-divider"></div>';
    }

    // Entities
    if (data.entities) {
      const allEntities = [].concat(
        (data.entities.people || []).map(function(e) { return { type: 'person', name: e }; }),
        (data.entities.organizations || []).map(function(e) { return { type: 'org', name: e }; }),
        (data.entities.terms || []).map(function(e) { return { type: 'term', name: e }; })
      );
      if (allEntities.length) {
        html += '<h3>Entities</h3><div>';
        allEntities.forEach(function(e, i) {
          html += '<span class="topic-tag" style="background:' + getLcarsColor(i + 3) + '">' + escapeHtml(e.name) + '</span>';
        });
        html += '</div>';
      }
    }

    // Sources with clickable links
    if (data.sources && data.sources.length) {
      html += '<div class="lcars-divider"></div><h3>Sources</h3><ul>';
      data.sources.forEach(function(src) {
        const label = src.title || src.url;
        const url = src.url;
        if (url) {
          html += '<li><a href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer" style="color:var(--lcars-light-blue);">' + escapeHtml(label) + '</a></li>';
        } else {
          html += '<li>' + escapeHtml(label) + '</li>';
        }
      });
      html += '</ul>';
    }

    // Raw fallback
    if (!data.summary && !data.sentiment && !data.topics && !data.input && typeof data === 'object') {
      html += '<h3>Raw Analysis</h3><pre class="input-text">' + linkify(escapeHtml(JSON.stringify(data, null, 2))) + '</pre>';
    }

    card.innerHTML = html;
    this.container.insertBefore(card, this.container.firstChild);
  }

  async loadHistory(api) {
    try {
      const items = await (api || this.api).get('/analyses');
      for (const item of items) {
        this.display(item);
      }
    } catch {
      // server may not be ready
    }
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function linkify(escapedHtml) {
  // Find URLs using string scanning — no regex
  let result = '';
  let i = 0;
  while (i < escapedHtml.length) {
    const httpIdx = escapedHtml.indexOf('http', i);
    if (httpIdx === -1) {
      result += escapedHtml.slice(i);
      break;
    }

    // Check if it's http:// or https://
    const slice = escapedHtml.slice(httpIdx);
    if (!slice.startsWith('http://') && !slice.startsWith('https://')) {
      result += escapedHtml.slice(i, httpIdx + 4);
      i = httpIdx + 4;
      continue;
    }

    // Add text before URL
    result += escapedHtml.slice(i, httpIdx);

    // Find end of URL (space, <, >, &, ", ', ), ])
    const stopChars = [' ', '<', '>', '&', '"', "'", ')', ']', '\n', '\t'];
    let urlEnd = escapedHtml.length;
    for (const ch of stopChars) {
      const idx = escapedHtml.indexOf(ch, httpIdx);
      if (idx !== -1 && idx < urlEnd) urlEnd = idx;
    }

    const url = escapedHtml.slice(httpIdx, urlEnd);
    result += '<a href="' + url + '" target="_blank" rel="noopener noreferrer" style="color:var(--lcars-light-blue);">' + url + '</a>';
    i = urlEnd;
  }
  return result;
}
