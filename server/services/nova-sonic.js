/**
 * Amazon Nova Sonic Service — Standalone S2S bridge via Bedrock bidirectional streaming.
 *
 * Wraps AWS Bedrock's InvokeModelWithBidirectionalStream in a bridge interface
 * matching the Moshi/Gemini/OpenAI pattern. Uses HTTP/2 streaming (not WebSocket).
 *
 * Nova Sonic event protocol requires contentStart/contentEnd wrappers with UUIDs
 * around each text or audio content block.
 *
 * Audio format:
 *   Input:  PCM 16-bit LE mono @ 16kHz
 *   Output: PCM 16-bit LE mono @ 24kHz
 *
 * Requires: AWS credentials (IAM, env vars, or profile).
 */

import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { randomUUID } from 'crypto';
import { TOOLS, getSystemPrompt } from './voice-assistant.js';

const DEFAULT_MODEL = 'amazon.nova-2-sonic-v1:0';
const DEFAULT_VOICE = 'tiffany';
const DEFAULT_REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

export const KIND_NOVA = 0x05;

export function isNovaSonicAvailable() {
  return !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE || process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI);
}

export function getNovaSonicStatus() {
  return {
    available: isNovaSonicAvailable(),
    model: DEFAULT_MODEL,
    voice: DEFAULT_VOICE,
    region: DEFAULT_REGION,
  };
}

function convertToolsForNova(tools) {
  return tools
    .filter(t => t.type === 'function' && t.function)
    .map(t => ({
      toolSpec: {
        name: t.function.name,
        description: t.function.description,
        inputSchema: { json: t.function.parameters },
      },
    }));
}

/**
 * Encode an event object into the chunk format the SDK expects.
 */
function encodeEvent(event) {
  return {
    chunk: {
      bytes: new TextEncoder().encode(JSON.stringify({ event })),
    },
  };
}

