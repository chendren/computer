import { clearEmpty } from '../utils/lcars-helpers.js';
import { formatTime, escapeHtml } from '../utils/formatters.js';

export class MonitorPanel {
  constructor(api) {
    this.api = api;
    this.container = document.getElementById('monitor-list');
    this.monitors = new Map();

    // Submit form
    this.nameInput = document.getElementById('monitor-name-input');
    this.targetInput = document.getElementById('monitor-target-input');
    this.submitBtn = document.getElementById('monitor-submit-btn');
    this.statusEl = document.getElementById('monitor-status');

    if (this.submitBtn) {
      this.submitBtn.addEventListener('click', () => this.createMonitor());
    }
    if (this.targetInput) {
      this.targetInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.createMonitor();
      });
    }
  }

  async createMonitor() {
    const name = this.nameInput?.value?.trim();
    const target = this.targetInput?.value?.trim();
    if (!name || !target) return;

    if (this.submitBtn) {
      this.submitBtn.disabled = true;
      this.submitBtn.textContent = 'Creating...';
    }
    if (this.statusEl) this.statusEl.textContent = '';

    try {
      await this.api.post('/monitors', {
        name,
        target: { type: target.startsWith('http') ? 'url' : 'endpoint', value: target },
        status: 'active',
        interval: '60s',
      });
      if (this.nameInput) this.nameInput.value = '';
      if (this.targetInput) this.targetInput.value = '';
      if (this.statusEl) {
        this.statusEl.textContent = 'CREATED';
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
      this.submitBtn.textContent = 'Create Monitor';
    }
  }

  display(data) {
    clearEmpty(this.container);

    const id = data.name || data.id;

    let card = this.monitors.get(id);
    if (card) {
      card.remove();
    }

    card = document.createElement('div');
    card.className = 'monitor-card';
    this.monitors.set(id, card);

    const statusColors = {
      active: '#55CC55',
      ok: '#55CC55',
      triggered: '#FFCC00',
      warning: '#FFCC00',
      alert: '#CC4444',
      error: '#CC4444',
      stopped: '#996600',
    };

    const status = data.status || (data.lastCheck && data.lastCheck.status) || 'active';
    const statusColor = statusColors[status] || '#996600';

    // Header
    const header = document.createElement('div');
    header.className = 'monitor-header';

    const dot = document.createElement('span');
    dot.className = 'monitor-status-dot';
    dot.style.background = statusColor;
    header.appendChild(dot);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'monitor-name';
    nameSpan.textContent = data.name || id;
    header.appendChild(nameSpan);

    const typeSpan = document.createElement('span');
    typeSpan.className = 'monitor-type';
    typeSpan.textContent = data.target?.type || 'unknown';
    header.appendChild(typeSpan);

    card.appendChild(header);

    // Target
    if (data.target?.value) {
      const targetDiv = document.createElement('div');
      targetDiv.className = 'monitor-target';
      targetDiv.textContent = data.target.value;
      card.appendChild(targetDiv);
    }

    // Interval
    if (data.interval) {
      const metaDiv = document.createElement('div');
      metaDiv.className = 'monitor-meta';
      metaDiv.textContent = 'Interval: ' + data.interval;
      card.appendChild(metaDiv);
    }

    // Last check
    if (data.lastCheck) {
      const lc = data.lastCheck;
      const lcDiv = document.createElement('div');
      lcDiv.className = 'monitor-last-check';

      const lcStatus = document.createElement('span');
      lcStatus.className = 'monitor-check-status';
      lcStatus.style.color = statusColors[lc.status] || '#996600';
      lcStatus.textContent = (lc.status || 'unknown').toUpperCase();
      lcDiv.appendChild(lcStatus);

      if (lc.timestamp) {
        const lcTime = document.createElement('span');
        lcTime.className = 'monitor-check-time';
        lcTime.textContent = ' ' + formatTime(lc.timestamp);
        lcDiv.appendChild(lcTime);
      }

      if (lc.detail) {
        const lcDetail = document.createElement('div');
        lcDetail.className = 'monitor-check-detail';
        lcDetail.textContent = lc.detail;
        lcDiv.appendChild(lcDetail);
      }

      card.appendChild(lcDiv);
    }

    // Conditions
    if (data.conditions && data.conditions.length) {
      const condDiv = document.createElement('div');
      condDiv.className = 'monitor-conditions';
      data.conditions.forEach(c => {
        const cEl = document.createElement('div');
        cEl.className = 'monitor-condition';
        cEl.textContent = c.check + ': ' + c.threshold;
        condDiv.appendChild(cEl);
      });
      card.appendChild(condDiv);
    }

    // History
    if (data.history && data.history.length) {
      const label = document.createElement('div');
      label.className = 'monitor-history-label';
      label.textContent = 'Recent Checks';
      card.appendChild(label);

      const histDiv = document.createElement('div');
      histDiv.className = 'monitor-history';
      data.history.slice(0, 10).forEach(h => {
        const hColor = statusColors[h.status] || '#996600';
        const item = document.createElement('div');
        item.className = 'monitor-history-item';

        const hDot = document.createElement('span');
        hDot.className = 'monitor-history-dot';
        hDot.style.background = hColor;
        item.appendChild(hDot);

        if (h.timestamp) {
          const hTime = document.createElement('span');
          hTime.className = 'monitor-history-time';
          hTime.textContent = formatTime(h.timestamp);
          item.appendChild(hTime);
        }

        const hDetail = document.createElement('span');
        hDetail.className = 'monitor-history-detail';
        hDetail.textContent = h.detail || h.status;
        item.appendChild(hDetail);

        histDiv.appendChild(item);
      });
      card.appendChild(histDiv);
    }

    this.container.insertBefore(card, this.container.firstChild);
  }

  async loadHistory() {
    try {
      const items = await this.api.get('/monitors');
      for (const item of items) {
        this.display(item);
      }
    } catch {}
  }
}
