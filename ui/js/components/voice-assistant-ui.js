/**
 * Voice Assistant UI — Dual-mode state machine.
 *
 * Computer Mode: VAD → Whisper STT → wake word → xLAM → Llama Scout → Coqui TTS
 * Moshi Mode:    Full-duplex speech-to-speech via Moshi (~200ms latency)
 */

import { VadService } from '../services/vad-service.js';

const STATES = {
  IDLE: 'idle',
  LISTENING: 'listening',
  CAPTURING: 'capturing',
  PROCESSING: 'processing',
  THINKING: 'thinking',
  SPEAKING: 'speaking',
  ERROR: 'error',
  // Moshi-specific
  MOSHI_ACTIVE: 'moshi_active',
};

const WAKE_WORD = 'computer';
const PUNCTUATION = ',.:!? \t';

function matchWakeWord(text) {
  const lower = (text || '').toLowerCase().trim();
  const idx = lower.indexOf(WAKE_WORD);
  if (idx === -1) return null;
  // Extract text after "computer" + any punctuation/whitespace
  let afterIdx = idx + WAKE_WORD.length;
  if (afterIdx >= lower.length) return '';
  // First char after "computer" must be punctuation or space
  if (PUNCTUATION.indexOf(lower[afterIdx]) === -1) return null;
  // Skip punctuation and whitespace
  while (afterIdx < text.length && PUNCTUATION.indexOf(text[afterIdx].toLowerCase()) !== -1) {
    afterIdx++;
  }
  return text.slice(afterIdx).trim();
}

export class VoiceAssistantUI {
  constructor(ws, audioPlayer, statusBar) {
    this.ws = ws;
    this.audio = audioPlayer;
    this.statusBar = statusBar;
    this.vad = new VadService();
    this.state = STATES.IDLE;
    this.voiceMode = 'computer'; // 'computer' or 'moshi'
    this.moshiTranscript = '';

    console.log('[VoiceUI] Constructing');

    this._createButton();
    this._createModeToggle();
    this._bindWsHandlers();
    this._bindAudioCallbacks();
    this._bindVadCallbacks();
  }

  _createButton() {
    this.button = document.createElement('button');
    this.button.className = 'voice-toggle';
    this.button.title = 'Voice Assistant';
    this.button.innerHTML = '&#9670;';
    this.button.setAttribute('data-state', 'idle');
    this.button.addEventListener('click', () => this.toggle());

    const titleBar = document.querySelector('.lcars-title-bar');
    if (titleBar) {
      titleBar.appendChild(this.button);
    } else {
      document.body.prepend(this.button);
    }
    console.log('[VoiceUI] Button added to', titleBar ? 'title bar' : 'body');
  }

  _createModeToggle() {
    this.modeButton = document.createElement('button');
    this.modeButton.className = 'voice-mode-toggle';
    this.modeButton.title = 'Voice Mode: Computer (click to switch)';
    this.modeButton.textContent = 'CMD';
    this.modeButton.setAttribute('data-mode', 'computer');
    this.modeButton.addEventListener('click', () => this._toggleMode());

    const titleBar = document.querySelector('.lcars-title-bar');
    if (titleBar) {
      titleBar.appendChild(this.modeButton);
    }
  }

  _toggleMode() {
    const newMode = this.voiceMode === 'moshi' ? 'computer' : 'moshi';
    this._wsSend('voice_mode', { mode: newMode });
  }

  _setVoiceMode(mode) {
    this.voiceMode = mode;
    this.vad.setMode(mode);
    this.modeButton.setAttribute('data-mode', mode);
    if (mode === 'moshi') {
      this.modeButton.textContent = 'MOSHI';
      this.modeButton.title = 'Voice Mode: Moshi (full-duplex) — click for Computer mode';
    } else {
      this.modeButton.textContent = 'CMD';
      this.modeButton.title = 'Voice Mode: Computer (commands) — click for Moshi mode';
    }
    console.log('[VoiceUI] Voice mode:', mode);
  }

  async toggle() {
    console.log('[VoiceUI] Toggle, state:', this.state);
    if (this.state === STATES.IDLE || this.state === STATES.ERROR) {
      await this.activate();
    } else {
      this.deactivate();
    }
  }

