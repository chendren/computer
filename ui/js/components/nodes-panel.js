import { escapeHtml } from '../utils/formatters.js';
import { clearEmpty } from '../utils/lcars-helpers.js';

export class NodesPanel {
  constructor(api, ws) {
    this.api = api;
    this.ws = ws;
    this.container = document.getElementById('nodes-content');
    this.nodes = [];
    this.captureResult = null;
    this.captureNodeId = null;

    this.ws.on('node_event', () => {
      this.loadHistory();
    });
  }

  async loadHistory() {
    try {
      const data = await this.api.get('/gateway/nodes');
      this.nodes = data.nodes || [];
      this.render();
    } catch {
      this.renderOffline();
    }
  }

  async captureCamera(nodeId) {
    this.captureNodeId = nodeId;
    this.captureResult = { loading: true, type: 'camera' };
    this.render();
    try {
      const data = await this.api.post(`/gateway/nodes/${encodeURIComponent(nodeId)}/camera`);
      this.captureResult = { loading: false, type: 'camera', data };
    } catch (err) {
      this.captureResult = { loading: false, type: 'camera', error: err.message };
    }
    this.render();
  }

  async captureScreen(nodeId) {
    this.captureNodeId = nodeId;
    this.captureResult = { loading: true, type: 'screen' };
    this.render();
    try {
      const data = await this.api.post(`/gateway/nodes/${encodeURIComponent(nodeId)}/screen`);
      this.captureResult = { loading: false, type: 'screen', data };
    } catch (err) {
      this.captureResult = { loading: false, type: 'screen', error: err.message };
    }
    this.render();
  }

  render() {
    if (!this.container) return;
    clearEmpty(this.container);

    if (this.nodes.length === 0) {
      this.container.innerHTML = `<div class="empty-state">
        <div class="empty-state-text">No nodes connected</div>
      </div>`;
      return;
    }

    const cards = this.nodes.map(n => {
      const id = n.id || 'unknown';
      const name = n.name || id;
      const platform = n.platform || 'unknown';
      const capabilities = Array.isArray(n.capabilities) ? n.capabilities : [];
      const hasCamera = capabilities.includes('camera');
      const hasScreen = capabilities.includes('screen');

      return `<div class="node-card-large">
        <div class="node-platform-icon">${getPlatformIcon(platform)}</div>
        <div class="node-info">
          <div class="node-name">${escapeHtml(name)}</div>
          <div class="node-platform-label">${escapeHtml(platform)}</div>
          ${capabilities.length > 0 ? `<div class="node-capabilities">${capabilities.map(c => `<span class="channel-cap-badge">${escapeHtml(c)}</span>`).join('')}</div>` : ''}
          <div class="node-actions">
            ${hasCamera ? `<button class="cmd-btn node-action-btn" data-action="camera" data-node="${escapeHtml(id)}" style="font-size:11px;padding:4px 10px;">Camera</button>` : ''}
            ${hasScreen ? `<button class="cmd-btn node-action-btn" data-action="screen" data-node="${escapeHtml(id)}" style="font-size:11px;padding:4px 10px;">Screen</button>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');

    let captureHtml = '';
    if (this.captureResult) {
      if (this.captureResult.loading) {
        captureHtml = `<div class="lcars-divider"></div>
          <div class="lcars-label">Capturing ${this.captureResult.type} from ${escapeHtml(this.captureNodeId || '')}...</div>
          <div class="loading-indicator"><span class="loading-dots">Capturing</span></div>`;
      } else if (this.captureResult.error) {
        captureHtml = `<div class="lcars-divider"></div>
          <div class="lcars-label">Capture Failed</div>
          <div class="empty-state"><div class="empty-state-text">${escapeHtml(this.captureResult.error)}</div></div>`;
      } else {
        const img = this.captureResult.data?.image || this.captureResult.data?.screenshot;
        if (img) {
          captureHtml = `<div class="lcars-divider"></div>
            <div class="lcars-label">${this.captureResult.type} — ${escapeHtml(this.captureNodeId || '')}</div>
            <div class="node-capture-view">
              <img src="data:image/png;base64,${img}" alt="Capture" class="browser-screenshot">
            </div>`;
        } else {
          captureHtml = `<div class="lcars-divider"></div>
            <div class="lcars-label">Capture Result</div>
            <pre class="browser-result">${escapeHtml(JSON.stringify(this.captureResult.data, null, 2))}</pre>`;
        }
      }
    }

    this.container.innerHTML = `<div class="nodes-grid">${cards}</div>${captureHtml}`;

    // Bind action buttons
    this.container.querySelectorAll('.node-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        const nodeId = btn.dataset.node;
        if (action === 'camera') this.captureCamera(nodeId);
        else if (action === 'screen') this.captureScreen(nodeId);
      });
    });
  }

  renderOffline() {
    if (!this.container) return;
    this.container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">&#9670;</div>
      <div class="empty-state-text">Gateway not connected</div>
    </div>`;
  }
}

function getPlatformIcon(platform) {
  switch (platform?.toLowerCase()) {
    case 'macos': case 'darwin': return '\u{1F4BB}';
    case 'ios': case 'iphone': return '\u{1F4F1}';
    case 'android': return '\u{1F4F1}';
    default: return '\u{1F5A5}';
  }
}
