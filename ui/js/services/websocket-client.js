export class WebSocketClient {
  constructor(url) {
    this.url = url;
    this.handlers = {};
    this.connect();
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.emit('_connected');
    };

    this.ws.binaryType = 'arraybuffer';

    this.ws.onmessage = (event) => {
      // Binary messages: Moshi audio/text frames with 1-byte kind prefix
      if (event.data instanceof ArrayBuffer) {
        const buf = new Uint8Array(event.data);
        if (buf.length < 1) return;
        const kind = buf[0];
        const payload = buf.slice(1);
        if (kind === 0x01) {
          this.emit('moshi_audio_frame', payload);
        } else if (kind === 0x02) {
          this.emit('moshi_text_frame', new TextDecoder().decode(payload));
        }
        return;
      }
      // JSON text messages
      try {
        const { type, data } = JSON.parse(event.data);
        this.emit(type, data);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.emit('_disconnected');
      setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = () => {
      this.ws.close();
    };
  }

  on(type, handler) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(handler);
  }

  emit(type, data) {
    const list = this.handlers[type];
    if (list) list.forEach(fn => fn(data));
  }

  setUrl(newUrl) {
    this.url = newUrl;
    if (this.ws) {
      this.ws.close();
    }
  }

  send(type, data) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }));
    }
  }

  sendBinary(blob) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(blob);
    }
  }
}
