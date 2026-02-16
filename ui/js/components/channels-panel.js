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
    this.gmailStatus = null;
    this.inboxSummary = null;
    this.priorityView = false;
    this.followups = [];
    this.showFollowups = false;
    this.threadSummary = null;
    this._followupsLoading = false;

    this.ws.on('channel_message', (data) => {
      this.handleIncomingMessage(data);
    });
  }

  async loadHistory() {
    // Load Gmail status directly (bypasses gateway)
    try {
      this.gmailStatus = await this.api.get('/gmail/status');
    } catch {
      this.gmailStatus = null;
    }

    // Also try gateway channels
    try {
      const data = await this.api.get('/gateway/channels');
      this.channels = data.channels || [];
      this.loadOAuthStatus();
    } catch {
      this.channels = [];
    }

    // Always show Gmail as a channel if credentials exist
    if (this.gmailStatus && this.gmailStatus.hasCredentials) {
      const hasGmail = this.channels.some(ch => {
        const id = typeof ch === 'string' ? ch : (ch.id || ch.name || '');
        return id.toLowerCase() === 'gmail';
      });
      if (!hasGmail) {
        this.channels.unshift({
          id: 'gmail',
          name: 'Gmail',
          connected: this.gmailStatus.connected,
          email: this.gmailStatus.email,
          direct: true,
        });
      }
    } else if (this.gmailStatus === null || (this.gmailStatus && !this.gmailStatus.hasCredentials)) {
      // Show Gmail as available but needs setup
      const hasGmail = this.channels.some(ch => {
        const id = typeof ch === 'string' ? ch : (ch.id || ch.name || '');
        return id.toLowerCase() === 'gmail';
      });
      if (!hasGmail) {
        this.channels.unshift({
          id: 'gmail',
          name: 'Gmail',
          connected: false,
          direct: true,
          needsSetup: !this.gmailStatus?.hasCredentials,
        });
      }
    }

    if (this.channels.length === 0) {
      this.renderOffline();
    } else {
      this.render();
    }
  }

  async loadOAuthStatus() {
    try {
      const data = await this.api.get('/gateway/oauth/status');
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
    this.inbox = { messages: [], total: 0, offset: 0, folder: 'inbox' };
    this.threadMessages = [];
    this.selectedThreadId = null;
    this.inboxSummary = null;
    this.priorityView = false;
    this.followups = [];
    this.showFollowups = false;
    this.threadSummary = null;

    // Gmail defaults to inbox view
    if (this._isGmailSelected(channelId)) {
      this.activeView = 'inbox';
      this.switchView('inbox').then(() => {
        // Auto-load intelligence in background
        this.loadPriorities();
        this.loadInboxSummary();
      });
    } else {
      this.activeView = 'compose';
      this.render();
    }
  }

  _isGmailSelected(channelId) {
    const id = (channelId || '').toLowerCase();
    return id === 'gmail' || id === 'email';
  }

  // ── Gmail Intelligence ──────────────────────────────

  async loadInboxSummary() {
    try {
      this.inboxSummary = { loading: true };
      this.render();
      this.inboxSummary = await this.api.get('/gmail/summary');
      this.render();
    } catch {
      this.inboxSummary = null;
      this.render();
    }
  }

  async loadPriorities() {
    try {
      this.priorityView = true;
      this.render();
      const data = await this.api.get('/gmail/priorities');
      this.inbox.messages = data.messages || [];
      this.render();
    } catch {
      this.priorityView = false;
      this.render();
    }
  }

  async loadFollowups() {
    try {
      this.showFollowups = true;
      this._followupsLoading = true;
      this.followups = [];
      this.render();
      const data = await this.api.get('/gmail/followups');
      this.followups = data.followups || [];
      this._followupsLoading = false;
      this.render();
    } catch {
      this._followupsLoading = false;
      this.followups = [];
      this.render();
    }
  }

  async loadThreadSummary() {
    if (!this.selectedThreadId) return;
    try {
      this.threadSummary = { loading: true };
      this.render();
      const tid = encodeURIComponent(this.selectedThreadId);
      this.threadSummary = await this.api.get(`/gmail/threads/${tid}/summary`);
      this.render();
    } catch {
      this.threadSummary = null;
      this.render();
    }
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

  async sendGmail() {
    const to = this.container?.querySelector('.gmail-to-input')?.value?.trim();
    const subject = this.container?.querySelector('.gmail-subject-input')?.value?.trim();
    const body = this.container?.querySelector('.gmail-body-input')?.value?.trim();
    if (!to || !body) return;

    const sendBtn = this.container?.querySelector('.gmail-send-btn');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = 'Sending...'; }

    try {
      const payload = { to, subject: subject || '', body };
      // If replying to a thread
      if (this.selectedThreadId && this.activeView === 'thread') {
        payload.threadId = this.selectedThreadId;
        // Find the last message's Message-ID for threading
        const lastMsg = this.threadMessages[this.threadMessages.length - 1];
        if (lastMsg && lastMsg.messageId) payload.inReplyTo = lastMsg.messageId;
      }
      const result = await this.api.post('/gmail/send', payload);
      // Clear compose form
      const toInput = this.container?.querySelector('.gmail-to-input');
      const subjectInput = this.container?.querySelector('.gmail-subject-input');
      const bodyInput = this.container?.querySelector('.gmail-body-input');
      if (toInput) toInput.value = '';
      if (subjectInput) subjectInput.value = '';
      if (bodyInput) bodyInput.value = '';
      this._gmailSentConfirm = `Sent to ${to}`;
      this.render();
      // Clear confirmation after 3 seconds
      setTimeout(() => { this._gmailSentConfirm = null; this.render(); }, 3000);
    } catch (err) {
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Send'; }
      alert('Send failed: ' + (err.message || 'Unknown error'));
    }
  }

  async replyGmail() {
    const input = this.container?.querySelector('.channel-send-input');
    const body = input?.value?.trim();
    if (!body || !this.selectedThreadId) return;

    const replyBtn = this.container?.querySelector('.channel-send-btn');
    if (replyBtn) { replyBtn.disabled = true; replyBtn.textContent = 'Sending...'; }

    try {
      // Get the original sender to reply to
      const lastMsg = this.threadMessages[this.threadMessages.length - 1];
      const to = lastMsg?.from || '';
      const subject = this.threadSubject.startsWith('Re:') ? this.threadSubject : 'Re: ' + this.threadSubject;
      const payload = { to, subject, body, threadId: this.selectedThreadId };
      if (lastMsg && lastMsg.messageId) payload.inReplyTo = lastMsg.messageId;

      await this.api.post('/gmail/send', payload);
      input.value = '';
      // Add to local thread display
      this.threadMessages.push({
        from: this.gmailStatus?.email || 'me',
        body,
        date: new Date().toISOString(),
      });
      this.render();
    } catch (err) {
      if (replyBtn) { replyBtn.disabled = false; replyBtn.textContent = 'Reply'; }
      alert('Reply failed: ' + (err.message || 'Unknown error'));
    }
  }

  async sendMessage() {
    // Gmail uses dedicated send methods
    if (this._isGmailChannel()) {
      if (this.activeView === 'thread') return this.replyGmail();
      return this.sendGmail();
    }

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
      await this.api.post('/gateway/send', payload);
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
      const data = await this.api.get('/gateway/channel-config');
      this.channelConfig = data.channels || {};
    } catch {
      this.channelConfig = {};
    }
  }

  // ── OAuth ────────────────────────────────────────

  async startOAuth(provider) {
    // Gmail uses direct OAuth flow
    if (provider === 'gmail') {
      window.open('/api/gmail/auth/start', 'oauth_gmail', 'width=600,height=700');
      this.pollGmailOAuth();
      return;
    }
    try {
      const data = await this.api.post(`/gateway/oauth/${encodeURIComponent(provider)}/start`, {});
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

  async pollGmailOAuth() {
    let attempts = 0;
    const check = async () => {
      attempts++;
      if (attempts > 60) return;
      try {
        this.gmailStatus = await this.api.get('/gmail/status');
        if (this.gmailStatus.connected) {
          // Update channel state
          const ch = this.channels.find(c => (typeof c === 'string' ? c : c.id) === 'gmail');
          if (ch && typeof ch === 'object') {
            ch.connected = true;
            ch.email = this.gmailStatus.email;
          }
          this.render();
          return;
        }
      } catch {}
      setTimeout(check, 2000);
    };
    setTimeout(check, 3000);
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
    if (provider === 'gmail') {
      try {
        await this.api.post('/gmail/auth/revoke');
        this.gmailStatus = { connected: false, hasCredentials: true };
        const ch = this.channels.find(c => (typeof c === 'string' ? c : c.id) === 'gmail');
        if (ch && typeof ch === 'object') {
          ch.connected = false;
          ch.email = null;
        }
        this.render();
      } catch (err) {
        console.error('Gmail revoke failed:', err);
      }
      return;
    }
    try {
      await this.api.post(`/gateway/oauth/${encodeURIComponent(provider)}/revoke`);
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
    // Gmail uses direct API
    if (this._isGmailChannel()) {
      try {
        const data = await this.api.get(`/gmail/inbox?max=25`);
        this.inbox.messages = data.messages || [];
        this.inbox.total = data.total || 0;
        this.inbox.offset = 0;
      } catch {
        this.inbox.messages = [];
      }
      try {
        const data = await this.api.get('/gmail/labels');
        this.folders = (data.labels || [])
          .filter(l => l.type === 'system' || l.type === 'user')
          .map(l => ({ name: l.name, id: l.id, count: l.messagesTotal }));
      } catch {
        this.folders = [];
      }
      return;
    }
    try {
      const id = encodeURIComponent(this.selectedChannel);
      const folder = encodeURIComponent(this.inbox.folder);
      const data = await this.api.get(`/gateway/channels/${id}/inbox?limit=25&offset=${offset}&folder=${folder}`);
      this.inbox.messages = data.messages || [];
      this.inbox.total = data.total || 0;
      this.inbox.offset = offset;
    } catch {
      this.inbox.messages = [];
    }
    // Also load folders
    try {
      const id = encodeURIComponent(this.selectedChannel);
      const data = await this.api.get(`/gateway/channels/${id}/folders`);
      this.folders = data.folders || [];
    } catch {
      this.folders = [];
    }
  }

  _isGmailChannel() {
    if (!this.selectedChannel) return false;
    const id = this.selectedChannel.toLowerCase();
    return id === 'gmail' || id === 'email';
  }

  async switchFolder(folder) {
    this.inbox.folder = folder;
    await this.loadInbox(0);
    this.render();
  }

  async openThread(threadId, subject) {
    this.selectedThreadId = threadId;
    this.threadSubject = subject || '';
    this.threadSummary = null;
    this.activeView = 'thread';
    if (this._isGmailChannel()) {
      try {
        const tid = encodeURIComponent(threadId);
        const data = await this.api.get(`/gmail/threads/${tid}`);
        this.threadMessages = data.messages || [];
        if (data.subject) this.threadSubject = data.subject;
      } catch {
        this.threadMessages = [];
      }
      // Mark as read in Gmail
      const msgInInbox = this.inbox.messages.find(msg => msg.threadId === threadId || msg.id === threadId);
      if (msgInInbox && msgInInbox.unread) {
        msgInInbox.unread = false;
        this.api.post(`/gmail/messages/${encodeURIComponent(msgInInbox.id)}/read`).catch(() => {});
      }
    } else {
      try {
        const id = encodeURIComponent(this.selectedChannel);
        const tid = encodeURIComponent(threadId);
        const data = await this.api.get(`/gateway/channels/${id}/threads/${tid}`);
        this.threadMessages = data.messages || [];
        if (data.subject) this.threadSubject = data.subject;
      } catch {
        this.threadMessages = [];
      }
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
      const isDirect = typeof ch === 'object' && ch.direct;
      const email = typeof ch === 'object' ? ch.email : null;
      const needsSetup = typeof ch === 'object' ? ch.needsSetup : false;

      // For Gmail direct: use gmailStatus
      const oauthOk = isDirect && oauthKey === 'gmail'
        ? this.gmailStatus?.connected
        : (oauthKey && this.oauthStatus[oauthKey]?.authorized);

      return `<div class="channel-card ${statusClass} ${selected}" data-channel="${escapeHtml(id)}">
        <div class="channel-indicator"></div>
        <div class="channel-name">${escapeHtml(features.label)}</div>
        ${email ? `<div class="channel-email">${escapeHtml(email)}</div>` : ''}
        <div class="channel-status-label">${connected ? 'ONLINE' : needsSetup ? 'SETUP' : 'OFFLINE'}</div>
        <div class="channel-card-footer">
          <div class="channel-format-badge">${features.format}</div>
          ${oauthKey ? `<div class="channel-oauth-badge ${oauthOk ? 'authorized' : 'unauthorized'}">${oauthOk ? 'AUTH' : needsSetup ? 'SETUP' : 'NO AUTH'}</div>` : ''}
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
    // Gmail gets a dedicated compose form
    if (this._isGmailChannel() && this.gmailStatus?.connected) {
      return `
        <div class="gmail-compose">
          ${this._gmailSentConfirm ? `<div class="gmail-sent-confirm">${escapeHtml(this._gmailSentConfirm)}</div>` : ''}
          <div class="gmail-compose-fields">
            <div class="gmail-field-row">
              <label class="gmail-field-label">TO</label>
              <input type="text" class="command-input gmail-to-input" placeholder="recipient@example.com" autocomplete="off">
            </div>
            <div class="gmail-field-row">
              <label class="gmail-field-label">SUBJECT</label>
              <input type="text" class="command-input gmail-subject-input" placeholder="Subject..." autocomplete="off">
            </div>
            <div class="gmail-field-row gmail-body-row">
              <textarea class="command-input gmail-body-input" placeholder="Write your message..." rows="8"></textarea>
            </div>
          </div>
          <div class="gmail-compose-actions">
            <button class="cmd-btn gmail-send-btn" style="background:var(--lcars-green)">Send</button>
            <span class="gmail-compose-hint">Sending as ${escapeHtml(this.gmailStatus?.email || 'connected account')}</span>
          </div>
        </div>
      `;
    }

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
    // Gmail intelligence toolbar
    let intelToolbar = '';
    if (this._isGmailChannel() && this.gmailStatus?.connected) {
      const unreadCount = this.inbox.messages.filter(m => m.unread).length;
      const totalCount = this.inbox.messages.length;
      intelToolbar = `<div class="gmail-intel-toolbar">
        <div class="gmail-inbox-stats">
          <span class="inbox-stat">${totalCount} messages</span>
          ${unreadCount > 0 ? `<span class="inbox-stat inbox-stat-unread">${unreadCount} unread</span>` : '<span class="inbox-stat inbox-stat-clear">all read</span>'}
        </div>
        <div class="gmail-intel-buttons">
          <button class="cmd-btn gmail-summarize-btn ${this.inboxSummary && !this.inboxSummary.loading ? 'done' : ''}" style="font-size:11px;padding:4px 12px;">${this.inboxSummary?.loading ? 'Analyzing...' : 'Summarize'}</button>
          <button class="cmd-btn gmail-priorities-btn ${this.priorityView ? 'active' : ''}" style="font-size:11px;padding:4px 12px;">${this.priorityView && !this.inbox.messages.some(m => m.priority) ? 'Loading...' : 'Priorities'}</button>
          <button class="cmd-btn gmail-followups-btn ${this.showFollowups ? 'active' : ''}" style="font-size:11px;padding:4px 12px;">Follow-ups</button>
          <button class="cmd-btn gmail-refresh-btn" style="font-size:11px;padding:4px 12px;">Refresh</button>
        </div>
      </div>`;
    }

    // Inbox summary card
    let summaryHtml = '';
    if (this.inboxSummary) {
      if (this.inboxSummary.loading) {
        summaryHtml = `<div class="inbox-summary-card"><span class="lcars-loading"></span> Analyzing inbox...</div>`;
      } else {
        const urgent = (this.inboxSummary.urgentItems || []).map(u =>
          `<div class="summary-urgent-item"><span class="priority-badge priority-urgent">URGENT</span> ${escapeHtml(u.from || '')}: ${escapeHtml(u.subject || '')} — ${escapeHtml(u.reason || '')}</div>`
        ).join('');
        const needsReply = (this.inboxSummary.needsReply || []).map(n =>
          `<div class="summary-reply-item"><span class="priority-badge priority-action">REPLY</span> ${escapeHtml(n.from || '')}: ${escapeHtml(n.subject || '')}</div>`
        ).join('');
        summaryHtml = `<div class="inbox-summary-card">
          <div class="summary-text">${escapeHtml(this.inboxSummary.summary || '')}</div>
          ${(this.inboxSummary.keyTopics || []).length > 0 ? `<div class="summary-topics">${this.inboxSummary.keyTopics.map(t => `<span class="summary-topic-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
          ${urgent}${needsReply}
        </div>`;
      }
    }

    // Follow-ups panel
    let followupsHtml = '';
    if (this.showFollowups) {
      if (this.followups.length === 0 && this._followupsLoading) {
        followupsHtml = `<div class="followup-panel"><div class="empty-state" style="min-height:auto;padding:12px"><div class="empty-state-text" style="font-size:12px">Analyzing follow-ups...</div></div></div>`;
      } else if (this.followups.length === 0) {
        followupsHtml = `<div class="followup-panel"><div class="empty-state" style="min-height:auto;padding:12px"><div class="empty-state-text" style="font-size:12px">No follow-ups needed. Your inbox is clear.</div></div></div>`;
      } else {
        followupsHtml = `<div class="followup-panel">
          ${this.followups.map(f => {
            const urgencyCls = f.urgency === 'high' ? 'priority-urgent' : f.urgency === 'medium' ? 'priority-action' : 'priority-fyi';
            return `<div class="followup-item">
              <span class="priority-badge ${urgencyCls}">${escapeHtml(f.type || 'follow-up')}</span>
              <span class="followup-from">${escapeHtml(f.from || '')}</span>
              <span class="followup-subject">${escapeHtml(f.subject || '')}</span>
              <div class="followup-reason">${escapeHtml(f.reason || '')}</div>
            </div>`;
          }).join('')}
        </div>`;
      }
    }

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

    // Group messages by priority when priority data available
    const hasPriority = msgs.some(m => m.priority && m.priority !== 'fyi');
    let groupedMsgHtml = '';
    if (hasPriority) {
      const order = ['urgent', 'action-required', 'fyi', 'promotional', 'automated'];
      const groupLabels = { urgent: 'REQUIRES ATTENTION', 'action-required': 'ACTION NEEDED', fyi: 'INFORMATIONAL', promotional: 'PROMOTIONS', automated: 'AUTOMATED' };
      for (const pri of order) {
        const group = msgs.filter(m => m.priority === pri);
        if (group.length === 0) continue;
        groupedMsgHtml += `<div class="inbox-group-header">${groupLabels[pri] || pri.toUpperCase()} (${group.length})</div>`;
        groupedMsgHtml += group.map(m => this._renderInboxItem(m)).join('');
      }
      // Any without priority
      const ungrouped = msgs.filter(m => !m.priority || !order.includes(m.priority));
      if (ungrouped.length > 0) {
        groupedMsgHtml += `<div class="inbox-group-header">OTHER (${ungrouped.length})</div>`;
        groupedMsgHtml += ungrouped.map(m => this._renderInboxItem(m)).join('');
      }
    }

    const msgList = msgs.length === 0
      ? `<div class="empty-state"><div class="empty-state-text">No messages in ${escapeHtml(this.inbox.folder)}</div></div>`
      : `<div class="inbox-list">${hasPriority ? groupedMsgHtml : msgs.map(m => this._renderInboxItem(m)).join('')}</div>`;

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
      ${intelToolbar}
      ${summaryHtml}
      ${followupsHtml}
      ${folderList}
      ${msgList}
      ${pagination}
    `;
  }

  _renderInboxItem(m) {
    const from = m.from || m.sender || m.nick || 'unknown';
    const displayFrom = from.split('<')[0].trim() || from;
    const subject = m.subject || m.text?.slice(0, 80) || '(no subject)';
    const date = m.date || m.timestamp || '';
    const unread = m.unread !== false;
    const threadId = m.threadId || m.id || m.messageId || '';
    const snippet = m.snippet || m.preview || m.text?.slice(0, 120) || '';
    const hasAttachments = m.attachments?.length > 0 || m.hasAttachments;
    const priority = m.priority || '';
    const priorityCls = priority ? `priority-${priority}` : '';
    const dimClass = (priority === 'promotional' || priority === 'automated') ? 'inbox-item-dim' : '';
    return `<div class="inbox-item ${unread ? 'unread' : ''} ${dimClass}" data-thread="${escapeHtml(threadId)}" data-subject="${escapeHtml(subject)}">
      <div class="inbox-item-header">
        ${priority ? `<span class="priority-badge ${priorityCls}">${escapeHtml(priority)}</span>` : ''}
        <span class="inbox-from">${escapeHtml(displayFrom)}</span>
        ${hasAttachments ? '<span class="inbox-attach-icon">&#128206;</span>' : ''}
        <span class="inbox-date">${date ? formatTime(date) : ''}</span>
      </div>
      <div class="inbox-subject">${escapeHtml(subject)}</div>
      ${snippet && !dimClass ? `<div class="inbox-snippet">${escapeHtml(snippet)}</div>` : ''}
      ${m.priorityReason && !dimClass ? `<div class="inbox-priority-reason">${escapeHtml(m.priorityReason)}</div>` : ''}
    </div>`;
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

    // Thread summary for Gmail
    let threadSummaryHtml = '';
    if (this._isGmailChannel()) {
      if (this.threadSummary) {
        if (this.threadSummary.loading) {
          threadSummaryHtml = `<div class="inbox-summary-card"><span class="lcars-loading"></span> Summarizing thread...</div>`;
        } else {
          const actions = (this.threadSummary.actionItems || []).map(a =>
            `<div class="summary-action-item"><span class="priority-badge priority-action">ACTION</span> ${escapeHtml(a.assignee || '')}: ${escapeHtml(a.action || '')}</div>`
          ).join('');
          threadSummaryHtml = `<div class="inbox-summary-card">
            <div class="summary-text">${escapeHtml(this.threadSummary.summary || '')}</div>
            ${(this.threadSummary.keyPoints || []).length > 0 ? `<div class="summary-topics">${this.threadSummary.keyPoints.map(p => `<span class="summary-topic-tag">${escapeHtml(p)}</span>`).join('')}</div>` : ''}
            ${(this.threadSummary.decisions || []).length > 0 ? `<div class="summary-decisions">${this.threadSummary.decisions.map(d => `<div class="summary-decision"><span class="priority-badge priority-fyi">DECISION</span> ${escapeHtml(d)}</div>`).join('')}</div>` : ''}
            ${actions}
            <div class="summary-status">Status: <span class="priority-badge priority-${this.threadSummary.status === 'needs-reply' ? 'urgent' : this.threadSummary.status === 'pending' ? 'action' : 'fyi'}">${escapeHtml(this.threadSummary.status || 'unknown')}</span></div>
          </div>`;
        }
      }
    }

    return `
      <div class="thread-header">
        <button class="cmd-btn thread-back-btn" style="font-size:11px;padding:4px 12px;">Back</button>
        <span class="lcars-label" style="margin:0">${escapeHtml(this.threadSubject)}</span>
        ${this._isGmailChannel() ? `<button class="cmd-btn thread-summarize-btn" style="font-size:11px;padding:4px 12px;">Summarize</button>` : ''}
      </div>
      ${threadSummaryHtml}
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
    // Gmail uses direct OAuth — check gmailStatus
    if (oauthKey === 'gmail' && this._isGmailChannel()) {
      const authorized = this.gmailStatus?.connected;
      const email = this.gmailStatus?.email || '';
      const needsSetup = !this.gmailStatus?.hasCredentials;
      oauthHtml = `<div class="channel-oauth-section">
        <div class="lcars-label" style="margin-bottom:8px">Authorization — Gmail</div>
        ${needsSetup
          ? `<div class="oauth-status-row">
              <span class="oauth-status unauthorized">NEEDS SETUP</span>
              <div class="oauth-hint">Create <code>data/google-oauth.json</code> with your <code>clientId</code> and <code>clientSecret</code> from Google Cloud Console.</div>
            </div>`
          : authorized
            ? `<div class="oauth-status-row">
                <span class="oauth-status authorized">AUTHORIZED</span>
                ${email ? `<span class="oauth-email">${escapeHtml(email)}</span>` : ''}
                <button class="cmd-btn oauth-revoke-btn" data-provider="gmail" style="font-size:11px;padding:4px 10px;background:var(--lcars-red)">Revoke</button>
              </div>`
            : `<div class="oauth-status-row">
                <span class="oauth-status unauthorized">NOT AUTHORIZED</span>
                <button class="cmd-btn oauth-start-btn" data-provider="gmail" style="font-size:11px;padding:4px 10px;background:var(--lcars-green)">Connect Gmail</button>
              </div>`
        }
        <div class="oauth-hint">Authorizes Gmail API access for reading, sending, and managing email through this channel.</div>
      </div>`;
    } else if (oauthKey) {
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

    // Gmail intelligence buttons
    const summarizeBtn = this.container.querySelector('.gmail-summarize-btn');
    if (summarizeBtn) summarizeBtn.addEventListener('click', () => this.loadInboxSummary());

    const prioritiesBtn = this.container.querySelector('.gmail-priorities-btn');
    if (prioritiesBtn) prioritiesBtn.addEventListener('click', () => this.loadPriorities());

    const followupsBtn = this.container.querySelector('.gmail-followups-btn');
    if (followupsBtn) followupsBtn.addEventListener('click', () => this.loadFollowups());

    const refreshBtn = this.container.querySelector('.gmail-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', async () => {
      this.inboxSummary = null;
      this.priorityView = false;
      this.followups = [];
      this.showFollowups = false;
      await this.loadInbox();
      this.render();
      // Re-trigger intelligence
      this.loadPriorities();
      this.loadInboxSummary();
    });

    const threadSumBtn = this.container.querySelector('.thread-summarize-btn');
    if (threadSumBtn) threadSumBtn.addEventListener('click', () => this.loadThreadSummary());

    // Gmail compose send button
    const gmailSendBtn = this.container.querySelector('.gmail-send-btn');
    if (gmailSendBtn) gmailSendBtn.addEventListener('click', () => this.sendGmail());

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
