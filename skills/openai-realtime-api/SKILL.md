---
name: openai-realtime-api
description: |
  Use this skill when the user asks about OpenAI Realtime API, OpenAI real-time audio, OpenAI speech-to-speech, OpenAI voice streaming, GPT-4o Realtime, gpt-realtime, OpenAI WebSocket audio, or wants to build voice apps with OpenAI's Realtime API. Provides complete API reference for the openai SDK Realtime WebSocket sessions, audio streaming, voice selection, function calling, and VAD configuration.
version: 1.0.0
tools: Bash, Read, Write
---

# OpenAI Realtime API — Node.js SDK Reference

Real-time speech-to-speech, TTS, and streaming audio via OpenAI's Realtime API over WebSocket.

## Models

| Model | Use Case | Notes |
|-------|----------|-------|
| `gpt-realtime` | Default alias | Routes to latest realtime model |
| `gpt-4o-realtime-preview` | Full S2S | Bidirectional audio + text + tools |
| `gpt-4o-mini-realtime-preview` | Lightweight S2S | Lower cost, faster |

## SDK Setup

```typescript
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
// Requires: yarn add openai ws @types/ws

const rt = new OpenAIRealtimeWS({ model: 'gpt-realtime' });
// Uses OPENAI_API_KEY env var by default
```

Package: `openai` v6+ (Node.js uses `openai/realtime/ws`)
Browser: `import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket'`
API key env: `OPENAI_API_KEY`

## Session Configuration

```typescript
rt.socket.on('open', () => {
  rt.send({
    type: 'session.update',
    session: {
      type: 'realtime',
      model: 'gpt-4o-realtime-preview',
      output_modalities: ['audio'],    // or ['text'] or ['audio', 'text']
      instructions: 'You are a helpful assistant.',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: { model: 'gpt-4o-transcribe' },
          turn_detection: {
            type: 'semantic_vad',       // or 'server_vad'
          },
          noise_reduction: { type: 'near_field' },
        },
        output: {
          format: { type: 'audio/pcm', rate: 24000 },
          voice: 'marin',
        },
      },
      tools: [/* function definitions */],
    },
  });
});
```

### Session Config — All Options

| Property | Type | Description |
|----------|------|-------------|
| `output_modalities` | `string[]` | `['audio']`, `['text']`, or both |
| `instructions` | `string` | System prompt |
| `audio.input.format` | `object` | `{ type: 'audio/pcm', rate: 24000 }` |
| `audio.input.transcription` | `object` | `{ model: 'gpt-4o-transcribe' }` |
| `audio.input.turn_detection` | `object` | VAD config (see below) |
| `audio.input.noise_reduction` | `object` | `{ type: 'near_field' }` or `'far_field'` |
| `audio.output.format` | `object` | `{ type: 'audio/pcm', rate: 24000 }` |
| `audio.output.voice` | `string` | Voice name (see list below) |
| `tools` | `object[]` | Function calling definitions |
| `temperature` | `number` | Sampling temperature |
| `max_response_output_tokens` | `number` | Max output tokens |

### Turn Detection (VAD)

```typescript
// Semantic VAD — AI-powered, understands pauses in speech context
turn_detection: { type: 'semantic_vad' }

// Server VAD — threshold-based, more predictable
turn_detection: {
  type: 'server_vad',
  threshold: 0.5,
  prefix_padding_ms: 300,
  silence_duration_ms: 500,
  create_response: true,
}

// Disabled — manual turn control
turn_detection: null
```

## Send Audio Input

```typescript
// Send PCM audio chunk (24kHz, 16-bit LE, mono) as base64
rt.send({
  type: 'input_audio_buffer.append',
  audio: base64PcmChunk,
});

// Commit the audio buffer (triggers processing if VAD is off)
rt.send({ type: 'input_audio_buffer.commit' });

// Clear the audio buffer
rt.send({ type: 'input_audio_buffer.clear' });
```

## Send Text Input

```typescript
// Send text as a conversation item
rt.send({
  type: 'conversation.item.create',
  item: {
    type: 'message',
    role: 'user',
    content: [{ type: 'input_text', text: 'Hello!' }],
  },
});

// Trigger a response
rt.send({ type: 'response.create' });
```

## Receive Audio Output

```typescript
// Streaming audio delta (base64-encoded PCM 24kHz)
rt.on('response.audio.delta', (event) => {
  const pcmChunk = Buffer.from(event.delta, 'base64');
  // Play or buffer the PCM chunk
});

// Audio playback complete
rt.on('response.audio.done', () => {
  console.log('Audio response finished');
});

// Text transcript of the audio response
rt.on('response.audio_transcript.delta', (event) => {
  process.stdout.write(event.delta);
});

rt.on('response.audio_transcript.done', (event) => {
  console.log('Full transcript:', event.transcript);
});
```

