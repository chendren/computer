---
name: nova-sonic-api
description: |
  Use this skill when the user asks about Amazon Nova Sonic, Nova 2 Sonic, AWS speech-to-speech, Bedrock Realtime audio, Bedrock bidirectional streaming, InvokeModelWithBidirectionalStream, or wants to build voice apps with Amazon's Nova Sonic model. Provides complete API reference for the @aws-sdk/client-bedrock-runtime bidirectional streaming, audio configuration, voice selection, and tool calling.
version: 1.0.0
tools: Bash, Read, Write
---

# Amazon Nova Sonic — @aws-sdk/client-bedrock-runtime Reference

Real-time speech-to-speech via Amazon Bedrock's bidirectional HTTP/2 streaming API.

## Models

| Model | Model ID | Notes |
|-------|----------|-------|
| Nova Sonic v1 | `amazon.nova-sonic-v1:0` | Original, 11 voices |
| Nova 2 Sonic | `amazon.nova-2-sonic-v1:0` | Latest, 16+ voices, polyglot |

## SDK Setup

```typescript
import {
  BedrockRuntimeClient,
  InvokeModelWithBidirectionalStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({ region: "us-east-1" });
```

Package: `@aws-sdk/client-bedrock-runtime` v3.787+
Auth: AWS credentials (IAM, env vars, profiles — NOT API keys)

## Session Architecture

Nova Sonic uses **HTTP/2 bidirectional streaming** — NOT WebSocket.
The request body is an `AsyncIterable<chunk>` that yields JSON events.
The response is also a stream of events.

```
Client ──AsyncIterable──→ Bedrock (HTTP/2) ──Stream──→ Client
  │ sessionStart                               │ contentStart
  │ audioInputEvent (base64 PCM)               │ audioOutput (base64 PCM)
  │ textInput                                  │ textOutput
  │ toolResult                                 │ toolUse
  │ sessionEnd                                 │ completionEnd
```

## Event Flow

### 1. Session Start

```typescript
async function* createRequestStream() {
  // First event: configure the session
  yield {
    chunk: {
      bytes: Buffer.from(JSON.stringify({
        event: {
          sessionStart: {
            inferenceConfiguration: {
              maxTokens: 1024,
              topP: 0.9,
              temperature: 0.7,
            },
            audioInputConfiguration: {
              mediaType: "audio/lpcm",
              sampleRateHertz: 16000,
              sampleSizeBits: 16,
              channelCount: 1,
              audioType: "SPEECH",
              encoding: "base64",
            },
            audioOutputConfiguration: {
              mediaType: "audio/lpcm",
              sampleRateHertz: 24000,
              sampleSizeBits: 16,
              channelCount: 1,
              voiceId: "matthew",
              encoding: "base64",
              audioType: "SPEECH",
            },
            toolUse: {
              tools: [/* tool definitions */],
              toolChoice: { auto: {} },
            },
            systemPrompt: [{ text: "You are a helpful assistant." }],
          },
        },
      })),
    },
  };
}
```

### 2. Send Audio Input

```typescript
// Stream audio as base64-encoded PCM chunks (16kHz, Int16 LE, mono)
yield {
  chunk: {
    bytes: Buffer.from(JSON.stringify({
      event: {
        audioInputEvent: {
          audioChunk: pcmBuffer.toString('base64'),
        },
      },
    })),
  },
};
```

### 3. Send Text Input

```typescript
yield {
  chunk: {
    bytes: Buffer.from(JSON.stringify({
      event: {
        textInput: {
          text: "Hello, what time is it?",
        },
      },
    })),
  },
};
```

### 4. Send Tool Result

```typescript
yield {
  chunk: {
    bytes: Buffer.from(JSON.stringify({
      event: {
        toolResult: {
          toolUseId: "tool-call-id",
          content: [{ text: JSON.stringify(result) }],
          status: "success",
        },
      },
    })),
  },
};
```

### 5. Session End

