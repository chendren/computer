import { clearEmpty, getLcarsColor } from '../utils/lcars-helpers.js';
import { formatTime, escapeHtml } from '../utils/formatters.js';

export class ComparisonPanel {
  constructor(api) {
    this.api = api;
    this.container = document.getElementById('comparison-results');

    // Submit form
    this.nameA = document.getElementById('compare-name-a');
    this.textA = document.getElementById('compare-text-a');
    this.nameB = document.getElementById('compare-name-b');
    this.textB = document.getElementById('compare-text-b');
    this.submitBtn = document.getElementById('compare-submit-btn');
    this.statusEl = document.getElementById('compare-status');

    if (this.submitBtn) {
      this.submitBtn.addEventListener('click', () => this.submitComparison());
    }
  }

  async submitComparison() {
    const textA = this.textA?.value?.trim();
    const textB = this.textB?.value?.trim();
    if (!textA || !textB) return;

    if (this.submitBtn) {
      this.submitBtn.disabled = true;
      this.submitBtn.textContent = 'Comparing...';
    }
    if (this.statusEl) this.statusEl.innerHTML = '<span class="lcars-loading"></span>';

    try {
      await this.api.post('/comparisons', {
        textA,
        textB,
        nameA: this.nameA.value.trim() || 'Subject A',
        nameB: this.nameB.value.trim() || 'Subject B',
      });
      if (this.textA) this.textA.value = '';
      if (this.textB) this.textB.value = '';
      if (this.nameA) this.nameA.value = '';
      if (this.nameB) this.nameB.value = '';
      if (this.statusEl) {
        this.statusEl.textContent = 'COMPLETE';
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
      this.submitBtn.textContent = 'Compare';
    }
  }

  display(data) {
    clearEmpty(this.container);

    const card = document.createElement('div');
    card.className = 'comparison-card';

    // Timestamp
    if (data.timestamp) {
      const ts = document.createElement('div');
      ts.className = 'lcars-label';
      ts.style.cssText = 'font-size:10px; margin-bottom:12px;';
      ts.textContent = formatTime(data.timestamp);
      card.appendChild(ts);
    }

    // Verdict
    if (data.verdict) {
      const verdict = document.createElement('div');
      verdict.className = 'comparison-verdict';
      verdict.textContent = data.verdict;
      card.appendChild(verdict);

      const divider = document.createElement('div');
      divider.className = 'lcars-divider';
      card.appendChild(divider);
    }

    // Subjects
    if (data.subjectA || data.subjectB) {
      const subjects = document.createElement('div');
      subjects.className = 'comparison-subjects';

      if (data.subjectA) {
        const a = document.createElement('div');
        a.className = 'comparison-subject subject-a';
        const aLabel = document.createElement('div');
        aLabel.className = 'comparison-subject-label';
        aLabel.textContent = 'Subject A';
        a.appendChild(aLabel);
        const aName = document.createElement('div');
        aName.className = 'comparison-subject-name';
        aName.textContent = data.subjectA.name || 'A';
        a.appendChild(aName);
        if (data.subjectA.summary) {
          const aSummary = document.createElement('div');
          aSummary.className = 'comparison-subject-summary';
          aSummary.textContent = data.subjectA.summary;
          a.appendChild(aSummary);
        }
        subjects.appendChild(a);
      }

      if (data.subjectB) {
        const b = document.createElement('div');
        b.className = 'comparison-subject subject-b';
        const bLabel = document.createElement('div');
        bLabel.className = 'comparison-subject-label';
        bLabel.textContent = 'Subject B';
        b.appendChild(bLabel);
        const bName = document.createElement('div');
        bName.className = 'comparison-subject-name';
        bName.textContent = data.subjectB.name || 'B';
        b.appendChild(bName);
        if (data.subjectB.summary) {
          const bSummary = document.createElement('div');
          bSummary.className = 'comparison-subject-summary';
          bSummary.textContent = data.subjectB.summary;
          b.appendChild(bSummary);
        }
        subjects.appendChild(b);
      }

      card.appendChild(subjects);
    }

    // Similarity score
    if (data.similarityScore != null) {
      const pct = Math.round(data.similarityScore * 100);
      const divider = document.createElement('div');
      divider.className = 'lcars-divider';
      card.appendChild(divider);

      const h3 = document.createElement('h3');
      h3.textContent = 'Similarity: ' + pct + '%';
      card.appendChild(h3);

      const bar = document.createElement('div');
      bar.className = 'similarity-bar';
      const fill = document.createElement('div');
      fill.className = 'similarity-fill';
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      card.appendChild(bar);
    }

    // Differences
    if (data.differences && data.differences.length) {
      const divider = document.createElement('div');
      divider.className = 'lcars-divider';
      card.appendChild(divider);

      const h3 = document.createElement('h3');
      h3.textContent = 'Key Differences';
      card.appendChild(h3);

      const diffs = document.createElement('div');
      diffs.className = 'comparison-diffs';
      data.differences.forEach(d => {
        const impactColors = { high: '#CC4444', medium: '#FFCC00', low: '#55CC55' };
        const impactColor = impactColors[d.impact] || '#996600';

        const diff = document.createElement('div');
        diff.className = 'comparison-diff';

        const aspect = document.createElement('div');
        aspect.className = 'diff-aspect';
        const impact = document.createElement('span');
        impact.className = 'diff-impact';
        impact.style.color = impactColor;
        impact.textContent = '[' + (d.impact || '?') + ']';
        aspect.appendChild(impact);
        aspect.appendChild(document.createTextNode(' ' + (d.aspect || '')));
        diff.appendChild(aspect);

        const sides = document.createElement('div');
        sides.className = 'diff-sides';
        const sideA = document.createElement('div');
        sideA.className = 'diff-side diff-a';
        const labelA = document.createElement('span');
        labelA.className = 'diff-label';
        labelA.textContent = 'A: ';
        sideA.appendChild(labelA);
        sideA.appendChild(document.createTextNode(d.subjectA || ''));
        sides.appendChild(sideA);

        const sideB = document.createElement('div');
        sideB.className = 'diff-side diff-b';
        const labelB = document.createElement('span');
        labelB.className = 'diff-label';
        labelB.textContent = 'B: ';
        sideB.appendChild(labelB);
        sideB.appendChild(document.createTextNode(d.subjectB || ''));
        sides.appendChild(sideB);
        diff.appendChild(sides);

        if (d.winner && d.winner !== 'tie') {
          const winner = document.createElement('div');
          winner.className = 'diff-winner';
          winner.textContent = 'Winner: ' + d.winner;
          diff.appendChild(winner);
        }

        diffs.appendChild(diff);
      });
      card.appendChild(diffs);
    }

    // Similarities
    if (data.similarities && data.similarities.length) {
      const divider = document.createElement('div');
      divider.className = 'lcars-divider';
      card.appendChild(divider);

      const h3 = document.createElement('h3');
      h3.textContent = 'Similarities';
      card.appendChild(h3);

      const ul = document.createElement('ul');
      data.similarities.forEach(s => {
        const li = document.createElement('li');
        const strong = document.createElement('strong');
        strong.textContent = s.aspect;
        li.appendChild(strong);
        li.appendChild(document.createTextNode(': ' + s.detail));
        ul.appendChild(li);
      });
      card.appendChild(ul);
    }

    // Recommendation
    if (data.recommendation) {
      const divider = document.createElement('div');
      divider.className = 'lcars-divider';
      card.appendChild(divider);

      const h3 = document.createElement('h3');
      h3.textContent = 'Recommendation';
      card.appendChild(h3);

      const p = document.createElement('p');
      p.className = 'comparison-recommendation';
      p.textContent = data.recommendation;
      card.appendChild(p);
    }

    this.container.insertBefore(card, this.container.firstChild);
  }

  async loadHistory(api) {
    const client = api || this.api;
    try {
      const items = await client.get('/comparisons');
      for (const item of items) {
        this.display(item);
      }
    } catch {}
  }
}
