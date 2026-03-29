/**
 * Voice Assistant UI — State machine for voice interaction.
 *
 * Supports two voice modes:
 *
 * Computer Mode (wake-word gated, traditional pipeline):
 *   Microphone → Silero VAD → WAV blob → server Whisper STT → wake word check
 *   → "voice_command" → xLAM tool routing → tool execution → Kokoro TTS → audio playback
 *
 * Moshi Mode (full-duplex S2S, ~200ms latency):
 *   Microphone → WebCodecs Opus encoder → WebSocket binary → Moshi MLX sidecar
 *   Moshi audio → WebSocket binary → WebCodecs Opus decoder → AudioContext playback
 *   Wake word "Computer" in Moshi transcript → briefly switch to Computer mode for command
 *
 * State machine transitions:
 *
 *   IDLE ──activate()──→ LISTENING (Computer) or MOSHI_ACTIVE (Moshi)
 *
 *   Computer mode:
 *   LISTENING → CAPTURING (speech) → PROCESSING (Whisper) → THINKING (AI) → SPEAKING → LISTENING
 *
 *   Moshi mode:
 *   MOSHI_ACTIVE → THINKING (wake word) → SPEAKING → MOSHI_ACTIVE
 *
 *   Any state → ERROR (auto-resets to IDLE after 8s)
 *   Any state → IDLE (deactivate)
 */

import { VadService } from '../services/vad-service.js';
import { GeminiAudio } from '../services/gemini-audio.js';

// All possible states. The current state:
//   - Sets the data-state CSS attribute on the voice button (controls appearance)
//   - Determines whether VAD is paused (suppressed during SPEAKING/THINKING)
//   - Controls how incoming WebSocket events are interpreted
const STATES = {
  IDLE: 'idle',               // Not active — button shows "click to start"
  LISTENING: 'listening',     // Computer mode: waiting to hear the wake word
  CAPTURING: 'capturing',     // Computer mode: speech detected, actively recording
  PROCESSING: 'processing',   // Computer mode: audio sent, waiting for Whisper STT result
  THINKING: 'thinking',       // AI processing the command (xLAM routing + tool calls)
  SPEAKING: 'speaking',       // TTS audio is playing back
  ERROR: 'error',             // Failed to start — auto-resets to IDLE after 8 seconds
  MOSHI_ACTIVE: 'moshi_active',   // Moshi mode: full-duplex conversation active
  GEMINI_ACTIVE: 'gemini_active', // Gemini mode: cloud S2S conversation active
  OPENAI_ACTIVE: 'openai_active', // OpenAI Realtime mode: cloud S2S conversation active
  NOVA_ACTIVE: 'nova_active',     // Nova Sonic mode: AWS S2S conversation active
};

const WAKE_WORD = 'computer';
// Characters that can appear between "computer" and the actual command
// e.g. "Computer, what time?" or "Computer: red alert" or "computer what time?"
const PUNCTUATION = ',.:!? \t';

/**
 * Parse a speech transcript and extract the command after the wake word "Computer".
 *
 * Accepts:
 *   "Computer, what time is it?" → "what time is it?"
 *   "Computer: red alert"        → "red alert"
 *   "Hey computer what time"     → "what time"  (word boundary required)
 *
 * Rejects (false positives):
 *   "computerize this"           → null (next char is not punctuation/space)
 *   "computers are fast"         → null (same reason)
 *
 * @param {string} text - Raw transcript from Whisper STT
 * @returns {string|null} Command text after wake word, '' for bare "computer", null if no match
 */
function matchWakeWord(text) {
  const lower = (text || '').toLowerCase().trim();
  const idx = lower.indexOf(WAKE_WORD);
  if (idx === -1) return null;

  // Word boundary check: the character immediately after "computer" must be
  // punctuation or whitespace — this prevents matching "computerize", "computers", etc.
  let afterIdx = idx + WAKE_WORD.length;
  if (afterIdx >= lower.length) return '';  // bare "computer" with nothing after
  if (PUNCTUATION.indexOf(lower[afterIdx]) === -1) return null;  // false positive

  // Skip all punctuation and whitespace between "computer" and the command itself
  while (afterIdx < text.length && PUNCTUATION.indexOf(text[afterIdx].toLowerCase()) !== -1) {
    afterIdx++;
  }

  // Return the command text (preserving original casing from the transcript)
  return text.slice(afterIdx).trim();
}

