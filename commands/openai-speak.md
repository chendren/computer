---
description: Speak text aloud using OpenAI Realtime API TTS
argument-hint: "<text to speak> [--voice Voice] [--play]"
allowed-tools: [Bash, Read, Write]
---

# OpenAI Speak

Convert text to speech using OpenAI Realtime API and play through speakers.

## Arguments

- `$ARGUMENTS` contains the text to speak, optionally with flags:
  - `--voice <name>` — choose a voice (default: marin). Options: marin, cedar, alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse
  - `--play` — auto-play through speakers (default: true)
  - `--save <path>` — save the WAV file to a path

## Process

1. **Parse arguments**: Extract text and flags from `$ARGUMENTS`.
   - Default voice: marin
   - Default output: `/tmp/openai-speak-output.wav`

2. **Generate speech**: Run via Bash. Replace `TEXT`, `VOICE`, and `OUTPUT`:

```bash
cd ~/.claude/plugins/computer && node -e "
import { createOpenAIRealtimeBridge } from './server/services/openai-realtime.js';
import { writeFileSync } from 'fs';

const text = process.argv[1];
const voice = process.argv[2] || 'marin';
const outPath = process.argv[3] || '/tmp/openai-speak-output.wav';

const bridge = createOpenAIRealtimeBridge({ voice, tools: [] });
const chunks = [];
let transcript = '';

bridge.onAudio(pcm => chunks.push(Buffer.from(pcm)));
bridge.onText(t => { transcript += t; });

await bridge.connect();
bridge.sendText(text);

await new Promise(resolve => {
  let sil = 0, last = 0;
  const check = setInterval(() => {
    if (chunks.length === last) { sil++; if ((chunks.length > 0 && sil > 6) || sil > 30) { clearInterval(check); resolve(); } }
    else { sil = 0; last = chunks.length; }
  }, 500);
});

const combined = Buffer.concat(chunks);
const hdr = Buffer.alloc(44);
hdr.write('RIFF',0); hdr.writeUInt32LE(36+combined.length,4);
hdr.write('WAVE',8); hdr.write('fmt ',12); hdr.writeUInt32LE(16,16);
hdr.writeUInt16LE(1,20); hdr.writeUInt16LE(1,22);
hdr.writeUInt32LE(24000,24); hdr.writeUInt32LE(48000,28);
hdr.writeUInt16LE(2,32); hdr.writeUInt16LE(16,34);
hdr.write('data',36); hdr.writeUInt32LE(combined.length,40);
writeFileSync(outPath, Buffer.concat([hdr, combined]));

console.log(JSON.stringify({
  voice, duration: (combined.length/48000).toFixed(1),
  chunks: chunks.length, transcript, file: outPath
}));
bridge.close();
process.exit(0);
" -- "TEXT" "VOICE" "OUTPUT"
```

3. **Play audio** (unless `--save` specified):
```bash
afplay OUTPUT_PATH
```

4. **Report results**: Show transcript, duration, voice, and file path.

## Voice Reference

| Voice | Style | Quality |
|-------|-------|---------|
| marin | Natural, warm | Highest (recommended) |
| cedar | Rich, refined | Highest (recommended) |
| alloy | Neutral, balanced | Standard |
| ash | Warm, conversational | Standard |
| coral | Clear, friendly | Standard |
| echo | Smooth, resonant | Standard |
| nova | Bright, energetic | Standard |
| onyx | Deep, authoritative | Standard |
| sage | Calm, measured | Standard |

## Example Usage

- `/computer:openai-speak Hello Captain, all systems nominal`
- `/computer:openai-speak --voice cedar The warp core is stable`
- `/computer:openai-speak --save ~/Desktop/alert.wav Red alert, shields up`
