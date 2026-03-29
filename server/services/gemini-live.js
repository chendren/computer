/**
 * Gemini Live Service — Standalone S2S bridge via @google/genai SDK.
 *
 * Wraps Google's Gemini 3.1 Flash Live API in a bridge interface matching
 * the Moshi pattern (createMoshiBridge). Can be used standalone or plugged
 * into the computer plugin's voice pipeline as a third mode.
 *
 * Audio format:
 *   Input:  PCM 16-bit LE mono @ 16kHz
 *   Output: PCM 16-bit LE mono @ 24kHz
 *
 * Requires: GEMINI_API_KEY environment variable.
 */

import { GoogleGenAI, Modality } from '@google/genai';
import { TOOLS, getSystemPrompt } from './voice-assistant.js';

const DEFAULT_MODEL = 'gemini-3.1-flash-live-preview';
const DEFAULT_VOICE = 'Kore';

// Kind byte for binary protocol (distinct from Moshi's 0x01)
export const KIND_GEMINI = 0x03;

/**
 * Check if Gemini Live is available (API key set).
 */
export function isGeminiAvailable() {
  return !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
}

/**
 * Get Gemini service status.
 */
export function getGeminiStatus() {
  return {
    available: isGeminiAvailable(),
    model: DEFAULT_MODEL,
    voice: DEFAULT_VOICE,
    apiKeySet: isGeminiAvailable(),
  };
}

/**
 * Convert OpenAI-format tool definitions to Gemini's function declaration format.
 *
 * OpenAI: { type: 'function', function: { name, description, parameters } }
 * Gemini: { name, description, parameters }
 */
function convertToolsForGemini(tools) {
  return tools
    .filter(t => t.type === 'function' && t.function)
    .map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
}

/**
 * Create a Gemini Live bridge with the same interface as createMoshiBridge().
 *
 * @param {object} config
 * @param {string} config.model - Model ID (default: gemini-3.1-flash-live-preview)
 * @param {string} config.voice - Voice name (default: Kore)
 * @param {string} config.systemInstruction - System prompt (default: from voice-assistant.js)
 * @param {object[]} config.tools - Tool definitions in OpenAI format (default: TOOLS from voice-assistant.js)
 * @param {string} config.thinkingLevel - Thinking level: minimal|low|medium|high (default: minimal)
 * @param {boolean} config.transcription - Enable input/output transcription (default: true)
 * @param {function} config.toolExecutor - async (toolName, args) => result
 */