export class VoiceAssistantUI {
  /**
   * @param {WebSocketClient} ws - Connection to the Computer server
   * @param {AudioPlayer} audioPlayer - Handles TTS queue and Moshi Opus decoding
   * @param {object} statusBar - LCARS status bar with setActivity(msg) method
   */
  constructor(ws, audioPlayer, statusBar) {
    this.ws = ws;             // WebSocketClient — send/receive server events
    this.audio = audioPlayer; // AudioPlayer — TTS playback and Moshi audio
    this.statusBar = statusBar; // LCARS status bar element
    this.vad = new VadService(); // Silero VAD + Opus streaming + Gemini PCM
    this.geminiAudio = new GeminiAudio(); // Gemini PCM playback
    this.state = STATES.IDLE;
    this.voiceMode = 'computer'; // Default: Voxtral STT → xLAM routing → Kokoro TTS
    this.moshiTranscript = ''; // Accumulates Moshi text tokens for display
    this.geminiTranscript = ''; // Accumulates Gemini text tokens for display
    this.openaiTranscript = ''; // Accumulates OpenAI Realtime text tokens
    this.novaTranscript = '';   // Accumulates Nova Sonic text tokens

    console.log('[VoiceUI] Constructing');

    this._createButton();       // ♦ diamond toggle button in the LCARS title bar
    this._createModeToggle();   // MOSHI / CMD mode label button
    this._bindWsHandlers();     // handle all server → client events
    this._bindAudioCallbacks(); // connect audio playback end → state transition
    this._bindVadCallbacks();   // connect VAD speech events → recording flow
  }

