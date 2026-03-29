---
name: gemini-live-api
description: |
  Use this skill when the user asks about Gemini Live API, Gemini TTS, Gemini text-to-speech, Gemini speech-to-speech, Gemini real-time audio, Gemini voice, Gemini streaming, Google Live API, or wants to build voice apps with Gemini. Provides complete API reference for @google/genai SDK Live sessions, TTS configuration, voice selection, and audio streaming.
version: 1.0.0
tools: Bash, Read, Write
---

# Gemini Live API — @google/genai SDK Reference

Real-time speech-to-speech, TTS, and streaming audio via Google's Gemini Live API.

## Models

| Model | Use Case | Notes |
|-------|----------|-------|
| `gemini-3.1-flash-live-preview` | Live S2S (Developer API) | Real-time bidirectional audio (latest) |
| `gemini-2.0-flash-live-preview-04-09` | Live S2S (Vertex AI) | Same capability, Vertex endpoint |
| `gemini-2.5-flash-preview-tts` | Batch TTS | Text-to-speech generation |

## SDK Setup

```typescript
import { GoogleGenAI, Modality } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
```

Package: `@google/genai` v1.46+
API key env: `GEMINI_API_KEY` or `GOOGLE_API_KEY`

## Live Session — Connect

```typescript
const session = await ai.live.connect({
  model: "gemini-3.1-flash-live-preview",
  config: {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: "Kore" }
      }
    },
    systemInstruction: { parts: [{ text: "You are a helpful assistant." }] },
    // Optional features:
    enableAffectiveDialog: true,       // Detect/adapt to emotions
    inputAudioTranscription: {},       // Transcribe user audio
    outputAudioTranscription: {},      // Transcribe model audio
  },
  callbacks: {
    onopen: () => console.log("Connected"),
    onmessage: (e) => {
      // e.data contains LiveServerMessage
      // Audio data: e.data.serverContent?.modelTurn?.parts[0]?.inlineData
      // Transcription: e.data.serverContent?.outputTranscription
    },
    onerror: (e) => console.error("Error:", e.error),
    onclose: () => console.log("Disconnected"),
  },
});
```

### LiveConnectConfig — All Options

| Property | Type | Description |
|----------|------|-------------|
| `responseModalities` | `Modality[]` | `[Modality.AUDIO]`, `[Modality.TEXT]`, or both |
| `speechConfig` | `SpeechConfig` | Voice selection, language, multi-speaker |
| `systemInstruction` | `ContentUnion` | System prompt (text only) |
| `tools` | `ToolListUnion` | Function calling tools |
| `temperature` | `number` | Sampling temperature |
| `topK` | `number` | Top-K sampling |
| `topP` | `number` | Nucleus sampling |
| `maxOutputTokens` | `number` | Max output tokens |
| `seed` | `number` | Reproducibility seed |
| `enableAffectiveDialog` | `boolean` | Emotional adaptation |
| `inputAudioTranscription` | `AudioTranscriptionConfig` | Transcribe input audio |
| `outputAudioTranscription` | `AudioTranscriptionConfig` | Transcribe output audio |
| `contextWindowCompression` | `ContextWindowCompressionConfig` | Compress context for long sessions |
| `sessionResumption` | `SessionResumptionConfig` | Resume dropped sessions |
| `proactivity` | `ProactivityConfig` | Model proactive responses |
| `explicitVadSignal` | `boolean` | Manual VAD control (disable auto-VAD) |
| `realtimeInputConfig` | `RealtimeInputConfig` | Input stream config |
| `thinkingConfig` | `ThinkingConfig` | Reasoning/thinking config |

## Send Audio Input

```typescript
// Send audio chunk (PCM 16-bit LE, 16kHz mono)
session.sendRealtimeInput({
  audio: new Blob([pcmBuffer], { type: "audio/pcm;rate=16000" }),
});

// Send text instead
session.sendRealtimeInput({ text: "Hello, how are you?" });

// Signal end of audio stream
session.sendRealtimeInput({ audioStreamEnd: true });

// Manual VAD control (when explicitVadSignal: true)
session.sendRealtimeInput({ activityStart: {} });
// ... send audio ...
session.sendRealtimeInput({ activityEnd: {} });
```

### SendRealtimeInput Parameters

| Property | Type | Description |
|----------|------|-------------|
| `audio` | `Blob` | PCM audio chunk |
| `text` | `string` | Text input |
| `video` | `Blob` | Video frame |
| `media` | `Blob` | Generic media |
| `audioStreamEnd` | `boolean` | Signal mic off |
| `activityStart` | `ActivityStart` | Start of user turn |
| `activityEnd` | `ActivityEnd` | End of user turn |

