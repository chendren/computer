---
name: computer-operations
description: |
  Use this skill when the user mentions "Computer", "LCARS", "Enterprise computer", "start the computer", "computer analyze", "computer search", "computer transcribe", or references the Star Trek computer interface. Provides operational knowledge for the Computer plugin system including server management, API endpoints, agent integration, and data storage.
version: 1.0.0
tools: Read, Bash
---

# Computer Operations

The Computer plugin provides a Star Trek LCARS-themed interface for voice transcription, AI analysis, chart generation, and web search.

## Server Management

- Start: `/computer` or `bash "${CLAUDE_PLUGIN_ROOT}/scripts/start.sh"`
- Stop: `/computer stop`
- Status: `/computer-status`
- Port: 3141
- URL: http://localhost:3141

## API Endpoints (push data to the UI)

All POST endpoints broadcast to connected WebSocket clients for real-time display.

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/health | Server health check |
| GET | /api/transcripts | List stored transcripts |
| POST | /api/transcripts | Store + display transcript |
| GET | /api/analyses | List stored analyses |
| POST | /api/analysis | Store + display analysis |
| POST | /api/charts | Render Chart.js visualization |
| POST | /api/search-results | Display search results |

## Agents

- **analyst**: Sentiment, topics, action items, summaries (Opus)
- **researcher**: Web search and information synthesis (Sonnet)
- **visualizer**: Chart.js config generation with LCARS colors (Sonnet)
- **transcription-processor**: Transcript cleanup and structuring (Sonnet)

## LCARS Chart Colors

Primary: #FF9900, #CC99CC, #9999FF, #FF9966, #CC6699, #99CCFF, #FFCC00
Background: #000000, Text: #FF9900, Grid: #333333

## Data Storage

JSON files in `${CLAUDE_PLUGIN_ROOT}/data/`:
- `transcripts/` — Voice and file transcripts
- `analyses/` — Analysis results
- `sessions/` — Conversation logs

## Pushing Data to UI

From any command or agent, push data to the running UI:
```bash
curl -X POST http://localhost:3141/api/analysis -H 'Content-Type: application/json' -d '{"summary":"...","topics":[...]}'
curl -X POST http://localhost:3141/api/charts -H 'Content-Type: application/json' -d '{"chartConfig":{...}}'
curl -X POST http://localhost:3141/api/search-results -H 'Content-Type: application/json' -d '{"results":[...]}'
```
