export class AudioPlayer {
  constructor() {
    this.queue = [];
    this.playing = false;
    this.enabled = true;
    this.currentAudio = null;
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