  /**
   * Create the ♦ diamond voice toggle button and insert it into the LCARS title bar.
   * CSS selects on data-state attribute to change button appearance per state.
   */
  _createButton() {
    this.button = document.createElement('button');
    this.button.className = 'voice-toggle';
    this.button.title = 'Voice Assistant';
    this.button.innerHTML = '&#9670;';  // Unicode diamond ♦ — the Star Trek computer symbol
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

  /**
   * Create the MOSHI / CMD mode label button.
   * Displays current mode, toggles on click.
   */
  _createModeToggle() {
    this.modeButton = document.createElement('button');
    this.modeButton.className = 'voice-mode-toggle';
    this.modeButton.title = 'Voice Mode: Computer (Voxtral STT → Kokoro TTS)';
    this.modeButton.textContent = 'CMD';
    this.modeButton.setAttribute('data-mode', 'computer');
    this.modeButton.addEventListener('click', () => this._toggleMode());

    const titleBar = document.querySelector('.lcars-title-bar');
    if (titleBar) {
      titleBar.appendChild(this.modeButton);
    }
  }

  /**
   * Request a mode switch from the server.
   * The server responds with 'voice_mode_changed' confirming the new mode.
   */
  _toggleMode() {
    // 4-way cycle: CMD → GEMINI → OPENAI → NOVA → CMD
    const cycle = { computer: 'gemini', gemini: 'openai', openai: 'nova', nova: 'computer' };
    const newMode = cycle[this.voiceMode] || 'computer';
    this._wsSend('voice_mode', { mode: newMode });
  }

  /**
   * Apply a confirmed mode change — updates local state and button labels.
   * Called when 'voice_mode_changed' arrives from the server.
   *
   * @param {string} mode - 'moshi' or 'computer'
   */
  _setVoiceMode(mode) {
    this.voiceMode = mode;
    this.vad.setMode(mode);  // tells VAD which pipeline to use
    this.modeButton.setAttribute('data-mode', mode);
    if (mode === 'gemini') {
      this.modeButton.textContent = 'GEMINI';
      this.modeButton.title = 'Voice Mode: Gemini Live (cloud S2S) — click for OpenAI mode';
    } else if (mode === 'openai') {
      this.modeButton.textContent = 'OPENAI';
      this.modeButton.title = 'Voice Mode: OpenAI Realtime (cloud S2S) — click for Nova mode';
    } else if (mode === 'nova') {
      this.modeButton.textContent = 'NOVA';
      this.modeButton.title = 'Voice Mode: Nova Sonic (AWS S2S) — click for Computer mode';
    } else {
      this.modeButton.textContent = 'CMD';
      this.modeButton.title = 'Voice Mode: Computer (Voxtral STT → Kokoro TTS) — click for Gemini mode';
    }
    console.log('[VoiceUI] Voice mode:', mode);
  }

  /**
   * Toggle voice on/off. Called when the user clicks the diamond button.
   * IDLE or ERROR → activate. Any active state → deactivate.
   */
  async toggle() {
    console.log('[VoiceUI] Toggle, state:', this.state);
    if (this.state === STATES.IDLE || this.state === STATES.ERROR) {
      await this.activate();
    } else {
      this.deactivate();
    }
  }

  /**
   * Start voice mode. Routes to Moshi or Computer pipeline based on voiceMode.
   * On failure, enters ERROR state and auto-resets to IDLE after 8 seconds.
   */
  async activate() {
    console.log('[VoiceUI] Activating...');
    this._showStatus('Voice: starting...');
    this.button.title = 'Starting...';
    try {
      if (this.voiceMode === 'moshi') {
        await this._activateMoshi();
      } else if (this.voiceMode === 'gemini') {
        await this._activateGemini();
      } else if (this.voiceMode === 'openai') {
        await this._activateOpenAI();
      } else if (this.voiceMode === 'nova') {
        await this._activateNova();
      } else {
        await this._activateComputer();
      }
    } catch (err) {
      console.error('[VoiceUI] Activation FAILED:', err);
      this._setState(STATES.ERROR);
      this.button.title = 'Error: ' + err.message;
      this._showStatus('Voice ERROR: ' + err.message);
      // Auto-reset: give the user time to read the error, then allow retry
      setTimeout(() => {
        if (this.state === STATES.ERROR) this._setState(STATES.IDLE);
      }, 8000);
    }
  }

  /**
   * Start Computer mode — initialize Silero VAD and enter LISTENING state.
   * From here, VAD callbacks drive the recording flow when speech is detected.
   */
  async _activateComputer() {
    await this.vad.start();  // requests mic permission, loads ONNX model
    this._setState(STATES.LISTENING);
    this._wsSend('voice_start', {});
    this.button.title = 'Voice Assistant (listening) — click to stop';
    this._showStatus('Voice: listening for "Computer"');
    console.log('[VoiceUI] Activated, LISTENING (Computer mode)');
  }

  /**
   * Start Moshi mode — initialize Opus encoder/decoder and begin streaming.
   *
   * Audio output: AudioPlayer.startMoshiStream() creates the WebCodecs decoder
   *   and AudioContext so incoming Opus frames from Moshi can be played.
   *
   * Audio input: VadService.startMoshiStream() opens the mic at 24kHz and
   *   encodes each 80ms chunk to Opus via WebCodecs AudioEncoder.
   *
   * Each encoded Opus frame is sent as a binary WebSocket message with kind
   * byte 0x01 prepended. The server strips the kind byte and forwards the raw
   * Opus frame to the Moshi MLX sidecar.
   */
  async _activateMoshi() {
    // Initialize the Opus decoder for Moshi's audio responses
    this.audio.startMoshiStream();
    // Initialize the mic + Opus encoder for our voice input to Moshi
    await this.vad.startMoshiStream();

    // Forward each encoded Opus frame to the server with the 0x01 kind byte prefix
    this.vad.onMoshiAudioFrame = (opusFrame) => {
      const frame = new Uint8Array(1 + opusFrame.length);
      frame[0] = 0x01;  // kind byte: Opus audio (server routes this to Moshi)
      frame.set(opusFrame, 1);
      this.ws.sendBinary(frame.buffer);
    };

    this._setState(STATES.MOSHI_ACTIVE);
    this._wsSend('voice_start', {});  // tells server to connect to Moshi bridge
    this.moshiTranscript = '';
    this.button.title = 'Moshi active (full-duplex) — click to stop';
    this._showStatus('Moshi: active — speak naturally');
    console.log('[VoiceUI] Activated, MOSHI_ACTIVE');
  }

  /**
   * Start Gemini Live mode — initialize raw PCM capture and playback.
   * No Opus encoding needed — Gemini speaks raw PCM natively.
   */
  async _activateGemini() {
    // Initialize PCM playback for Gemini's audio responses
    this.geminiAudio.startPlayback();
    // Initialize mic PCM capture for Gemini input
    await this.vad.startGeminiStream();

    // Track speech state for explicit VAD signaling
    this._geminiSpeaking = false;
    this._geminiSilenceTimer = null;

    // Forward each captured PCM chunk to the server with the 0x03 kind byte prefix
    this.vad.onGeminiAudioChunk = (int16Chunk) => {
      const bytes = new Uint8Array(int16Chunk.buffer);

      // Simple energy-based VAD: detect if this chunk contains speech
      // (sum of absolute sample values above threshold = speech)
      let energy = 0;
      for (let i = 0; i < int16Chunk.length; i++) {
        energy += Math.abs(int16Chunk[i]);
      }
      const avgEnergy = energy / int16Chunk.length;
      const hasSpeech = avgEnergy > 200; // threshold for 16-bit PCM

      if (hasSpeech && !this._geminiSpeaking) {
        // Speech started — signal activityStart
        this._geminiSpeaking = true;
        this._wsSend('gemini_activity', { action: 'start' });
        if (this._geminiSilenceTimer) { clearTimeout(this._geminiSilenceTimer); this._geminiSilenceTimer = null; }
      } else if (!hasSpeech && this._geminiSpeaking) {
        // Silence detected — wait 600ms before signaling end (debounce)
        if (!this._geminiSilenceTimer) {
          this._geminiSilenceTimer = setTimeout(() => {
            this._geminiSpeaking = false;
            this._wsSend('gemini_activity', { action: 'end' });
            this._geminiSilenceTimer = null;
          }, 600);
        }
      } else if (hasSpeech && this._geminiSilenceTimer) {
        // Speech resumed during silence debounce — cancel the end signal
        clearTimeout(this._geminiSilenceTimer);
        this._geminiSilenceTimer = null;
      }

      const frame = new Uint8Array(1 + bytes.length);
      frame[0] = 0x03; // kind byte: raw PCM (server routes this to Gemini)
      frame.set(bytes, 1);
      this.ws.sendBinary(frame.buffer);
    };

    this._setState(STATES.GEMINI_ACTIVE);
    this._wsSend('voice_mode', { mode: 'gemini' }); // tells server to connect Gemini bridge
    this.geminiTranscript = '';
    this.button.title = 'Gemini Live active — click to stop';
    this._showStatus('Gemini: active — speak naturally');
    console.log('[VoiceUI] Activated, GEMINI_ACTIVE');
  }

  /**
   * Start OpenAI Realtime mode — 24kHz PCM capture and playback.
   * OpenAI has built-in semantic VAD — no manual activity signals needed.
   */
  async _activateOpenAI() {
    // Reuse GeminiAudio for PCM playback (already 24kHz)
    this.geminiAudio.startPlayback();
    // Start mic capture at 24kHz (OpenAI's native rate, unlike Gemini's 16kHz)
    await this.vad.startGeminiStream(24000);

    this.vad.onGeminiAudioChunk = (int16Chunk) => {
      const bytes = new Uint8Array(int16Chunk.buffer);
      const frame = new Uint8Array(1 + bytes.length);
      frame[0] = 0x04; // kind byte: OpenAI Realtime PCM
      frame.set(bytes, 1);
      this.ws.sendBinary(frame.buffer);
    };

    this._setState(STATES.OPENAI_ACTIVE);
    this._wsSend('voice_mode', { mode: 'openai' });
    this.openaiTranscript = '';
    this.button.title = 'OpenAI Realtime active — click to stop';
    this._showStatus('OpenAI: active — speak naturally');
    console.log('[VoiceUI] Activated, OPENAI_ACTIVE');
  }

  /**
   * Start Nova Sonic mode — 16kHz PCM capture, 24kHz playback (same as Gemini).
   * Nova has built-in VAD via Bedrock bidirectional streaming.
   */
  async _activateNova() {
    this.geminiAudio.startPlayback();
    await this.vad.startGeminiStream(16000); // Nova uses 16kHz input like Gemini

    this.vad.onGeminiAudioChunk = (int16Chunk) => {
      const bytes = new Uint8Array(int16Chunk.buffer);
      const frame = new Uint8Array(1 + bytes.length);
      frame[0] = 0x05; // kind byte: Nova Sonic PCM
      frame.set(bytes, 1);
      this.ws.sendBinary(frame.buffer);
    };

    this._setState(STATES.NOVA_ACTIVE);
    this._wsSend('voice_mode', { mode: 'nova' });
    this.novaTranscript = '';
    this.button.title = 'Nova Sonic active — click to stop';
    this._showStatus('Nova: active — speak naturally');
    console.log('[VoiceUI] Activated, NOVA_ACTIVE');
  }

  /**
   * Stop all voice processing and return to IDLE.
   * Releases mic, stops audio, sends voice_cancel to disconnect bridges.
   */
  deactivate() {
    console.log('[VoiceUI] Deactivating');
    this.vad.stop();              // release mic and destroy VAD, Opus encoder, or Gemini capture
    this.audio.stop();            // stop any currently playing TTS audio
    this.audio.stopMoshiStream(); // release WebCodecs decoder and AudioContext
    this.geminiAudio.stopPlayback(); // release Gemini PCM playback
    this.geminiAudio.stopCapture();  // release Gemini PCM capture if active
    this._setState(STATES.IDLE);
    this._wsSend('voice_cancel', {});  // tells server to disconnect bridges
    this.button.title = 'Voice Assistant — click to start';
    this.moshiTranscript = '';
    this.geminiTranscript = '';
    this.openaiTranscript = '';
    this.novaTranscript = '';
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

  /**
   * Transition to a new state. Updates button appearance and manages VAD pause/resume.
   *
   * VAD pause/resume rules:
   *   SPEAKING  → pause VAD: don't record while TTS audio is playing (avoid self-transcription)
   *   THINKING  → pause VAD: don't send Opus frames during Computer command processing
   *   LISTENING or MOSHI_ACTIVE → resume VAD: open mic for user input
   *   Other states (CAPTURING, PROCESSING, ERROR, IDLE) → leave VAD as-is
   *
   * @param {string} newState - Target state from the STATES enum
   */
  _setState(newState) {
    const old = this.state;
    this.state = newState;
    this.button.setAttribute('data-state', newState);  // CSS uses this for visual styling
    console.log('[VoiceUI] ' + old + ' -> ' + newState);

    if (newState === STATES.SPEAKING || newState === STATES.THINKING) {
      // Pause microphone while the assistant is talking or thinking
      this.vad.pause();
      if (this.geminiAudio) this.geminiAudio.pause();
    } else if (newState === STATES.LISTENING || newState === STATES.MOSHI_ACTIVE || newState === STATES.GEMINI_ACTIVE || newState === STATES.OPENAI_ACTIVE || newState === STATES.NOVA_ACTIVE) {
      // Resume mic when returning to an input-ready state
      this.vad.resume();
      if (this.geminiAudio) this.geminiAudio.resume();
    }
  }

  /**
   * Wire up Silero VAD callbacks for the Computer mode recording pipeline.
   *
   * onSpeechStart: Silero detected speech onset above threshold.
   *   - In LISTENING: move to CAPTURING to collect the audio
   *   - In SPEAKING: barge-in — interrupt TTS, start capturing new command
   *   - In MOSHI_ACTIVE: ignore — Moshi manages its own audio input
   *
   * onSpeechEnd: Silero detected sustained silence (redemptionFrames met).
   *   Converts the collected Float32 audio to a 16kHz WAV blob and sends
   *   it to the server as a binary WebSocket message. The server responds
   *   with 'stt_result' once Whisper has transcribed it.
   *
   * onError: VAD failure — logged only, does not change state.
   */
  _bindVadCallbacks() {
    this.vad.onSpeechStart = () => {
      console.log('[VoiceUI] onSpeechStart, state:', this.state);
      if (this.state === STATES.MOSHI_ACTIVE) return;  // Moshi handles its own audio
      this._showStatus('Voice: speech detected...');
      if (this.state === STATES.SPEAKING) {
        // Barge-in: user started speaking while TTS is playing → interrupt audio
        this.audio.interrupt();
        this._setState(STATES.CAPTURING);
      } else if (this.state === STATES.LISTENING) {
        this._setState(STATES.CAPTURING);
      }
    };

    this.vad.onSpeechEnd = (audio) => {
      console.log('[VoiceUI] onSpeechEnd, state:', this.state, 'samples:', audio?.length);
      if (this.state === STATES.MOSHI_ACTIVE) return;  // Moshi handles its own audio
      if (this.state !== STATES.CAPTURING && this.state !== STATES.LISTENING) {
        console.log('[VoiceUI] Ignored — wrong state');
        return;
      }

      this._setState(STATES.PROCESSING);
      this._showStatus('Voice: processing speech...');

      // Convert Silero's Float32 audio to WAV and send to server for Whisper STT.
      // The server will respond with 'stt_result' containing the transcript text.
      const wavBlob = VadService.float32ToWavBlob(audio);
      console.log('[VoiceUI] WAV blob:', wavBlob.size, 'bytes, sending...');
      this._wsSendBinary(wavBlob);
    };

    this.vad.onError = (err) => {
      console.error('[VoiceUI] VAD error:', err);
    };
  }

  /**
   * Wire up all WebSocket server → client event handlers.
   *
   * Computer mode events flow: stt_result → voice_command → voice_thinking →
   *   voice_response (+ TTS audio) → voice_done → back to LISTENING
   *
   * Moshi mode events: continuous moshi_audio_frame + moshi_text streams,
   *   plus voice_mode_changed when wake word triggers Computer mode temporarily.
   */
  _bindWsHandlers() {
    // ── Computer mode handlers ────────────────────────────────────────────────

    // Whisper returned a transcript — check for the wake word before acting
    this.ws.on('stt_result', (data) => {
      console.log('[VoiceUI] stt_result:', JSON.stringify(data), 'state:', this.state);
      this._showStatus('Voice heard: "' + data.text + '"');
      if (this.state !== STATES.PROCESSING) return;

      const command = matchWakeWord(data.text);
      console.log('[VoiceUI] Wake word:', command !== null ? 'YES -> "' + command + '"' : 'NO');
      if (command !== null && command.length > 0) {
        // Wake word found: send command to server for AI processing
        this._setState(STATES.THINKING);
        this._showStatus('Voice command: "' + command + '" — thinking...');
        console.log('[VoiceUI] Sending command:', command);
        this._wsSend('voice_command', { text: command });
      } else {
        // No wake word (or bare "Computer") — discard and go back to listening
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
        // TTS audio was generated — play it; onPlaybackEnd will return to LISTENING
        this._setState(STATES.SPEAKING);
        this.audio.speak(data.audioUrl);
      } else if (data.text) {
        // Text-only response (no audio) — display and return to listening immediately
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
        const activeState = { moshi: STATES.MOSHI_ACTIVE, gemini: STATES.GEMINI_ACTIVE, openai: STATES.OPENAI_ACTIVE, nova: STATES.NOVA_ACTIVE };
        this._setState(activeState[this.voiceMode] || STATES.LISTENING);
      }
    });

    this.ws.on('voice_panel_switch', (data) => {
      console.log('[VoiceUI] panel_switch:', data.panel);
      if (data.panel && window.computerApp) {
        window.computerApp.switchPanel(data.panel);
      }
    });

    // ── Moshi mode handlers ────────────────────────────────────────────────────

    // Opus audio frame from Moshi — decoded and played by AudioPlayer
    this.ws.on('moshi_audio_frame', (opusFrame) => {
      this.audio.playOpusFrame(opusFrame);
    });

    // Incremental text transcript from Moshi (JSON-encoded, may have fullText accumulator)
    this.ws.on('moshi_text', (data) => {
      if (data.text) {
        // Use fullText if the server provides it (avoids duplication bugs)
        this.moshiTranscript = data.fullText || (this.moshiTranscript + data.text);
        this._showStatus('Moshi: ' + this.moshiTranscript.slice(-80));  // last 80 chars
      }
    });

    // Text token from binary WebSocket frame (kind byte 0x02)
    this.ws.on('moshi_text_frame', (text) => {
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
      } else if (data.reason === 'gemini_disconnected') {
        this._showStatus('Gemini disconnected — Computer mode');
        if (this.state === STATES.GEMINI_ACTIVE) {
          this._setState(STATES.LISTENING);
        }
      } else if (data.reason === 'openai_disconnected') {
        this._showStatus('OpenAI disconnected — Computer mode');
        if (this.state === STATES.OPENAI_ACTIVE) {
          this._setState(STATES.LISTENING);
        }
      } else if (data.reason === 'nova_disconnected') {
        this._showStatus('Nova disconnected — Computer mode');
        if (this.state === STATES.NOVA_ACTIVE) {
          this._setState(STATES.LISTENING);
        }
      }
    });

    this.ws.on('moshi_handshake', (config) => {
      // Moshi is connected and ready — config contains server-side settings
      console.log('[VoiceUI] Moshi handshake:', config);
      this._showStatus('Moshi: connected — speak naturally');
    });

    this.ws.on('moshi_error', (data) => {
      console.error('[VoiceUI] moshi_error:', data.error);
      this._showStatus('Moshi error: ' + data.error);
      // Moshi failed — fall back to Computer mode so voice still functions
      this._setVoiceMode('computer');
    });

    // ── Gemini mode handlers ────────────────────────────────────────────────

    // Raw PCM audio from Gemini — play directly (no Opus decoding needed)
    this.ws.on('gemini_audio_frame', (pcmPayload) => {
      if (this.voiceMode === 'gemini') {
        this.geminiAudio.playPcmChunk(pcmPayload);
      }
    });

    // Incremental text transcript from Gemini
    this.ws.on('gemini_text', (data) => {
      if (data.text) {
        this.geminiTranscript = data.fullText || (this.geminiTranscript + data.text);
        this._showStatus('Gemini: ' + this.geminiTranscript.slice(-80));
      }
    });

    // Tool call feedback from Gemini
    this.ws.on('gemini_tool_call', (data) => {
      if (data.tools) {
        this._showStatus('Gemini tools: ' + data.tools.join(', '));
      }
    });

    this.ws.on('gemini_error', (data) => {
      console.error('[VoiceUI] gemini_error:', data.error);
      this._showStatus('Gemini error: ' + data.error);
      this._setVoiceMode('computer');
    });

    // ── OpenAI Realtime mode handlers ─────────────────────────────────────

    this.ws.on('openai_audio_frame', (pcmPayload) => {
      if (this.voiceMode === 'openai') {
        this.geminiAudio.playPcmChunk(pcmPayload);
      }
    });

    this.ws.on('openai_text', (data) => {
      if (data.text) {
        this.openaiTranscript = data.fullText || (this.openaiTranscript + data.text);
        this._showStatus('OpenAI: ' + this.openaiTranscript.slice(-80));
      }
    });

    this.ws.on('openai_tool_call', (data) => {
      if (data.tools) {
        this._showStatus('OpenAI tools: ' + data.tools.join(', '));
      }
    });

    this.ws.on('openai_error', (data) => {
      console.error('[VoiceUI] openai_error:', data.error);
      this._showStatus('OpenAI error: ' + data.error);
      this._setVoiceMode('computer');
    });

    // ── Nova Sonic mode handlers ──────────────────────────────────────────

    this.ws.on('nova_audio_frame', (pcmPayload) => {
      if (this.voiceMode === 'nova') {
        this.geminiAudio.playPcmChunk(pcmPayload);
      }
    });

    this.ws.on('nova_text', (data) => {
      if (data.text) {
        this.novaTranscript = data.fullText || (this.novaTranscript + data.text);
        this._showStatus('Nova: ' + this.novaTranscript.slice(-80));
      }
    });

    this.ws.on('nova_tool_call', (data) => {
      if (data.tools) {
        this._showStatus('Nova tools: ' + data.tools.join(', '));
      }
    });

    this.ws.on('nova_error', (data) => {
      console.error('[VoiceUI] nova_error:', data.error);
      this._showStatus('Nova error: ' + data.error);
      this._setVoiceMode('computer');
    });
  }

  /**
   * Wire up the audio playback end callback.
   *
   * When the TTS queue drains (AudioPlayer fires onPlaybackEnd), transition back
   * to the appropriate listening state:
   *   - Moshi mode → MOSHI_ACTIVE: resume full-duplex conversation
   *   - Computer mode → LISTENING: wait for next wake word
   *
   * This callback is also triggered by interrupt() when the user barges in.
   */
  _bindAudioCallbacks() {
    this.audio.onPlaybackEnd = () => {
      console.log('[VoiceUI] playback ended, state:', this.state);
      if (this.state === STATES.SPEAKING) {
        const activeState = { moshi: STATES.MOSHI_ACTIVE, gemini: STATES.GEMINI_ACTIVE, openai: STATES.OPENAI_ACTIVE, nova: STATES.NOVA_ACTIVE };
        this._setState(activeState[this.voiceMode] || STATES.LISTENING);
      }
    };
  }

  /**
   * Show a status message in the LCARS status bar and log it.
   * @param {string} msg - Human-readable description of current voice activity
   */
  _showStatus(msg) {
    console.log('[VoiceUI] STATUS:', msg);
    this.statusBar?.setActivity?.(msg);
  }
}
