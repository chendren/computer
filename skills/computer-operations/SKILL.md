---
name: computer-operations
description: |
  Use this skill when the user mentions "Computer", "LCARS", "Enterprise computer", "start the computer", "computer analyze", "computer search", "computer transcribe", "captain's log", "monitor", "briefing", "compare", "summarize", "explain", "translate", or references the Star Trek computer interface. Provides operational knowledge for the Computer plugin system including server management, API endpoints, agent integration, data storage, cross-referencing prior results, and proactive suggestions.
version: 2.0.0
tools: Read, Bash
---

# Computer Operations

The Computer plugin provides a Star Trek LCARS-themed interface for voice transcription, AI analysis, chart generation, web search, monitoring, logging, comparison, summarization, translation, and explanation.

## Server Management

- Start: `/computer:computer` or `bash "${CLAUDE_PLUGIN_ROOT}/scripts/start.sh"`
- Stop: `/computer:computer stop`
- Status: `/computer:status`
- Port: 3141
- URL: http://localhost:3141

## API Endpoints (push data to the UI)

All POST endpoints broadcast to connected WebSocket clients for real-time display.

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/health | Server health check |
| GET/POST | /api/transcripts | Store + display transcripts |
| GET/POST | /api/analyses | Store + display analyses |
| POST | /api/charts | Render Chart.js visualization |
| POST | /api/search-results | Display search results |
| GET/POST | /api/logs | Captain's log entries |
| GET/POST | /api/monitors | Monitor status tracking |
| GET/POST | /api/comparisons | Side-by-side comparisons |
| POST | /api/tts/speak | Generate spoken response |
| POST | /api/claude/query | Stream Claude response (SSE) |
| POST | /api/transcribe/file | Upload audio for Whisper transcription |

## Commands

| Command | Purpose |
|---------|---------|
| `/computer:computer` | Launch/stop server |
| `/computer:analyze` | Sentiment, topics, entities, action items |
| `/computer:search` | Web search with synthesis |
| `/computer:transcribe` | Whisper audio transcription |
| `/computer:status` | System diagnostics |
| `/computer:compare` | Side-by-side comparison of files/text |
| `/computer:summarize` | Multi-level document summarization |
| `/computer:monitor` | Set up watches on URLs/files/processes |
| `/computer:log` | Captain's log entries |
| `/computer:brief` | Activity briefing and status report |

## Agents

| Agent | Model | Purpose |
|-------|-------|---------|
| analyst | Opus | Sentiment, topics, action items, summaries |
| researcher | Sonnet | Web search and information synthesis |
| visualizer | Sonnet | Chart.js config generation with LCARS colors |
| transcription-processor | Sonnet | Transcript cleanup and structuring |
| comparator | Opus | Side-by-side comparison with radar charts |
| summarizer | Opus | Multi-level summarization (executive → detailed) |
| monitor | Sonnet | Continuous monitoring and alerting |
| translator | Sonnet | Multi-language translation with cultural context |
| explainer | Opus | Layered explanations (ELI5 → deep dive) |

## LCARS Chart Colors

Primary: #FF9900, #CC99CC, #9999FF, #FF9966, #CC6699, #99CCFF, #FFCC00
Background: #000000, Text: #FF9900, Grid: #333333

## Data Storage

JSON files in `${CLAUDE_PLUGIN_ROOT}/data/`:
- `transcripts/` — Voice and file transcripts
- `analyses/` — Analysis results, summaries, explanations, translations
- `sessions/` — Conversation logs
- `logs/` — Captain's log entries
- `monitors/` — Monitor configurations and status
- `comparisons/` — Comparison results

## Cross-Referencing Prior Results

When the user references earlier work ("what did we find about X?", "in the last analysis...", "compare this to what we found before"), you should:

1. **Fetch stored data**: Query the relevant API endpoint to retrieve prior results
   ```bash
   curl -s http://localhost:3141/api/analyses | jq '.[0:5]'
   curl -s http://localhost:3141/api/logs
   curl -s http://localhost:3141/api/transcripts
   ```
2. **Search through results**: Look for matching content, topics, or entities
3. **Reference naturally**: "As noted in the analysis from [timestamp], the sentiment was..."
4. **Link findings**: Connect current work to prior results when relevant

## Proactive Suggestions

Based on context, suggest relevant follow-up actions:

- After an **analysis**: "Would you like me to compare this with a previous analysis?" or "Shall I search for more information on [top topic]?"
- After a **search**: "Would you like me to analyze these findings in more detail?"
- After a **transcription**: "Would you like me to summarize the key points?" or "Shall I extract action items?"
- After a **comparison**: "Would you like a deeper explanation of the key differences?"
- After a **monitor triggers**: "The monitor detected a change. Would you like me to analyze the difference?"

## Pushing Data to UI

From any command or agent, push data to the running UI by writing JSON to a temp file and using curl:
```bash
# Write JSON (avoids shell escaping issues)
# Then POST with file reference:
curl -X POST http://localhost:3141/api/analysis -H 'Content-Type: application/json' -d @/tmp/computer-result.json
curl -X POST http://localhost:3141/api/charts -H 'Content-Type: application/json' -d @/tmp/computer-chart.json
curl -X POST http://localhost:3141/api/search-results -H 'Content-Type: application/json' -d @/tmp/computer-search.json
curl -X POST http://localhost:3141/api/logs -H 'Content-Type: application/json' -d @/tmp/computer-log.json
curl -X POST http://localhost:3141/api/monitors -H 'Content-Type: application/json' -d @/tmp/computer-monitor.json
curl -X POST http://localhost:3141/api/comparisons -H 'Content-Type: application/json' -d @/tmp/computer-comparison.json
```

## TTS Acknowledgements

For short status messages, include `"speak": true` in status broadcasts to have the Computer speak:
```bash
curl -X POST http://localhost:3141/api/tts/speak -H 'Content-Type: application/json' -d '{"text":"Analysis complete."}'
```
Max 300 characters. Only use for brief acknowledgements, not full results.
