import { clearEmpty } from '../utils/lcars-helpers.js';

export class ChartPanel {
  constructor() {
    this.wrapper = document.getElementById('chart-wrapper');
    this.charts = [];
  }

  render(chartConfig) {
    if (!chartConfig) return;
    clearEmpty(this.wrapper);

    const container = document.createElement('div');
    container.className = 'chart-container';

    const title = document.createElement('div');
    title.className = 'lcars-label';
    title.textContent = chartConfig.options?.plugins?.title?.text || 'Visualization';

    const canvas = document.createElement('canvas');
    container.appendChild(title);
    container.appendChild(canvas);

    // Insert at top
    this.wrapper.insertBefore(container, this.wrapper.firstChild);

    try {
      const chart = new Chart(canvas.getContext('2d'), chartConfig);
      this.charts.push(chart);
    } catch (err) {
      container.innerHTML += `<p style="color: var(--lcars-red);">Chart error: ${err.message}</p>`;
    }
  }

  clear() {
    this.charts.forEach(c => c.destroy());
    this.charts = [];
    this.wrapper.innerHTML = '<div class="empty-state"><div class="empty-state-text">No charts generated</div></div>';
  }
}