## Receive Text Output

```typescript
rt.on('response.text.delta', (event) => process.stdout.write(event.delta));
rt.on('response.text.done', (event) => console.log(event.text));
```

## Function Calling

### Define Tools

```typescript
rt.send({
  type: 'session.update',
  session: {
    tools: [
      {
        type: 'function',
        name: 'get_time',
        description: 'Get the current time and date.',
        parameters: { type: 'object', properties: {} },
      },
    ],
  },
});
```

### Handle Tool Calls

```typescript
rt.on('response.function_call_arguments.done', (event) => {
  const { name, call_id, arguments: argsJson } = event;
  const args = JSON.parse(argsJson);

  // Execute the tool
  const result = executeFunction(name, args);

  // Send the result back
  rt.send({
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id,
      output: JSON.stringify(result),
    },
  });

  // Trigger a new response incorporating the tool result
  rt.send({ type: 'response.create' });
});
```

## Close Session

```typescript
rt.close();
```

## Voice Selection

### Available Voices (13 total)

| Voice | Style |
|-------|-------|
| alloy | Neutral, balanced |
| ash | Warm, conversational |
| ballad | Expressive, melodic |
| coral | Clear, friendly |
| echo | Smooth, resonant |
| fable | Storytelling, warm |
| nova | Bright, energetic |
| onyx | Deep, authoritative |
| sage | Calm, measured |
| shimmer | Light, airy |
| verse | Versatile, adaptive |
| marin | Natural, high quality (recommended) |
| cedar | Rich, refined (recommended) |

Note: `marin` and `cedar` are newest and highest quality. `tts-1`/`tts-1-hd` only support the first 9 voices.

## Audio Format

| Direction | Format | Sample Rate | Encoding |
|-----------|--------|-------------|----------|
| Input | PCM 16-bit LE mono | 24 kHz | `audio/pcm` |
| Output | PCM 16-bit LE mono | 24 kHz | `audio/pcm` |
| Alt input | mu-law 8-bit mono | 8 kHz | `audio/pcmu` (telephony) |
| Alt input | A-law 8-bit mono | 8 kHz | `audio/pcma` (telephony) |

Note: Both input and output are 24kHz (same rate, unlike Gemini which is 16kHz in / 24kHz out).

## Key Server Events

| Event | Description |
|-------|-------------|
| `session.created` | Session established |
| `session.updated` | Config change confirmed |
| `input_audio_buffer.speech_started` | VAD detected speech |
| `input_audio_buffer.speech_stopped` | VAD detected silence |
| `input_audio_buffer.committed` | Audio buffer committed |
| `conversation.item.created` | New item in conversation |
| `response.created` | Model started generating |
| `response.audio.delta` | Audio chunk (base64 PCM) |
| `response.audio.done` | Audio generation complete |
| `response.audio_transcript.delta` | Transcript chunk |
| `response.audio_transcript.done` | Full transcript |
| `response.text.delta` | Text chunk |
| `response.text.done` | Text complete |
| `response.function_call_arguments.delta` | Tool call args streaming |
| `response.function_call_arguments.done` | Tool call complete |
| `response.done` | Full response complete |
| `error` | Error occurred |

## Transcription Models

| Model | Use Case |
|-------|----------|
| `gpt-4o-transcribe` | Best quality STT |
| `gpt-4o-mini-transcribe` | Faster, lower cost |
| `gpt-4o-transcribe-diarize` | Speaker diarization |
| `whisper-1` | Legacy Whisper |

## Session Limits

| Limit | Value |
|-------|-------|
| Max session duration | 30 minutes |
| Max audio input | Continuous (within session) |
| Audio format | PCM 24kHz or mu-law 8kHz |
| Voices | 13 built-in |
| Function calling | Supported |

## Key Differences from Gemini Live

| Aspect | OpenAI Realtime | Gemini Live |
|--------|----------------|-------------|
| SDK | `openai/realtime/ws` | `@google/genai` |
| Audio rate (input) | 24kHz | 16kHz |
| Audio rate (output) | 24kHz | 24kHz |
| VAD | Built-in server/semantic | Requires explicit signals |
| Send text | `conversation.item.create` + `response.create` | `sendRealtimeInput({ text })` |
| Send audio | `input_audio_buffer.append` (base64) | `sendRealtimeInput({ audio })` |
| Tool results | `conversation.item.create` type `function_call_output` | `sendToolResponse()` |
| Session init | `session.update` event | Config in `connect()` call |
| Event model | Named events (`rt.on(...)`) | Callback with message object |
