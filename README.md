# Computer — Star Trek Enterprise AI Agent

A Claude Code plugin that brings the USS Enterprise computer to life. Combines Claude's AI capabilities with a locally-served LCARS-themed web interface for voice interaction, text analysis, data visualization, web search, monitoring, knowledge management, and conversational AI — all running on your machine with local vector search.

![LCARS Interface](https://img.shields.io/badge/UI-LCARS%20Theme-FF9900?style=flat-square&labelColor=000000)
![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-CC99CC?style=flat-square&labelColor=000000)
![Node.js](https://img.shields.io/badge/Node.js-Express%20%2B%20WebSocket-9999FF?style=flat-square&labelColor=000000)
![LanceDB](https://img.shields.io/badge/Vector%20DB-LanceDB-55CC55?style=flat-square&labelColor=000000)

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
  - [Slash Commands](#slash-commands)
  - [Web UI Panels](#web-ui-panels)
  - [Voice Interaction](#voice-interaction)
  - [Smart Voice Routing](#smart-voice-routing)
- [API Reference](#api-reference)
  - [REST Endpoints](#rest-endpoints)
  - [Knowledge Base API](#knowledge-base-api)
  - [WebSocket Events](#websocket-events)
- [Server Components](#server-components)
  - [Routes](#routes)
  - [Services](#services)
- [UI Components](#ui-components)
  - [JavaScript Modules](#javascript-modules)
  - [CSS Design System](#css-design-system)
- [Plugin Components](#plugin-components)
  - [Commands](#commands)
  - [Agents](#agents)
  - [Skills](#skills)
  - [Hooks](#hooks)
- [Vector Knowledge Base](#vector-knowledge-base)
  - [Chunking Strategies](#chunking-strategies)
  - [Search Methods](#search-methods)
  - [Knowledge API Examples](#knowledge-api-examples)
- [Security](#security)
  - [Server-Side Redaction Middleware](#server-side-redaction-middleware)
  - [Agent System Prompt Hardening](#agent-system-prompt-hardening)
  - [Security Stats Endpoint](#security-stats-endpoint)
- [Data Storage](#data-storage)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [File Structure](#file-structure)

---

## Overview

Computer is a Claude Code plugin that functions as an AI assistant modeled after the Star Trek USS Enterprise computer. It runs a local Express + WebSocket server on port 3141, serving an LCARS-themed single-page application that provides real-time voice transcription, AI-powered text analysis, dynamic Chart.js visualizations, web search synthesis, monitoring, knowledge management with vector search, desktop notifications, and conversational AI interaction.

The CLI session acts as the orchestrator — slash commands and agents perform work and push results to the web UI via REST API calls, which are then broadcast to all connected browser clients via WebSocket in real time.

**Key design principles:**
- Fully local: Voice transcription via Whisper, text-to-speech via Coqui TTS, embeddings via Ollama — no external APIs for voice or search
- Vector-powered knowledge: LanceDB with nomic-embed-text (768-dim) for semantic search with 6 chunking strategies and 6 search methods
- Real-time: WebSocket pushes data to the browser instantly as commands complete
- Vanilla JS: No build step, no framework — ES modules served directly by Express
- Smart voice routing: Spoken commands auto-detect intent and route to the correct slash command
- Desktop notifications: macOS alerts for monitor triggers and analysis completion
- LCARS aesthetic: Authentic Star Trek computer interface with the signature orange/lavender/blue color palette

---

## Features

### Voice Input & Output
- **Real-time speech-to-text** — Browser records 3-second audio chunks via MediaRecorder, sends them over WebSocket as binary frames, server transcribes each chunk locally using OpenAI Whisper (`tiny` model for low latency)
- **File-based transcription** — Upload audio files (mp3, wav, m4a, ogg, flac, webm, mp4) for full transcription using Whisper (`base` model for accuracy)
- **Text-to-speech responses** — The Computer speaks short acknowledgements and clarifications using Coqui TTS (`vits` model, ~0.2s generation time). Responses over 200 characters are displayed only, not spoken
- **Smart voice routing** — When you stop the microphone, speech is analyzed for command intent (e.g., "Computer, analyze this text" auto-routes to `/computer:analyze`) and a green badge indicates the detected route
- **Voice-to-command pipeline** — Accumulated speech populates the command input field for submission

### AI Analysis
- **Sentiment analysis** — Overall tone classification with confidence score and percentage breakdown bar
- **Topic extraction** — 3-7 key themes with relevance scores, displayed as color-coded LCARS tags
- **Action items** — Extracted with priority levels (high/medium/low)
- **Entity recognition** — People, organizations, locations, dates, and technical terms
- **Summary generation** — Concise 2-3 sentence summaries
- **Collapsible raw input** — Original analyzed text shown in a collapsible panel above results

### Vector Knowledge Base
- **LanceDB vector storage** — Local vector database with nomic-embed-text embeddings (768 dimensions) via Ollama
- **6 chunking strategies** — Fixed-size, sentence, paragraph, sliding window, semantic (embedding similarity), recursive (hierarchical by headers/paragraphs/sentences)
- **6 search methods** — Vector similarity, BM25 keyword, hybrid (vector+keyword weighted), metadata filtering, MMR (diversity-promoting), multi-query with Reciprocal Rank Fusion
- **Searchable UI** — Method dropdown, metadata filters (source, confidence, tags), tabbed views (Entries/Results/Stats), relevance scores, expandable chunk previews
- **Auto-migration** — Existing JSON knowledge entries are automatically migrated to vector DB on startup

### Data Visualization
- **Chart.js v4 integration** — Dynamic charts rendered with LCARS-themed colors
- **Multiple chart types** — Doughnut, bar, line, radar, pie, polar area, scatter
- **Auto-generation** — Analysis commands automatically generate topic distribution charts

### Web Search
- **AI-powered search** — Web search with Claude-synthesized summaries and key findings
- **Structured results** — Title (clickable hyperlink), snippet, and source URL for each result

### Monitoring & Logging
- **Monitor panel** — Active monitor cards with status dots, check history, conditions display. Monitors track URLs, files, processes
- **Captain's Log** — Stardate-formatted log entries with categories and color-coded tags
- **Comparison panel** — Side-by-side comparisons with similarity bars, diff grids, impact ratings, and recommendations
- **Desktop notifications** — macOS native notifications for monitor alerts (Submarine sound) and analysis completion (Glass sound)

### Dashboard
- **Bridge console** — System stats overview (analyses, logs, monitors, knowledge counts), active monitor status with alert indicators, recent log entries, recent analyses, and real-time activity feed

### Conversational AI
- **Streaming responses** — Claude responses stream in real-time via Server-Sent Events
- **Command history** — Navigate previous commands with up/down arrow keys
- **Star Trek personality** — System prompt configures Claude as the USS Enterprise Computer
- **Short response TTS** — Brief responses are spoken aloud automatically

### Workflow & Export
- **Pipeline command** — Chain multiple operations in sequence (analyze → summarize → compare)
- **Export command** — Generate formatted reports (markdown, HTML, JSON) from stored data with time filtering
- **Briefing command** — Activity briefing and status report across all subsystems

### Real-Time Communication
- **WebSocket broadcasting** — All data pushed via REST API is instantly broadcast to connected browser clients
- **Auto-reconnection** — Browser reconnects automatically after 3 seconds if the WebSocket drops
- **Heartbeat** — Server pings clients every 30 seconds to maintain connections
- **Auto-panel switching** — UI automatically switches to the relevant panel when data arrives

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code CLI Session                    │
│                                                               │
│  /computer:analyze "text"    /computer:search "query"         │
│  /computer:know "remember"   /computer:monitor "url"          │
│  /computer:pipeline "ops"    /computer:export "markdown"      │
│          │                          │                         │
│          ▼                          ▼                         │
│   Write JSON to /tmp    ──►   curl POST to localhost:3141     │
└─────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Express + WebSocket Server (:3141)               │
│                                                               │
│  Security Middleware         WebSocket Server                   │
│  ├── Scans POST/PUT/PATCH   ├── Binary frames → Whisper STT   │
│  ├── 26 secret patterns     ├── broadcast() to all clients    │
│  ├── Sensitive field names   ├── Heartbeat every 30s           │
│  └── Redacts → [REDACTED]   └── Auto-cleanup disconnected     │
│                                                                 │
│  REST API                    Services                           │
│  ├── /api/knowledge/*        ├── security.js → Redaction       │
│  │   ├── POST / (ingest)    ├── vectordb.js → LanceDB         │
│  │   ├── POST /search       ├── embeddings.js → Ollama        │
│  │   ├── POST /bulk         ├── chunking.js → 6 strategies    │
│  │   ├── GET /stats         ├── search.js → 6 methods         │
│  │   └── DELETE /:id        ├── storage.js → JSON files       │
│  ├── /api/analyses          ├── transcription.js → Whisper    │
│  ├── /api/transcripts       ├── tts.js → Coqui TTS           │
│  ├── /api/logs              ├── notifications.js → macOS      │
│  ├── /api/monitors          └── websocket.js → Client mgmt   │
│  ├── /api/comparisons                                          │
│  ├── /api/charts                                               │
│  ├── /api/tts/speak                                            │
│  ├── /api/claude/query (SSE)                                   │
│  ├── /api/security/stats                                       │
│  └── /api/transcribe/file                                      │
└─────────────────────────────────────────────────────────────┘
                                      │
                              WebSocket broadcast
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────┐
│                    LCARS Web UI (Browser)                     │
│                                                               │
│  ┌──────────┐  ┌────────────────────────────────────────┐    │
│  │ Sidebar  │  │  Active Panel                           │    │
│  │          │  │                                          │    │
│  │[Dashbrd] │  │  Dashboard: Bridge console overview     │    │
│  │[Main]    │  │  Main: Chat with Claude via SSE         │    │
│  │[Trans]   │  │  Transcript: Live STT + file upload     │    │
│  │[Analy]   │  │  Analysis: Sentiment, topics, entities  │    │
│  │[Chart]   │  │  Charts: Chart.js visualizations        │    │
│  │[Search]  │  │  Search: Web search results             │    │
│  │[Log]     │  │  Log: Captain's log with stardates      │    │
│  │[Monitor] │  │  Monitor: Active monitors + status      │    │
│  │[Compare] │  │  Compare: Side-by-side diffs            │    │
│  │[Know]    │  │  Knowledge: Vector search + stats        │    │
│  │          │  │                                          │    │
│  │ Status   │  │                                          │    │
│  │ ● Server │  │                                          │    │
│  │ ● WS     │  │                                          │    │
│  │ ● Voice  │  │                                          │    │
│  └──────────┘  └────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Status Bar: Connection | Uptime | Activity            │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## Prerequisites

### Required

| Tool | Purpose | Install |
|------|---------|---------|
| **Node.js** (v18+) | Server runtime | `brew install node` |
| **Claude Code** | CLI tool for AI capabilities | [Install guide](https://docs.anthropic.com/en/docs/claude-code) |
| **Ollama** | Local embeddings for knowledge base | `brew install ollama` |
| **nomic-embed-text** | Embedding model (768-dim) | `ollama pull nomic-embed-text` |

### Optional (for full functionality)

| Tool | Purpose | Install |
|------|---------|---------|
| **OpenAI Whisper** | Local speech-to-text | `pip install openai-whisper` |
| **Coqui TTS** | Local text-to-speech | `pip install TTS` |
| **FFmpeg** | Audio format conversion | `brew install ffmpeg` |

Whisper is expected at `/opt/homebrew/bin/whisper` and TTS at `/opt/homebrew/bin/tts`. If your installations are elsewhere, update the paths in `server/services/transcription.js` and `server/services/tts.js`.

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/chendren/computer.git ~/.claude/plugins/computer
```

### 2. Install Node.js dependencies

```bash
cd ~/.claude/plugins/computer
npm install --omit=dev
```

### 3. Ensure Ollama is running with the embedding model

```bash
ollama serve &   # Start Ollama if not running
ollama pull nomic-embed-text   # Download embedding model (274 MB)
```

### 4. Register as a local Claude Code plugin

Create a local marketplace wrapper:

```bash
mkdir -p ~/.claude/plugins/computer-marketplace/.claude-plugin/plugins
```

Create `~/.claude/plugins/computer-marketplace/.claude-plugin/marketplace.json`:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "computer-local",
  "description": "Local Computer plugin marketplace",
  "owner": { "name": "Your Name" },
  "plugins": [
    {
      "name": "computer",
      "description": "Star Trek Enterprise-style AI computer with LCARS interface",
      "version": "1.0.0",
      "author": { "name": "Your Name" },
      "source": "../../../computer",
      "category": "productivity"
    }
  ]
}
```

Symlink the plugin source:

```bash
ln -s ~/.claude/plugins/computer ~/.claude/plugins/computer-marketplace/.claude-plugin/plugins/computer
```

Register the marketplace and install:

```bash
claude plugin marketplace add computer-local --source directory --path ~/.claude/plugins/computer-marketplace
claude plugin install computer@computer-local
```

### 5. Verify installation

Start a new Claude Code session. The SessionStart hook will auto-start the server. Alternatively, run:

```bash
# In Claude Code
/computer:computer
```

Then open [http://localhost:3141](http://localhost:3141) in your browser. The Dashboard panel loads by default showing system status.

### Alternative: Manual server start (without plugin system)

```bash
cd ~/.claude/plugins/computer
npm start
# Server runs at http://localhost:3141
```

---

## Usage

### Slash Commands

All commands are namespaced under `computer:` when invoked from Claude Code.

| Command | Purpose |
|---------|---------|
| `/computer:computer` | Launch/stop the LCARS server |
| `/computer:analyze <text-or-file>` | Sentiment, topics, entities, action items |
| `/computer:search <query>` | Web search with synthesis |
| `/computer:transcribe <audio-file>` | Whisper audio transcription |
| `/computer:status` | System diagnostics readout |
| `/computer:compare <items>` | Side-by-side comparison of files/text |
| `/computer:summarize <text>` | Multi-level document summarization |
| `/computer:monitor <target>` | Set up watches on URLs/files/processes |
| `/computer:log <entry>` | Captain's log entries |
| `/computer:brief` | Activity briefing and status report |
| `/computer:pipeline <operations>` | Chain multiple operations in sequence |
| `/computer:know <query-or-fact>` | Store, retrieve, or search knowledge base |
| `/computer:export [format] [timeframe]` | Generate formatted reports (markdown/html/json) |

#### Example: Analyze text

```
/computer:analyze "The quarterly results exceeded expectations with 15% revenue growth"
```

Performs comprehensive analysis including sentiment, topics, action items, entities, and summary. Generates a Chart.js visualization. Results push to the Analysis panel and trigger a desktop notification.

#### Example: Knowledge base

```
/computer:know remember The Enterprise uses a matter/antimatter warp drive
/computer:know what do we know about warp drive
/computer:know stats
```

Stores facts with auto-detected tags and chunking strategy, then enables semantic vector search across all stored knowledge.

#### Example: Pipeline

```
/computer:pipeline analyze meeting-notes.txt then summarize then compare with last week
```

Chains multiple operations, passing results from one to the next.

### Web UI Panels

The LCARS interface has 10 panels accessible via the sidebar navigation:

| Panel | Purpose |
|-------|---------|
| **Dashboard** | Bridge console — system stats, active monitors, recent logs, activity feed |
| **Main** | Chat input, streaming Claude responses, command history |
| **Transcript** | Mic toggle, file upload, timestamped transcript entries |
| **Analysis** | Collapsible raw input, sentiment bar, topic tags, entities, action items |
| **Charts** | Chart.js renders with LCARS colors, chart history |
| **Search** | Search input, result cards with clickable links |
| **Log** | Captain's log entries with stardates, categories, color-coded tags |
| **Monitor** | Active monitor cards with status dots, check history, conditions |
| **Compare** | Side-by-side comparison with similarity bars, diff grids, impact ratings |
| **Knowledge** | Vector search with method selection, metadata filters, tabbed views (Entries/Results/Stats) |

Panels auto-switch when relevant data arrives via WebSocket.

### Voice Interaction

#### Speaking to the Computer (STT)

1. Open the Transcript panel in the browser
2. Click **Start Listening** — the browser requests microphone access
3. Speak naturally — audio is recorded in 3-second chunks
4. Each chunk is sent as a binary WebSocket frame to the server
5. The server transcribes each chunk using Whisper (`tiny` model, ~1s on Apple Silicon)
6. Transcribed text appears in the transcript panel in real time
7. Click **Stop Listening** — accumulated text is analyzed for command intent and populates the command input

#### Computer Speaking Back (TTS)

- **Claude responses under 200 characters** are spoken aloud after displaying
- **Status events** flagged with `speak: true` are spoken (e.g., "Analysis complete")
- **Longer responses** are displayed only — no TTS for verbose output
- API enforces a **300-character maximum**
- Audio is queued and played sequentially to prevent overlapping speech

Model: `tts_models/en/ljspeech/vits` — fast English model with ~0.2s generation time.

### Smart Voice Routing

When you stop the microphone, the transcribed text is analyzed for command intent:

| Voice Pattern | Auto-routes to |
|--------------|----------------|
| "Computer, analyze [text]" | `/computer:analyze` |
| "Computer, search [query]" | `/computer:search` |
| "Computer, compare [items]" | `/computer:compare` |
| "Computer, summarize [text]" | `/computer:summarize` |
| "Computer, monitor [target]" | `/computer:monitor` |
| "Computer, translate [text]" | `/computer:translate` |
| "Computer, explain [topic]" | `/computer:explain` |
| "Captain's log [entry]" | `/computer:log` |
| "Computer, remember [fact]" | `/computer:know` |
| "Computer, status" | `/computer:status` |
| "Computer, briefing" | `/computer:brief` |

A green "Routed" badge appears in the UI when a command is detected.

---

## API Reference

### REST Endpoints

The server exposes the following REST API at `http://localhost:3141/api/`.

#### Health Check

```
GET /api/health
```

Response:
```json
{
  "status": "online",
  "system": "USS Enterprise Computer",
  "uptime": 1234.56,
  "timestamp": "2026-02-14T10:00:00.000Z",
  "vectordb": "online",
  "ollama": "online"
}
```

#### Data Endpoints (CRUD + WebSocket broadcast)

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | /api/transcripts | Store + display transcripts |
| GET /api/transcripts/:id | Get single transcript |
| GET/POST | /api/analyses | Store + display analyses (+ desktop notification) |
| POST | /api/charts | Render Chart.js visualization (broadcast only) |
| POST | /api/search-results | Display search results (broadcast only) |
| GET/POST | /api/sessions | Session management |
| GET/POST | /api/logs | Captain's log entries |
| GET/POST | /api/monitors | Monitor status tracking (+ alert notifications) |
| GET/POST | /api/comparisons | Side-by-side comparisons |

#### Text-to-Speech

```
POST /api/tts/speak              # Generate speech (max 300 chars)
GET  /api/tts/audio/:filename    # Serve generated WAV file
```

#### Claude Query (SSE streaming)

```
POST /api/claude/query
```

Body: `{ "prompt": "...", "systemPrompt": "..." }`
Response: Server-Sent Events stream.

#### File Transcription

```
POST /api/transcribe/file        # Multipart upload → Whisper
```

### Knowledge Base API

The knowledge base has its own dedicated route at `/api/knowledge/`.

#### Ingest a document

```
POST /api/knowledge
```

Body:
```json
{
  "text": "The content to store and chunk",
  "title": "Optional title",
  "source": "user",
  "confidence": "high",
  "tags": ["starfleet", "enterprise"],
  "chunk_strategy": "paragraph",
  "chunk_options": {}
}
```

Also supports legacy format: `{ "fact": "A short fact" }`.

Response:
```json
{
  "id": "uuid",
  "title": "Optional title",
  "chunk_count": 3,
  "chunk_strategy": "paragraph",
  "source": "user",
  "confidence": "high",
  "tags": ["starfleet", "enterprise"],
  "created_at": "2026-02-14T10:00:00.000Z"
}
```

#### Search knowledge

```
POST /api/knowledge/search
```

Body:
```json
{
  "query": "who commands the Enterprise",
  "method": "hybrid",
  "limit": 10,
  "metadata_filter": {
    "source": "user",
    "confidence": "high",
    "tags": ["starfleet"],
    "date_range": { "from": "2026-01-01", "to": "2026-12-31" }
  },
  "options": {
    "vector_weight": 0.7,
    "keyword_weight": 0.3,
    "lambda": 0.5
  }
}
```

Methods: `vector`, `keyword`, `hybrid`, `mmr`, `multi_query`

Response:
```json
{
  "results": [
    {
      "chunk_id": "uuid",
      "parent_id": "uuid",
      "text": "The Enterprise NCC-1701-D is a Galaxy-class starship...",
      "score": 0.87,
      "title": "Enterprise D Overview",
      "source": "user",
      "tags": ["starfleet"],
      "confidence": "high",
      "chunk_index": 0,
      "chunk_strategy": "paragraph",
      "created_at": "2026-02-14T10:00:00.000Z"
    }
  ],
  "method": "hybrid",
  "query": "who commands the Enterprise",
  "total_results": 4
}
```

#### Other Knowledge Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/knowledge | List entries (paginated: `?offset=0&limit=50`) |
| GET | /api/knowledge/stats | Collection statistics |
| GET | /api/knowledge/:id | Single entry with chunks |
| DELETE | /api/knowledge/:id | Remove entry and all chunks |
| POST | /api/knowledge/bulk | Bulk ingest multiple documents |

### WebSocket Events

Connect to `ws://localhost:3141`. All events use JSON format: `{ "type": "<event>", "data": {...} }`.

#### Server → Client Events

| Event | Trigger | Data Shape |
|-------|---------|------------|
| `status` | Connection, status updates | `{ message, connected?, speak? }` |
| `transcript` | New transcript saved | `{ id, timestamp, source, text, segments }` |
| `analysis` | New analysis saved | `{ id, summary, sentiment, topics, ... }` |
| `chart` | Chart data posted | Chart.js config object |
| `search` | Search results posted | `{ query, summary, results }` |
| `log` | Captain's log entry | `{ id, entry, category, stardate, tags }` |
| `monitor` | Monitor status update | `{ id, name, status, target, lastCheck }` |
| `comparison` | Comparison result | `{ id, subjects, diffs, verdict, similarity }` |
| `knowledge` | Knowledge entry ingested | `{ id, title, chunk_count, chunk_strategy }` |
| `stt_result` | Audio chunk transcribed | `{ text }` |
| `stt_error` | Transcription failed | `{ error }` |

#### Client → Server

| Type | Format | Purpose |
|------|--------|---------|
| Binary frame | Raw audio (webm/opus) | 3-second audio chunk for real-time STT |

---

## Server Components

### Middleware

| File | Purpose |
|------|---------|
| `server/middleware/security.js` | Secret redaction: 26 regex patterns (API keys, tokens, private keys, connection strings) + sensitive field name detection. Scans all POST/PUT/PATCH bodies, replaces secrets with `[REDACTED]`, logs warnings to console |

### Routes

| File | Purpose |
|------|---------|
| `server/routes/api.js` | CRUD for transcripts, analyses, sessions, logs, monitors, comparisons. Desktop notifications wired to monitor alerts and analysis completion |
| `server/routes/knowledge.js` | Dedicated knowledge base routes: ingest, search, bulk, stats, delete. All operations go through vector DB |
| `server/routes/claude.js` | Claude CLI proxy with SSE streaming via child process |
| `server/routes/transcribe.js` | Multer file upload → Whisper transcription |
| `server/routes/tts.js` | Text-to-speech endpoint + WAV file serving |

### Services

| File | Purpose |
|------|---------|
| `server/services/vectordb.js` | LanceDB connection management, two-table schema (entries + chunks), CRUD operations, JSON migration |
| `server/services/embeddings.js` | Ollama nomic-embed-text wrapper: `embed()`, `embedBatch()` with 4-concurrent pool, `isOllamaAvailable()`, `cosineSimilarity()` |
| `server/services/chunking.js` | 6 chunking strategies: fixed, sentence, paragraph, sliding window, semantic, recursive |
| `server/services/search.js` | 6 search methods: vector, keyword (BM25), hybrid, metadata filter, MMR, multi-query (RRF) |
| `server/services/storage.js` | JSON file persistence for transcripts, analyses, sessions, logs, monitors, comparisons |
| `server/services/transcription.js` | Whisper CLI wrapper: `transcribeChunk()` (tiny model) and `transcribeFile()` (base model) |
| `server/services/tts.js` | Coqui TTS with sequential queue, auto-cleanup |
| `server/services/claude-bridge.js` | Spawns `claude -p` child processes for streaming/non-streaming queries |
| `server/services/websocket.js` | WebSocket manager with binary audio handling and chunk queue |
| `server/services/notifications.js` | macOS desktop notifications via osascript: `notify()`, `notifyAlert()`, `notifyComplete()` |

---

## UI Components

### JavaScript Modules

All UI code is vanilla JavaScript using ES module imports. No build step required.

#### Core Application

| File | Purpose |
|------|---------|
| `ui/js/app.js` | Bootstrap, component wiring, WebSocket event routing, panel switching |

#### Panel Components

| File | Purpose |
|------|---------|
| `ui/js/components/dashboard-panel.js` | Bridge console: system stats, monitor status, recent logs, activity feed |
| `ui/js/components/command-input.js` | Chat interface with Claude streaming, command history, TTS, smart voice routing |
| `ui/js/components/transcript-panel.js` | Timestamped transcript display with live interim text |
| `ui/js/components/analysis-panel.js` | Sentiment bars, topic tags, entities, action items, collapsible input |
| `ui/js/components/chart-panel.js` | Chart.js renderer with history |
| `ui/js/components/search-panel.js` | Search results with clickable links |
| `ui/js/components/log-panel.js` | Captain's log with stardates, categories, color-coded tags |
| `ui/js/components/monitor-panel.js` | Monitor cards with status dots, check history, conditions |
| `ui/js/components/comparison-panel.js` | Side-by-side diffs with similarity bars, impact ratings |
| `ui/js/components/knowledge-panel.js` | Vector search UI: method dropdown, metadata filters, tabs (Entries/Results/Stats), scores |
| `ui/js/components/voice-input.js` | Mic toggle, file upload, voice-to-command pipeline |
| `ui/js/components/status-bar.js` | Connection/uptime/activity indicators |

#### Services

| File | Purpose |
|------|---------|
| `ui/js/services/api-client.js` | REST client: `get()`, `post()`, `delete()`, `uploadFile()`, `queryClaudeStream()` |
| `ui/js/services/websocket-client.js` | WebSocket with auto-reconnect, binary send, event dispatch |
| `ui/js/services/speech-service.js` | MediaRecorder → WebSocket → Whisper STT pipeline |
| `ui/js/services/audio-player.js` | Queue-based TTS audio playback |

#### Utilities

| File | Purpose |
|------|---------|
| `ui/js/utils/formatters.js` | Time, date, uptime formatting, HTML escaping |
| `ui/js/utils/lcars-helpers.js` | LCARS color cycling, DOM helpers |

### CSS Design System

#### LCARS Color Palette

| Variable | Hex | Usage |
|----------|-----|-------|
| `--lcars-orange` | `#FF9900` | Primary text, borders, buttons |
| `--lcars-peach` | `#FF9966` | Secondary elements |
| `--lcars-lavender` | `#CC99CC` | Headers, labels, section titles |
| `--lcars-blue` | `#9999FF` | Tertiary accents, search elements |
| `--lcars-light-blue` | `#99CCFF` | Data text, links, response text |
| `--lcars-rose` | `#CC6699` | Alerts, accent highlights |
| `--lcars-gold` | `#FFCC00` | Highlights, warnings, loading states |
| `--lcars-red` | `#CC4444` | Errors, negative sentiment, active mic |
| `--lcars-green` | `#55CC55` | Success, positive sentiment, online status |

**Layout files:**
- `ui/css/lcars.css` — Full design system: variables, grid layout, elbows, buttons, animations, status indicators (10 sidebar buttons with distinct colors)
- `ui/css/components.css` — Panel-specific styles for all 10 panels plus dashboard grid, knowledge search UI, monitor cards, log entries, comparison diffs, voice route badge

---

## Plugin Components

### Commands

Located in `commands/`. Each command is a Markdown file with YAML frontmatter specifying `description`, `argument-hint`, and `allowed-tools`.

| File | Invoke As | Purpose |
|------|-----------|---------|
| `computer.md` | `/computer:computer` | Start/stop the LCARS server |
| `analyze.md` | `/computer:analyze` | AI analysis of text or files |
| `search.md` | `/computer:search` | Web search with UI push |
| `transcribe.md` | `/computer:transcribe` | Whisper audio transcription |
| `status.md` | `/computer:status` | System diagnostics readout |
| `compare.md` | `/computer:compare` | Side-by-side comparison |
| `summarize.md` | `/computer:summarize` | Multi-level summarization |
| `monitor.md` | `/computer:monitor` | Set up watches |
| `log.md` | `/computer:log` | Captain's log entries |
| `brief.md` | `/computer:brief` | Activity briefing |
| `pipeline.md` | `/computer:pipeline` | Chain operations |
| `know.md` | `/computer:know` | Knowledge base (vector search) |
| `export.md` | `/computer:export` | Generate reports |

Commands push results to the web UI by writing JSON to a temp file and POSTing with `curl -d @file` to avoid shell escaping issues.

### Agents

Located in `agents/`. Each agent is a Markdown file defining a specialized AI role.

| File | Model | Purpose |
|------|-------|---------|
| `analyst.md` | Opus | Sentiment, topics, action items, summaries, entity extraction |
| `researcher.md` | Sonnet | Web research, source evaluation, information synthesis |
| `visualizer.md` | Sonnet | Chart.js v4 config generation with LCARS color theming |
| `transcription-processor.md` | Sonnet | Transcript cleanup, speaker detection, segmentation |
| `comparator.md` | Opus | Side-by-side comparison with radar charts |
| `summarizer.md` | Opus | Multi-level summarization (executive → detailed) |
| `monitor.md` | Sonnet | Continuous monitoring and alerting |
| `translator.md` | Sonnet | Multi-language translation with cultural context |
| `explainer.md` | Opus | Layered explanations (ELI5 → deep dive) |
| `pipeline.md` | Opus | Workflow orchestration chaining operations |
| `knowledge.md` | Opus | Persistent knowledge store, retrieve, synthesize |

### Skills

Located in `skills/computer-operations/`.

**`SKILL.md` (v3.0)** — Triggers when the conversation mentions "Computer", "LCARS", "knowledge", "remember", "pipeline", "export", or related terms. Provides operational knowledge about all 13 commands, 11 agents, 10 UI panels, API endpoints, vector search, chunking strategies, and LCARS design conventions.

**Reference documents:**
- `references/lcars-design.md` — Complete LCARS color palette, typography rules, and layout patterns
- `references/chart-patterns.md` — Standard Chart.js v4 configuration templates with LCARS theming

### Hooks

Located in `hooks/hooks.json`.

**SessionStart hook:** Runs `scripts/status.sh` when a new Claude Code session begins. Checks if the server is running, auto-installs node_modules if missing, creates data directories, and starts the server if it's not already running.

---

## Vector Knowledge Base

The knowledge base uses LanceDB for local vector storage with Ollama nomic-embed-text embeddings (768 dimensions).

### LanceDB Schema

**Table `knowledge_chunks`** (searched by vectors):
- `id`, `parent_id`, `text`, `vector[768]`, `chunk_index`, `chunk_count`
- `chunk_strategy`, `chunk_level`, `title`, `source`, `confidence`
- `tags` (JSON string), `content_type`, `created_at`, `updated_at`

**Table `knowledge_entries`** (metadata, no vectors):
- `id`, `title`, `original_text`, `source`, `confidence`
- `tags` (JSON string), `content_type`, `chunk_strategy`, `chunk_count`
- `created_at`, `updated_at`

### Chunking Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| `fixed` | N-character chunks with configurable overlap | Uniform chunk sizes |
| `sentence` | Split on sentence boundaries, group N sentences | Short facts, individual statements |
| `paragraph` | Split on double newlines, merge short paragraphs (default) | Medium documents with clear paragraphs |
| `sliding` | Fixed window with configurable step size | Overlapping context windows |
| `semantic` | Embed sentences, split when cosine similarity drops below threshold | Content where topic shifts matter |
| `recursive` | Split by headers → paragraphs → sentences, preserves hierarchy | Long documents with sections |

### Search Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| `vector` | Cosine similarity nearest neighbors | Pure semantic search |
| `keyword` | BM25-style TF-IDF scoring in memory | Exact term matching |
| `hybrid` | Combined vector + keyword with configurable weights (default) | Best general-purpose |
| `mmr` | Maximal Marginal Relevance, lambda-tunable diversity | Avoid redundant results |
| `multi_query` | Generate query variations, merge via Reciprocal Rank Fusion | Complex or ambiguous queries |

### Knowledge API Examples

```bash
# Store a fact (auto-selects sentence chunking for short text)
curl -X POST http://localhost:3141/api/knowledge \
  -H 'Content-Type: application/json' \
  -d '{"text":"The Enterprise uses dilithium crystals for warp drive","source":"user","confidence":"high","tags":["engineering"]}'

# Semantic search
curl -X POST http://localhost:3141/api/knowledge/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"how does warp drive work","method":"hybrid","limit":5}'

# Bulk ingest documents
curl -X POST http://localhost:3141/api/knowledge/bulk \
  -H 'Content-Type: application/json' \
  -d '{"documents":[{"text":"Doc 1...","title":"First"},{"text":"Doc 2...","title":"Second"}],"chunk_strategy":"paragraph"}'

# Get statistics
curl http://localhost:3141/api/knowledge/stats

# Delete an entry
curl -X DELETE http://localhost:3141/api/knowledge/{id}
```

---

## Security

A two-layer failsafe prevents any agent from leaking tokens, API keys, passwords, or credentials through the API or UI.

### Server-Side Redaction Middleware

Express middleware (`server/middleware/security.js`) intercepts **every POST/PUT/PATCH request** before it reaches any route handler. All data is scanned and redacted before storage or WebSocket broadcast.

**Pattern-based detection** — 26 regex patterns covering:

| Category | Patterns Detected |
|----------|-------------------|
| AI API keys | OpenAI (`sk-*`), Anthropic (`sk-ant-*`) |
| Cloud credentials | AWS access keys (`AKIA*`), AWS secret keys, Google API keys (`AIza*`) |
| Source control | GitHub PATs (`ghp_*`), OAuth tokens (`gho_*`), app tokens (`ghs_*`), fine-grained (`github_pat_*`) |
| Payment | Stripe keys (`sk_live_*`, `sk_test_*`) |
| Communication | Slack tokens (`xox*`), Discord tokens, SendGrid (`SG.*`), Twilio (`SK*`) |
| Infrastructure | Vercel, DigitalOcean, Supabase, npm tokens, Heroku keys |
| Authentication | JWT tokens (`eyJ*.*.*`), Bearer tokens, private key blocks (RSA, EC, DSA, SSH, PGP) |
| Databases | Connection strings with credentials (`postgres://user:pass@host`, `mongodb+srv://...`, `redis://...`) |
| Generic | Hex secrets in key/token/password context (64+ chars) |

**Sensitive field name detection** — Any JSON key matching these names has its value replaced with `[REDACTED]`:

`password`, `passwd`, `pwd`, `secret`, `token`, `api_key`, `apikey`, `access_key`, `secret_key`, `private_key`, `auth`, `authorization`, `credential`, `client_secret`, `signing_key`, `encryption_key`, `bearer`, `session_token`, `refresh_token`, `access_token`, `database_url`, `db_password`, `connection_string`, `smtp_password`, `ssh_key`, `master_key`, `service_key`

**Example:**

```bash
# Input with secrets
curl -X POST http://localhost:3141/api/logs \
  -H 'Content-Type: application/json' \
  -d '{"entry":"Key: sk-ant-abc123...","password":"hunter2"}'

# Stored/broadcast as:
{"entry":"Key: [REDACTED]","password":"[REDACTED]"}
```

All redactions are logged to the server console with type and path:
```
[SECURITY] Redacted 2 secret(s) from POST /api/logs: Anthropic API key at entry, sensitive_field at password
```

### Agent System Prompt Hardening

All 11 agent system prompts include a mandatory `SECURITY DIRECTIVE` section:

1. **Never output** tokens, API keys, passwords, secrets, private keys, connection strings, or credentials
2. **Redact** all secrets with `[REDACTED]` before including in any output
3. **Refuse** requests that ask to extract, list, store, or return credentials
4. Applies to **all output forms**: JSON results, summaries, entities, action items, chart labels, translations, pipeline steps, monitor scripts, knowledge entries

This provides defense-in-depth — even if an agent's output somehow bypassed the server middleware, the agent itself is instructed to never emit secrets.

### Security Stats Endpoint

```
GET /api/security/stats
```

Returns redaction audit data:

```json
{
  "total_redactions": 9,
  "recent_redactions": [
    {
      "timestamp": "2026-02-14T11:19:36.227Z",
      "method": "POST",
      "path": "/api/logs",
      "findings": [
        { "type": "Anthropic API key", "path": "entry", "preview": "sk-ant..." }
      ]
    }
  ],
  "patterns_loaded": 26,
  "sensitive_fields_pattern": "..."
}
```

---

## Data Storage

```
data/
├── vectordb/            # LanceDB vector database (knowledge embeddings + chunks)
│   ├── knowledge_chunks/
│   └── knowledge_entries/
├── transcripts/         # One JSON file per transcript
├── analyses/            # One JSON file per analysis
├── sessions/            # One JSON file per session
├── logs/                # One JSON file per captain's log entry
├── monitors/            # One JSON file per monitor config
├── comparisons/         # One JSON file per comparison result
├── knowledge/           # Legacy JSON (auto-migrated to vectordb on startup)
├── server.pid           # PID of running server process
└── server.log           # Server stdout/stderr log
```

JSON-stored items have auto-generated `id` (UUID v4), `timestamp` (ISO-8601), and `type` fields.

Temporary files during processing:
- `/tmp/computer-chunk-{id}.webm` — Audio chunks during STT (auto-deleted)
- `/tmp/computer-tts/{id}.wav` — TTS audio files (auto-deleted after 5 min)
- `/tmp/computer-*-result.json` — Command output JSON before POST

---

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `COMPUTER_PORT` | `3141` | Server port |

### Hardcoded Paths

| Constant | File | Default |
|----------|------|---------|
| `WHISPER_PATH` | `server/services/transcription.js` | `/opt/homebrew/bin/whisper` |
| `TTS_PATH` | `server/services/tts.js` | `/opt/homebrew/bin/tts` |
| `TTS_MODEL` | `server/services/tts.js` | `tts_models/en/ljspeech/vits` |
| `OLLAMA_URL` | `server/services/embeddings.js` | `http://localhost:11434` |
| `EMBEDDING_MODEL` | `server/services/embeddings.js` | `nomic-embed-text` |

### Whisper Models

| Context | Model | Rationale |
|---------|-------|-----------|
| Real-time STT (audio chunks) | `tiny` | Speed priority — ~1s for a 3s chunk on Apple Silicon |
| File upload transcription | `base` | Accuracy priority — full file, one-time processing |

---

## Troubleshooting

### Server won't start

```bash
lsof -i :3141                    # Check if port is in use
cat data/server.log              # Check server log
lsof -i :3141 -t | xargs kill -9  # Kill and restart
npm start
```

### Ollama not available

The knowledge base requires Ollama running with `nomic-embed-text`:

```bash
ollama serve          # Start Ollama
ollama pull nomic-embed-text  # Ensure model is downloaded
curl http://localhost:11434/api/tags  # Verify it's running
```

Check status via: `curl http://localhost:3141/api/health` — the `ollama` field should be `"online"`.

### Plugin commands not recognized

Commands must use the `computer:` prefix: `/computer:analyze` (not `/computer-analyze`).

Verify the plugin is installed:
```bash
cat ~/.claude/settings.json | grep computer
```

### Knowledge search returns no results

1. Check Ollama is running: `curl http://localhost:11434/api/tags`
2. Check knowledge stats: `curl http://localhost:3141/api/knowledge/stats`
3. Ingest some data first: `curl -X POST http://localhost:3141/api/knowledge -H 'Content-Type: application/json' -d '{"text":"Test fact"}'`

### Cache sync issues

After editing source files, sync to cache:

```bash
rsync -av --exclude node_modules --exclude data \
  ~/.claude/plugins/computer/ \
  ~/.claude/plugins/cache/computer-local/computer/1.0.0/
```

Then restart the server.

---

## File Structure

```
~/.claude/plugins/computer/
├── .claude-plugin/
│   └── plugin.json                    # Plugin metadata
├── package.json                       # Dependencies: express, ws, @lancedb/lancedb, etc.
├── README.md
│
├── commands/                          # 13 slash commands
│   ├── computer.md                    # Start/stop server
│   ├── analyze.md                     # AI text analysis
│   ├── search.md                      # Web search
│   ├── transcribe.md                  # Whisper transcription
│   ├── status.md                      # System diagnostics
│   ├── compare.md                     # Side-by-side comparison
│   ├── summarize.md                   # Multi-level summarization
│   ├── monitor.md                     # Set up watches
│   ├── log.md                         # Captain's log
│   ├── brief.md                       # Activity briefing
│   ├── pipeline.md                    # Chain operations
│   ├── know.md                        # Knowledge base (vector search)
│   └── export.md                      # Generate reports
│
├── agents/                            # 11 specialized AI agents
│   ├── analyst.md                     # Opus — Sentiment, topics, entities
│   ├── researcher.md                  # Sonnet — Web research synthesis
│   ├── visualizer.md                  # Sonnet — Chart.js generation
│   ├── transcription-processor.md     # Sonnet — Transcript cleanup
│   ├── comparator.md                  # Opus — Side-by-side comparison
│   ├── summarizer.md                  # Opus — Multi-level summarization
│   ├── monitor.md                     # Sonnet — Continuous monitoring
│   ├── translator.md                  # Sonnet — Multi-language translation
│   ├── explainer.md                   # Opus — Layered explanations
│   ├── pipeline.md                    # Opus — Workflow orchestration
│   └── knowledge.md                   # Opus — Knowledge management
│
├── skills/
│   └── computer-operations/
│       ├── SKILL.md                   # v3.0 — All commands, agents, panels, vector KB
│       └── references/
│           ├── lcars-design.md        # LCARS design guide
│           └── chart-patterns.md      # Chart.js templates
│
├── hooks/
│   └── hooks.json                     # SessionStart auto-start
│
├── scripts/
│   ├── start.sh                       # Server launch
│   └── status.sh                      # Health check + auto-start
│
├── server/
│   ├── index.js                       # Express + WebSocket + LanceDB init
│   ├── middleware/
│   │   └── security.js                # Secret redaction (26 patterns + field names)
│   ├── routes/
│   │   ├── api.js                     # CRUD + notifications for 6 data types
│   │   ├── knowledge.js               # Vector KB: ingest, search, bulk, stats, delete
│   │   ├── claude.js                  # Claude CLI proxy with SSE
│   │   ├── transcribe.js             # Multer upload → Whisper
│   │   └── tts.js                     # TTS endpoint + WAV serving
│   ├── services/
│   │   ├── vectordb.js                # LanceDB: 2 tables, CRUD, migration
│   │   ├── embeddings.js              # Ollama nomic-embed-text wrapper
│   │   ├── chunking.js               # 6 chunking strategies
│   │   ├── search.js                  # 6 search methods (vector, BM25, hybrid, MMR, RRF)
│   │   ├── storage.js                 # JSON file persistence
│   │   ├── claude-bridge.js           # claude -p child processes
│   │   ├── transcription.js           # Whisper CLI (chunk + file modes)
│   │   ├── tts.js                     # Coqui TTS sequential queue
│   │   ├── websocket.js              # WS manager + audio processing
│   │   └── notifications.js           # macOS desktop notifications
│   └── utils/
│       └── helpers.js                 # UUID, timestamp, duration
│
├── ui/
│   ├── index.html                     # SPA with 10 LCARS panels
│   ├── css/
│   │   ├── lcars.css                  # LCARS design system
│   │   └── components.css             # All panel + component styles
│   └── js/
│       ├── app.js                     # Bootstrap + WS event routing
│       ├── components/
│       │   ├── dashboard-panel.js     # Bridge console overview
│       │   ├── command-input.js       # Chat + smart voice routing
│       │   ├── transcript-panel.js    # Live STT display
│       │   ├── analysis-panel.js      # Analysis results
│       │   ├── chart-panel.js         # Chart.js renderer
│       │   ├── search-panel.js        # Search results
│       │   ├── log-panel.js           # Captain's log
│       │   ├── monitor-panel.js       # Monitor cards
│       │   ├── comparison-panel.js    # Side-by-side diffs
│       │   ├── knowledge-panel.js     # Vector search UI + stats
│       │   ├── voice-input.js         # Mic + upload controls
│       │   └── status-bar.js          # Status indicators
│       ├── services/
│       │   ├── api-client.js          # REST + SSE client
│       │   ├── audio-player.js        # TTS playback queue
│       │   ├── speech-service.js      # MediaRecorder → WS → Whisper
│       │   └── websocket-client.js    # WS with auto-reconnect
│       └── utils/
│           ├── formatters.js          # Time, date, HTML escaping
│           └── lcars-helpers.js       # LCARS colors, DOM helpers
│
└── data/                              # Created at runtime (gitignored)
    ├── vectordb/                      # LanceDB vector database
    ├── transcripts/
    ├── analyses/
    ├── sessions/
    ├── logs/
    ├── monitors/
    ├── comparisons/
    ├── server.pid
    └── server.log
```

---

## License

MIT
