import { clearEmpty, getLcarsColor } from '../utils/lcars-helpers.js';
import { formatTime, escapeHtml } from '../utils/formatters.js';

export class ComparisonPanel {
  constructor() {
    this.container = document.getElementById('comparison-results');
  }

  display(data) {
    clearEmpty(this.container);

    const card = document.createElement('div');
    card.className = 'comparison-card';

    let html = '';

    // Timestamp
    if (data.timestamp) {
      html += `<div class="lcars-label" style="font-size:10px; margin-bottom:12px;">${formatTime(data.timestamp)}</div>`;
    }

    // Verdict
    if (data.verdict) {
      html += `<div class="comparison-verdict">${escapeHtml(data.verdict)}</div>`;
      html += `<div class="lcars-divider"></div>`;
    }

    // Subjects
    if (data.subjectA || data.subjectB) {
      html += `<div class="comparison-subjects">`;
      if (data.subjectA) {
        html += `<div class="comparison-subject subject-a">`;
        html += `<div class="comparison-subject-label">Subject A</div>`;
        html += `<div class="comparison-subject-name">${escapeHtml(data.subjectA.name || 'A')}</div>`;
        if (data.subjectA.summary) html += `<div class="comparison-subject-summary">${escapeHtml(data.subjectA.summary)}</div>`;
        html += `</div>`;
      }
      if (data.subjectB) {
        html += `<div class="comparison-subject subject-b">`;
        html += `<div class="comparison-subject-label">Subject B</div>`;
        html += `<div class="comparison-subject-name">${escapeHtml(data.subjectB.name || 'B')}</div>`;
        if (data.subjectB.summary) html += `<div class="comparison-subject-summary">${escapeHtml(data.subjectB.summary)}</div>`;
        html += `</div>`;
      }
      html += `</div>`;
    }

    // Similarity score
    if (data.similarityScore != null) {
      const pct = Math.round(data.similarityScore * 100);
      html += `<div class="lcars-divider"></div>`;
      html += `<h3>Similarity: ${pct}%</h3>`;
      html += `<div class="similarity-bar"><div class="similarity-fill" style="width:${pct}%"></div></div>`;
    }

    // Differences
    if (data.differences && data.differences.length) {
      html += `<div class="lcars-divider"></div>`;
      html += `<h3>Key Differences</h3>`;
      html += `<div class="comparison-diffs">`;
      data.differences.forEach((d, i) => {
        const impactColors = { high: '#CC4444', medium: '#FFCC00', low: '#55CC55' };
        const impactColor = impactColors[d.impact] || '#996600';
        html += `<div class="comparison-diff">`;
        html += `<div class="diff-aspect"><span class="diff-impact" style="color:${impactColor}">[${escapeHtml(d.impact || '?')}]</span> ${escapeHtml(d.aspect)}</div>`;
        html += `<div class="diff-sides">`;
        html += `<div class="diff-side diff-a"><span class="diff-label">A:</span> ${escapeHtml(d.subjectA || '')}</div>`;
        html += `<div class="diff-side diff-b"><span class="diff-label">B:</span> ${escapeHtml(d.subjectB || '')}</div>`;
        html += `</div>`;
        if (d.winner && d.winner !== 'tie') {
          html += `<div class="diff-winner">Winner: ${escapeHtml(d.winner)}</div>`;
        }
        html += `</div>`;
      });
      html += `</div>`;
    }

    // Similarities
    if (data.similarities && data.similarities.length) {
      html += `<div class="lcars-divider"></div>`;
      html += `<h3>Similarities</h3>`;
      html += `<ul>`;
      data.similarities.forEach(s => {
        html += `<li><strong>${escapeHtml(s.aspect)}</strong>: ${escapeHtml(s.detail)}</li>`;
      });
      html += `</ul>`;
    }

    // Recommendation
    if (data.recommendation) {
      html += `<div class="lcars-divider"></div>`;
      html += `<h3>Recommendation</h3>`;
      html += `<p class="comparison-recommendation">${escapeHtml(data.recommendation)}</p>`;
    }

    card.innerHTML = html;
    this.container.insertBefore(card, this.container.firstChild);
  }

  async loadHistory(api) {
    try {
      const items = await api.get('/comparisons');
      for (const item of items) {
        this.display(item);
      }
    } catch {}
  }
}
