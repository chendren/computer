/**
 * Voice Assistant UI — State machine orchestrating the full voice flow.
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
};

const WAKE_WORD_RE = /^(?:hey\s+)?computer[,.:!?\s]+(.+)/i;

export class VoiceAssistantUI {
  constructor(ws, audioPlayer, statusBar) {
    this.ws = ws;
    this.audio = audioPlayer;
    this.statusBar = statusBar;
    this.vad = new VadService();
    this.state = STATES.IDLE;

    console.log('[VoiceUI] Constructing');

    this._createButton();
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
      await this.vad.start();
      this._setState(STATES.LISTENING);
      this._wsSend('voice_start', {});
      this.button.title = 'Voice Assistant (listening) — click to stop';
      this._showStatus('Voice: listening for "Computer"');
      console.log('[VoiceUI] Activated, LISTENING');
    } catch (err) {
      console.error('[VoiceUI] Activation FAILED:', err);
      this._setState(STATES.ERROR);
      this.button.title = `Error: ${err.message}`;
      this._showStatus(`Voice ERROR: ${err.message}`);
      setTimeout(() => {
        if (this.state === STATES.ERROR) this._setState(STATES.IDLE);
      }, 8000);
    }
  }

  deactivate() {
    console.log('[VoiceUI] Deactivating');
    this.vad.stop();
    this.audio.stop();
    this._setState(STATES.IDLE);
    this._wsSend('voice_cancel', {});
    this.button.title = 'Voice Assistant — click to start';
  }

  /** Send JSON via WS with readiness check */
  _wsSend(type, data) {
    try {
      this.ws.send(type, data);
      console.log(`[VoiceUI] WS sent: ${type}`);
    } catch (err) {
      console.error(`[VoiceUI] WS send failed (${type}):`, err);
    }
  }

  /** Send binary via WS with readiness check */
  _wsSendBinary(blob) {
    try {
      this.ws.sendBinary(blob);
      console.log(`[VoiceUI] WS sent binary: ${blob.size} bytes`);
    } catch (err) {
      console.error('[VoiceUI] WS sendBinary failed:', err);
    }
  }

  _setState(newState) {
    const old = this.state;
    this.state = newState;
    this.button.setAttribute('data-state', newState);
    console.log(`[VoiceUI] ${old} → ${newState}`);

    if (newState === STATES.SPEAKING) {
      this.vad.pause();
    } else if (newState === STATES.LISTENING) {
      this.vad.resume();
    }
  }

  _bindVadCallbacks() {
    this.vad.onSpeechStart = () => {
      console.log('[VoiceUI] onSpeechStart, state:', this.state);
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
    this.ws.on('stt_result', (data) => {
      console.log('[VoiceUI] stt_result:', JSON.stringify(data), 'state:', this.state);
      this._showStatus(`Voice heard: "${data.text}"`);
      if (this.state !== STATES.PROCESSING) return;

      const match = data.text?.match(WAKE_WORD_RE);
      console.log('[VoiceUI] Wake word:', match ? `YES → "${match[1]}"` : 'NO');
      if (match) {
        const command = match[1].trim();
        if (command.length > 0) {
          this._setState(STATES.THINKING);
          this._showStatus(`Voice command: "${command}" — thinking...`);
          console.log('[VoiceUI] Sending command:', command);
          this._wsSend('voice_command', { text: command });
        } else {
          this._setState(STATES.LISTENING);
        }
      } else {
        this._showStatus(`Voice: no wake word in "${data.text}" — listening...`);
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
      this.statusBar?.setActivity(`Voice error: ${data.error}`);
      if (this.state !== STATES.IDLE) {
        this._setState(STATES.LISTENING);
      }
    });

    this.ws.on('voice_panel_switch', (data) => {
      console.log('[VoiceUI] panel_switch:', data.panel);
      if (data.panel && window.computerApp) {
        window.computerApp.switchPanel(data.panel);
      }
    });
  }

  _bindAudioCallbacks() {
    this.audio.onPlaybackEnd = () => {
      console.log('[VoiceUI] playback ended, state:', this.state);
      if (this.state === STATES.SPEAKING) {
        this._setState(STATES.LISTENING);
      }
    };
  }

  /** Show status message in the LCARS status bar for visibility */
  _showStatus(msg) {
    console.log('[VoiceUI] STATUS:', msg);
    this.statusBar?.setActivity?.(msg);
  }
}
