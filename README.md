# Computer — Star Trek Enterprise AI Agent

A Claude Code plugin that brings the USS Enterprise computer to life. Combines Claude's AI capabilities with a locally-served LCARS-themed web interface for voice interaction, text analysis, data visualization, web search, and conversational AI — all running on your machine.

![LCARS Interface](https://img.shields.io/badge/UI-LCARS%20Theme-FF9900?style=flat-square&labelColor=000000)
![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-CC99CC?style=flat-square&labelColor=000000)
![Node.js](https://img.shields.io/badge/Node.js-Express%20%2B%20WebSocket-9999FF?style=flat-square&labelColor=000000)

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
- [API Reference](#api-reference)
  - [REST Endpoints](#rest-endpoints)
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
- [Data Storage](#data-storage)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [File Structure](#file-structure)

---

## Overview

Computer is a Claude Code plugin that functions as an AI assistant modeled after the Star Trek USS Enterprise computer. It runs a local Express + WebSocket server on port 3141, serving an LCARS-themed single-page application that provides real-time voice transcription, AI-powered text analysis, dynamic Chart.js visualizations, web search synthesis, and conversational AI interaction.

The CLI session acts as the orchestrator — slash commands and agents perform work and push results to the web UI via REST API calls, which are then broadcast to all connected browser clients via WebSocket in real time.

**Key design principles:**
- Fully local: Voice transcription via Whisper, text-to-speech via Coqui TTS — no external speech APIs
- Real-time: WebSocket pushes data to the browser instantly as commands complete
- Vanilla JS: No build step, no framework — ES modules served directly by Express
- JSON file storage: Simple, zero-dependency, human-inspectable persistence
- LCARS aesthetic: Authentic Star Trek computer interface with the signature orange/lavender/blue color palette

---

## Features

### Voice Input & Output
- **Real-time speech-to-text** — Browser records 3-second audio chunks via MediaRecorder, sends them over WebSocket as binary frames, and the server transcribes each chunk locally using OpenAI Whisper (`tiny` model for low latency)
- **File-based transcription** — Upload audio files (mp3, wav, m4a, ogg, flac, webm, mp4) for full transcription using Whisper (`base` model for accuracy)
- **Text-to-speech responses** — The Computer speaks short acknowledgements and clarifications using Coqui TTS (`vits` model, ~0.2s generation time). Responses over 200 characters are displayed only, not spoken
- **Voice-to-command pipeline** — When you stop the microphone, accumulated speech automatically populates the command input field for submission

### AI Analysis
- **Sentiment analysis** — Overall tone classification (positive/negative/neutral/mixed) with confidence score and percentage breakdown displayed as a labeled color bar
- **Topic extraction** — 3-7 key themes with relevance scores (0-1), displayed as color-coded tags using the LCARS palette
- **Action items** — Actionable items extracted with priority levels (high/medium/low)
- **Entity recognition** — People, organizations, locations, dates, and technical terms
- **Summary generation** — Concise 2-3 sentence summaries
- **Raw input display** — Original analyzed text shown in a collapsible panel above results

### Data Visualization
- **Chart.js v4 integration** — Dynamic charts rendered with LCARS-themed colors and styling
- **Multiple chart types** — Doughnut, bar, line, radar, pie, polar area, and scatter
- **Auto-generation** — Analysis commands automatically generate topic distribution charts
- **Chart history** — Multiple charts stack in the visualization panel

### Web Search
- **AI-powered search** — Web search with Claude-synthesized summaries and key findings
- **Structured results** — Title (clickable hyperlink), snippet, and source URL for each result
- **Real-time display** — Results pushed to the UI panel instantly via WebSocket

### Conversational AI
- **Streaming responses** — Claude responses stream in real-time via Server-Sent Events
- **Command history** — Navigate previous commands with up/down arrow keys
- **Star Trek personality** — System prompt configures Claude as the USS Enterprise Computer
- **Short response TTS** — Brief responses are spoken aloud automatically

### Real-Time Communication
- **WebSocket broadcasting** — All data pushed via REST API is instantly broadcast to connected browser clients
- **Auto-reconnection** — Browser reconnects automatically after 3 seconds if the WebSocket drops
- **Heartbeat** — Server pings clients every 30 seconds to maintain connections
- **Auto-panel switching** — UI automatically switches to the relevant panel when data arrives (search results switch to Search panel, analysis to Analysis panel, etc.)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code CLI Session                    │
│                                                               │
│  /computer:analyze "text"    /computer:search "query"         │
│  /computer:transcribe file   /computer:status                 │
│          │                          │                         │
│          ▼                          ▼                         │
│   Write JSON to /tmp    ──►   curl POST to localhost:3141     │
└─────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Express + WebSocket Server (:3141)               │
│                                                               │
│  REST API                    WebSocket Server                 │
│  ├── POST /api/analysis      ├── Binary frames → Whisper STT │
│  ├── POST /api/transcripts   ├── broadcast() to all clients  │
│  ├── POST /api/search-results├── Heartbeat every 30s         │
│  ├── POST /api/charts        └── Auto-cleanup disconnected   │
│  ├── POST /api/tts/speak                                     │
│  ├── POST /api/claude/query (SSE streaming)                  │
│  └── POST /api/transcribe/file (multipart upload)            │
│                                                               │
│  Services                                                     │
│  ├── storage.js      → JSON file persistence                 │
│  ├── transcription.js → Whisper CLI wrapper                  │
│  ├── tts.js          → Coqui TTS with sequential queue       │
│  ├── claude-bridge.js → claude -p child process              │
│  └── websocket.js    → Client mgmt + audio chunk processing  │
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
│  │ [Main]   │  │  Main: Chat with Claude via SSE         │    │
│  │ [Trans]  │  │  Transcript: Live STT + file upload     │    │
│  │ [Analy]  │  │  Analysis: Sentiment, topics, entities  │    │
│  │ [Chart]  │  │  Charts: Chart.js visualizations        │    │
│  │ [Search] │  │  Search: Web search results             │    │
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

### 3. Register as a local Claude Code plugin

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

### 4. Verify installation

Start a new Claude Code session. The SessionStart hook will auto-start the server. Alternatively, run:

```bash
# In Claude Code
/computer:computer
```

Then open [http://localhost:3141](http://localhost:3141) in your browser.

### Alternative: Manual server start (without plugin system)

If you just want to run the server standalone:

```bash
cd ~/.claude/plugins/computer
npm start
# Server runs at http://localhost:3141
```

---

## Usage

### Slash Commands

All commands are namespaced under `computer:` when invoked from Claude Code.

#### `/computer:computer` — Launch or stop the server

```
/computer:computer          # Start server, open browser
/computer:computer stop     # Stop server
```

Starts the Express + WebSocket server on port 3141 in the background, installs dependencies if needed, and opens the LCARS UI in your default browser.

#### `/computer:analyze <text-or-file-path>` — AI analysis

```
/computer:analyze "The quarterly results exceeded expectations with 15% revenue growth"
/computer:analyze ~/documents/meeting-notes.txt
```

Performs comprehensive analysis including sentiment, topics, action items, entities, and summary. Generates a Chart.js visualization of topic distribution. Results are pushed to the Analysis panel in the web UI and displayed in the terminal.

**Output includes:**
- Sentiment classification with confidence and breakdown percentages
- 3-7 key topics with relevance scores
- Action items with priority levels
- Named entity extraction
- Concise summary
- Chart.js doughnut chart of topic distribution

#### `/computer:search <query>` — Web search with synthesis

```
/computer:search "latest developments in quantum computing"
/computer:search "Express.js WebSocket best practices"
```

Performs a web search, synthesizes findings into a summary, and pushes structured results (title, URL, snippet) to the Search panel. All URLs are rendered as clickable hyperlinks in the UI.

#### `/computer:transcribe <audio-file>` — Audio transcription

```
/computer:transcribe ~/recordings/meeting.mp3
/computer:transcribe ~/voice-memo.m4a
```

Transcribes audio files using OpenAI Whisper (`base` model) with timestamped segments. Results are pushed to the Transcript panel. Supports mp3, wav, m4a, ogg, flac, webm, and mp4 formats.

#### `/computer:status` — System diagnostics

```
/computer:status
```

Displays a Star Trek-style systems readout showing server status, data counts (transcripts, analyses, sessions), storage usage, tool availability (Whisper, FFmpeg, Node.js), and health check results.

### Web UI Panels

The LCARS interface has five panels accessible via the sidebar navigation:

| Panel | Purpose | Content |
|-------|---------|---------|
| **Main** | Conversational AI | Chat input, streaming Claude responses, command history |
| **Transcript** | Voice & audio | Mic toggle, file upload, timestamped transcript entries |
| **Analysis** | Text analysis | Collapsible raw input, sentiment bar, topic tags, entities, action items |
| **Charts** | Visualizations | Chart.js renders with LCARS colors, chart history |
| **Search** | Web search | Search input, result cards with clickable links |

Panels auto-switch when relevant data arrives via WebSocket: running `/computer:analyze` switches to the Analysis panel, `/computer:search` switches to Search, etc.

### Voice Interaction

#### Speaking to the Computer (STT)

1. Open the Transcript panel in the browser
2. Click **Start Listening** — the browser requests microphone access
3. Speak naturally — audio is recorded in 3-second chunks
4. Each chunk is sent as a binary WebSocket frame to the server
5. The server transcribes each chunk using Whisper (`tiny` model, ~1s processing on Apple Silicon)
6. Transcribed text appears in the transcript panel in real time
7. Click **Stop Listening** — accumulated text populates the command input on the Main panel
8. Press Enter to send the transcribed text to Claude

#### Computer Speaking Back (TTS)

The Computer automatically speaks short responses using Coqui TTS:

- **Claude responses under 200 characters** are spoken aloud after displaying
- **Status events** flagged with `speak: true` are spoken (e.g., "Analysis complete")
- **Longer responses** are displayed only — no TTS for verbose output
- The TTS endpoint enforces a **300-character maximum** at the API level
- Audio is queued and played sequentially to prevent overlapping speech

The TTS model used is `tts_models/en/ljspeech/vits` — a fast English model with ~0.2s generation time.

#### Uploading Audio Files

1. Open the Transcript panel
2. Click **Upload Audio** and select a file
3. The file is uploaded to the server via multipart POST
4. Whisper transcribes the full file using the `base` model (more accurate than `tiny`)
5. Results appear in the Transcript panel with timestamps

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
  "timestamp": "2026-02-14T10:00:00.000Z"
}
```

#### Transcripts

```
GET  /api/transcripts        # List all (newest first)
GET  /api/transcripts/:id    # Get by ID
POST /api/transcripts        # Create new (broadcasts via WebSocket)
```

POST body:
```json
{
  "source": "whisper",
  "filename": "meeting.mp3",
  "text": "Full transcribed text...",
  "segments": [
    { "id": 0, "start": 0.0, "end": 5.2, "text": "First segment..." }
  ],
  "language": "en"
}
```

Response: Stored object with auto-generated `id`, `timestamp`, and `type: "transcript"`.

#### Analyses

```
GET  /api/analyses     # List all (newest first)
POST /api/analysis     # Create new (broadcasts via WebSocket)
```

POST body:
```json
{
  "input": "The original text that was analyzed...",
  "summary": "Concise 2-3 sentence summary.",
  "sentiment": {
    "overall": "positive",
    "confidence": 0.85,
    "breakdown": { "positive": 0.6, "negative": 0.1, "neutral": 0.3 }
  },
  "topics": [
    { "name": "Revenue Growth", "relevance": 0.9 }
  ],
  "actionItems": [
    { "text": "Review Q2 projections", "priority": "high" }
  ],
  "entities": {
    "people": ["John Smith"],
    "organizations": ["Acme Corp"],
    "terms": ["quarterly results"]
  },
  "chartSpec": { "type": "doughnut", "data": {}, "options": {} }
}
```

#### Charts (broadcast only, no storage)

```
POST /api/charts
```

POST body: Any valid Chart.js v4 configuration object. Broadcast to all connected clients as a `chart` WebSocket event.

#### Search Results (broadcast only, no storage)

```
POST /api/search-results
```

POST body:
```json
{
  "query": "quantum computing",
  "summary": "Synthesis of findings...",
  "results": [
    { "title": "Result Title", "url": "https://...", "snippet": "Excerpt..." }
  ],
  "timestamp": "2026-02-14T10:00:00.000Z"
}
```

#### Text-to-Speech

```
POST /api/tts/speak              # Generate speech
GET  /api/tts/audio/:filename    # Serve generated WAV file
```

POST `/api/tts/speak` body:
```json
{ "text": "Acknowledged." }
```

Response:
```json
{ "audioUrl": "/api/tts/audio/uuid-here.wav" }
```

Constraints: Text is required, maximum 300 characters. Generated WAV files are auto-deleted after 5 minutes.

#### Claude Query (SSE streaming)

```
POST /api/claude/query
```

POST body:
```json
{
  "prompt": "What is the current stardate?",
  "systemPrompt": "You are the USS Enterprise Computer."
}
```

Response: Server-Sent Events stream:
```
data: {"text":"The current"}
data: {"text":" stardate is"}
data: {"text":" 2026.045."}
data: {"done":true,"code":0}
```

#### File Transcription

```
POST /api/transcribe/file
Content-Type: multipart/form-data
```

Form field: `audio` (file). Accepts any audio format supported by Whisper. Returns transcript JSON and broadcasts to WebSocket.

#### Sessions

```
GET  /api/sessions     # List all
POST /api/sessions     # Create new
```

### WebSocket Events

Connect to `ws://localhost:3141`. All events use JSON format: `{ "type": "<event>", "data": {...} }`.

#### Server → Client Events

| Event | Trigger | Data Shape |
|-------|---------|------------|
| `status` | Connection, status updates | `{ message, connected?, speak? }` |
| `transcript` | New transcript saved | `{ id, timestamp, source, text, segments }` |
| `analysis` | New analysis saved | `{ id, summary, sentiment, topics, actionItems, entities, chartSpec }` |
| `chart` | Chart data posted | Chart.js config object |
| `search` | Search results posted | `{ query, summary, results }` |
| `stt_result` | Audio chunk transcribed | `{ text }` |
| `stt_error` | Transcription failed | `{ error }` |

#### Client → Server

| Type | Format | Purpose |
|------|--------|---------|
| Binary frame | Raw audio (webm/opus) | 3-second audio chunk for real-time STT |

Text-based client-to-server messages are reserved for future use.

---

## Server Components

### Routes

#### `server/routes/api.js`

CRUD operations for transcripts, analyses, and sessions. POST endpoints save data to JSON file storage and broadcast to all WebSocket clients. Chart and search-result POST endpoints are broadcast-only (no persistent storage).

#### `server/routes/claude.js`

Claude CLI proxy. Spawns `claude -p "<prompt>" --output-format text` as a child process and streams stdout/stderr back to the client as Server-Sent Events. Sets `CLAUDECODE=""` environment variable to avoid nested session formatting issues.

**Exported functions from `server/services/claude-bridge.js`:**
- `queryClaude(prompt, systemPrompt)` — Non-streaming, returns complete response string
- `queryClaudeStreaming(prompt, systemPrompt, onChunk, onDone)` — Streaming with callbacks, returns child process handle

#### `server/routes/transcribe.js`

File upload endpoint using multer middleware. Accepts multipart audio uploads, runs Whisper transcription, saves results, and broadcasts to WebSocket clients. Sends status updates during processing.

#### `server/routes/tts.js`

Text-to-speech endpoint. POST accepts `{ text }` (max 300 chars), generates WAV via Coqui TTS, returns audio URL. Also serves generated WAV files as static assets from `/tmp/computer-tts/`.

### Services

#### `server/services/storage.js`

JSON file-based persistence. Each item type (transcripts, analyses, sessions) stores individual JSON files as `data/{type}/{uuid}.json`. Auto-generates UUID and ISO-8601 timestamp on save. Exports `transcripts`, `analyses`, and `sessions` objects, each with `list()`, `get(id)`, and `save(data)` methods.

**Initialization:** Call `initStorage(pluginRoot)` at startup to create data directory structure.

#### `server/services/transcription.js`

Whisper CLI wrapper with two modes:

- `transcribeChunk(audioBuffer, format)` — For real-time STT. Writes buffer to temp file, runs Whisper with `--model tiny --language en` for speed (~1s on Apple Silicon). Returns trimmed text string. Cleans up temp files.
- `transcribeFile(filePath)` — For file uploads. Runs Whisper with `--model base` for accuracy. Returns full Whisper JSON output with segments, timestamps, and language detection.

Whisper path: `/opt/homebrew/bin/whisper` (configurable via `WHISPER_PATH` constant).

#### `server/services/tts.js`

Coqui TTS wrapper with sequential processing queue. Only one TTS process runs at a time since the model is CPU-intensive. Generates WAV files to `/tmp/computer-tts/` with UUID filenames. Auto-cleans files older than 5 minutes.

- `generateSpeech(text)` — Queues and generates speech. Returns `{ id, path, filename }`.
- `cleanupTTSFiles(maxAgeMs)` — Removes old WAV files. Runs automatically every 5 minutes.

TTS model: `tts_models/en/ljspeech/vits` (~0.2s generation, English only).

#### `server/services/websocket.js`

WebSocket connection manager with audio chunk processing:

- `initWebSocket(wss)` — Sets up connection handling, binary message processing, and heartbeat
- `broadcast(type, data)` — Sends JSON message to all connected clients

**Binary message handling:** When a client sends a binary WebSocket frame, it is treated as an audio chunk. The server queues it for Whisper transcription (max 1 concurrent process, queue depth 3) and sends back an `stt_result` event to the originating client only.

#### `server/utils/helpers.js`

Utility functions:
- `generateId()` — UUID v4 via the `uuid` package
- `timestamp()` — Current ISO-8601 string
- `formatDuration(seconds)` — Converts to `HH:MM:SS` format

---

## UI Components

### JavaScript Modules

All UI code is vanilla JavaScript using ES module imports. No build step required.

#### `ui/js/app.js` — Application Bootstrap

The `ComputerApp` class initializes all components in the correct order and wires up WebSocket event handlers. Component initialization order matters because `VoiceInput` depends on `CommandInput` (for populating the input field after speech stops).

**Initialization order:**
1. WebSocketClient, ApiClient, AudioPlayer
2. StatusBar, TranscriptPanel, ChartPanel, AnalysisPanel, SearchPanel
3. CommandInput (with AudioPlayer reference)
4. VoiceInput (with WebSocket client and CommandInput reference)

**WebSocket event routing:**

| Event | Action |
|-------|--------|
| `transcript` | Display in TranscriptPanel, switch to Transcript panel |
| `analysis` | Display in AnalysisPanel, switch to Analysis panel, render chart if present |
| `chart` | Render in ChartPanel, switch to Charts panel |
| `search` | Display in SearchPanel, switch to Search panel |
| `status` | Update StatusBar, optionally speak if `data.speak === true` and message < 100 chars |

#### `ui/js/components/command-input.js` — Conversational Interface

Chat-style interface for interacting with Claude. Sends prompts via SSE streaming to `/api/claude/query` with the system prompt: *"You are the USS Enterprise Computer. Respond concisely and helpfully."*

- **Command history** — Up/Down arrows navigate previous commands
- **TTS integration** — Short responses (< 200 chars) are automatically spoken via the AudioPlayer
- `setInputText(text)` — Public method used by VoiceInput to populate the field with transcribed speech

#### `ui/js/components/voice-input.js` — Voice Controls

Manages the microphone toggle button and audio file upload. Creates a `SpeechService` instance with the WebSocket client for sending audio chunks.

When the user stops listening, accumulated transcribed text is passed to `CommandInput.setInputText()` so it can be submitted as a command.

#### `ui/js/components/transcript-panel.js` — Transcript Display

Displays timestamped transcript entries with source labels. Supports both stored entries (from API) and live interim text (from real-time STT). Live text appears at 50% opacity until finalized.

#### `ui/js/components/analysis-panel.js` — Analysis Results

Renders analysis cards with:
- Timestamp header
- Collapsible raw input (`<details>` element, open by default)
- Summary paragraph
- Sentiment heading with confidence percentage and labeled breakdown bar (green/gray/red)
- Topic tags with LCARS palette colors and relevance percentages
- Action items list with priority prefixes
- Entity tags
- Source links (clickable, `target="_blank"`)
- Fallback: Raw JSON display if no recognized fields

Helper functions: `escapeHtml(text)` for XSS protection, `linkify(html)` for auto-converting URLs to clickable links.

#### `ui/js/components/chart-panel.js` — Chart.js Renderer

Creates Chart.js v4 instances from configuration objects. Each chart gets its own `<canvas>` inside a `.chart-container`. Extracts title from `chartConfig.options.plugins.title.text`. New charts are inserted at the top of the panel.

#### `ui/js/components/search-panel.js` — Search Results

Displays structured search results with:
- Query header
- Summary card
- Individual result cards: clickable title link, text snippet, clickable URL
- Raw text fallback with auto-linkified URLs if JSON parsing fails

Also includes a search input bar that queries Claude directly (independent of the `/computer:search` command).

#### `ui/js/components/status-bar.js` — Status Indicators

Three status dots in the sidebar (Server, WebSocket, Voice) and a bottom status bar showing connection state, uptime counter (updates every second), and current activity text.

#### `ui/js/services/websocket-client.js` — WebSocket Client

Event-based WebSocket wrapper with auto-reconnect (3 seconds). Methods:
- `on(type, handler)` — Register event handler
- `send(type, data)` — Send JSON message
- `sendBinary(blob)` — Send binary data (used for audio chunks)
- `emit(type, data)` — Internal event dispatch

Special events: `_connected` and `_disconnected` for connection state.

#### `ui/js/services/api-client.js` — REST Client

HTTP client wrapping `fetch()`. Methods:
- `get(path)` — GET request, returns parsed JSON
- `post(path, data)` — POST with JSON body
- `uploadFile(path, file)` — Multipart form upload (field name: `audio`)
- `queryClaudeStream(prompt, systemPrompt, onChunk)` — SSE streaming from Claude endpoint

#### `ui/js/services/speech-service.js` — Local Whisper STT

Replaces the Web Speech API with local Whisper transcription via WebSocket. Uses `MediaRecorder` with `audio/webm;codecs=opus` (falls back to `audio/mp4` for Safari).

- `start()` — Requests mic access, starts recording in 3-second chunks, sends binary frames via WebSocket
- `stop()` — Stops recording, releases mic
- `toggle()` — Start/stop toggle
- `getAccumulatedText()` — Returns all transcribed text since last start, then resets

Listens for `stt_result` WebSocket events from the server and fires the `onResult` callback.

#### `ui/js/services/audio-player.js` — TTS Playback

Queue-based audio player for TTS responses. Prevents overlapping speech by playing audio URLs sequentially.

- `speak(audioUrl)` — Add to queue and play
- `stop()` — Clear queue and stop current audio
- `toggle()` — Enable/disable TTS playback

#### `ui/js/utils/formatters.js` — Formatting Utilities

- `formatTime(isoString)` — ISO to `HH:MM:SS`
- `formatDate(isoString)` — ISO to `"Jan 15, 2025"`
- `formatUptime(seconds)` — Seconds to `"2h 34m"` or `"45s"`
- `escapeHtml(text)` — XSS-safe HTML escaping via DOM
- `nowTime()` — Current time as `HH:MM:SS`

#### `ui/js/utils/lcars-helpers.js` — LCARS Utilities

- `getLcarsColor(index)` — Cycles through 7 LCARS colors: `#FF9900`, `#CC99CC`, `#9999FF`, `#FF9966`, `#CC6699`, `#99CCFF`, `#FFCC00`
- `createEl(tag, className, content)` — DOM element factory
- `clearEmpty(container)` — Removes `.empty-state` placeholder from a container

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
| `--lcars-bg` | `#000000` | Main background |
| `--lcars-panel-bg` | `#0a0a1a` | Panel background |
| `--lcars-text-dim` | `#996600` | Dimmed/secondary text |

#### Typography

- **Primary font:** Antonio (loaded from Google Fonts) — uppercase, letter-spacing 2px
- **Data/code font:** Courier New monospace — for transcripts, analysis text, responses

#### Layout

The LCARS frame uses CSS Grid with two columns (sidebar + content) and three rows (header + main + footer). The signature LCARS "elbows" (rounded corner bars) are created with `border-radius: 30px` on colored blocks.

**Key layout files:**
- `ui/css/lcars.css` — Full design system: variables, grid layout, elbows, buttons, animations, status indicators
- `ui/css/components.css` — Panel-specific styles: command input, messages, transcript entries, analysis cards, sentiment bars, topic tags, chart containers, search results, empty states, loading indicators

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

Commands push results to the web UI by writing JSON to a temp file and POSTing with `curl -d @file` to avoid shell escaping issues with special characters.

### Agents

Located in `agents/`. Each agent is a Markdown file defining a specialized AI role with specific tools and output formats.

| File | Model | Purpose |
|------|-------|---------|
| `analyst.md` | Opus | Sentiment, topics, action items, summaries, entity extraction |
| `researcher.md` | Sonnet | Web research, source evaluation, information synthesis |
| `visualizer.md` | Sonnet | Chart.js v4 config generation with LCARS color theming |
| `transcription-processor.md` | Sonnet | Transcript cleanup, speaker detection, segmentation |

Agents output structured JSON and push results to the server via curl POST.

### Skills

Located in `skills/computer-operations/`.

**`SKILL.md`** — Triggers when the conversation mentions "Computer", "LCARS", "Enterprise computer", or related terms. Provides the AI with operational knowledge about the server, API endpoints, agents, and LCARS design conventions.

**Reference documents:**
- `references/lcars-design.md` — Complete LCARS color palette, typography rules, and layout patterns
- `references/chart-patterns.md` — Standard Chart.js v4 configuration templates with LCARS theming

### Hooks

Located in `hooks/hooks.json`.

**SessionStart hook:** Runs `scripts/status.sh` when a new Claude Code session begins. The script checks if the server is running, auto-installs node_modules if missing, creates data directories, and starts the server if it's not already running. Timeout: 30 seconds (accommodates npm install on first run).

---

## Data Storage

All data is persisted as individual JSON files in the `data/` directory (created at runtime):

```
data/
├── transcripts/     # One JSON file per transcript
│   └── {uuid}.json
├── analyses/        # One JSON file per analysis
│   └── {uuid}.json
├── sessions/        # One JSON file per session
│   └── {uuid}.json
├── server.pid       # PID of running server process
└── server.log       # Server stdout/stderr log
```

Each stored item has auto-generated fields:
- `id` — UUID v4
- `timestamp` — ISO-8601 string
- `type` — `"transcript"`, `"analysis"`, or `"session"`

Temporary files are created during processing:
- `/tmp/computer-chunk-{id}.webm` — Audio chunks during real-time STT (auto-deleted)
- `/tmp/computer-tts/{id}.wav` — TTS audio files (auto-deleted after 5 minutes)
- `/tmp/computer-analysis-result.json` — Analysis JSON before POST (created by commands)
- `/tmp/computer-search-result.json` — Search JSON before POST (created by commands)
- `/tmp/computer-transcript-result.json` — Transcript JSON before POST (created by commands)

---

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `COMPUTER_PORT` | `3141` | Server port |
| `CLAUDECODE` | `""` | Set to empty string when spawning Claude CLI to avoid formatting |

### Hardcoded Paths (edit in source if needed)

| Constant | File | Default |
|----------|------|---------|
| `WHISPER_PATH` | `server/services/transcription.js` | `/opt/homebrew/bin/whisper` |
| `TTS_PATH` | `server/services/tts.js` | `/opt/homebrew/bin/tts` |
| `TTS_MODEL` | `server/services/tts.js` | `tts_models/en/ljspeech/vits` |
| `TTS_OUTPUT_DIR` | `server/services/tts.js` | `/tmp/computer-tts` |

### Whisper Models

| Context | Model | Rationale |
|---------|-------|-----------|
| Real-time STT (audio chunks) | `tiny` | Speed priority — ~1s for a 3s chunk on Apple Silicon |
| File upload transcription | `base` | Accuracy priority — full file, one-time processing |

To change models, edit the `--model` argument in `server/services/transcription.js`.

### TTS Configuration

The default model is `tts_models/en/ljspeech/vits` — a lightweight, fast English voice (~0.2s generation). To use a different Coqui TTS model:

1. List available models: `tts --list_models`
2. Download the model: `tts --model_name <model> --text "test" --out_path /tmp/test.wav`
3. Update `TTS_MODEL` in `server/services/tts.js`

Note: The `xtts_v2` multilingual model requires a compatible `transformers` library version. If you encounter import errors, stick with the `vits` model or fix the Python dependency.

---

## Troubleshooting

### Server won't start

```bash
# Check if port 3141 is already in use
lsof -i :3141

# Check server log
cat ~/.claude/plugins/computer/data/server.log

# Kill existing process and restart
lsof -i :3141 -t | xargs kill -9
cd ~/.claude/plugins/computer && npm start
```

### Plugin commands not recognized

Commands must be invoked with the `computer:` prefix:
- `/computer:analyze` (correct)
- `/computer-analyze` (incorrect)

If commands don't appear at all, verify the plugin is installed:
```bash
# Check settings
cat ~/.claude/settings.json | grep computer
```

The `enabledPlugins` object should contain `"computer@computer-local": true`.

### Whisper not found

The server expects Whisper at `/opt/homebrew/bin/whisper`. If yours is elsewhere:

```bash
which whisper  # Find your installation
```

Then update `WHISPER_PATH` in `server/services/transcription.js`.

### TTS errors

If Coqui TTS fails with import errors (especially with `xtts_v2`), the `vits` model is the reliable fallback. Test it:

```bash
tts --model_name tts_models/en/ljspeech/vits --text "Test." --out_path /tmp/test.wav
```

### No audio in browser

- Ensure the browser tab is focused (browsers block autoplay on background tabs)
- Check the browser console for `AudioPlayer` errors
- Verify the TTS endpoint works: `curl -X POST http://localhost:3141/api/tts/speak -H 'Content-Type: application/json' -d '{"text":"Test"}'`

### WebSocket disconnects

The client auto-reconnects after 3 seconds. If connections drop frequently, check:
- Server is still running: `lsof -i :3141`
- No firewall blocking WebSocket upgrades
- Server log for errors: `tail -f data/server.log`

### Cache sync issues

Claude Code runs the plugin from the cache directory. After editing source files, sync to cache:

```bash
rsync -av --exclude node_modules --exclude data --exclude package-lock.json \
  ~/.claude/plugins/computer/ \
  ~/.claude/plugins/cache/computer-local/computer/1.0.0/
```

Then restart the server.

---

## File Structure

```
~/.claude/plugins/computer/
├── .claude-plugin/
│   └── plugin.json                    # Plugin metadata (name, version, author)
├── package.json                       # Node.js dependencies and scripts
├── README.md                          # This file
├── .gitignore                         # Excludes node_modules, data, logs
│
├── commands/                          # Claude Code slash commands
│   ├── computer.md                    # /computer:computer — Start/stop server
│   ├── analyze.md                     # /computer:analyze — AI text analysis
│   ├── search.md                      # /computer:search — Web search
│   ├── transcribe.md                  # /computer:transcribe — Whisper transcription
│   └── status.md                      # /computer:status — System diagnostics
│
├── agents/                            # Specialized AI agent definitions
│   ├── analyst.md                     # Opus — Sentiment, topics, entities
│   ├── researcher.md                  # Sonnet — Web research synthesis
│   ├── visualizer.md                  # Sonnet — Chart.js config generation
│   └── transcription-processor.md     # Sonnet — Transcript cleanup
│
├── skills/
│   └── computer-operations/
│       ├── SKILL.md                   # Triggers on "Computer" references
│       └── references/
│           ├── lcars-design.md        # LCARS color/typography/layout guide
│           └── chart-patterns.md      # Chart.js template configs
│
├── hooks/
│   └── hooks.json                     # SessionStart auto-start hook
│
├── scripts/
│   ├── start.sh                       # Server launch script
│   └── status.sh                      # Health check + auto-start
│
├── server/
│   ├── index.js                       # Express + WebSocket entry point
│   ├── routes/
│   │   ├── api.js                     # CRUD for transcripts, analyses, sessions
│   │   ├── claude.js                  # Claude CLI proxy with SSE streaming
│   │   ├── transcribe.js             # Multer file upload → Whisper
│   │   └── tts.js                     # Text-to-speech endpoint + audio serving
│   ├── services/
│   │   ├── claude-bridge.js           # Spawns claude -p child processes
│   │   ├── storage.js                 # JSON file persistence
│   │   ├── transcription.js           # Whisper CLI wrapper (chunk + file)
│   │   ├── tts.js                     # Coqui TTS with sequential queue
│   │   └── websocket.js              # WebSocket manager + audio chunk processing
│   └── utils/
│       └── helpers.js                 # UUID, timestamp, duration formatting
│
├── ui/
│   ├── index.html                     # SPA shell with LCARS layout
│   ├── css/
│   │   ├── lcars.css                  # Full LCARS design system
│   │   └── components.css             # Panel-specific component styles
│   └── js/
│       ├── app.js                     # Bootstrap, component wiring, WS handlers
│       ├── components/
│       │   ├── analysis-panel.js      # Analysis results with sentiment bars
│       │   ├── chart-panel.js         # Chart.js renderer with history
│       │   ├── command-input.js       # Chat interface with Claude streaming
│       │   ├── search-panel.js        # Search results with clickable links
│       │   ├── status-bar.js          # Connection/uptime/activity indicators
│       │   ├── transcript-panel.js    # Timestamped transcript display
│       │   └── voice-input.js         # Mic toggle + file upload controls
│       ├── services/
│       │   ├── api-client.js          # REST + SSE streaming client
│       │   ├── audio-player.js        # Queue-based TTS audio playback
│       │   ├── speech-service.js      # MediaRecorder → WebSocket → Whisper STT
│       │   └── websocket-client.js    # WebSocket with auto-reconnect
│       └── utils/
│           ├── formatters.js          # Time, date, uptime, HTML escaping
│           └── lcars-helpers.js       # LCARS colors, DOM helpers
│
└── data/                              # Created at runtime (gitignored)
    ├── transcripts/                   # Stored transcript JSON files
    ├── analyses/                      # Stored analysis JSON files
    ├── sessions/                      # Stored session JSON files
    ├── server.pid                     # Running server PID
    └── server.log                     # Server output log
```

---

## License

MIT
