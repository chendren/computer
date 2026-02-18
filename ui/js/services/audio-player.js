/**
 * AudioPlayer — TTS playback queue and Moshi S2S Opus streaming.
 *
 * Two completely separate audio pipelines share this class:
 *
 * 1. Computer Mode (TTS queue):
 *    The server generates speech with Kokoro TTS and returns a URL.
 *    speak(url) queues each URL → HTMLAudioElement plays them sequentially.
 *    interrupt() immediately stops playback and fires onPlaybackEnd,
 *    which returns the voice UI to LISTENING state so the user can speak again.
 *
 * 2. Moshi Mode (Opus streaming):
 *    startMoshiStream() initializes a WebCodecs AudioDecoder at 24kHz.
 *    playOpusFrame(data) feeds raw Opus bytes into the decoder.
 *    The decoder emits decoded PCM → _playDecodedAudio() schedules it on
 *    an AudioContext using an advancing _nextPlayTime timestamp, creating
 *    gapless playback even though frames arrive asynchronously.
 *    Requires Chrome or Edge (WebCodecs AudioDecoder not in Firefox).
 */
export class AudioPlayer {
  constructor() {
    // ── TTS queue state ──────────────────────────────────────────────────
    this.queue = [];           // URLs waiting to play (FIFO)
    this.playing = false;      // true while _playNext() has an active audio element
    this.enabled = true;       // global mute toggle
    this.currentAudio = null;  // the currently playing HTMLAudioElement
    this.onPlaybackEnd = null; // callback fired when the entire queue drains

    // ── Moshi streaming state ────────────────────────────────────────────
    this._audioCtx = null;       // Web Audio API context at 24kHz
    this._opusDecoder = null;    // WebCodecs AudioDecoder for Opus → PCM
    this._moshiActive = false;   // true while streaming is initialized
    this._nextPlayTime = 0;      // AudioContext timestamp for seamless scheduling
  }

  /**
   * Queue a TTS audio URL for playback.
   * If nothing is playing, starts immediately.
   * If something is already playing, the URL is played after it finishes.
   *
   * @param {string} audioUrl - URL path to a .wav file on the server (e.g. /audio/xyz.wav)
   */
  async speak(audioUrl) {
    if (!this.enabled) return;
    this.queue.push(audioUrl);
    if (!this.playing) {
      this._playNext();
    }
  }

  /**
   * Internal: play the next URL in the queue.
   * Chains automatically (each audio element's onended calls _playNext again)
   * until the queue is empty, then fires onPlaybackEnd.
   */
  _playNext() {
    if (this.queue.length === 0) {
      // Queue is empty — notify the voice UI (VoiceAssistantUI._bindAudioCallbacks)
      // so it can transition from SPEAKING back to LISTENING state
      this.playing = false;
      if (this.onPlaybackEnd) this.onPlaybackEnd();
      return;
    }

    this.playing = true;
    const url = this.queue.shift();

    // HTMLAudioElement loads and plays the audio at the given URL.
    // The server serves audio files from /audio/ as static assets.
    this.currentAudio = new Audio(url);
    this.currentAudio.onended = () => {
      this.currentAudio = null;
      this._playNext();  // automatically play the next URL in queue
    };
    this.currentAudio.onerror = () => {
      // Skip broken audio files and continue with the rest of the queue
      this.currentAudio = null;
      this._playNext();
    };
    this.currentAudio.play().catch(() => {
      // play() can reject if the browser blocks autoplay — skip and continue
      this.currentAudio = null;
      this._playNext();
    });
  }

  /**
   * Immediately stop all audio and clear the queue, then fire onPlaybackEnd.
   * Use this for user interruptions ("belay that") — the callback returns
   * the voice UI to LISTENING so the user can give a new command right away.
   */
  interrupt() {
    this.queue = [];
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.playing = false;
    if (this.onPlaybackEnd) this.onPlaybackEnd();  // notify UI immediately
  }

  /**
   * Stop all audio and clear the queue WITHOUT firing onPlaybackEnd.
   * Use when deactivating voice mode entirely (not an interruption mid-response).
   */
  stop() {
    this.queue = [];
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.playing = false;
  }

