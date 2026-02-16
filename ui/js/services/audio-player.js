export class AudioPlayer {
  constructor() {
    this.queue = [];
    this.playing = false;
    this.enabled = true;
    this.currentAudio = null;
    this.onPlaybackEnd = null; // callback when all audio finishes

    // Moshi Opus streaming state
    this._audioCtx = null;
    this._opusDecoder = null;
    this._moshiActive = false;
    this._nextPlayTime = 0;
  }

  async speak(audioUrl) {
    if (!this.enabled) return;
    this.queue.push(audioUrl);
    if (!this.playing) {
      this._playNext();
    }
  }

  _playNext() {
    if (this.queue.length === 0) {
      this.playing = false;
      if (this.onPlaybackEnd) this.onPlaybackEnd();
      return;
    }

    this.playing = true;
    const url = this.queue.shift();

    this.currentAudio = new Audio(url);
    this.currentAudio.onended = () => {
      this.currentAudio = null;
      this._playNext();
    };
    this.currentAudio.onerror = () => {
      this.currentAudio = null;
      this._playNext();
    };
    this.currentAudio.play().catch(() => {
      this.currentAudio = null;
      this._playNext();
    });
  }

  /**
   * Immediately stop all audio playback and clear the queue.
   * Triggers onPlaybackEnd callback.
   */
  interrupt() {
    this.queue = [];
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.playing = false;
    if (this.onPlaybackEnd) this.onPlaybackEnd();
  }

  stop() {
    this.queue = [];
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.playing = false;
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stop();
    return this.enabled;
  }

  // ── Moshi Opus Streaming ──────────────────────────────

  /**
   * Initialize the AudioContext and WebCodecs Opus decoder for Moshi streaming.
   * Call once when entering Moshi mode.
   */
  async startMoshiStream() {
    if (!this.enabled) return;
    if (this._moshiActive) return;

    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    this._nextPlayTime = this._audioCtx.currentTime;
    this._moshiActive = true;

    // Use WebCodecs AudioDecoder if available (Chrome/Edge)
    if (typeof AudioDecoder !== 'undefined') {
      this._opusDecoder = new AudioDecoder({
        output: (audioData) => {
          this._playDecodedAudio(audioData);
        },
        error: (err) => {
          console.error('[AudioPlayer] Opus decoder error:', err);
        },
      });
      this._opusDecoder.configure({
        codec: 'opus',
        sampleRate: 24000,
        numberOfChannels: 1,
      });
      console.log('[AudioPlayer] Moshi stream started (WebCodecs Opus)');
    } else {
      console.warn('[AudioPlayer] WebCodecs AudioDecoder not available — Moshi audio disabled');
      this._moshiActive = false;
    }
  }

  /**
   * Feed an Opus frame from Moshi into the decoder.
   * @param {Uint8Array} opusFrame - Raw Opus-encoded audio frame
   */
  playOpusFrame(opusFrame) {
    if (!this._moshiActive || !this._opusDecoder || !this.enabled) return;
    if (this._opusDecoder.state === 'closed') return;

    try {
      const chunk = new EncodedAudioChunk({
        type: 'key',
        timestamp: 0, // Decoder handles timing
        data: opusFrame,
      });
      this._opusDecoder.decode(chunk);
    } catch (err) {
      // Silently skip corrupt frames
    }
  }

  /**
   * Play decoded PCM audio data through the AudioContext.
   */
  _playDecodedAudio(audioData) {
    if (!this._audioCtx || !this._moshiActive) return;

    const numFrames = audioData.numberOfFrames;
    const sampleRate = audioData.sampleRate || 24000;
    const buffer = this._audioCtx.createBuffer(1, numFrames, sampleRate);
    const channelData = buffer.getChannelData(0);

    // Copy decoded samples
    audioData.copyTo(channelData, { planeIndex: 0 });
    audioData.close();

    // Schedule playback with seamless timing
    const now = this._audioCtx.currentTime;
    if (this._nextPlayTime < now) {
      this._nextPlayTime = now;
    }

    const source = this._audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this._audioCtx.destination);
    source.start(this._nextPlayTime);
    this._nextPlayTime += buffer.duration;
  }

  /**
   * Stop Moshi audio streaming and clean up resources.
   */
  stopMoshiStream() {
    this._moshiActive = false;
    if (this._opusDecoder && this._opusDecoder.state !== 'closed') {
      try { this._opusDecoder.close(); } catch {}
    }
    this._opusDecoder = null;
    if (this._audioCtx && this._audioCtx.state !== 'closed') {
      this._audioCtx.close().catch(() => {});
    }
    this._audioCtx = null;
    this._nextPlayTime = 0;
    console.log('[AudioPlayer] Moshi stream stopped');
  }

  get isMoshiActive() {
    return this._moshiActive;
  }
}
