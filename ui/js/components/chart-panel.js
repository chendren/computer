import { clearEmpty } from '../utils/lcars-helpers.js';

const LCARS_COLORS = [
  '#ff9900', '#cc99cc', '#9999ff', '#99ccff', '#ff6666', '#ffcc66',
  '#66cc99', '#cc6666', '#6699cc', '#cc9966',
];

export class ChartPanel {
  constructor() {
    this.wrapper = document.getElementById('chart-wrapper');
    this.charts = [];
  }

  render(data) {
    if (!data) return;
    clearEmpty(this.wrapper);

    console.log('[chart-panel] render called, data keys:', Object.keys(data));
    console.log('[chart-panel] table:', data.table ? `headers=${data.table.headers?.length}, rows=${data.table.rows?.length}` : 'null');

    // Accept both old format (chartConfig directly) and new format ({ chartConfig, sources, table })
    const chartConfig = data.chartConfig || data;
    const sources = data.sources || [];
    const table = data.table || null;

    const container = document.createElement('div');
    container.className = 'chart-container';

    const title = document.createElement('div');
    title.className = 'lcars-label';
    title.textContent = chartConfig.options?.plugins?.title?.text || 'Visualization';
    container.appendChild(title);

    // Render chart if we have chart data
    if (chartConfig.data?.datasets?.length > 0 && chartConfig.data?.labels?.length > 0) {
      // Assign LCARS colors to datasets
      const datasets = chartConfig.data.datasets.map((ds, i) => ({
        ...ds,
        borderColor: ds.borderColor || LCARS_COLORS[i % LCARS_COLORS.length],
        backgroundColor: ds.backgroundColor || (
          chartConfig.type === 'line'
            ? LCARS_COLORS[i % LCARS_COLORS.length] + '33'
            : LCARS_COLORS[i % LCARS_COLORS.length] + 'aa'
        ),
        borderWidth: ds.borderWidth || 2,
        tension: ds.tension ?? 0.3,
        pointRadius: ds.pointRadius ?? 3,
      }));

      const config = {
        ...chartConfig,
        data: { ...chartConfig.data, datasets },
        options: {
          ...chartConfig.options,
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            ...chartConfig.options?.plugins,
            legend: {
              display: datasets.length > 1,
              labels: { color: '#ff9900', font: { family: 'var(--lcars-font)' } },
            },
            title: {
              ...chartConfig.options?.plugins?.title,
              color: '#ff9900',
              font: { size: 14, family: 'var(--lcars-font)' },
            },
          },
          scales: chartConfig.type !== 'pie' && chartConfig.type !== 'doughnut' && chartConfig.type !== 'radar' ? {
            x: { ticks: { color: '#9999cc' }, grid: { color: '#1a1a3a' } },
            y: { ticks: { color: '#9999cc' }, grid: { color: '#1a1a3a' } },
          } : undefined,
        },
      };

      const canvasWrap = document.createElement('div');
      canvasWrap.style.height = '350px';
      canvasWrap.style.position = 'relative';
      const canvas = document.createElement('canvas');
      canvasWrap.appendChild(canvas);
      container.appendChild(canvasWrap);

      try {
        const chart = new Chart(canvas.getContext('2d'), config);
        this.charts.push(chart);
      } catch (err) {
        canvasWrap.innerHTML = `<p style="color: var(--lcars-red);">Chart error: ${err.message}</p>`;
      }
    }

    // Render table if provided
    if (table && table.headers && table.rows) {
      const tableEl = document.createElement('table');
      tableEl.className = 'chart-table';

      const thead = document.createElement('thead');
      const headerRow = document.createElement('tr');
      for (const h of table.headers) {
        const th = document.createElement('th');
        th.textContent = h;
        headerRow.appendChild(th);
      }
      thead.appendChild(headerRow);
      tableEl.appendChild(thead);

      const tbody = document.createElement('tbody');
      for (const row of table.rows) {
        const tr = document.createElement('tr');
        for (const cell of row) {
          const td = document.createElement('td');
          td.textContent = cell;
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      tableEl.appendChild(tbody);
      container.appendChild(tableEl);
    }

    // Render source citations
    if (sources.length > 0) {
      const citDiv = document.createElement('div');
      citDiv.className = 'chart-sources';
      citDiv.innerHTML = sources.map((s, i) =>
        `<a href="${s.url}" target="_blank" rel="noopener">[${i + 1}] ${s.title || s.url}</a>`
      ).join(' ');
      container.appendChild(citDiv);
    }

    // Insert at top
    this.wrapper.insertBefore(container, this.wrapper.firstChild);
  }

  clear() {
    this.charts.forEach(c => c.destroy());
    this.charts = [];
    this.wrapper.innerHTML = '<div class="empty-state"><div class="empty-state-text">No charts generated</div></div>';
  }
}