  /**
   * Toggle global mute. When muted, stop() is called immediately.
   * @returns {boolean} new enabled state
   */
  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stop();
    return this.enabled;
  }

  // ── Moshi Mode: Continuous Opus Streaming ───────────────────────────────

  /**
   * Initialize the WebCodecs AudioDecoder for real-time Opus decoding.
   * Call once when entering Moshi mode (before any playOpusFrame() calls).
   *
   * How Moshi playback works:
   *   The server receives Opus frames from the Moshi MLX sidecar and relays
   *   them to the browser as binary WebSocket messages (kind byte 0x01).
   *   Each frame is 80ms of audio at 24kHz mono.
   *
   *   This decoder converts Opus → raw PCM, then _playDecodedAudio() schedules
   *   each PCM buffer on an AudioContext using a monotonically advancing
   *   _nextPlayTime cursor — guaranteeing gapless playback regardless of the
   *   timing of WebSocket delivery.
   *
   * Requires Chrome or Edge — Firefox does not support WebCodecs AudioDecoder.
   */
  async startMoshiStream() {
    if (!this.enabled) return;
    if (this._moshiActive) return;  // idempotent

    // AudioContext at 24kHz — Moshi's native sample rate (different from 44.1kHz default)
    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    this._nextPlayTime = this._audioCtx.currentTime;  // start scheduling from right now
    this._moshiActive = true;

    if (typeof AudioDecoder !== 'undefined') {
      this._opusDecoder = new AudioDecoder({
        output: (audioData) => {
          // Called for each decoded Opus frame — audioData contains raw PCM samples
          this._playDecodedAudio(audioData);
        },
        error: (err) => {
          console.error('[AudioPlayer] Opus decoder error:', err);
        },
      });

      // Configure for Moshi's codec profile: Opus mono at 24kHz
      this._opusDecoder.configure({
        codec: 'opus',
        sampleRate: 24000,
        numberOfChannels: 1,
      });
      console.log('[AudioPlayer] Moshi stream started (WebCodecs Opus)');
    } else {
      this._moshiActive = false;
      throw new Error('WebCodecs AudioDecoder not available — use Chrome or Edge for Moshi S2S');
    }
  }

  /**
   * Feed a raw Opus frame (from the WebSocket server) into the decoder.
   * The decoder processes it asynchronously and calls the output callback.
   *
   * @param {Uint8Array} opusFrame - Raw Opus-encoded audio, no kind byte
   */
  playOpusFrame(opusFrame) {
    if (!this._moshiActive || !this._opusDecoder || !this.enabled) return;
    if (this._opusDecoder.state === 'closed') return;

    try {
      // Wrap the Opus bytes in an EncodedAudioChunk — the WebCodecs API container.
      // type: 'key' means this is a self-contained keyframe (Moshi always sends full frames).
      // timestamp: 0 because we manage playback timing separately in _playDecodedAudio.
      const chunk = new EncodedAudioChunk({
        type: 'key',
        timestamp: 0,
        data: opusFrame,
      });
      this._opusDecoder.decode(chunk);
    } catch (err) {
      // Silently skip corrupt or malformed frames — common during Moshi startup
    }
  }

  /**
   * Schedule a decoded PCM buffer for gapless playback on the AudioContext.
   *
   * Web Audio API plays audio by scheduling BufferSourceNodes at absolute timestamps.
   * _nextPlayTime advances by each buffer's duration after scheduling, ensuring
   * frames play back-to-back with no gaps — even if frames arrive slightly late.
   *
   * If we've fallen behind real-time (e.g. after a pause), we catch up to
   * the current time before scheduling, preventing audible artifacts.
   *
   * @param {AudioData} audioData - Decoded PCM from the WebCodecs AudioDecoder
   */
  _playDecodedAudio(audioData) {
    if (!this._audioCtx || !this._moshiActive) return;

    const numFrames = audioData.numberOfFrames;
    const sampleRate = audioData.sampleRate || 24000;

    // Allocate a Web Audio API AudioBuffer to hold the decoded PCM
    const buffer = this._audioCtx.createBuffer(1, numFrames, sampleRate);
    const channelData = buffer.getChannelData(0);  // mono — single channel

    // Copy decoded samples from the WebCodecs AudioData into the Web Audio buffer
    audioData.copyTo(channelData, { planeIndex: 0 });
    audioData.close();  // release native WebCodecs memory immediately

    // If we've fallen behind real-time, snap forward to avoid scheduling in the past
    const now = this._audioCtx.currentTime;
    if (this._nextPlayTime < now) {
      this._nextPlayTime = now;
    }

    // Schedule this buffer to play exactly when the previous one ends
    const source = this._audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(this._audioCtx.destination);
    source.start(this._nextPlayTime);

    // Advance the cursor by exactly this buffer's duration — no gaps, no overlaps
    this._nextPlayTime += buffer.duration;
  }

  /**
   * Stop Moshi streaming and release all audio resources.
   * Safe to call multiple times — checks state before closing.
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

  /** True if Moshi streaming is active and accepting Opus frames. */
  get isMoshiActive() {
    return this._moshiActive;
  }
}
