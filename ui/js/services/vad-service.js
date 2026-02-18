/**
 * VAD Service — Voice Activity Detection (Computer mode) + Opus streaming (Moshi mode).
 *
 * Computer Mode (VAD-gated, wake word required):
 *   Uses Silero VAD via @ricky0123/vad-web. Silero is a tiny (~2MB ONNX model) that
 *   runs entirely in the browser inside an AudioWorklet + Web Worker. It scores each
 *   30ms audio frame with a speech probability (0.0–1.0). When the score rises above
 *   positiveSpeechThreshold, onSpeechStart fires. When it drops below
 *   negativeSpeechThreshold for redemptionFrames consecutive frames, onSpeechEnd fires
 *   with all the collected audio as a Float32Array.
 *
 *   The collected audio is converted to 16kHz WAV (float32ToWavBlob) and sent to
 *   the server, where Whisper transcribes it and checks for the wake word "Computer".
 *
 * Moshi Mode (continuous streaming, full-duplex):
 *   No VAD — the mic is open continuously. Raw PCM is captured at 24kHz mono via
 *   ScriptProcessorNode, converted to Int16, encoded to Opus frames using the
 *   WebCodecs AudioEncoder API, and streamed to the server via WebSocket binary frames.
 *   The server forwards them to the Moshi MLX sidecar for real-time S2S conversation.
 *   Requires Chrome or Edge (WebCodecs not available in Firefox).
 */

export class VadService {
  constructor() {
    this.vad = null;        // Silero MicVAD instance (Computer mode only)
    this.running = false;   // true after start() or startMoshiStream() succeeds
    this.paused = false;    // true while in SPEAKING/THINKING — suppresses callbacks
    this.mode = 'computer'; // 'computer' = Silero VAD gated, 'moshi' = continuous Opus

    // ── Callbacks (set by VoiceAssistantUI._bindVadCallbacks) ────────────
    this.onSpeechStart = null;  // called when Silero detects speech beginning
    this.onSpeechEnd = null;    // called with Float32Array audio when speech ends
    this.onError = null;        // called if VAD initialization fails

    // ── Moshi mode: WebCodecs audio pipeline ─────────────────────────────
    this._moshiStream = null;      // MediaStream from getUserMedia at 24kHz
    this._moshiProcessor = null;   // ScriptProcessorNode — captures raw PCM frames
    this._moshiCtx = null;         // AudioContext running at 24kHz
    this._opusEncoder = null;      // WebCodecs AudioEncoder → Opus frames
    this.onMoshiAudioFrame = null; // callback: receives (Uint8Array opusFrame) per frame
  }

  /**
   * Update the current voice mode. Called by VoiceAssistantUI when mode changes.
   * Affects which pipeline is used and whether onSpeechStart/End fire.
   */
  setMode(mode) {
    this.mode = mode;
    console.log('[VAD] Mode set to:', mode);
  }

