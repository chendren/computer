export class SpeechService {
  constructor(wsClient) {
    this.ws = wsClient;
    this.supported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    this.listening = false;
    this.mediaRecorder = null;
    this.stream = null;
    this.onResult = null;
    this.onStateChange = null;
    this.accumulatedText = '';

    // Listen for STT results from server
    this.ws.on('stt_result', (data) => {
      if (data.text && this.onResult) {
        this.accumulatedText += (this.accumulatedText ? ' ' : '') + data.text;
        this.onResult(data.text, true);
      }
    });

    this.ws.on('stt_error', (data) => {
      console.error('STT error:', data.error);
    });
  }

  async start() {
    if (!this.supported) return false;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Detect supported codec
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/webm';

      this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.ws.sendBinary(event.data);
        }
      };

      this.mediaRecorder.onerror = (err) => {
        console.error('MediaRecorder error:', err);
      };

      // Record in 3-second chunks
      this.mediaRecorder.start(3000);
      this.listening = true;
      this.accumulatedText = '';
      if (this.onStateChange) this.onStateChange(true);
      return true;
    } catch (err) {
      console.error('Microphone access denied:', err);
      return false;
    }
  }

  stop() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.mediaRecorder = null;
    this.listening = false;
    if (this.onStateChange) this.onStateChange(false);
  }

  toggle() {
    if (this.listening) {
      this.stop();
    } else {
      return this.start();
    }
  }

  getAccumulatedText() {
    const text = this.accumulatedText;
    this.accumulatedText = '';
    return text;
  }
}
