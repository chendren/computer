/**
 * VAD Service — wraps Silero VAD (via @ricky0123/vad-web)
 */

export class VadService {
  constructor() {
    this.vad = null;
    this.running = false;
    this.paused = false;
    this.mode = 'computer'; // 'computer' = VAD-gated, 'moshi' = continuous Opus streaming

    // Callbacks
    this.onSpeechStart = null;
    this.onSpeechEnd = null;
    this.onError = null;

    // Moshi mode state
    this._moshiStream = null;
    this._moshiProcessor = null;
    this._moshiCtx = null;
    this._opusEncoder = null;
    this.onMoshiAudioFrame = null; // callback: (Uint8Array opusFrame) => void
  }

  setMode(mode) {
    this.mode = mode;
    console.log('[VAD] Mode set to:', mode);
  }

  async start() {
    if (this.running) return;

    console.log('[VAD] Starting... window.vad:', !!window.vad, 'window.ort:', !!window.ort);
    console.log('[VAD] MicVAD:', !!window.vad?.MicVAD);

    if (!window.vad?.MicVAD) {
      throw new Error('VAD library not loaded (vad=' + !!window.vad + ', ort=' + !!window.ort + ')');
    }

    // Set WASM paths BEFORE MicVAD init (ortConfig callback may not be supported)
    if (window.ort?.env?.wasm) {
      window.ort.env.wasm.wasmPaths = '/lib/';
      console.log('[VAD] Set ort.env.wasm.wasmPaths = /lib/');
    } else {
      console.warn('[VAD] Cannot set WASM paths — ort.env.wasm not found');
    }

    // Pre-check microphone permission
    console.log('[VAD] Requesting microphone permission...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      console.log('[VAD] Microphone permission granted');
    } catch (err) {
      console.error('[VAD] Microphone access denied:', err);
      throw new Error(`Microphone access denied: ${err.message}`);
    }

    console.log('[VAD] Creating MicVAD...');
    try {
      this.vad = await window.vad.MicVAD.new({
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.2,
        redemptionFrames: 12,
        preSpeechPadFrames: 8,
        minSpeechFrames: 3,
        modelURL: '/lib/silero_vad.onnx',
        workletURL: '/lib/vad.worklet.bundle.min.js',
        ortConfig: (ort) => {
          console.log('[VAD] ortConfig callback called');
          ort.env.wasm.wasmPaths = '/lib/';
        },
        onFrameProcessed: (probs) => {
          if (probs.isSpeech > 0.3) {
            console.log('[VAD] Frame speech prob:', probs.isSpeech.toFixed(3));
          }
        },
        onVADMisfire: () => {
          console.log('[VAD] Misfire (speech too short)');
        },
        onSpeechStart: () => {
          console.log('[VAD] >>> SPEECH START, paused:', this.paused);
          if (!this.paused && this.onSpeechStart) {
            this.onSpeechStart();
          }
        },
        onSpeechEnd: (audio) => {
          console.log('[VAD] <<< SPEECH END, samples:', audio?.length, 'paused:', this.paused);
          if (!this.paused && this.onSpeechEnd) {
            this.onSpeechEnd(audio);
          }
        },
      });
      console.log('[VAD] MicVAD created successfully');
    } catch (err) {
      console.error('[VAD] MicVAD.new() FAILED:', err);
      throw new Error(`VAD init failed: ${err.message}`);
    }

    this.vad.start();
    this.running = true;
    console.log('[VAD] Now listening for speech');
  }

  stop() {
    console.log('[VAD] Stopping');
    if (this.mode === 'moshi') {
      this._stopMoshiStream();
    }
    if (this.vad) {
      this.vad.pause();
      this.vad.destroy();
      this.vad = null;
    }
    this.running = false;
    this.paused = false;
  }

  pause() {
    console.log('[VAD] Pausing');
    this.paused = true;
    if (this.vad) this.vad.pause();
  }

  resume() {
    console.log('[VAD] Resuming');
    this.paused = false;
    if (this.vad) this.vad.start();
  }

  // ── Moshi Mode: Continuous Opus Streaming ──────────────

  /**
   * Start continuous microphone capture at 24kHz with Opus encoding.
   * Moshi expects Opus frames — we use WebCodecs AudioEncoder.
   */
  async startMoshiStream() {
    if (this._moshiStream) return;

    console.log('[VAD] Starting Moshi continuous stream...');

    // Request microphone at 24kHz mono
    this._moshiStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 24000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    this._moshiCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    const source = this._moshiCtx.createMediaStreamSource(this._moshiStream);

    // Use WebCodecs AudioEncoder for Opus encoding if available
    if (typeof AudioEncoder !== 'undefined') {
      // Create a ScriptProcessor to capture raw PCM and feed to encoder
      // We use 1920 samples per frame (80ms at 24kHz) to match Moshi's expectation
      const bufferSize = 1920;
      this._moshiProcessor = this._moshiCtx.createScriptProcessor(bufferSize, 1, 1);

      this._opusEncoder = new AudioEncoder({
        output: (chunk) => {
          // Extract encoded Opus data
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          if (this.onMoshiAudioFrame) {
            this.onMoshiAudioFrame(data);
          }
        },
        error: (err) => {
          console.error('[VAD] Opus encoder error:', err);
        },
      });

      this._opusEncoder.configure({
        codec: 'opus',
        sampleRate: 24000,
        numberOfChannels: 1,
        bitrate: 24000,
      });

      let timestamp = 0;
      this._moshiProcessor.onaudioprocess = (e) => {
        if (this.paused) return;
        const input = e.inputBuffer.getChannelData(0);
        // Convert Float32 to Int16 for the encoder
        const int16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        const audioData = new AudioData({
          format: 's16',
          sampleRate: 24000,
          numberOfFrames: int16.length,
          numberOfChannels: 1,
          timestamp: timestamp,
          data: int16.buffer,
        });
        timestamp += (int16.length / 24000) * 1_000_000; // microseconds

        try {
          this._opusEncoder.encode(audioData);
          audioData.close();
        } catch {
          audioData.close();
        }
      };

      source.connect(this._moshiProcessor);
      this._moshiProcessor.connect(this._moshiCtx.destination);
      console.log('[VAD] Moshi Opus streaming active (WebCodecs)');
    } else {
      console.warn('[VAD] WebCodecs AudioEncoder not available — cannot stream to Moshi');
      this._stopMoshiStream();
      return;
    }

    this.running = true;
  }

  _stopMoshiStream() {
    if (this._opusEncoder && this._opusEncoder.state !== 'closed') {
      try { this._opusEncoder.close(); } catch {}
    }
    this._opusEncoder = null;
    if (this._moshiProcessor) {
      this._moshiProcessor.disconnect();
      this._moshiProcessor = null;
    }
    if (this._moshiCtx && this._moshiCtx.state !== 'closed') {
      this._moshiCtx.close().catch(() => {});
    }
    this._moshiCtx = null;
    if (this._moshiStream) {
      this._moshiStream.getTracks().forEach(t => t.stop());
      this._moshiStream = null;
    }
    console.log('[VAD] Moshi stream stopped');
  }

  static float32ToWavBlob(float32Array, sampleRate = 16000) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = float32Array.length * (bitsPerSample / 8);
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < float32Array.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