  async activate() {
    console.log('[VoiceUI] Activating...');
    this._showStatus('Voice: starting...');
    this.button.title = 'Starting...';
    try {
      if (this.voiceMode === 'moshi') {
        await this._activateMoshi();
      } else {
        await this._activateComputer();
      }
    } catch (err) {
      console.error('[VoiceUI] Activation FAILED:', err);
      this._setState(STATES.ERROR);
      this.button.title = 'Error: ' + err.message;
      this._showStatus('Voice ERROR: ' + err.message);
      setTimeout(() => {
        if (this.state === STATES.ERROR) this._setState(STATES.IDLE);
      }, 8000);
    }
  }

  async _activateComputer() {
    await this.vad.start();
    this._setState(STATES.LISTENING);
    this._wsSend('voice_start', {});
    this.button.title = 'Voice Assistant (listening) — click to stop';
    this._showStatus('Voice: listening for "Computer"');
    console.log('[VoiceUI] Activated, LISTENING (Computer mode)');
  }

  async _activateMoshi() {
    // Start Moshi continuous audio stream
    this.audio.startMoshiStream();
    await this.vad.startMoshiStream();

    // Wire up Opus frame sending
    this.vad.onMoshiAudioFrame = (opusFrame) => {
      // Send with 0x01 kind prefix
      const frame = new Uint8Array(1 + opusFrame.length);
      frame[0] = 0x01;
      frame.set(opusFrame, 1);
      this.ws.sendBinary(frame.buffer);
    };

    this._setState(STATES.MOSHI_ACTIVE);
    this._wsSend('voice_start', {});
    this.moshiTranscript = '';
    this.button.title = 'Moshi active (full-duplex) — click to stop';
    this._showStatus('Moshi: active — speak naturally');
    console.log('[VoiceUI] Activated, MOSHI_ACTIVE');
  }

  deactivate() {
    console.log('[VoiceUI] Deactivating');
    this.vad.stop();
    this.audio.stop();
    this.audio.stopMoshiStream();
    this._setState(STATES.IDLE);
    this._wsSend('voice_cancel', {});
    this.button.title = 'Voice Assistant — click to start';
    this.moshiTranscript = '';
  }

  _wsSend(type, data) {
    try {
      this.ws.send(type, data);
      console.log('[VoiceUI] WS sent: ' + type);
    } catch (err) {
      console.error('[VoiceUI] WS send failed (' + type + '):', err);
    }
  }

  _wsSendBinary(blob) {
    try {
      this.ws.sendBinary(blob);
    } catch (err) {
      console.error('[VoiceUI] WS sendBinary failed:', err);
    }
  }

  _setState(newState) {
    const old = this.state;
    this.state = newState;
    this.button.setAttribute('data-state', newState);
    console.log('[VoiceUI] ' + old + ' -> ' + newState);

    if (newState === STATES.SPEAKING) {
      this.vad.pause();
    } else if (newState === STATES.LISTENING) {
      this.vad.resume();
    }
  }

  _bindVadCallbacks() {
    this.vad.onSpeechStart = () => {
      console.log('[VoiceUI] onSpeechStart, state:', this.state);
      if (this.state === STATES.MOSHI_ACTIVE) return; // Moshi handles its own VAD
      this._showStatus('Voice: speech detected...');
      if (this.state === STATES.SPEAKING) {
        this.audio.interrupt();
        this._setState(STATES.CAPTURING);
      } else if (this.state === STATES.LISTENING) {
        this._setState(STATES.CAPTURING);
      }
    };

    this.vad.onSpeechEnd = (audio) => {
      console.log('[VoiceUI] onSpeechEnd, state:', this.state, 'samples:', audio?.length);
      if (this.state === STATES.MOSHI_ACTIVE) return; // Moshi handles its own VAD
      if (this.state !== STATES.CAPTURING && this.state !== STATES.LISTENING) {
        console.log('[VoiceUI] Ignored — wrong state');
        return;
      }

      this._setState(STATES.PROCESSING);
      this._showStatus('Voice: processing speech...');

      const wavBlob = VadService.float32ToWavBlob(audio);
      console.log('[VoiceUI] WAV blob:', wavBlob.size, 'bytes, sending...');
      this._wsSendBinary(wavBlob);
    };

    this.vad.onError = (err) => {
      console.error('[VoiceUI] VAD error:', err);
    };
  }

