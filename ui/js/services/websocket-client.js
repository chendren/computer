/**
 * WebSocketClient — Persistent connection to the Computer server.
 *
 * Handles both text (JSON) and binary messages from the server.
 * Automatically reconnects after 3 seconds if the connection drops,
 * so the UI stays live across server restarts.
 *
 * Message protocol:
 *   Text (JSON): { type: string, data: any } — all standard events
 *     Examples: 'stt_result', 'voice_response', 'voice_thinking', 'moshi_text'
 *
 *   Binary: 1-byte kind prefix + raw payload
 *     0x01 = Opus audio frame from Moshi → routed to 'moshi_audio_frame'
 *     0x02 = UTF-8 text token from Moshi → routed to 'moshi_text_frame'
 *
 * Usage:
 *   const ws = new WebSocketClient('ws://localhost:3141?token=abc');
 *   ws.on('stt_result', (data) => console.log(data.text));
 *   ws.send('voice_start', {});
 */
export class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.handlers = {};  // event type → array of handler functions
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(this.url);

    // Notify listeners when the handshake completes and the socket is open
    this.ws.onopen = () => {
      this.emit('_connected');
    };

    // Tell the WebSocket API to deliver binary messages as ArrayBuffer (not Blob).
    // This lets us inspect the kind byte synchronously without FileReader.
    this.ws.binaryType = 'arraybuffer';

    this.ws.onmessage = (event) => {
      // ── Binary message: Moshi audio/text frames ──────────────────────────
      // The server tags every binary message with a 1-byte "kind" prefix:
      //   0x01 = Opus audio frame — continuous Moshi S2S voice output to play
      //   0x02 = UTF-8 text token — Moshi's incremental transcript stream
      if (event.data instanceof ArrayBuffer) {
        const buf = new Uint8Array(event.data);
        if (buf.length < 1) return;
        const kind = buf[0];
        const payload = buf.slice(1);  // everything after the kind byte is the content

        if (kind === 0x01) {
          // Raw Opus audio — pass to AudioPlayer.playOpusFrame() for decoding
          this.emit('moshi_audio_frame', payload);
        } else if (kind === 0x02) {
          // Text token — append to the on-screen Moshi transcript
          this.emit('moshi_text_frame', new TextDecoder().decode(payload));
        }
        return;
      }

      // ── Text message: standard JSON event envelope ────────────────────────
      // All server-sent events arrive as: { type: "event_name", data: {...} }
      try {
        const { type, data } = JSON.parse(event.data);
        this.emit(type, data);
      } catch {
        // Ignore malformed messages — server may send partial data during startup
      }
    };

    this.ws.onclose = () => {
      this.emit('_disconnected');
      // Auto-reconnect after 3 seconds — the server may have briefly restarted
      setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = () => {
      // Force-close the socket, which triggers onclose → schedules reconnect
      this.ws.close();
    };
  }

  /**
   * Register a handler for a specific event type.
   * Multiple handlers per event type are supported — all will be called.
   *
   * @param {string} type - Event type to listen for (e.g. 'stt_result')
   * @param {function} handler - Called with (data) when the event fires
   */
  on(type, handler) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(handler);
  }

  /**
   * Internally dispatch an event to all registered handlers.
   * Used by onmessage and connection lifecycle events.
   */
  emit(type, data) {
    const list = this.handlers[type];
    if (list) list.forEach(fn => fn(data));
  }

  /**
   * Change the WebSocket URL and reconnect immediately.
   * Used when the auth token changes or the server port changes.
   */
  setUrl(newUrl) {
    this.url = newUrl;
    if (this.ws) {
      this.ws.close();  // triggers onclose → reconnects with new URL
    }
  }

  /**
   * Send a JSON event to the server.
   * @param {string} type - Event name (e.g. 'voice_command', 'voice_start')
   * @param {object} data - Payload object
   */
  send(type, data) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  /**
   * Send raw binary data to the server.
   * Used to transmit Opus audio frames to Moshi during S2S streaming.
   * The caller must prepend the kind byte (0x01) before the Opus payload.
   *
   * @param {ArrayBuffer|Blob} blob - Binary data with kind byte prefix
   */
  sendBinary(blob) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(blob);
    }
  }
}