```typescript
yield {
  chunk: {
    bytes: Buffer.from(JSON.stringify({
      event: { sessionEnd: {} },
    })),
  },
};
```

## Invoke Command

```typescript
const command = new InvokeModelWithBidirectionalStreamCommand({
  modelId: "amazon.nova-2-sonic-v1:0",
  body: createRequestStream(),  // AsyncIterable
});

const response = await client.send(command);
```

## Process Response Stream

```typescript
for await (const event of response.body) {
  if (event.chunk?.bytes) {
    const msg = JSON.parse(Buffer.from(event.chunk.bytes).toString());

    if (msg.event?.audioOutput) {
      // Base64-encoded PCM audio chunk (24kHz, Int16 LE, mono)
      const pcm = Buffer.from(msg.event.audioOutput.audioChunk, 'base64');
      // Play or buffer
    }

    if (msg.event?.textOutput) {
      console.log('Text:', msg.event.textOutput.text);
    }

    if (msg.event?.toolUse) {
      // Model wants to call a tool
      const { toolName, toolUseId, content } = msg.event.toolUse;
      // Execute tool, then yield toolResult event
    }

    if (msg.event?.contentStart) {
      // New content block starting (role info)
    }

    if (msg.event?.contentEnd) {
      // Content block finished
    }

    if (msg.event?.completionEnd) {
      // Full response complete
    }
  }
}
```

## Voice Selection

### Nova Sonic v1 Voices (11)

| Language | Feminine | Masculine |
|----------|----------|-----------|
| English (US) | `tiffany` | `matthew` |
| English (GB) | `amy` | — |
| French | `ambre` | `florian` |
| Italian | `beatrice` | `lorenzo` |
| German | `greta` | `lennart` |
| Spanish | `lupe` | `carlos` |

### Nova 2 Sonic Voices (16+)

All v1 voices plus additional voices across 8 languages.
Polyglot support: Tiffany can speak all languages in a single conversation.

Default recommendation: `tiffany` (polyglot, versatile) or `matthew` (clear, authoritative).

## Audio Format

| Direction | Format | Sample Rate | Encoding |
|-----------|--------|-------------|----------|
| Input | PCM 16-bit LE mono | 16 kHz | base64 `audio/lpcm` |
| Output | PCM 16-bit LE mono | 24 kHz | base64 `audio/lpcm` |

Note: Same rates as Gemini (16kHz in, 24kHz out). Different from OpenAI (24kHz both).

## Tool Definition Format

```typescript
{
  tools: [{
    toolSpec: {
      name: "get_time",
      description: "Get the current time and date.",
      inputSchema: {
        json: {
          type: "object",
          properties: {},
        },
      },
    },
  }],
  toolChoice: { auto: {} },  // or { any: {} } or { tool: { name: "..." } }
}
```

## Session Limits

| Limit | Value |
|-------|-------|
| Max session duration | 8 minutes |
| Context window | 300K tokens |
| Audio chunk size | 1024 samples |
| Continuation | Reconnect with chat history |

## Key Differences from Gemini/OpenAI

| Aspect | Nova Sonic | Gemini Live | OpenAI Realtime |
|--------|-----------|-------------|-----------------|
| Protocol | HTTP/2 bidi stream | WebSocket | WebSocket |
| SDK | `@aws-sdk/client-bedrock-runtime` | `@google/genai` | `openai/realtime/ws` |
| Auth | AWS IAM credentials | API key | API key |
| Audio in rate | 16kHz | 16kHz | 24kHz |
| Audio out rate | 24kHz | 24kHz | 24kHz |
| Body format | AsyncIterable of JSON events | SDK methods | JSON messages |
| VAD | Built-in | Explicit signals | Built-in semantic |
| Session limit | 8 min | 15 min | 30 min |
| Tool calling | `toolUse`/`toolResult` events | `sendToolResponse()` | `conversation.item.create` |
| Voices | 16 (polyglot) | 30 | 13 |
