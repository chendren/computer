export class AudioPlayer {
  constructor() {
    this.queue = [];
    this.playing = false;
    this.enabled = true;
    this.currentAudio = null;
    this.onPlaybackEnd = null; // callback when all audio finishes
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
}
