/**
 * VAD Service — wraps Silero VAD (via @ricky0123/vad-web)
 */

export class VadService {
  constructor() {
    this.vad = null;
    this.running = false;
    this.paused = false;

    // Callbacks
    this.onSpeechStart = null;
    this.onSpeechEnd = null;
    this.onError = null;
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