## Send Text Content (non-realtime)

```typescript
// Send a text message and signal turn complete
session.sendClientContent({
  turns: [{ role: "user", parts: [{ text: "Tell me a joke" }] }],
  turnComplete: true,
});
```

## Close Session

```typescript
session.close();
```

## Voice Configuration

### Single Voice

```typescript
config: {
  speechConfig: {
    voiceConfig: {
      prebuiltVoiceConfig: { voiceName: "Kore" }
    }
  }
}
```

### Multi-Speaker

```typescript
config: {
  speechConfig: {
    multiSpeakerVoiceConfig: {
      speakerVoiceConfigs: [
        { speaker: "narrator", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Orus" } } },
        { speaker: "character", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } },
      ]
    }
  }
}
```

### Available Voices (30 total)

| Voice | Style |
|-------|-------|
| Puck | Upbeat, versatile |
| Charon | Informative, calm |
| Kore | Firm, authoritative |
| Fenrir | Excitable, energetic |
| Leda | Youthful, cheerful |
| Orus | Firm, informative |
| Aoede | Bright, warm |
| Callirhoe | Even-toned, easy-going |
| Autonoe | Bright, upbeat |
| Enceladus | Breathy, clear |
| Iapetus | Clear, straightforward |
| Umbriel | Easy-going, conversational |
| Algieba | Smooth, informative |
| Despina | Smooth, clear |
| Erinome | Clear, articulate |
| Gacrux | Mature, deliberate |
| Hydra | Firm, confident |
| Laomedeia | Upbeat, bright |
| Pulcherrima | Forward, deliberate |
| Sulafat | Warm, expressive |
| Vindemiatrix | Gentle, guiding |
| Zephyr | Bright, friendly |
| Achernar | Soft, breathy |
| Zubenelgenubi | Warm, casual |
| Sadachbia | Lively, animated |
| Sadaltager | Knowledgeable, clear |
| Schedar | Even, deliberate |
| Taygeta | Approachable, warm |
| Elnath | Smooth, flowing |
| Perseus | Clear, warm |

## Batch TTS (Non-Live)

For generating audio files from text without a live session:

```typescript
const response = await ai.models.generateContent({
  model: "gemini-2.5-flash-preview-tts",
  contents: [{ parts: [{ text: "Hello world, this is Gemini speaking!" }] }],
  config: {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: "Kore" }
      }
    }
  }
});

// Extract audio data
const audioData = response.candidates[0].content.parts[0].inlineData;
// audioData.data = base64-encoded WAV
// audioData.mimeType = "audio/wav" or "audio/L16;rate=24000"
```

### Multi-Speaker Batch TTS

```typescript
const response = await ai.models.generateContent({
  model: "gemini-2.5-flash-preview-tts",
  contents: [{
    parts: [{
      text: `narrator: Welcome to the story.
character: I can't believe we're here!
narrator: And so the adventure began.`
    }]
  }],
  config: {
    responseModalities: [Modality.AUDIO],
    speechConfig: {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: [
          { speaker: "narrator", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Orus" } } },
          { speaker: "character", voiceConfig: { prebuiltVoiceConfig: { voiceName: "Leda" } } },
        ]
      }
    }
  }
});
```

## Audio Format

| Direction | Format | Sample Rate | Encoding |
|-----------|--------|-------------|----------|
| Input | PCM 16-bit LE mono | 16 kHz | `audio/pcm;rate=16000` |
| Output (Live) | PCM 16-bit LE mono | 24 kHz | `audio/pcm;rate=24000` |
| Output (Batch TTS) | WAV or PCM | 24 kHz | `audio/wav` or `audio/L16;rate=24000` |

### PCM to WAV Conversion

```typescript
function pcmToWav(pcmData: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmData.length, 40);
  return Buffer.concat([header, pcmData]);
}
```

## Session Limits

| Limit | Value |
|-------|-------|
| Audio duration | 15 minutes |
| Video duration | 2 minutes |
| Context window | 128K tokens |
| Languages | 90+ |

## Key Features

- **Built-in noise reduction**: In model weights, not a config param
- **Voice Activity Detection (VAD)**: Automatic by default, or manual with `explicitVadSignal: true`
- **Function calling**: Pass `tools` in config, handle tool calls in `onmessage`
- **Session resumption**: Use `sessionResumption` config for reconnection
- **Context compression**: Use `contextWindowCompression` for long sessions
- **Free tier**: Available with unlimited tokens
