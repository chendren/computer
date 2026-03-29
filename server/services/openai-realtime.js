/**
 * OpenAI Realtime Service — Standalone S2S bridge via openai SDK.
 *
 * Wraps OpenAI's Realtime API (WebSocket) in a bridge interface matching
 * the Moshi/Gemini pattern. Can be used standalone or plugged into the
 * computer plugin's voice pipeline as a fourth mode.
 *
 * Audio format:
 *   Input:  PCM 16-bit LE mono @ 24kHz
 *   Output: PCM 16-bit LE mono @ 24kHz
 *   (Same rate both directions — unlike Gemini which is 16kHz in / 24kHz out)
 *
 * Requires: OPENAI_API_KEY environment variable.
 */

import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import { TOOLS, getSystemPrompt } from './voice-assistant.js';

const DEFAULT_MODEL = 'gpt-4o-realtime-preview';
const DEFAULT_VOICE = 'marin';

// Kind byte for binary protocol (distinct from Moshi 0x01, Gemini 0x03)
export const KIND_OPENAI = 0x04;

/**
 * Check if OpenAI Realtime is available (API key set).
 */
export function isOpenAIRealtimeAvailable() {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Get OpenAI Realtime service status.
 */
export function getOpenAIRealtimeStatus() {
  return {
    available: isOpenAIRealtimeAvailable(),
    model: DEFAULT_MODEL,
    voice: DEFAULT_VOICE,
    apiKeySet: isOpenAIRealtimeAvailable(),
  };
}

/**
 * Convert OpenAI-format tool definitions for Realtime API.
 * Realtime uses same shape but without the outer { type: 'function' } wrapper.
 */
function convertToolsForRealtime(tools) {
  return tools
    .filter(t => t.type === 'function' && t.function)
    .map(t => ({
      type: 'function',
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    }));
}

/**
 * Create an OpenAI Realtime bridge with the same interface as createMoshiBridge/createGeminiBridge.
 *
 * @param {object} config
 * @param {string} config.model - Model ID (default: gpt-4o-realtime-preview)
 * @param {string} config.voice - Voice name (default: marin)
 * @param {string} config.instructions - System prompt (default: from voice-assistant.js)
 * @param {object[]} config.tools - Tool definitions in OpenAI format (default: TOOLS)
 * @param {string} config.vadType - VAD type: 'semantic_vad' | 'server_vad' | null (default: semantic_vad)
 * @param {boolean} config.transcription - Enable input/output transcription (default: true)
 * @param {function} config.toolExecutor - async (toolName, args) => result
 */
export function createOpenAIRealtimeBridge(config = {}) {
  const {
    model = DEFAULT_MODEL,
    voice = DEFAULT_VOICE,
    instructions = getSystemPrompt(),
    tools = TOOLS,
    vadType = 'semantic_vad',
    transcription = true,
    toolExecutor = null,
  } = config;

  let rt = null;
  let connected = false;
  let textCallback = null;
  let audioCallback = null;
  let toolCallCallback = null;
  let closeCallback = null;
  let transcriptCallback = null;

  const bridge = {
    connect() {
      return new Promise((resolve, reject) => {
        if (!process.env.OPENAI_API_KEY) {
          reject(new Error('OPENAI_API_KEY not set'));
          return;
        }

        try {
          rt = new OpenAIRealtimeWS({ model });

          const timeout = setTimeout(() => {
            if (!connected) {
              reject(new Error('OpenAI Realtime connection timeout'));
            }
          }, 15000);

          rt.socket.on('open', () => {
            console.log('[openai-rt] WebSocket open, sending session.update');

            const sessionConfig = {
              type: 'realtime',
              model,
              output_modalities: ['audio'],
              instructions,
              audio: {
                input: {
                  format: { type: 'audio/pcm', rate: 24000 },
                  noise_reduction: { type: 'near_field' },
                },
                output: {
                  format: { type: 'audio/pcm', rate: 24000 },
                  voice,
                },
              },
            };

            // Add VAD
            if (vadType) {
              sessionConfig.audio.input.turn_detection = { type: vadType };
            }

            // Add transcription
            if (transcription) {
              sessionConfig.audio.input.transcription = { model: 'gpt-4o-transcribe' };
            }

            // Add tools
            const rtTools = convertToolsForRealtime(tools);
            if (rtTools.length > 0) {
              sessionConfig.tools = rtTools;
            }

            rt.send({ type: 'session.update', session: sessionConfig });
          });

          rt.on('session.created', () => {
            console.log('[openai-rt] Session created');
          });

          rt.on('session.updated', () => {
            connected = true;
            clearTimeout(timeout);
            console.log('[openai-rt] Session configured');
            resolve(true);
          });

          // Audio response chunks
          rt.on('response.output_audio.delta', (event) => {
            if (audioCallback && event.delta) {
              const pcmBuffer = Buffer.from(event.delta, 'base64');
              audioCallback(pcmBuffer);
            }
          });

          // Text response (when output_modalities includes 'text')
          rt.on('response.text.delta', (event) => {
            if (textCallback && event.delta) {
              textCallback(event.delta);
            }
          });

          // Audio transcript (what the model said, as text)
          rt.on('response.output_audio_transcript.delta', (event) => {
            if (textCallback && event.delta) {
              textCallback(event.delta);
            }
          });

          // Input audio transcription (what the user said)
          rt.on('conversation.item.input_audio_transcription.completed', (event) => {
            if (transcriptCallback && event.transcript) {
              transcriptCallback(event.transcript);
            }
          });

          // Function calling
          rt.on('response.function_call_arguments.done', (event) => {
            handleToolCall(event);
          });

          // VAD events
          rt.on('input_audio_buffer.speech_started', () => {
            console.log('[openai-rt] Speech started');
          });

          rt.on('input_audio_buffer.speech_stopped', () => {
            console.log('[openai-rt] Speech stopped');
          });

          rt.on('error', (event) => {
            console.error('[openai-rt] Error:', event.error?.message || event);
            if (!connected) {
              clearTimeout(timeout);
              reject(new Error(event.error?.message || 'Realtime error'));
            }
          });

          rt.socket.on('close', () => {
            console.log('[openai-rt] Disconnected');
            connected = false;
            if (closeCallback) closeCallback();
          });

          rt.socket.on('error', (err) => {
            console.error('[openai-rt] Socket error:', err.message);
            connected = false;
            if (!connected) {
              clearTimeout(timeout);
              reject(err);
            }
          });
        } catch (err) {
          reject(err);
        }
      });
    },

    sendAudio(pcmBuffer) {
      if (!rt || !connected) return false;
      try {
        const audioData = Buffer.isBuffer(pcmBuffer)
          ? pcmBuffer
          : Buffer.from(pcmBuffer);
        rt.send({
          type: 'input_audio_buffer.append',
          audio: audioData.toString('base64'),
        });
        return true;
      } catch (err) {
        console.error('[openai-rt] sendAudio error:', err.message);
        return false;
      }
    },

    sendText(text) {
      if (!rt || !connected) return;
      rt.send({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      });
      rt.send({ type: 'response.create' });
    },

    /** Commit the audio buffer (manual turn end when VAD is off). */
    commitAudio() {
      if (rt && connected) {
        rt.send({ type: 'input_audio_buffer.commit' });
      }
    },

    close() {
      if (rt) {
        try { rt.close(); } catch {}
        rt = null;
      }
      connected = false;
    },

    onText(cb) { textCallback = cb; },
    onAudio(cb) { audioCallback = cb; },
    onToolCall(cb) { toolCallCallback = cb; },
    onClose(cb) { closeCallback = cb; },
    onTranscript(cb) { transcriptCallback = cb; },

    isOpen() { return connected && rt !== null; },
  };

  /**
   * Handle function calls from the model.
   * Executes tools via toolExecutor and sends results back.
   */
  async function handleToolCall(event) {
    const { name, call_id, arguments: argsJson } = event;
    let args = {};
    try { args = JSON.parse(argsJson || '{}'); } catch {}

    console.log('[openai-rt] Tool call:', name, JSON.stringify(args));

    if (toolCallCallback) {
      toolCallCallback([{ name, args, call_id }]);
    }

    if (toolExecutor) {
      try {
        const result = await toolExecutor(name, args);

        // Send tool result back
        rt.send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id,
            output: JSON.stringify(result),
          },
        });

        // Trigger response generation with the tool result
        rt.send({ type: 'response.create' });
      } catch (err) {
        console.error('[openai-rt] Tool execution error:', name, err.message);
        rt.send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id,
            output: JSON.stringify({ error: err.message }),
          },
        });
        rt.send({ type: 'response.create' });
      }
    }
  }

  return bridge;
}
