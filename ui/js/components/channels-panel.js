import { escapeHtml, formatTime } from '../utils/formatters.js';
import { clearEmpty } from '../utils/lcars-helpers.js';

// Channel-specific constraints and compose features
const CHANNEL_FEATURES = {
  discord:   { maxLen: 2000, format: 'markdown', label: 'Discord', supports: ['embeds', 'reactions', 'threads', 'media'] },
  slack:     { maxLen: 40000, format: 'mrkdwn', label: 'Slack', supports: ['blocks', 'threads', 'reactions', 'media'] },
  telegram:  { maxLen: 4096, format: 'markdown', label: 'Telegram', supports: ['buttons', 'media', 'stickers'] },
  irc:       { maxLen: 512, format: 'plain', label: 'IRC', supports: [] },
  matrix:    { maxLen: 65536, format: 'html', label: 'Matrix', supports: ['reactions', 'threads', 'media'] },
  whatsapp:  { maxLen: 65536, format: 'plain', label: 'WhatsApp', supports: ['media', 'buttons', 'templates'] },
  signal:    { maxLen: 8000, format: 'plain', label: 'Signal', supports: ['media', 'reactions'] },
  email:     { maxLen: 1000000, format: 'html', label: 'Email', supports: ['subject', 'html', 'attachments', 'threads', 'media'], oauth: 'gmail' },
  gmail:     { maxLen: 1000000, format: 'html', label: 'Gmail', supports: ['subject', 'html', 'attachments', 'threads', 'media'], oauth: 'gmail' },
  teams:     { maxLen: 28000, format: 'html', label: 'Teams', supports: ['cards', 'reactions', 'media'], oauth: 'microsoft' },
  twitch:    { maxLen: 500, format: 'plain', label: 'Twitch', supports: [], oauth: 'twitch' },
  messenger: { maxLen: 2000, format: 'plain', label: 'Messenger', supports: ['media', 'buttons'], oauth: 'facebook' },
  line:      { maxLen: 5000, format: 'plain', label: 'LINE', supports: ['media', 'stickers'] },
  mastodon:  { maxLen: 500, format: 'plain', label: 'Mastodon', supports: ['media'], oauth: 'mastodon' },
  bluesky:   { maxLen: 300, format: 'plain', label: 'Bluesky', supports: ['media'] },
  xmpp:      { maxLen: 65536, format: 'plain', label: 'XMPP', supports: ['media'] },
  sms:       { maxLen: 1600, format: 'plain', label: 'SMS', supports: ['media'] },
  webhook:   { maxLen: 1000000, format: 'json', label: 'Webhook', supports: ['json'] },
  rest:      { maxLen: 1000000, format: 'json', label: 'REST', supports: ['json'] },
  cli:       { maxLen: 1000000, format: 'plain', label: 'CLI', supports: [] },
  nostr:     { maxLen: 65536, format: 'plain', label: 'Nostr', supports: [] },
  wechat:    { maxLen: 2048, format: 'plain', label: 'WeChat', supports: ['media'] },
};

export class ChannelsPanel {
  constructor(api, ws) {
    this.api = api;
    this.ws = ws;
    this.container = document.getElementById('channels-content');
    this.channels = [];
    this.selectedChannel = null;
    this.messages = [];
    this.showConfig = false;
    this.channelConfig = {};
    this.activeView = 'compose'; // compose | inbox | thread
    this.attachments = [];
    this.oauthStatus = {};
    this.inbox = { messages: [], total: 0, offset: 0, folder: 'inbox' };
    this.folders = [];
    this.threadMessages = [];
    this.threadSubject = '';
    this.selectedThreadId = null;

    this.ws.on('channel_message', (data) => {
      this.handleIncomingMessage(data);
    });
  }

  async loadHistory() {
    try {
      const res = await fetch('/api/gateway/channels');
      const data = await res.json();
      this.channels = data.channels || [];
      // Load OAuth status in parallel
      this.loadOAuthStatus();
      this.render();
    } catch {
      this.renderOffline();
    }
  }

