import { SpeechService } from '../services/speech-service.js';

export class VoiceInput {
  constructor(transcriptPanel, statusBar, wsClient, commandInput) {
    this.speech = new SpeechService(wsClient);
    this.transcriptPanel = transcriptPanel;
    this.statusBar = statusBar;
    this.commandInput = commandInput;
    this.micBtn = document.getElementById('mic-btn');
    this.uploadBtn = document.getElementById('upload-btn');
    this.fileInput = document.getElementById('audio-file-input');
    this.uploadStatus = document.getElementById('upload-status');

    if (!this.speech.supported) {
      this.micBtn.textContent = 'Voice Not Supported';
      this.micBtn.disabled = true;
    }

    this.speech.onResult = (text, isFinal) => {
      this.transcriptPanel.addLiveText(text, isFinal);
    };

    this.speech.onStateChange = (listening) => {
      this.micBtn.textContent = listening ? 'Stop Listening' : 'Start Listening';
      this.micBtn.classList.toggle('listening', listening);
      this.statusBar.setMicActive(listening);

      // When mic stops, populate command input with accumulated speech
      if (!listening && this.commandInput) {
        const fullText = this.speech.getAccumulatedText();
        if (fullText.trim()) {
          this.commandInput.setInputText(fullText.trim());
        }
      }
    };

    this.micBtn.addEventListener('click', () => {
      this.speech.toggle();
    });

    this.uploadBtn.addEventListener('click', () => {
      this.fileInput.click();
    });

    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files.length > 0) {
        this.uploadFile(this.fileInput.files[0]);
      }
    });
  }

  async uploadFile(file) {
    this.uploadStatus.textContent = 'Transcribing...';
    this.uploadBtn.disabled = true;

    try {
      const api = this.transcriptPanel.api;
      await api.uploadFile('/transcribe/file', file);
      this.uploadStatus.textContent = 'Complete';
    } catch (err) {
      this.uploadStatus.textContent = `Error: ${err.message}`;
    }

    this.uploadBtn.disabled = false;
    setTimeout(() => { this.uploadStatus.textContent = ''; }, 5000);
  }
}
