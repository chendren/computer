---
description: Show Computer system status and diagnostics
allowed-tools: [Bash, Read]
---

# Computer Status

Display system status for the Computer LCARS interface.

## Checks to perform

1. **Server Status**: `lsof -i :3141 -t`
2. **Data counts**:
   - Transcripts: `ls "${CLAUDE_PLUGIN_ROOT}/data/transcripts/" 2>/dev/null | wc -l`
   - Analyses: `ls "${CLAUDE_PLUGIN_ROOT}/data/analyses/" 2>/dev/null | wc -l`
   - Storage: `du -sh "${CLAUDE_PLUGIN_ROOT}/data/" 2>/dev/null`
3. **Tools**: `which whisper`, `which ffmpeg`, `node --version`
4. **Health** (if running): `curl -s http://localhost:3141/api/health`

## Output Format

Present as a Star Trek systems readout:

```
╔════════════════════════════════╗
║   COMPUTER SYSTEMS STATUS     ║
╠════════════════════════════════╣
║ Server:       [ONLINE/OFFLINE]║
║ Port:         3141            ║
║ Transcripts:  [count] stored  ║
║ Analyses:     [count] stored  ║
║ Storage:      [size]          ║
╠════════════════════════════════╣
║ SUBSYSTEMS                    ║
║ Whisper:      [path/MISSING]  ║
║ FFmpeg:       [path/MISSING]  ║
║ Node.js:      [version]       ║
╠════════════════════════════════╣
║ GATEWAY                       ║
║ Status:       [ONLINE/OFFLINE]║
║ Connected:    [YES/NO]        ║
║ Channels:     [count]         ║
║ Nodes:        [count]         ║
║ Security:     [count] redacted║
╚════════════════════════════════╝
```