  /**
   * Initialize and start Silero VAD for Computer mode.
   *
   * Prerequisites:
   *   - vad-web script loaded: window.vad.MicVAD
   *   - onnxruntime-web script loaded: window.ort
   *   - ONNX WASM files served at /lib/ (silero_vad.onnx, ort-wasm-*.wasm)
   *   - Microphone permission granted
   *
   * Throws on any failure so VoiceAssistantUI can catch and show an error state.
   */
  async start() {
    if (this.running) return;

    console.log('[VAD] Starting... window.vad:', !!window.vad, 'window.ort:', !!window.ort);
    console.log('[VAD] MicVAD:', !!window.vad?.MicVAD);

    // Both vad-web and onnxruntime-web must be loaded via <script> tags in the HTML
    if (!window.vad?.MicVAD) {
      throw new Error('VAD library not loaded (vad=' + !!window.vad + ', ort=' + !!window.ort + ')');
    }

    // Set the ONNX Runtime WASM binary paths BEFORE MicVAD.new().
    // MicVAD initializes ONNX Runtime internally and will look for ort-wasm-*.wasm
    // files at these paths. The /lib/ directory serves them as static assets.
    if (window.ort?.env?.wasm) {
      window.ort.env.wasm.wasmPaths = '/lib/';
      console.log('[VAD] Set ort.env.wasm.wasmPaths = /lib/');
    } else {
      console.warn('[VAD] Cannot set WASM paths — ort.env.wasm not found');
    }

    // Pre-warm the microphone permission before MicVAD.new() opens it.
    // This shows the browser permission dialog at a predictable time and gives
    // us a clean error message if the user denies it.
    console.log('[VAD] Requesting microphone permission...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());  // release immediately — MicVAD will reopen
      console.log('[VAD] Microphone permission granted');
    } catch (err) {
      console.error('[VAD] Microphone access denied:', err);
      throw new Error(`Microphone access denied: ${err.message}`);
    }

    console.log('[VAD] Creating MicVAD...');
    try {
      this.vad = await window.vad.MicVAD.new({
        // ── Sensitivity parameters ─────────────────────────────────────────────
        //
        // positiveSpeechThreshold: Silero speech probability above which a 30ms frame
        //   is classified as "speech started". 0.5 = 50% confidence required.
        //   Raise this (e.g. 0.8) in noisy environments to reduce false triggers.
        //   Lower this (e.g. 0.3) if the assistant frequently misses the start of words.
        positiveSpeechThreshold: 0.5,

        // negativeSpeechThreshold: probability below which a frame is classified as silence.
        //   Must be lower than positiveSpeechThreshold. 0.2 creates hysteresis — the model
        //   requires strong silence confidence before ending a speech segment, preventing
        //   mid-word cuts during natural hesitations.
        negativeSpeechThreshold: 0.2,

        // redemptionFrames: consecutive below-threshold frames required to end a segment.
        //   12 frames × 30ms = 360ms of continuous silence before speech ends.
        //   Prevents the computer from cutting you off mid-sentence during brief pauses.
        redemptionFrames: 12,

        // preSpeechPadFrames: silent frames to include BEFORE detected speech onset.
        //   8 frames = 240ms of audio before the speech threshold was crossed.
        //   Captures the beginning of words that Silero hadn't yet classified as speech,
        //   preventing the first syllable from being clipped.
        preSpeechPadFrames: 8,

        // minSpeechFrames: discard speech segments shorter than this many frames.
        //   3 frames = 90ms — filters out lip smacks, clicks, and keyboard noise.
        minSpeechFrames: 3,

        // ── File paths ────────────────────────────────────────────────────────
        modelURL: '/lib/silero_vad.onnx',              // Silero VAD ONNX model (~2MB)
        workletURL: '/lib/vad.worklet.bundle.min.js',  // AudioWorklet for in-browser inference

        // Also set WASM paths inside the worker context — belt-and-suspenders
        // because the worker has its own global scope separate from window.ort
        ortConfig: (ort) => {
          console.log('[VAD] ortConfig callback called');
          ort.env.wasm.wasmPaths = '/lib/';
        },

        // ── Debug hooks ───────────────────────────────────────────────────────
        onFrameProcessed: (probs) => {
          // Log speech probability for each 30ms frame (only at >30% to avoid noise spam)
          if (probs.isSpeech > 0.3) {
            console.log('[VAD] Frame speech prob:', probs.isSpeech.toFixed(3));
          }
        },
        onVADMisfire: () => {
          // Speech was detected but ended before minSpeechFrames — safely discarded
          console.log('[VAD] Misfire (speech too short)');
        },

        // ── Main speech event callbacks ────────────────────────────────────────
        onSpeechStart: () => {
          console.log('[VAD] >>> SPEECH START, paused:', this.paused);
          // paused is true during SPEAKING/THINKING — don't interrupt our own TTS audio
          if (!this.paused && this.onSpeechStart) {
            this.onSpeechStart();
          }
        },
        onSpeechEnd: (audio) => {
          // audio: Float32Array of all samples collected during this utterance,
          // including the preSpeechPad frames before onset detection.
          // Silero outputs 16kHz audio — matches Whisper's preferred sample rate.
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

  /**
   * Fully stop VAD and release the microphone.
   * For Computer mode: destroys the MicVAD instance.
   * For Moshi mode: tears down the Opus streaming pipeline.
   */
  stop() {
    console.log('[VAD] Stopping');
    if (this.mode === 'moshi') {
      this._stopMoshiStream();
    }
    if (this.vad) {
      this.vad.pause();
      this.vad.destroy();  // releases the AudioWorklet and ONNX resources
      this.vad = null;
    }
    this.running = false;
    this.paused = false;
  }

  /**
   * Temporarily suspend callbacks without destroying VAD.
   * Called when transitioning to SPEAKING or THINKING state so the system
   * doesn't try to transcribe its own TTS audio playing through the speakers.
   * For Moshi mode, also pauses the Opus encoder so we don't send audio
   * during Computer command processing.
   */
  pause() {
    console.log('[VAD] Pausing');
    this.paused = true;
    if (this.vad) this.vad.pause();  // stop the MicVAD processing loop
  }

  /**
   * Resume after a pause — restores mic listening.
   * Called when returning to LISTENING or MOSHI_ACTIVE state.
   */
  resume() {
    console.log('[VAD] Resuming');
    this.paused = false;
    if (this.vad) this.vad.start();  // restart the MicVAD processing loop
  }

  // ── Moshi Mode: Continuous Opus Streaming ─────────────────────────────────

  /**
   * Start continuous 24kHz Opus microphone capture for Moshi S2S streaming.
   *
   * Pipeline overview:
   *   getUserMedia (24kHz mono)
   *   → AudioContext.createMediaStreamSource
   *   → ScriptProcessorNode (captures raw PCM in 1920-sample = 80ms chunks)
   *   → Float32 → Int16 conversion
   *   → WebCodecs AudioEncoder (Opus at 24kbps)
   *   → onMoshiAudioFrame callback
   *   → WebSocket sendBinary (0x01 kind prefix + Opus frame)
   *   → Server → Moshi MLX sidecar
   *
   * Frame parameters:
   *   Buffer size: 1920 samples = 80ms at 24kHz (Moshi's expected frame interval)
   *   Codec: Opus mono at 24kbps — sufficient quality for voice with low bandwidth
   *
   * Browser support: Chrome and Edge only (WebCodecs AudioEncoder not in Firefox).
   */
  async startMoshiStream() {
    if (this._moshiStream) return;  // idempotent

    console.log('[VAD] Starting Moshi continuous stream...');

    // Request mic at exactly 24kHz mono — Moshi's native sample rate.
    // echoCancellation and noiseSuppression reduce feedback and background noise.
    this._moshiStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 24000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });

    this._moshiCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    const source = this._moshiCtx.createMediaStreamSource(this._moshiStream);

    if (typeof AudioEncoder !== 'undefined') {
      // ScriptProcessorNode bridges the live mic stream to the WebCodecs encoder.
      // We capture 1920 samples per callback = 80ms at 24kHz = Moshi's frame size.
      // Note: ScriptProcessorNode is deprecated but still the best cross-browser
      // option for synchronous PCM access. AudioWorklet would be preferred for new code.
      const bufferSize = 1920;
      this._moshiProcessor = this._moshiCtx.createScriptProcessor(bufferSize, 1, 1);

      // WebCodecs AudioEncoder converts raw PCM to Opus frames asynchronously
      this._opusEncoder = new AudioEncoder({
        output: (chunk) => {
          // Called for each completed Opus frame — extract bytes and send to server
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          if (this.onMoshiAudioFrame) {
            this.onMoshiAudioFrame(data);  // VoiceAssistantUI sends this via WebSocket
          }
        },
        error: (err) => {
          console.error('[VAD] Opus encoder error:', err);
        },
      });

      // Configure encoder: Opus mono at 24kbps — optimized for speech, not music
      this._opusEncoder.configure({
        codec: 'opus',
        sampleRate: 24000,
        numberOfChannels: 1,
        bitrate: 24000,
      });

      // Track AudioEncoder timestamp in microseconds (required by the WebCodecs spec)
      let timestamp = 0;

      this._moshiProcessor.onaudioprocess = (e) => {
        if (this.paused) return;  // don't send audio during THINKING/SPEAKING state

        // ScriptProcessor delivers Float32 PCM in range [-1.0, 1.0]
        const input = e.inputBuffer.getChannelData(0);

        // AudioEncoder requires Int16 format — scale to [-32768, 32767]
        const int16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));  // clamp to valid range
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        // Wrap in AudioData — the WebCodecs API's container for raw PCM samples
        const audioData = new AudioData({
          format: 's16',          // signed 16-bit PCM, little-endian
          sampleRate: 24000,
          numberOfFrames: int16.length,
          numberOfChannels: 1,
          timestamp: timestamp,   // microseconds from stream start
          data: int16.buffer,
        });

        // Advance timestamp: each frame is bufferSize/sampleRate seconds = 80ms
        timestamp += (int16.length / 24000) * 1_000_000;

        try {
          this._opusEncoder.encode(audioData);
          audioData.close();  // free native resources immediately
        } catch {
          audioData.close();
        }
      };

      // Connect the graph: mic source → PCM capture → dummy output sink.
      // The destination connection is required by the Web Audio spec even though
      // we don't actually use the ScriptProcessor's output signal.
      source.connect(this._moshiProcessor);
      this._moshiProcessor.connect(this._moshiCtx.destination);
      console.log('[VAD] Moshi Opus streaming active (WebCodecs)');
    } else {
      this._stopMoshiStream();
      throw new Error('WebCodecs AudioEncoder not available — use Chrome or Edge for Moshi S2S');
    }

    this.running = true;
  }

  /**
   * Tear down the Moshi audio pipeline and release all resources.
   * Called by stop() and when switching back to Computer mode.
   */
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
      this._moshiStream.getTracks().forEach(t => t.stop());  // release microphone
      this._moshiStream = null;
    }
    console.log('[VAD] Moshi stream stopped');
  }

  /**
   * Convert a Float32Array of audio samples to a WAV Blob for server upload.
   *
   * Silero VAD delivers 16kHz mono Float32 audio. Whisper expects 16kHz input,
   * so no resampling is needed — we just convert to the standard WAV file format.
   *
   * WAV file layout (44-byte header + PCM data):
   *   Offset  0: "RIFF"          — file format marker
   *   Offset  4: fileSize - 8    — total bytes remaining
   *   Offset  8: "WAVE"          — RIFF subtype
   *   Offset 12: "fmt "          — format chunk ID
   *   Offset 16: 16              — format chunk size (always 16 for PCM)
   *   Offset 20: 1               — audio format (1 = uncompressed PCM)
   *   Offset 22: 1               — channel count (mono)
   *   Offset 24: sampleRate      — e.g. 16000
   *   Offset 28: byteRate        — sampleRate × channels × bytesPerSample
   *   Offset 32: blockAlign      — channels × bytesPerSample
   *   Offset 34: 16              — bits per sample
   *   Offset 36: "data"          — data chunk ID
   *   Offset 40: dataSize        — bytes of PCM data
   *   Offset 44: Int16 samples   — little-endian signed 16-bit PCM
   *
   * @param {Float32Array} float32Array - Raw audio from Silero VAD
   * @param {number} sampleRate - Default 16000 (Silero VAD's output rate)
   * @returns {Blob} WAV file ready to POST to /api/voice/transcribe
   */
  static float32ToWavBlob(float32Array, sampleRate = 16000) {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
    const blockAlign = numChannels * (bitsPerSample / 8);
    const dataSize = float32Array.length * (bitsPerSample / 8);  // 2 bytes per sample
    const buffer = new ArrayBuffer(44 + dataSize);  // 44-byte header + PCM data
    const view = new DataView(buffer);

    // RIFF chunk header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);  // total file size minus the 8-byte RIFF header
    writeString(view, 8, 'WAVE');

    // Format sub-chunk (describes the PCM encoding)
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);           // format chunk is always 16 bytes for PCM
    view.setUint16(20, 1, true);            // audio format 1 = Linear PCM (uncompressed)
    view.setUint16(22, numChannels, true);  // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // Data sub-chunk (the actual audio samples)
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // Convert Float32 samples to Int16 little-endian
    // Negative values: multiply by 0x8000 (32768) to reach -32768
    // Positive values: multiply by 0x7FFF (32767) to reach +32767
    let offset = 44;
    for (let i = 0; i < float32Array.length; i++) {
      const sample = Math.max(-1, Math.min(1, float32Array[i]));  // clamp to valid range
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }
}

/**
 * Write an ASCII string into a DataView at the given byte offset.
 * Used to write the WAV header magic strings: "RIFF", "WAVE", "fmt ", "data".
 */
function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