  async loadOAuthStatus() {
    try {
      const res = await fetch('/api/gateway/oauth/status');
      const data = await res.json();
      this.oauthStatus = data.providers || {};
    } catch {
      this.oauthStatus = {};
    }
  }

  handleIncomingMessage(data) {
    if (this.selectedChannel && data.channel === this.selectedChannel) {
      this.messages.push(data);
      this.renderMessageFeed();
    }
    const card = this.container?.querySelector(`[data-channel="${data.channel}"]`);
    if (card) {
      card.classList.add('channel-active');
      setTimeout(() => card.classList.remove('channel-active'), 2000);
    }
  }

  selectChannel(channelId) {
    this.selectedChannel = channelId;
    this.messages = [];
    this.showConfig = false;
    this.attachments = [];
    this.activeView = 'compose';
    this.inbox = { messages: [], total: 0, offset: 0, folder: 'inbox' };
    this.threadMessages = [];
    this.selectedThreadId = null;
    this.render();
  }

  getFeatures(channelId) {
    const key = channelId?.toLowerCase().replace(/[^a-z]/g, '');
    return CHANNEL_FEATURES[key] || { maxLen: 2000, format: 'plain', label: channelId, supports: [] };
  }

  hasMediaSupport(features) {
    return features.supports.includes('media') || features.supports.includes('attachments');
  }

  // ── Attachments ──────────────────────────────────