export function createNovaSonicBridge(config = {}) {
  const {
    model = DEFAULT_MODEL,
    voice = DEFAULT_VOICE,
    region = DEFAULT_REGION,
    systemPrompt = getSystemPrompt(),
    tools = TOOLS,
    toolExecutor = null,
  } = config;

  let connected = false;
  let textCallback = null;
  let audioCallback = null;
  let toolCallCallback = null;
  let closeCallback = null;

  // Event queue + resolver for AsyncIterable
  const eventQueue = [];
  let eventResolve = null;
  let streamClosed = false;

  // Session-level prompt name (stays constant for the session)
  const promptName = randomUUID();
  // Track active audio content name for streaming chunks
  let activeAudioContentName = null;

  function pushEvent(event) {
    const chunk = encodeEvent(event);
    if (eventResolve) {
      const resolve = eventResolve;
      eventResolve = null;
      resolve({ value: chunk, done: false });
    } else {
      eventQueue.push(chunk);
    }
  }

  function createRequestStream() {
    return {
      [Symbol.asyncIterator]() {
        return {
          next() {
            if (streamClosed) return Promise.resolve({ done: true });
            if (eventQueue.length > 0) {
              return Promise.resolve({ value: eventQueue.shift(), done: false });
            }
            return new Promise((resolve) => { eventResolve = resolve; });
          },
        };
      },
    };
  }

  const bridge = {
    async connect() {
      const client = new BedrockRuntimeClient({ region });
      const novaTools = convertToolsForNova(tools);

      // 1. Queue sessionStart
      // sessionStart only carries inference config — audio/voice/tools go in promptStart
      const sessionStartEvt = {
        inferenceConfiguration: {
          maxTokens: 1024,
          topP: 0.9,
          temperature: 0.7,
        },
      };

      // Event sequence: sessionStart → promptStart → system prompt → (then ready for content)
      pushEvent({ sessionStart: sessionStartEvt });

      // promptStart opens the prompt — carries output config, voice, and tools
      const promptStartEvt = {
        promptName,
        textOutputConfiguration: { mediaType: 'text/plain' },
        audioOutputConfiguration: {
          mediaType: 'audio/lpcm',
          sampleRateHertz: 24000,
          sampleSizeBits: 16,
          channelCount: 1,
          voiceId: voice,
          encoding: 'base64',
          audioType: 'SPEECH',
        },
      };
      if (novaTools.length > 0) {
        promptStartEvt.toolUseOutputConfiguration = { mediaType: 'application/json' };
        promptStartEvt.toolConfiguration = { tools: novaTools };
      }
      pushEvent({ promptStart: promptStartEvt });

      // System prompt as a non-interactive TEXT content block
      const sysContentName = randomUUID();
      pushEvent({
        contentStart: {
          promptName,
          contentName: sysContentName,
          type: 'TEXT',
          interactive: false,
          role: 'SYSTEM',
          textInputConfiguration: { mediaType: 'text/plain' },
        },
      });
      pushEvent({
        textInput: { promptName, contentName: sysContentName, content: systemPrompt },
      });
      pushEvent({
        contentEnd: { promptName, contentName: sysContentName },
      });

      // Don't open an audio block here — sendAudio() opens one on demand,
      // and sendText() sends its own silence audio block.

      const command = new InvokeModelWithBidirectionalStreamCommand({
        modelId: model,
        body: createRequestStream(),
      });

      try {
        const response = await client.send(command);
        connected = true;
        console.log('[nova-sonic] Connected to Bedrock bidirectional stream');

        processResponseStream(response.body).catch(err => {
          console.error('[nova-sonic] Stream error:', err.message);
          connected = false;
          if (closeCallback) closeCallback();
        });

        return true;
      } catch (err) {
        console.error('[nova-sonic] Connection failed:', err.message);
        throw err;
      }
    },

    sendAudio(pcmBuffer) {
      if (!connected) return false;
      try {
        const audioData = Buffer.isBuffer(pcmBuffer) ? pcmBuffer : Buffer.from(pcmBuffer);

        // Start a new audio content block if not already streaming
        if (!activeAudioContentName) {
          activeAudioContentName = randomUUID();
          pushEvent({
            contentStart: {
              promptName,
              contentName: activeAudioContentName,
              type: 'AUDIO',
              interactive: true,
              role: 'USER',
              audioInputConfiguration: {
                mediaType: 'audio/lpcm',
                sampleRateHertz: 16000,
                sampleSizeBits: 16,
                channelCount: 1,
                audioType: 'SPEECH',
                encoding: 'base64',
              },
            },
          });
        }

        pushEvent({ audioInput: { promptName, contentName: activeAudioContentName, content: audioData.toString('base64') } });
        return true;
      } catch (err) {
        console.error('[nova-sonic] sendAudio error:', err.message);
        return false;
      }
    },

    /** End the current audio content block (call after speech ends). */
    endAudio() {
      if (activeAudioContentName) {
        pushEvent({ contentEnd: { promptName, contentName: activeAudioContentName } });
        activeAudioContentName = null;
      }
    },

    sendText(text) {
      if (!connected) return;

      // Close any open audio block first
      if (activeAudioContentName) {
        pushEvent({ contentEnd: { promptName, contentName: activeAudioContentName } });
        activeAudioContentName = null;
      }

      // Send text content
      const contentName = randomUUID();
      pushEvent({
        contentStart: {
          promptName, contentName, type: 'TEXT', interactive: true, role: 'USER',
          textInputConfiguration: { mediaType: 'text/plain' },
        },
      });
      pushEvent({ textInput: { promptName, contentName, content: text } });
      pushEvent({ contentEnd: { promptName, contentName } });

      // Nova Sonic requires at least one audio content per prompt.
      // Send 0.5s of silence to satisfy the requirement and trigger response.
      const silenceCN = randomUUID();
      const silence = Buffer.alloc(16000); // 0.5s at 16kHz Int16
      pushEvent({
        contentStart: {
          promptName, contentName: silenceCN, type: 'AUDIO', interactive: true, role: 'USER',
          audioInputConfiguration: {
            mediaType: 'audio/lpcm', sampleRateHertz: 16000, sampleSizeBits: 16,
            channelCount: 1, audioType: 'SPEECH', encoding: 'base64',
          },
        },
      });
      pushEvent({ audioInput: { promptName, contentName: silenceCN, content: silence.toString('base64') } });
      pushEvent({ contentEnd: { promptName, contentName: silenceCN } });
    },

    close() {
      if (activeAudioContentName) {
        try { pushEvent({ contentEnd: { promptName, contentName: activeAudioContentName } }); } catch {}
        activeAudioContentName = null;
      }
      if (connected) {
        try { pushEvent({ promptEnd: { promptName } }); } catch {}
        try { pushEvent({ sessionEnd: {} }); } catch {}
      }
      streamClosed = true;
      connected = false;
      if (eventResolve) { eventResolve({ done: true }); eventResolve = null; }
    },

    onText(cb) { textCallback = cb; },
    onAudio(cb) { audioCallback = cb; },
    onToolCall(cb) { toolCallCallback = cb; },
    onClose(cb) { closeCallback = cb; },
    isOpen() { return connected; },
  };

  async function processResponseStream(stream) {
    try {
      for await (const event of stream) {
        if (event.chunk?.bytes) {
          const text = new TextDecoder().decode(event.chunk.bytes);
          try {
            const msg = JSON.parse(text);
            handleResponseEvent(msg);
          } catch {
            // Non-JSON chunk, skip
          }
        }
      }
    } finally {
      connected = false;
      console.log('[nova-sonic] Stream ended');
      if (closeCallback) closeCallback();
    }
  }

  function handleResponseEvent(msg) {
    const evt = msg.event || msg;

    if (evt.audioOutput?.content && audioCallback) {
      const pcm = Buffer.from(evt.audioOutput.content, 'base64');
      audioCallback(pcm);
    }

    if (evt.textOutput?.content && textCallback) {
      textCallback(evt.textOutput.content);
    }

    if (evt.toolUse) {
      handleToolUse(evt.toolUse);
    }

    if (evt.contentStart) {
      console.log('[nova-sonic] Content start:', evt.contentStart.type || '', evt.contentStart.role || '');
    }
    if (evt.completionEnd) {
      console.log('[nova-sonic] Completion end');
    }
  }

  async function handleToolUse(toolUse) {
    const { toolName, toolUseId, content } = toolUse;
    let args = {};
    if (content) {
      try { args = typeof content === 'string' ? JSON.parse(content) : content; } catch {}
    }

    console.log('[nova-sonic] Tool call:', toolName, JSON.stringify(args));
    if (toolCallCallback) toolCallCallback([{ name: toolName, args, id: toolUseId }]);

    if (toolExecutor) {
      try {
        const result = await toolExecutor(toolName, args);
        const resultContentName = randomUUID();
        pushEvent({
          contentStart: {
            promptName,
            contentName: resultContentName,
            type: 'TOOL_RESULT',
            interactive: true,
            toolResultInputConfiguration: { toolUseId, status: 'success' },
          },
        });
        pushEvent({
          textInput: { promptName, contentName: resultContentName, content: JSON.stringify(result) },
        });
        pushEvent({
          contentEnd: { promptName, contentName: resultContentName },
        });
      } catch (err) {
        console.error('[nova-sonic] Tool error:', toolName, err.message);
        const errContentName = randomUUID();
        pushEvent({
          contentStart: {
            promptName,
            contentName: errContentName,
            type: 'TOOL_RESULT',
            interactive: true,
            toolResultInputConfiguration: { toolUseId, status: 'error' },
          },
        });
        pushEvent({
          textInput: { promptName, contentName: errContentName, content: JSON.stringify({ error: err.message }) },
        });
        pushEvent({
          contentEnd: { promptName, contentName: errContentName },
        });
      }
    }
  }

  return bridge;
}
