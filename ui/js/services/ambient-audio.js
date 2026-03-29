/**
 * AmbientAudio — Procedural ambient sound generator using Web Audio API.
 *
 * Generates Star Trek-style atmospheric audio loops via oscillators and
 * filtered noise. All sounds are kept very quiet (gain 0.02-0.05) so
 * they sit underneath speech and UI audio without competing.
 *
 * Presets:
 *   bridge      — low warp core hum (60 Hz + 120 Hz harmonic) + filtered air circulation noise
 *   engineering — deep throbbing warp core (40 Hz + LFO modulation) + bandpass machinery rumble
 *   space       — ultra-low deep space hum (30 Hz) — minimal, eerie ambience
 */
export class AmbientAudio {
  constructor() {
    this.ctx = null;
    this.playing = false;
    this.nodes = [];
    this.currentPreset = null;
  }

  start(preset = 'bridge') {
    if (this.playing) this.stop();
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.playing = true;
    this.currentPreset = preset;

    const presets = {
      bridge: () => this._bridgeAmbient(),
      engineering: () => this._engineeringAmbient(),
      space: () => this._spaceAmbient(),
    };

    (presets[preset] || presets.bridge)();
  }

  _bridgeAmbient() {
    // Low warp core hum (60 Hz)
    const osc1 = this.ctx.createOscillator();
    osc1.type = 'sine';
    osc1.frequency.value = 60;
    const gain1 = this.ctx.createGain();
    gain1.gain.value = 0.03;
    osc1.connect(gain1).connect(this.ctx.destination);
    osc1.start();
    this.nodes.push(osc1, gain1);

    // Higher harmonic (120 Hz)
    const osc2 = this.ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 120;
    const gain2 = this.ctx.createGain();
    gain2.gain.value = 0.015;
    osc2.connect(gain2).connect(this.ctx.destination);
    osc2.start();
    this.nodes.push(osc2, gain2);

    // Subtle filtered noise (air circulation)
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.value = 200;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = 0.01;
    noise.connect(noiseFilter).connect(noiseGain).connect(this.ctx.destination);
    noise.start();
    this.nodes.push(noise, noiseFilter, noiseGain);
  }

  _engineeringAmbient() {
    // Deeper warp core throb (40 Hz with slow LFO)
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 40;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.5;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 5;
    lfo.connect(lfoGain).connect(osc.frequency);
    lfo.start();
    const gain = this.ctx.createGain();
    gain.gain.value = 0.05;
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    this.nodes.push(osc, lfo, lfoGain, gain);

    // Machinery noise (bandpass-filtered)
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 300;
    filter.Q.value = 2;
    const nGain = this.ctx.createGain();
    nGain.gain.value = 0.02;
    noise.connect(filter).connect(nGain).connect(this.ctx.destination);
    noise.start();
    this.nodes.push(noise, filter, nGain);
  }

  _spaceAmbient() {
    // Very subtle deep space hum
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 30;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.02;
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    this.nodes.push(osc, gain);
  }

  stop() {
    for (const node of this.nodes) {
      try { node.stop?.(); } catch {}
      try { node.disconnect(); } catch {}
    }
    this.nodes = [];
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; }
    this.playing = false;
    this.currentPreset = null;
  }

  isPlaying() { return this.playing; }
  getPreset() { return this.currentPreset; }
}