  handleFileSelect(files) {
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) {
        alert(`${file.name} exceeds 25MB limit`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        this.attachments.push({
          name: file.name,
          type: file.type,
          size: file.size,
          data: reader.result.split(',')[1], // base64 without prefix
        });
        this.renderAttachmentPreview();
      };
      reader.readAsDataURL(file);
    }
  }

  removeAttachment(index) {
    this.attachments.splice(index, 1);
    this.renderAttachmentPreview();
  }

  renderAttachmentPreview() {
    const preview = this.container?.querySelector('.attachment-preview');
    if (!preview) return;
    if (this.attachments.length === 0) {
      preview.innerHTML = '';
      return;
    }
    preview.innerHTML = this.attachments.map((a, i) => {
      const isImage = a.type.startsWith('image/');
      const sizeStr = a.size < 1024 ? `${a.size}B` : a.size < 1048576 ? `${(a.size / 1024).toFixed(1)}KB` : `${(a.size / 1048576).toFixed(1)}MB`;
      return `<div class="attachment-item">
        ${isImage ? `<img src="data:${a.type};base64,${a.data}" class="attachment-thumb" alt="">` : `<span class="attachment-file-icon">&#128196;</span>`}
        <span class="attachment-name">${escapeHtml(a.name)}</span>
        <span class="attachment-size">${sizeStr}</span>
        <button class="attachment-remove" data-index="${i}">&times;</button>
      </div>`;
    }).join('');
    preview.querySelectorAll('.attachment-remove').forEach(btn => {
      btn.addEventListener('click', () => this.removeAttachment(parseInt(btn.dataset.index)));
    });
  }

  // ── Send ─────────────────────────────────────────

  async sendMessage() {
    const input = this.container?.querySelector('.channel-send-input');
    const text = input?.value.trim();
    if (!text || !this.selectedChannel) return;

    const features = this.getFeatures(this.selectedChannel);
    if (text.length > features.maxLen) {
      alert(`Message exceeds ${features.label} limit of ${features.maxLen} characters`);
      return;
    }

    const payload = {
      channel: this.selectedChannel,
      target: this.container?.querySelector('.channel-target-input')?.value || '_default',
      text,
    };

    if (features.supports.includes('subject')) {
      const subject = this.container?.querySelector('.channel-subject-input')?.value;
      if (subject) payload.subject = subject;
    }

    if (this.attachments.length > 0) {
      payload.attachments = this.attachments.map(a => ({
        name: a.name,
        type: a.type,
        data: a.data,
      }));
    }

    // Thread reply
    if (this.selectedThreadId) {
      payload.threadId = this.selectedThreadId;
    }

    try {
      await fetch('/api/gateway/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      input.value = '';
      this.attachments = [];
      this.messages.push({
        channel: this.selectedChannel,
        text,
        from: 'computer',
        timestamp: new Date().toISOString(),
        attachments: payload.attachments?.length || 0,
      });
      this.renderMessageFeed();
      this.renderAttachmentPreview();
    } catch (err) {
      console.error('Send failed:', err);
    }
  }

  // ── Config ───────────────────────────────────────

  async toggleConfig() {
    this.showConfig = !this.showConfig;
    if (this.showConfig) {
      await Promise.allSettled([
        this.loadChannelConfig(),
        this.loadOAuthStatus(),
      ]);
    }
    this.render();
  }

  async loadChannelConfig() {
    try {
      const res = await fetch('/api/gateway/channel-config');
      const data = await res.json();
      this.channelConfig = data.channels || {};
    } catch {
      this.channelConfig = {};
    }
  }

  // ── OAuth ────────────────────────────────────────

  async startOAuth(provider) {
    try {
      const res = await fetch(`/api/gateway/oauth/${encodeURIComponent(provider)}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.authUrl) {
        window.open(data.authUrl, `oauth_${provider}`, 'width=600,height=700');
        // Poll for completion
        this.pollOAuthComplete(provider);
      } else {
        alert('Failed to get authorization URL');
      }
    } catch (err) {
      console.error('OAuth start failed:', err);
    }
  }

  async pollOAuthComplete(provider) {
    let attempts = 0;
    const check = async () => {
      attempts++;
      if (attempts > 60) return; // 2min timeout
      await this.loadOAuthStatus();
      const status = this.oauthStatus[provider];
      if (status?.authorized) {
        this.render();
        return;
      }
      setTimeout(check, 2000);
    };
    setTimeout(check, 3000);
  }

  async revokeOAuth(provider) {
    if (!confirm(`Revoke ${provider} authorization?`)) return;
    try {
      await fetch(`/api/gateway/oauth/${encodeURIComponent(provider)}/revoke`, { method: 'POST' });
      await this.loadOAuthStatus();
      this.render();
    } catch (err) {
      console.error('OAuth revoke failed:', err);
    }
  }

  // ── Inbox ────────────────────────────────────────

  async switchView(view) {
    this.activeView = view;
    if (view === 'inbox') {
      await this.loadInbox();
    }
    this.render();
  }

  async loadInbox(offset = 0) {
    try {
      const id = encodeURIComponent(this.selectedChannel);
      const folder = encodeURIComponent(this.inbox.folder);
      const res = await fetch(`/api/gateway/channels/${id}/inbox?limit=25&offset=${offset}&folder=${folder}`);
      const data = await res.json();
      this.inbox.messages = data.messages || [];
      this.inbox.total = data.total || 0;
      this.inbox.offset = offset;
    } catch {
      this.inbox.messages = [];
    }
    // Also load folders
    try {
      const id = encodeURIComponent(this.selectedChannel);
      const res = await fetch(`/api/gateway/channels/${id}/folders`);
      const data = await res.json();
      this.folders = data.folders || [];
    } catch {
      this.folders = [];
    }
  }

  async switchFolder(folder) {
    this.inbox.folder = folder;
    await this.loadInbox(0);
    this.render();
  }

  async openThread(threadId, subject) {
    this.selectedThreadId = threadId;
    this.threadSubject = subject || '';
    this.activeView = 'thread';
    try {
      const id = encodeURIComponent(this.selectedChannel);
      const tid = encodeURIComponent(threadId);
      const res = await fetch(`/api/gateway/channels/${id}/threads/${tid}`);
      const data = await res.json();
      this.threadMessages = data.messages || [];
      if (data.subject) this.threadSubject = data.subject;
    } catch {
      this.threadMessages = [];
    }
    this.render();
  }

  // ── Render ───────────────────────────────────────

  render() {
    if (!this.container) return;
    clearEmpty(this.container);

    if (!Array.isArray(this.channels) || this.channels.length === 0) {
      this.container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">&#9670;</div>
        <div class="empty-state-text">No channels detected</div>
      </div>`;
      return;
    }

    const channelGrid = this.channels.map(ch => {
      const id = typeof ch === 'string' ? ch : (ch.id || ch.name || 'unknown');
      const connected = typeof ch === 'object' ? ch.connected : false;
      const statusClass = connected ? 'status-online' : 'status-offline';
      const selected = this.selectedChannel === id ? 'selected' : '';
      const features = this.getFeatures(id);
      const oauthKey = features.oauth;
      const oauthOk = oauthKey && this.oauthStatus[oauthKey]?.authorized;
      return `<div class="channel-card ${statusClass} ${selected}" data-channel="${escapeHtml(id)}">
        <div class="channel-indicator"></div>
        <div class="channel-name">${escapeHtml(features.label)}</div>
        <div class="channel-status-label">${connected ? 'ONLINE' : 'OFFLINE'}</div>
        <div class="channel-card-footer">
          <div class="channel-format-badge">${features.format}</div>
          ${oauthKey ? `<div class="channel-oauth-badge ${oauthOk ? 'authorized' : 'unauthorized'}">${oauthOk ? 'AUTH' : 'NO AUTH'}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    const features = this.selectedChannel ? this.getFeatures(this.selectedChannel) : null;
    const hasThreads = features?.supports.includes('threads');
    const hasMedia = features ? this.hasMediaSupport(features) : false;

    let feedHtml = '';
    if (this.selectedChannel) {
      // View tabs
      const viewTabs = `<div class="knowledge-tabs channel-view-tabs">
        <button class="knowledge-tab ${this.activeView === 'compose' ? 'active' : ''}" data-view="compose">Compose</button>
        ${hasThreads || features?.supports.includes('subject') ? `<button class="knowledge-tab ${this.activeView === 'inbox' ? 'active' : ''}" data-view="inbox">Inbox</button>` : ''}
        ${this.activeView === 'thread' ? `<button class="knowledge-tab active" data-view="thread">Thread</button>` : ''}
      </div>`;

      feedHtml = `
        <div class="lcars-divider"></div>
        <div class="channel-compose-header">
          <div class="lcars-label">${escapeHtml(features.label)} — ${features.format} format, max ${features.maxLen} chars</div>
          <button class="cmd-btn channel-config-btn" style="font-size:11px;padding:4px 12px;">${this.showConfig ? 'Hide Config' : 'Configure'}</button>
        </div>
        ${this.showConfig ? this.renderConfigPanel(features) : ''}
        ${features.supports.length > 0 ? `<div class="channel-capabilities">${features.supports.map(s => `<span class="channel-cap-badge">${s}</span>`).join('')}</div>` : ''}
        ${viewTabs}
        ${this.activeView === 'compose' ? this.renderComposeView(features, hasMedia) : ''}
        ${this.activeView === 'inbox' ? this.renderInboxView(features) : ''}
        ${this.activeView === 'thread' ? this.renderThreadView(features, hasMedia) : ''}
      `;
    }

    this.container.innerHTML = `
      <div class="channel-grid">${channelGrid}</div>
      ${feedHtml}
    `;

    this.bindHandlers(features, hasMedia);
  }

  renderComposeView(features, hasMedia) {
    return `
      <div class="channel-feed" id="channel-feed"></div>
      ${hasMedia ? `<div class="attachment-preview"></div>` : ''}
      <div class="channel-send-area">
        <input type="text" class="command-input channel-target-input" placeholder="Target (#channel, @user)" value="_default" style="max-width:180px" autocomplete="off">
        ${features.supports.includes('subject') ? `<input type="text" class="command-input channel-subject-input" placeholder="Subject..." style="max-width:200px" autocomplete="off">` : ''}
        <input type="text" class="command-input channel-send-input" placeholder="Message (${features.format})..." autocomplete="off">
        <span class="channel-char-count" id="char-count">0/${features.maxLen}</span>
        ${hasMedia ? `<label class="cmd-btn channel-attach-btn" style="font-size:11px;padding:6px 12px;cursor:pointer;">Attach<input type="file" class="channel-file-input" multiple hidden></label>` : ''}
        <button class="cmd-btn channel-send-btn">Send</button>
      </div>
    `;
  }

  renderInboxView(features) {
    const folderList = this.folders.length > 0
      ? `<div class="inbox-folders">
          ${this.folders.map(f => {
            const name = typeof f === 'string' ? f : (f.name || f.id || 'unknown');
            const count = typeof f === 'object' ? (f.count || f.total || '') : '';
            return `<button class="knowledge-tab inbox-folder-btn ${this.inbox.folder === name ? 'active' : ''}" data-folder="${escapeHtml(name)}">${escapeHtml(name)}${count ? ` (${count})` : ''}</button>`;
          }).join('')}
        </div>`
      : '';

    const msgs = this.inbox.messages;
    const msgList = msgs.length === 0
      ? `<div class="empty-state"><div class="empty-state-text">No messages in ${escapeHtml(this.inbox.folder)}</div></div>`
      : `<div class="inbox-list">
          ${msgs.map(m => {
            const from = m.from || m.sender || m.nick || 'unknown';
            const subject = m.subject || m.text?.slice(0, 80) || '(no subject)';
            const date = m.date || m.timestamp || '';
            const unread = m.unread !== false;
            const threadId = m.threadId || m.id || m.messageId || '';
            const snippet = m.snippet || m.preview || m.text?.slice(0, 120) || '';
            const hasAttachments = m.attachments?.length > 0 || m.hasAttachments;
            return `<div class="inbox-item ${unread ? 'unread' : ''}" data-thread="${escapeHtml(threadId)}" data-subject="${escapeHtml(subject)}">
              <div class="inbox-item-header">
                <span class="inbox-from">${escapeHtml(from)}</span>
                ${hasAttachments ? '<span class="inbox-attach-icon">&#128206;</span>' : ''}
                <span class="inbox-date">${date ? formatTime(date) : ''}</span>
              </div>
              <div class="inbox-subject">${escapeHtml(subject)}</div>
              ${snippet ? `<div class="inbox-snippet">${escapeHtml(snippet)}</div>` : ''}
            </div>`;
          }).join('')}
        </div>`;

    const pageTotal = this.inbox.total;
    const pageStart = this.inbox.offset + 1;
    const pageEnd = Math.min(this.inbox.offset + 25, pageTotal);
    const pagination = pageTotal > 25
      ? `<div class="inbox-pagination">
          <button class="cmd-btn inbox-prev-btn" style="font-size:11px;padding:4px 12px;" ${this.inbox.offset === 0 ? 'disabled' : ''}>Prev</button>
          <span class="inbox-page-info">${pageStart}–${pageEnd} of ${pageTotal}</span>
          <button class="cmd-btn inbox-next-btn" style="font-size:11px;padding:4px 12px;" ${pageEnd >= pageTotal ? 'disabled' : ''}>Next</button>
        </div>`
      : '';

    return `
      ${folderList}
      ${msgList}
      ${pagination}
    `;
  }

  renderThreadView(features, hasMedia) {
    const msgs = this.threadMessages;
    const msgHtml = msgs.length === 0
      ? `<div class="empty-state"><div class="empty-state-text">Loading thread...</div></div>`
      : msgs.map(m => {
          const from = m.from || m.sender || m.role || 'unknown';
          const text = m.text || m.content || m.body || '';
          const date = m.date || m.timestamp || '';
          const attachments = Array.isArray(m.attachments) ? m.attachments : [];
          return `<div class="thread-message">
            <div class="thread-msg-header">
              <span class="channel-msg-from">${escapeHtml(from)}</span>
              <span class="channel-msg-time">${date ? formatTime(date) : ''}</span>
            </div>
            <div class="thread-msg-body">${escapeHtml(typeof text === 'string' ? text : JSON.stringify(text))}</div>
            ${attachments.length > 0 ? `<div class="thread-attachments">${attachments.map(a => {
              const name = a.name || a.filename || 'attachment';
              return `<span class="thread-attachment-badge">&#128206; ${escapeHtml(name)}</span>`;
            }).join('')}</div>` : ''}
          </div>`;
        }).join('');

    return `
      <div class="thread-header">
        <button class="cmd-btn thread-back-btn" style="font-size:11px;padding:4px 12px;">Back</button>
        <span class="lcars-label" style="margin:0">${escapeHtml(this.threadSubject)}</span>
      </div>
      <div class="thread-feed">${msgHtml}</div>
      ${hasMedia ? `<div class="attachment-preview"></div>` : ''}
      <div class="channel-send-area">
        <input type="text" class="command-input channel-send-input" placeholder="Reply..." autocomplete="off">
        ${hasMedia ? `<label class="cmd-btn channel-attach-btn" style="font-size:11px;padding:6px 12px;cursor:pointer;">Attach<input type="file" class="channel-file-input" multiple hidden></label>` : ''}
        <button class="cmd-btn channel-send-btn">Reply</button>
      </div>
    `;
  }

  renderConfigPanel(features) {
    const cfg = this.channelConfig[this.selectedChannel] || {};
    const entries = Object.entries(cfg);
    const oauthKey = features?.oauth;

    let oauthHtml = '';
    if (oauthKey) {
      const status = this.oauthStatus[oauthKey];
      const authorized = status?.authorized;
      const email = status?.email || status?.user || '';
      oauthHtml = `<div class="channel-oauth-section">
        <div class="lcars-label" style="margin-bottom:8px">Authorization — ${escapeHtml(oauthKey)}</div>
        ${authorized
          ? `<div class="oauth-status-row">
              <span class="oauth-status authorized">AUTHORIZED</span>
              ${email ? `<span class="oauth-email">${escapeHtml(email)}</span>` : ''}
              <button class="cmd-btn oauth-revoke-btn" data-provider="${escapeHtml(oauthKey)}" style="font-size:11px;padding:4px 10px;background:var(--lcars-red)">Revoke</button>
            </div>`
          : `<div class="oauth-status-row">
              <span class="oauth-status unauthorized">NOT AUTHORIZED</span>
              <button class="cmd-btn oauth-start-btn" data-provider="${escapeHtml(oauthKey)}" style="font-size:11px;padding:4px 10px;background:var(--lcars-green)">Authorize ${escapeHtml(oauthKey)}</button>
            </div>`
        }
        ${oauthKey === 'gmail' ? `<div class="oauth-hint">Authorizes Gmail API access for reading, sending, and managing email through this channel.</div>` : ''}
      </div>`;
    }

    const configHtml = entries.length === 0
      ? `<div class="empty-state" style="min-height:auto;padding:12px"><div class="empty-state-text" style="font-size:12px">No additional configuration</div></div>`
      : entries.map(([key, val]) => `
          <div class="config-row">
            <span class="config-key">${escapeHtml(key)}</span>
            <span class="config-value">${escapeHtml(typeof val === 'object' ? JSON.stringify(val) : String(val))}</span>
          </div>
        `).join('');

    return `<div class="channel-config-panel">
      ${oauthHtml}
      ${entries.length > 0 ? `<div class="lcars-label" style="margin:8px 0">Configuration</div>` : ''}
      ${configHtml}
    </div>`;
  }

  renderMessageFeed() {
    const feed = this.container?.querySelector('#channel-feed');
    if (!feed) return;
    if (this.messages.length === 0) {
      feed.innerHTML = '<div class="empty-state"><div class="empty-state-text">No messages</div></div>';
      return;
    }
    feed.innerHTML = this.messages.slice(-50).map(m => `
      <div class="channel-message ${m.from === 'computer' ? 'outgoing' : 'incoming'}">
        <span class="channel-msg-from">${escapeHtml(m.from || m.nick || 'unknown')}</span>
        <span class="channel-msg-text">${escapeHtml(m.text || '')}</span>
        ${m.attachments ? `<span class="channel-msg-attach">&#128206; ${m.attachments}</span>` : ''}
        <span class="channel-msg-time">${m.timestamp ? formatTime(m.timestamp) : ''}</span>
      </div>
    `).join('');
    feed.scrollTop = feed.scrollHeight;
  }

  // ── Event Binding ────────────────────────────────

  bindHandlers(features, hasMedia) {
    // Channel card clicks
    this.container.querySelectorAll('.channel-card').forEach(card => {
      card.addEventListener('click', () => this.selectChannel(card.dataset.channel));
    });

    // View tab clicks
    this.container.querySelectorAll('.channel-view-tabs .knowledge-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchView(tab.dataset.view));
    });

    // Config toggle
    const configBtn = this.container.querySelector('.channel-config-btn');
    if (configBtn) configBtn.addEventListener('click', () => this.toggleConfig());

    // Send
    const sendBtn = this.container.querySelector('.channel-send-btn');
    const sendInput = this.container.querySelector('.channel-send-input');
    if (sendBtn) sendBtn.addEventListener('click', () => this.sendMessage());
    if (sendInput) {
      sendInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.sendMessage(); });
      sendInput.addEventListener('input', () => {
        const counter = this.container.querySelector('#char-count');
        if (counter && features) counter.textContent = `${sendInput.value.length}/${features.maxLen}`;
      });
    }

    // File attachments
    if (hasMedia) {
      const fileInput = this.container.querySelector('.channel-file-input');
      if (fileInput) {
        fileInput.addEventListener('change', () => {
          this.handleFileSelect(fileInput.files);
          fileInput.value = '';
        });
      }
    }

    // OAuth buttons
    this.container.querySelectorAll('.oauth-start-btn').forEach(btn => {
      btn.addEventListener('click', () => this.startOAuth(btn.dataset.provider));
    });
    this.container.querySelectorAll('.oauth-revoke-btn').forEach(btn => {
      btn.addEventListener('click', () => this.revokeOAuth(btn.dataset.provider));
    });

    // Inbox items
    this.container.querySelectorAll('.inbox-item').forEach(item => {
      item.addEventListener('click', () => {
        this.openThread(item.dataset.thread, item.dataset.subject);
      });
    });

    // Inbox pagination
    const prevBtn = this.container.querySelector('.inbox-prev-btn');
    const nextBtn = this.container.querySelector('.inbox-next-btn');
    if (prevBtn) prevBtn.addEventListener('click', async () => { await this.loadInbox(Math.max(0, this.inbox.offset - 25)); this.render(); });
    if (nextBtn) nextBtn.addEventListener('click', async () => { await this.loadInbox(this.inbox.offset + 25); this.render(); });

    // Folder buttons
    this.container.querySelectorAll('.inbox-folder-btn').forEach(btn => {
      btn.addEventListener('click', () => this.switchFolder(btn.dataset.folder));
    });

    // Thread back
    const backBtn = this.container.querySelector('.thread-back-btn');
    if (backBtn) backBtn.addEventListener('click', () => this.switchView('inbox'));

    // Render feed if on compose view
    if (this.activeView === 'compose') this.renderMessageFeed();
    if (hasMedia) this.renderAttachmentPreview();
  }

  renderOffline() {
    if (!this.container) return;
    this.container.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">&#9670;</div>
      <div class="empty-state-text">Gateway not connected</div>
    </div>`;
  }
}
