---
description: Transcribe an audio file using Whisper
argument-hint: "<audio-file-path>"
allowed-tools: [Bash, Read, Write]
---

# Computer Transcribe

Transcribe an audio file using Whisper and store the result.

## Process

1. **Validate**: Check that $ARGUMENTS contains a file path
   - Verify the file exists
   - Accepted formats: mp3, wav, m4a, ogg, flac, webm, mp4

2. **Transcribe**:
   ```bash
   /opt/homebrew/bin/whisper "$ARGUMENTS" --model base --output_format json --output_dir /tmp/computer-transcribe
   ```

3. **Read output**: Find and read the JSON output file from /tmp/computer-transcribe/

4. **Push to UI**: Write the transcript JSON to `/tmp/computer-transcript-result.json` using the Write tool:
   ```json
   {"source":"whisper","filename":"<name>","text":"<full-text>","segments":[...]}
   ```
   Then POST it:
   ```bash
   curl -s -X POST http://localhost:3141/api/transcripts -H 'Content-Type: application/json' -d @/tmp/computer-transcript-result.json
   ```

5. **Display**: Show the transcript with timestamps in the terminal

Arguments: $ARGUMENTS
