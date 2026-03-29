/**
 * Gemini Audio — PCM capture and gapless playback for Gemini Live mode.
 *
 * Unlike Moshi (which uses Opus encoding/decoding via WebCodecs), Gemini Live
 * communicates in raw PCM: Int16 mono at 16kHz in, 24kHz out. This eliminates
 * the codec layer entirely — simpler, lower latency, and no Chrome-only dependency.
 *
 * Capture pipeline:
 *   getUserMedia (16kHz mono) → AudioWorklet → Float32→Int16 → onChunk callback
 *   → WebSocket binary with 0x03 kind prefix → server → Gemini Live API
 *
 * Playback pipeline:
 *   WebSocket binary (0x03 prefix stripped) → Int16→Float32 conversion
 *   → AudioBuffer → BufferSource scheduled with gapless _nextPlayTime cursor
 */

const CAPTURE_SAMPLE_RATE = 16000;  // Gemini input rate
const PLAYBACK_SAMPLE_RATE = 24000; // Gemini output rate
const CAPTURE_BUFFER_SIZE = 1600;   // 100ms at 16kHz — good balance of latency vs overhead

export class GeminiAudio {
  constructor() {
    // ── Capture state ──────────────────────────────────────────────────
    this._captureStream = null;    // MediaStream from getUserMedia
    this._captureCtx = null;       // AudioContext at 16kHz
    this._captureProcessor = null; // ScriptProcessorNode for PCM extraction
    this.onChunk = null;           // callback: (Int16Array) per captured chunk

    // ── Playback state ─────────────────────────────────────────────────
    this._playbackCtx = null;      // AudioContext at 24kHz
    this._nextPlayTime = 0;        // gapless scheduling cursor
    this._active = false;          // true while capture + playback are initialized
    this._paused = false;          // true during THINKING/SPEAKING — suppresses capture
  }

  /**
   * Start PCM capture from the microphone.
   * Each captured chunk fires onChunk(Int16Array).
   * @param {number} sampleRate - Capture rate (default: 16000 for Gemini, 24000 for OpenAI)
   */
  async startCapture(sampleRate = CAPTURE_SAMPLE_RATE) {
    if (this._captureStream) return; // idempotent

    const bufferSize = Math.round(sampleRate * 0.1); // 100ms at target rate

    this._captureStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    this._captureCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });
    const source = this._captureCtx.createMediaStreamSource(this._captureStream);

    this._captureProcessor = this._captureCtx.createScriptProcessor(bufferSize, 1, 1);

    this._captureProcessor.onaudioprocess = (e) => {
      if (this._paused) return;

      const input = e.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      if (this.onChunk) {
        this.onChunk(int16);
      }
    };

    source.connect(this._captureProcessor);
    this._captureProcessor.connect(this._captureCtx.destination);
    console.log('[GeminiAudio] Capture started (16kHz PCM)');
  }

  /**
   * Stop PCM capture and release the microphone.
   */
  stopCapture() {
    if (this._captureProcessor) {
      this._captureProcessor.disconnect();
      this._captureProcessor = null;
    }
    if (this._captureCtx && this._captureCtx.state !== 'closed') {
      this._captureCtx.close().catch(() => {});
    }
    this._captureCtx = null;
    if (this._captureStream) {
      this._captureStream.getTracks().forEach(t => t.stop());
      this._captureStream = null;
    }
    console.log('[GeminiAudio] Capture stopped');
  }

  /**
   * Initialize the playback AudioContext at 24kHz for gapless PCM scheduling.
   */
  startPlayback() {
    if (this._playbackCtx) return;
    this._playbackCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: PLAYBACK_SAMPLE_RATE });
    this._nextPlayTime = this._playbackCtx.currentTime;
    this._active = true;
    console.log('[GeminiAudio] Playback started (24kHz PCM)');
  }

  /**
   * Play a raw PCM Int16 chunk through the AudioContext with gapless scheduling.
   * Uses the same _nextPlayTime cursor pattern as AudioPlayer._playDecodedAudio().
   *
   * @param {Int16Array|Uint8Array} pcmData - Raw Int16 LE PCM at 24kHz
   */
  playPcmChunk(pcmData) {
    if (!this._playbackCtx || !this._active) return;

    // Convert to Int16Array if we received raw bytes
    const int16 = pcmData instanceof Int16Array
      ? pcmData
      : new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2);

    // Convert Int16 → Float32 for Web Audio API
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7FFF);
    }

    const buffer = this._playbackCtx.createBuffer(1, float32.length, PLAYBACK_SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    // Snap forward if we've fallen behind real-time
    const now = this._playbackCtx.currentTime;
    if (this._nextPlayTime < now) {
      this._nextPlayTime = now;
    }

    const source = this._playbackCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this._playbackCtx.destination);
    source.start(this._nextPlayTime);
    this._nextPlayTime += buffer.duration;
  }

  /**
   * Stop playback and release the AudioContext.
   */
  stopPlayback() {
    this._active = false;
    if (this._playbackCtx && this._playbackCtx.state !== 'closed') {
      this._playbackCtx.close().catch(() => {});
    }
    this._playbackCtx = null;
    this._nextPlayTime = 0;
    console.log('[GeminiAudio] Playback stopped');
  }

  /** Pause capture (suppress chunks during THINKING/SPEAKING). */
  pause() {
    this._paused = true;
  }

  /** Resume capture. */
  resume() {
    this._paused = false;
  }

  /** True if Gemini audio is active. */
  get isActive() {
    return this._active;
  }
}