  _bindWsHandlers() {
    // ── Computer mode handlers ──
    this.ws.on('stt_result', (data) => {
      console.log('[VoiceUI] stt_result:', JSON.stringify(data), 'state:', this.state);
      this._showStatus('Voice heard: "' + data.text + '"');
      if (this.state !== STATES.PROCESSING) return;

      const command = matchWakeWord(data.text);
      console.log('[VoiceUI] Wake word:', command !== null ? 'YES -> "' + command + '"' : 'NO');
      if (command !== null && command.length > 0) {
        this._setState(STATES.THINKING);
        this._showStatus('Voice command: "' + command + '" — thinking...');
        console.log('[VoiceUI] Sending command:', command);
        this._wsSend('voice_command', { text: command });
      } else {
        this._showStatus('Voice: no wake word in "' + data.text + '" — listening...');
        this._setState(STATES.LISTENING);
      }
    });

    this.ws.on('stt_error', (data) => {
      console.error('[VoiceUI] stt_error:', data);
      if (this.state === STATES.PROCESSING) {
        this._setState(STATES.LISTENING);
      }
    });

    this.ws.on('voice_thinking', () => {
      console.log('[VoiceUI] voice_thinking');
      this._setState(STATES.THINKING);
    });

    this.ws.on('voice_response', (data) => {
      console.log('[VoiceUI] voice_response:', JSON.stringify(data).slice(0, 200));
      if (data.audioUrl) {
        this._setState(STATES.SPEAKING);
        this.audio.speak(data.audioUrl);
      } else if (data.text) {
        this.statusBar?.setActivity(data.text);
        this._setState(STATES.LISTENING);
      }
    });

    this.ws.on('voice_done', () => {
      console.log('[VoiceUI] voice_done, state:', this.state);
      if (this.state === STATES.THINKING) {
        this._setState(STATES.LISTENING);
      }
    });

    this.ws.on('voice_error', (data) => {
      console.error('[VoiceUI] voice_error:', data.error);
      this.statusBar?.setActivity('Voice error: ' + data.error);
      if (this.state !== STATES.IDLE) {
        this._setState(this.voiceMode === 'moshi' ? STATES.MOSHI_ACTIVE : STATES.LISTENING);
      }
    });

    this.ws.on('voice_panel_switch', (data) => {
      console.log('[VoiceUI] panel_switch:', data.panel);
      if (data.panel && window.computerApp) {
        window.computerApp.switchPanel(data.panel);
      }
    });

    // ── Moshi handlers ──
    this.ws.on('moshi_audio_frame', (opusFrame) => {
      // Opus audio from Moshi — play through AudioPlayer
      this.audio.playOpusFrame(opusFrame);
    });

    this.ws.on('moshi_text', (data) => {
      // Text transcript from Moshi
      if (data.text) {
        this.moshiTranscript = data.fullText || (this.moshiTranscript + data.text);
        this._showStatus('Moshi: ' + this.moshiTranscript.slice(-80));
      }
    });

    this.ws.on('moshi_text_frame', (text) => {
      // Direct text frame from binary WebSocket message
      this.moshiTranscript += text;
      this._showStatus('Moshi: ' + this.moshiTranscript.slice(-80));
    });

    this.ws.on('voice_mode_changed', (data) => {
      console.log('[VoiceUI] voice_mode_changed:', data.mode, 'reason:', data.reason);
      this._setVoiceMode(data.mode);

      if (data.reason === 'wake_word') {
        this._showStatus('Wake word detected: switching to Computer mode...');
        this._setState(STATES.THINKING);
      } else if (data.reason === 'command_complete') {
        this._showStatus('Moshi: active — speak naturally');
        this._setState(STATES.MOSHI_ACTIVE);
      } else if (data.reason === 'moshi_disconnected') {
        this._showStatus('Moshi disconnected — Computer mode');
        if (this.state === STATES.MOSHI_ACTIVE) {
          this._setState(STATES.LISTENING);
        }
      }
    });

    this.ws.on('moshi_handshake', (config) => {
      console.log('[VoiceUI] Moshi handshake:', config);
      this._showStatus('Moshi: connected — speak naturally');
    });

    this.ws.on('moshi_error', (data) => {
      console.error('[VoiceUI] moshi_error:', data.error);
      this._showStatus('Moshi error: ' + data.error);
      // Fall back to Computer mode
      this._setVoiceMode('computer');
    });
  }

  _bindAudioCallbacks() {
    this.audio.onPlaybackEnd = () => {
      console.log('[VoiceUI] playback ended, state:', this.state);
      if (this.state === STATES.SPEAKING) {
        this._setState(this.voiceMode === 'moshi' ? STATES.MOSHI_ACTIVE : STATES.LISTENING);
      }
    };
  }

  _showStatus(msg) {
    console.log('[VoiceUI] STATUS:', msg);
    this.statusBar?.setActivity?.(msg);
  }
}