export function createGeminiBridge(config = {}) {
  const {
    model = DEFAULT_MODEL,
    voice = DEFAULT_VOICE,
    systemInstruction = getSystemPrompt(),
    tools = TOOLS,
    thinkingLevel = 'minimal',
    transcription = true,
    toolExecutor = null,
  } = config;

  let session = null;
  let connected = false;
  let textCallback = null;
  let audioCallback = null;
  let toolCallCallback = null;
  let closeCallback = null;
  let currentVoice = voice;
  let currentSystemInstruction = systemInstruction;

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  const bridge = {
    async connect() {
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY or GOOGLE_API_KEY not set');
      }

      const ai = new GoogleGenAI({ apiKey });
      const geminiTools = convertToolsForGemini(tools);

      const liveConfig = {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: currentVoice },
          },
        },
        systemInstruction: {
          parts: [{ text: currentSystemInstruction }],
        },
        thinkingConfig: { thinkingLevel },
        // Disable auto-VAD — the browser client sends activityStart/End signals
        // via the WebSocket bridge for reliable speech boundary detection
        realtimeInputConfig: {
          automaticActivityDetection: { disabled: true },
        },
      };

      // Add transcription if enabled
      if (transcription) {
        liveConfig.inputAudioTranscription = {};
        liveConfig.outputAudioTranscription = {};
      }

      // Add tools if available
      if (geminiTools.length > 0) {
        liveConfig.tools = [{ functionDeclarations: geminiTools }];
      }

      try {
        session = await ai.live.connect({
          model,
          config: liveConfig,
          callbacks: {
            onopen: () => {
              connected = true;
              console.log('[gemini-live] Connected to Gemini Live API');
            },
            onmessage: (msg) => {
              handleServerMessage(msg);
            },
            onerror: (e) => {
              console.error('[gemini-live] Error:', e.message || e);
              connected = false;
              if (closeCallback) closeCallback();
            },
            onclose: () => {
              console.log('[gemini-live] Disconnected');
              connected = false;
              if (closeCallback) closeCallback();
            },
          },
        });
        return true;
      } catch (err) {
        console.error('[gemini-live] Connection failed:', err.message);
        throw err;
      }
    },

    sendAudio(pcmBuffer) {
      if (!session || !connected) return false;
      try {
        const audioData = Buffer.isBuffer(pcmBuffer)
          ? pcmBuffer
          : Buffer.from(pcmBuffer);
        // SDK expects { data: base64, mimeType } object — not a browser Blob
        session.sendRealtimeInput({
          audio: { data: audioData.toString('base64'), mimeType: 'audio/pcm;rate=16000' },
        });
        return true;
      } catch (err) {
        console.error('[gemini-live] sendAudio error:', err.message);
        return false;
      }
    },

    /** Signal start of user speech (explicit VAD). */
    activityStart() {
      if (session && connected) session.sendRealtimeInput({ activityStart: {} });
    },

    /** Signal end of user speech (explicit VAD). */
    activityEnd() {
      if (session && connected) session.sendRealtimeInput({ activityEnd: {} });
    },

    sendText(text) {
      if (!session || !connected) return;
      // Gemini 3.1 Flash Live uses sendRealtimeInput for text
      // (sendClientContent is only for seeding initial history)
      session.sendRealtimeInput({ text });
    },

    close() {
      if (session) {
        try { session.close(); } catch {}
        session = null;
      }
      connected = false;
    },

    onText(cb) { textCallback = cb; },
    onAudio(cb) { audioCallback = cb; },
    onToolCall(cb) { toolCallCallback = cb; },
    onClose(cb) { closeCallback = cb; },

    isOpen() { return connected && session !== null; },

    setVoice(name) { currentVoice = name; },
    setSystemInstruction(text) { currentSystemInstruction = text; },
  };

  /**
   * Handle incoming server messages from the Gemini Live session.
   * A single message can contain multiple parts: audio, text, tool calls.
   */
  function handleServerMessage(msg) {
    // Setup complete — session is ready
    if (msg.setupComplete != null) {
      console.log('[gemini-live] Setup complete');
      return;
    }

    // Tool calls from the model
    if (msg.toolCall) {
      handleToolCall(msg.toolCall);
      return;
    }

    const serverContent = msg.serverContent;
    if (!serverContent) return;

    // Process model turn parts (audio + text)
    const parts = serverContent.modelTurn?.parts || [];
    for (const part of parts) {
      // Audio data (base64-encoded PCM)
      if (part.inlineData && audioCallback) {
        const { data } = part.inlineData;
        if (data && data.length > 4) {
          const pcmBuffer = Buffer.from(data, 'base64');
          audioCallback(pcmBuffer);
        }
      }

      // Text content (thinking/response text)
      if (part.text && textCallback) {
        textCallback(part.text);
      }
    }

    // Input transcription (what the user said)
    if (serverContent.inputTranscription?.text && textCallback) {
      textCallback(serverContent.inputTranscription.text);
    }

    // Output transcription (what the model said, as text)
    if (serverContent.outputTranscription?.text && textCallback) {
      textCallback(serverContent.outputTranscription.text);
    }
  }

  /**
   * Handle tool calls from Gemini.
   * Executes tools via the provided toolExecutor and sends results back.
   */
  async function handleToolCall(toolCall) {
    const functionCalls = toolCall.functionCalls || [];
    if (functionCalls.length === 0) return;

    if (toolCallCallback) {
      toolCallCallback(functionCalls);
    }

    // Execute tools and send results back to Gemini
    if (toolExecutor) {
      const functionResponses = [];
      for (const call of functionCalls) {
        console.log('[gemini-live] Tool call:', call.name, JSON.stringify(call.args));
        try {
          const result = await toolExecutor(call.name, call.args || {});
          functionResponses.push({
            name: call.name,
            id: call.id,
            response: { result: JSON.stringify(result) },
          });
        } catch (err) {
          console.error('[gemini-live] Tool execution error:', call.name, err.message);
          functionResponses.push({
            name: call.name,
            id: call.id,
            response: { error: err.message },
          });
        }
      }

      // Send tool results back to Gemini
      if (session && connected) {
        try {
          session.sendToolResponse({ functionResponses });
        } catch (err) {
          console.error('[gemini-live] sendToolResponse error:', err.message);
        }
      }
    }
  }

  return bridge;
}
