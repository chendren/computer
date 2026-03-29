---
description: Speak text aloud using Gemini 3.1 Flash Live TTS
argument-hint: "<text to speak> [--voice Voice] [--play]"
allowed-tools: [Bash, Read, Write]
---

# Gemini Speak

Convert text to speech using Gemini 3.1 Flash Live and play it through the speakers.

## Arguments

- `$ARGUMENTS` contains the text to speak, optionally with flags:
  - `--voice <name>` — choose a voice (default: Kore). Options: Puck, Charon, Kore, Fenrir, Leda, Orus, Aoede, Zephyr, Achernar, Perseus
  - `--play` — auto-play through speakers (default: true)
  - `--save <path>` — save the WAV file to a path instead of /tmp

## Process

1. **Parse arguments**: Extract the text and any flags from `$ARGUMENTS`.
   - If no text provided, ask the user what to speak
   - Default voice: Kore
   - Default output: `/tmp/gemini-speak-output.wav`

2. **Generate speech**: Run this Node.js script via Bash. Replace `TEXT`, `VOICE`, and `OUTPUT` with parsed values:

```bash
cd ~/.claude/plugins/computer && GEMINI_API_KEY="$GEMINI_API_KEY" node -e "
import { createGeminiBridge } from './server/services/gemini-live.js';
import { writeFileSync } from 'fs';

const text = process.argv[1];
const voice = process.argv[2] || 'Kore';
const outPath = process.argv[3] || '/tmp/gemini-speak-output.wav';

const bridge = createGeminiBridge({ voice, tools: [], transcription: true });
const chunks = [];
let transcript = '';

bridge.onAudio(pcm => chunks.push(Buffer.from(pcm)));
bridge.onText(t => { transcript += t; });

await bridge.connect();
await new Promise(r => setTimeout(r, 500));
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

3. **Play audio** (unless `--play false` or `--save` was specified):
```bash
afplay OUTPUT_PATH
```

4. **Report results**: Show the transcript, duration, voice used, and file path.

## Voice Reference

| Voice | Style |
|-------|-------|
| Kore | Firm, authoritative |
| Puck | Upbeat, versatile |
| Charon | Informative, calm |
| Fenrir | Excitable, energetic |
| Leda | Youthful, cheerful |
| Orus | Firm, informative |
| Aoede | Bright, warm |
| Zephyr | Bright, friendly |
| Achernar | Soft, breathy |
| Perseus | Clear, warm |

## Example Usage

- `/computer:gemini-speak Hello Captain, all systems nominal`
- `/computer:gemini-speak --voice Orus The warp core is stable at 97 percent efficiency`
- `/computer:gemini-speak --save ~/Desktop/greeting.wav Welcome aboard the Enterprise`
