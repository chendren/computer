# Computer — Star Trek Enterprise AI Agent

A Claude Code plugin that brings the USS Enterprise computer to life. Self-contained local AI voice assistant with an LCARS-themed web interface featuring **full-duplex speech-to-speech conversation via Moshi** (~200ms latency), dual-model tool routing via Ollama (Llama 4 Scout + xLAM), vector knowledge base, data visualization, web search, Gmail integration, monitoring, and 19 interactive panels — all running entirely on your machine with zero external API dependencies.

![LCARS Interface](https://img.shields.io/badge/UI-LCARS%20Theme-FF9900?style=flat-square&labelColor=000000)
![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-CC99CC?style=flat-square&labelColor=000000)
![Node.js](https://img.shields.io/badge/Node.js-Express%20%2B%20WebSocket-9999FF?style=flat-square&labelColor=000000)
![LanceDB](https://img.shields.io/badge/Vector%20DB-LanceDB-55CC55?style=flat-square&labelColor=000000)
![Moshi](https://img.shields.io/badge/Voice-Moshi%20Speech--to--Speech-33CCFF?style=flat-square&labelColor=000000)
![Ollama](https://img.shields.io/badge/LLM-Llama%204%20Scout%20%2B%20xLAM%20via%20Ollama-66CCFF?style=flat-square&labelColor=000000)
![Self-Contained](https://img.shields.io/badge/Mode-LOCAL%20(self--contained)-55CC55?style=flat-square&labelColor=000000)

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
  - [Gateway API (Local Services)](#gateway-api-local-services)
  - [WebSocket Events](#websocket-events)
- [Moshi Speech-to-Speech](#moshi-speech-to-speech)
  - [Dual-Mode Voice Architecture](#dual-mode-voice-architecture)
  - [Moshi Protocol](#moshi-protocol)
  - [Wake Word Switching](#wake-word-switching)
  - [Moshi API](#moshi-api)
- [Gmail Integration](#gmail-integration)
- [Server Components](#server-components)
  - [Middleware](#middleware)
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
- [Data Storage](#data-storage)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [File Structure](#file-structure)

---

## Overview

Computer is a Claude Code plugin that functions as an AI assistant modeled after the Star Trek USS Enterprise computer. It runs a self-contained Express + WebSocket server on port 3141, serving an LCARS-themed single-page application with 19 panels covering voice interaction, AI analysis, data visualization, web search, Gmail, monitoring, knowledge management, and more.

**Key design principles:**
- **Fully self-contained** — All services run locally. No external gateway or cloud APIs required. Voice transcription via Whisper, text-to-speech via Coqui TTS, dual-model LLM inference via Ollama, vision analysis via Ollama, embeddings via Ollama
- **Moshi speech-to-speech** — Full-duplex voice conversation via Moshi MLX with ~200ms latency, running natively on Apple Silicon. Seamlessly switches to tool-augmented Computer mode on wake word
- **Dual-model voice pipeline** — xLAM 8B for deterministic tool routing + Llama 4 Scout for conversational responses. 25+ tools including web search, charts, email, knowledge base, and more
- **Vector-powered knowledge** — LanceDB with nomic-embed-text (768-dim) for semantic search with 6 chunking strategies and 6 search methods
- **Real-time** — WebSocket pushes data to the browser instantly as commands complete
- **Vanilla JS** — No build step, no framework — ES modules served directly by Express
- **Gmail integration** — Direct OAuth-based Gmail access for reading, sending, and managing email
- **LCARS aesthetic** — Authentic Star Trek computer interface with the signature orange/lavender/blue color palette

---

## Features

### Moshi Full-Duplex Voice (NEW)
- **Speech-to-speech in ~200ms** — Moshi MLX runs natively on Apple Silicon via the Metal GPU framework. True full-duplex: speak and hear responses simultaneously, like a real conversation
- **Dual-mode voice** — **Moshi mode** (default): always-listening natural conversation. **Computer mode**: say "Computer, ..." to trigger tool-augmented commands with web search, charts, email, etc.
- **Automatic mode switching** — Wake word "Computer" in Moshi's transcript triggers a seamless switch to Computer mode. After the command executes, switches back to Moshi mode
- **Opus audio streaming** — Browser captures at 24kHz, encodes to Opus via WebCodecs API, streams over WebSocket. Moshi responses stream back as Opus frames for real-time playback
- **Live transcript** — Moshi's text output displayed in the status bar in real-time
- **Mode toggle** — CMD/MOSHI button in the title bar to manually switch modes
- **Cyan visual indicator** — Diamond button pulses cyan when Moshi is active

### Always-Listening Voice Assistant (Computer Mode)
- **Wake word activation** — Say "Computer" followed by a command. Always-on listening via Silero VAD (Voice Activity Detection) in-browser via ONNX Runtime WebAssembly
- **Dual-model tool use** — xLAM 8B routes to 25+ tools, Llama 4 Scout generates conversational responses. Zero API cost
- **Full voice pipeline** — VAD detects speech, Whisper STT transcribes, wake word detection, xLAM routes tools, Scout generates response, Coqui TTS speaks, audio plays in browser
- **Interruption support** — Speak during TTS playback to interrupt and issue a new command
- **Visual state indicator** — Diamond button with color-coded states: amber pulse (listening), bright amber (capturing), red pulse (thinking), green pulse (speaking)
- **25+ voice tools** — Knowledge search/store, captain's log, charts, web search, email (check/send/reply/summarize/followups), panel switching, alerts, reminders, monitors, browse URLs, and more
- **Auto-search for live data** — Queries about prices, weather, stocks, news automatically trigger web search via DuckDuckGo + Instant Answers API + page content fetching
- **Smart chart generation** — "Show me gold prices" or "Chart Amazon vs Tesla" triggers LLM-powered intent parsing, financial API lookups, web data extraction, and Chart.js visualization
- **Session memory** — Per-WebSocket conversation history (20 turns, 4hr TTL)

### Gmail Integration
- **OAuth authentication** — Authorize Gmail directly from the LCARS UI
- **Inbox & threads** — Browse inbox, read full email threads, folder navigation
- **Send & reply** — Compose new emails or reply within threads
- **Voice-accessible** — "Computer, check my email", "Computer, summarize my inbox", "Computer, reply to John's email"
- **Follow-up detection** — Identifies emails needing responses

### AI Analysis
- **Sentiment analysis** — Tone classification with confidence score and breakdown bar
- **Topic extraction** — Key themes with relevance scores as color-coded LCARS tags
- **Action items** — Extracted with priority levels (high/medium/low)
- **Entity recognition** — People, organizations, locations, dates, technical terms
- **Summary generation** — Concise 2-3 sentence summaries
- **Media analysis** — Upload images/video for AI analysis via Ollama vision models
- **Structured JSON output** — Analysis via Llama 4 Scout with `response_format: json_object`

### Interactive Panels (19)
- **Dashboard** — Bridge console: system stats, Moshi status, Ollama status, Gmail status, security score
- **Main** — Chat with Claude via SSE streaming
- **Transcript** — Live STT, file upload, timestamped entries
- **Analysis** — Sentiment bars, topic tags, entities, action items
- **Charts** — Chart.js v4 with LCARS theming, smart data visualization
- **Knowledge** — Vector search with method selection, metadata filters
- **Channels** — Gmail compose, inbox, threads, OAuth
- **Search** — Web search results with clickable links
- **Log** — Captain's log with stardates and categories
- **Monitor** — Active monitors with status dots and check history
- **Compare** — Side-by-side diffs with similarity bars
- **Gateway** — Sessions, agents, models (all local services)
- **Plugins** — Plugin/hook/tool registry
- **Cron** — Scheduled jobs with event log
- **Browser** — URL bar + viewport
- **Nodes** — Local device info with camera/screen capture
- **Security** — Shield gauge + redaction stats

### Vector Knowledge Base
- **LanceDB** with nomic-embed-text embeddings (768-dim) via Ollama
- **6 chunking strategies** — Fixed, sentence, paragraph, sliding window, semantic, recursive
- **6 search methods** — Vector, BM25, hybrid, metadata, MMR, multi-query with RRF

### Data Visualization
- **Smart chart agent** — Natural language to chart: "Show me Tesla stock this month", "Compare US and China population"
- **Chart.js v4** — Line, bar, pie, doughnut, radar, polar area, scatter
- **Financial fast paths** — Live prices from Swissquote (metals) and Google Finance (stocks/crypto)
- **Table mode** — "Show me a table of..." renders interactive data tables
- **Source attribution** — Charts link back to data sources

---

## Architecture

```
                                ┌─────────────────────────────────────────┐
                                │         Claude Code CLI Session          │
                                │  /computer:analyze, /computer:know, ... │
                                └────────────────┬────────────────────────┘
                                                 │ HTTP POST
                                                 ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    Express + WebSocket Server (:3141)                            │
│                                                                                 │
│  Middleware                      WebSocket Handler                               │
│  ├── Helmet (CSP, X-Frame)      ├── Auth via ?token= query param                │
│  ├── CORS (same-origin only)    ├── Dual-mode voice routing                     │
│  ├── Rate limiting (200/min)    │   ├── Moshi mode: binary audio → Moshi bridge │
│  ├── Bearer token auth          │   └── Computer mode: audio → Whisper STT      │
│  ├── Security scan (in+out)     ├── Voice command processing (25+ tools)         │
│  └── Secret redaction           ├── Smart chart executor                         │
│                                 └── Web search + auto-fetch                      │
│  Local Services                                                                  │
│  ├── config.js      — JSON config (data/config.json)                            │
│  ├── models.js      — Ollama model listing + capability detection               │
│  ├── sessions.js    — Voice session tracking                                    │
│  ├── agents.js      — Agent definitions from agents/*.md (YAML frontmatter)     │
│  ├── vision.js      — Image/video analysis via Ollama vision models             │
│  ├── node-local.js  — Local machine as "node 0" (camera, screen, commands)      │
│  ├── cron-scheduler.js — Local cron with minute-level granularity               │
│  ├── plugins.js     — Static tool/hook/plugin registry                          │
│  ├── moshi.js       — Moshi sidecar manager + WebSocket bridge                  │
│  ├── gmail.js       — Direct Gmail API via OAuth                                │
│  └── voice-assistant.js — Dual-model (xLAM + Scout) + 25+ tools                │
│                                                                                 │
│  REST API: /api/knowledge/*, /api/transcribe/*, /api/tts/*, /api/claude/*,      │
│            /api/media/*, /api/voice/*, /api/gateway/*, /api/gmail/*             │
└──────────────┬──────────────────────────────────────────────┬───────────────────┘
               │ WebSocket bridge                              │ WebSocket broadcast
               ▼                                               ▼
┌──────────────────────────┐            ┌─────────────────────────────────────────┐
│  Moshi MLX Sidecar       │            │           LCARS Web UI (Browser)        │
│  Port 8998               │            │                                         │
│  ├── Speech-to-speech    │            │  ┌────────────┐  ┌───────────────────┐  │
│  ├── ~200ms latency      │            │  │ Sidebar    │  │ Active Panel      │  │
│  ├── Opus audio I/O      │            │  │ 19 panels  │  │ (one of 19)       │  │
│  ├── Text transcript     │            │  └────────────┘  └───────────────────┘  │
│  └── MLX on Apple Silicon│            │  ┌────────────────────────────────────┐  │
└──────────────────────────┘            │  │ ◆ Voice │ CMD/MOSHI │ Status Bar  │  │
                                        │  └────────────────────────────────────┘  │
               ▲                        │  WebCodecs Opus encode/decode            │
               │                        │  Silero VAD (ONNX Runtime WASM)          │
               │                        └─────────────────────────────────────────┘
               │
┌──────────────┴──────────────┐
│  Ollama (localhost:11434)    │
│  ├── llama4:scout           │
│  ├── xLAM 8B F16            │
│  └── nomic-embed-text       │
└─────────────────────────────┘
```

---

## Prerequisites

### Required

| Tool | Purpose | Install |
|------|---------|---------|
| **Node.js** (v18+) | Server runtime | `brew install node` |
| **Claude Code** | CLI tool for AI capabilities | [Install guide](https://docs.anthropic.com/en/docs/claude-code) |
| **Ollama** | Local LLM inference + embeddings | `brew install ollama` |
| **nomic-embed-text** | Embedding model (768-dim) | `ollama pull nomic-embed-text` |

### Recommended

| Tool | Purpose | Install |
|------|---------|---------|
| **Llama 4 Scout** | Voice conversation + analysis | `ollama pull llama4:scout` |
| **xLAM 8B F16** | Deterministic tool routing | `ollama pull hf.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf:F16` |
| **Python 3.12** | Moshi MLX runtime | `brew install python@3.12` |

### Optional

| Tool | Purpose | Install |
|------|---------|---------|
| **OpenAI Whisper** | Local speech-to-text | `pip install openai-whisper` |
| **Coqui TTS** | Local text-to-speech | `pip install TTS` |
| **FFmpeg** | Audio/video processing | `brew install ffmpeg` |

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

### 3. Ensure Ollama is running with models

```bash
ollama serve &
ollama pull nomic-embed-text
ollama pull llama4:scout
ollama pull hf.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf:F16
```

### 4. (Recommended) Set up Moshi speech-to-speech

```bash
cd ~/.claude/plugins/computer
python3.12 -m venv moshi-env
source moshi-env/bin/activate
pip install moshi_mlx
```

First run will download the Moshi model (~5GB). You can test standalone:

```bash
source moshi-env/bin/activate
python -m moshi_mlx.local_web -q 4 --hf-repo kyutai/moshika-mlx-q4
# Opens on http://localhost:8998
```

The LCARS server manages Moshi as a sidecar process automatically — no need to start it manually.

### 5. Register as a Claude Code plugin

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
      "version": "3.0.0",
      "author": { "name": "Your Name" },
      "source": "../../../computer",
      "category": "productivity"
    }
  ]
}
```

Symlink and install:

```bash
ln -s ~/.claude/plugins/computer ~/.claude/plugins/computer-marketplace/.claude-plugin/plugins/computer
claude plugin marketplace add computer-local --source directory --path ~/.claude/plugins/computer-marketplace
claude plugin install computer@computer-local
```

### 6. Verify installation

Start a new Claude Code session. The SessionStart hook auto-starts the server. Open [http://localhost:3141](http://localhost:3141) in your browser.

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
| `/computer:status` | System diagnostics + Moshi/Ollama/Gmail status |
| `/computer:compare <items>` | Side-by-side comparison of files/text |
| `/computer:summarize <text>` | Multi-level document summarization |
| `/computer:monitor <target>` | Set up watches on URLs/files/processes |
| `/computer:log <entry>` | Captain's log entries |
| `/computer:brief` | Activity briefing and status report |
| `/computer:pipeline <operations>` | Chain operations |
| `/computer:know <query-or-fact>` | Store, retrieve, or search knowledge base |
| `/computer:export [format] [timeframe]` | Generate formatted reports |
| `/computer:channels` | List messaging channels with status |
| `/computer:send <channel> <target> <message>` | Send message (Gmail supported) |
| `/computer:gateway` | Local service status, sessions, agents, models |
| `/computer:audit` | Security audit |

### Web UI Panels

The LCARS interface has 19 panels organized in three groups:

#### Core
| Panel | Purpose |
|-------|---------|
| **Dashboard** | Bridge console — system stats, Moshi status, Ollama status, Gmail, security |
| **Main** | Chat input, streaming Claude responses, command history |
| **Transcript** | Mic toggle, file upload, timestamped transcript entries |
| **Analysis** | Collapsible raw input, sentiment bar, topic tags, entities, action items |
| **Charts** | Chart.js renders with LCARS colors, smart chart generation |
| **Knowledge** | Vector search with method selection, metadata filters, tabbed views |

#### Comms
| Panel | Purpose |
|-------|---------|
| **Channels** | Gmail compose, inbox, threads, OAuth |
| **Search** | Web search results with clickable links |
| **Log** | Captain's log with stardates, categories, color-coded tags |
| **Monitor** | Active monitors with status dots, check history |
| **Compare** | Side-by-side comparison with similarity bars, diff grids |

#### Ops
| Panel | Purpose |
|-------|---------|
| **Gateway** | Tabbed: Overview / Sessions / Agents / Models (all local) |
| **Plugins** | Tabbed: Plugins / Hooks / Tools registry |
| **Cron** | Job grid with schedule display, event log |
| **Browser** | URL bar + viewport |
| **Nodes** | Local device info with camera/screen capture |
| **Security** | Shield gauge, redaction stats, audit findings |

### Voice Interaction

#### Moshi Mode (Full-Duplex, Recommended)

1. Open the LCARS UI in your browser
2. Click the **MOSHI** mode toggle button in the title bar
3. Click the **diamond button** (&#9670;) — it pulses cyan
4. **Speak naturally** — Moshi responds in real-time with ~200ms latency
5. Full-duplex: you can speak while Moshi is talking
6. Say **"Computer, check my email"** — auto-switches to Computer mode for tools
7. After the command completes, returns to Moshi mode

#### Computer Mode (Tool-Augmented)

1. Click **CMD** mode toggle (or it auto-selects if Moshi is unavailable)
2. Click the diamond button — it pulses amber
3. Say **"Computer, what is the system status?"** — button turns red (thinking)
4. The Computer speaks the response — button turns green (speaking)
5. Returns to amber (listening) for the next command

**Voice command flow:**
```
Moshi Mode:  [Mic → Opus encode] → [WebSocket] → [LCARS bridge] → [Moshi MLX]
             → [Audio + text response] → [Opus decode → playback]
             → [Wake word "Computer" detected → switch to Computer mode]

Computer Mode: [Silero VAD] → [Whisper STT] → [wake word check]
               → [xLAM tool routing] → [tool execution] → [Llama 4 Scout response]
               → [Coqui TTS] → [audio playback] → [return to listening/Moshi]
```

### Smart Voice Routing

| Voice Pattern | Action |
|--------------|--------|
| "Computer, analyze [text]" | AI analysis with sentiment, topics, entities |
| "Computer, search [query]" | Web search with results pushed to UI |
| "Computer, check my email" | Gmail inbox summary |
| "Computer, reply to [name]'s email" | Compose and send reply |
| "Computer, show me [chart]" | Smart chart generation |
| "Computer, what time is it?" | Stardate + local time |
| "Computer, set a reminder" | Timer with notification |
| "Computer, red alert" | Visual + audio alert |
| "Computer, remember [fact]" | Store in knowledge base |
| "Computer, show me [panel]" | Switch to named panel |

---

## API Reference

### REST Endpoints

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
  "vectordb": "online",
  "ollama": "online",
  "gateway": { "enabled": true, "running": true, "connected": true, "mode": "local" },
  "moshi": { "running": true, "ready": true, "pid": 12345, "port": 8998 },
  "gmail": { "connected": true, "email": "user@gmail.com" },
  "config": { "mode": "local" }
}
```

#### Data Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | /api/transcripts | Transcripts |
| GET/POST | /api/analyses | Analyses |
| POST | /api/charts | Chart.js visualizations |
| POST | /api/search-results | Search results |
| GET/POST | /api/logs | Captain's log entries |
| GET/POST | /api/monitors | Monitor status tracking |
| GET/POST | /api/comparisons | Side-by-side comparisons |

#### Voice

```
GET  /api/voice/status         # Voice status + Moshi info
GET  /api/voice/config         # VAD config + mode descriptions
GET  /api/voice/moshi/status   # Moshi process health
POST /api/voice/moshi/start    # Start Moshi sidecar
POST /api/voice/moshi/stop     # Stop Moshi sidecar
```

#### TTS / STT

```
POST /api/tts/speak            # Generate speech via Coqui TTS
GET  /api/tts/audio/:file      # Serve generated WAV file
GET  /api/tts/providers        # List TTS providers
POST /api/transcribe/file      # Transcribe audio via Whisper
GET  /api/transcribe/providers # List STT providers
```

#### Media Analysis

```
POST /api/media/analyze        # Upload image/video for Ollama vision analysis
POST /api/media/video/frames   # Extract video frames via FFmpeg
GET  /api/media/providers      # List vision providers
```

### Knowledge Base API

```bash
# Store a fact
curl -X POST http://localhost:3141/api/knowledge \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"text":"The Enterprise uses dilithium crystals","source":"user","tags":["engineering"]}'

# Semantic search
curl -X POST http://localhost:3141/api/knowledge/search \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"how does warp drive work","method":"hybrid","limit":5}'

# Get statistics
curl -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/knowledge/stats
```

### Gateway API (Local Services)

All gateway endpoints run as self-contained local services (no external gateway required).

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/gateway/status | Local service status |
| GET | /api/gateway/channels | Connected channels (Gmail) |
| POST | /api/gateway/send | Send message (Gmail) |
| GET | /api/gateway/sessions | Voice sessions |
| GET | /api/gateway/agents | Agent definitions from agents/*.md |
| GET | /api/gateway/models | Ollama model catalog |
| GET | /api/gateway/nodes | Local machine info |
| GET | /api/gateway/plugins | Plugin registry |
| GET | /api/gateway/cron | Cron job list |
| GET | /api/gateway/sessions/:key/history | Session conversation history |
| GET | /api/gateway/sessions/:key/cost | Token usage |
| POST | /api/gateway/nodes/:id/camera | Capture camera image |
| POST | /api/gateway/nodes/:id/screen | Capture screenshot |
| POST | /api/gateway/nodes/:id/execute | Execute whitelisted command |

#### OAuth

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/gateway/oauth/status | Gmail authorization status |
| POST | /api/gateway/oauth/:provider/start | Start Gmail OAuth flow |
| POST | /api/gateway/oauth/:provider/revoke | Revoke authorization |

### WebSocket Events

Connect to `ws://localhost:3141?token=<auth-token>`. Binary messages use a 1-byte kind prefix for Moshi audio.

#### Server to Client

| Event | Data |
|-------|------|
| `status` | `{ message, connected }` |
| `stt_result` | `{ text }` — Whisper transcription |
| `voice_thinking` | `{}` — Processing started |
| `voice_response` | `{ text, audioUrl, toolsUsed, panelSwitch }` |
| `voice_done` | `{}` — Turn complete |
| `voice_error` | `{ error }` |
| `voice_mode_changed` | `{ mode: 'moshi'\|'computer', reason }` |
| `moshi_text` | `{ text, fullText }` — Moshi transcript |
| `moshi_handshake` | `{}` — Moshi bridge connected |
| `moshi_error` | `{ error }` |
| `voice_panel_switch` | `{ panel }` |
| `chart` | `{ chartConfig, sources, table }` |
| `alert_status` | `{ level, reason }` |
| Binary `0x01` | Opus audio frame from Moshi |

#### Client to Server

| Event | Data |
|-------|------|
| `voice_command` | `{ text }` — Execute command |
| `voice_mode` | `{ mode: 'moshi'\|'computer' }` — Switch mode |
| `voice_start` | `{}` — Activate voice |
| `voice_cancel` | `{}` — Deactivate voice |
| Binary `0x01` + data | Opus audio frame to Moshi |
| Binary (WAV/WebM) | Audio chunk for Whisper STT |

---

## Moshi Speech-to-Speech

### Dual-Mode Voice Architecture

Computer implements a dual-mode voice system:

**Moshi Mode** (default when available):
- Full-duplex speech-to-speech via [Moshi](https://github.com/kyutai-labs/moshi) by Kyutai Labs
- Runs natively on Apple Silicon via MLX with 4-bit quantization (~5GB model)
- ~200ms response latency — natural conversational flow
- Audio streamed as Opus frames over WebSocket
- Moshi handles its own voice activity detection — no Silero VAD needed
- Text transcript relayed to LCARS UI in real-time

**Computer Mode** (tool commands):
- Triggered by wake word "Computer" in Moshi's transcript, or by manual toggle
- Routes through the full tool pipeline: Whisper STT, xLAM tool routing, tool execution, Llama 4 Scout response generation, Coqui TTS
- Access to 25+ tools: web search, charts, email, knowledge base, alerts, monitors, etc.
- After command completion, auto-switches back to Moshi mode

### Moshi Protocol

The LCARS server bridges between the browser and Moshi's WebSocket at `ws://localhost:8998/api/chat`:

```
Browser ←→ LCARS Server (:3141) ←→ Moshi MLX (:8998)

Binary message format (both directions):
  [1 byte kind] [payload...]
  0x00 = Handshake (Moshi → server, empty payload)
  0x01 = Opus audio frame (bidirectional)
  0x02 = UTF-8 text token (Moshi → server)

Audio: Opus-encoded, 24kHz, mono, ~80ms frames
```

### Wake Word Switching

When Moshi is active and its text output contains "Computer, ..." the server:
1. Extracts the command text after "Computer"
2. Switches the client to Computer mode
3. Processes the command through the full tool pipeline
4. Sends the response (with TTS audio)
5. Switches back to Moshi mode

### Moshi API

```bash
# Check Moshi status
curl -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/voice/moshi/status
# → {"running":true,"ready":true,"pid":12345,"port":8998}

# Start Moshi (if not auto-started)
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/voice/moshi/start

# Stop Moshi
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/voice/moshi/stop
```

---

## Gmail Integration

Gmail is integrated directly via OAuth (no gateway required):

```bash
# Authorize Gmail (opens OAuth flow)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3141/api/gateway/oauth/gmail/start

# Check inbox
curl -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/gmail/inbox?max=10

# Send email
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  http://localhost:3141/api/gmail/send \
  -d '{"to":"user@example.com","subject":"Hello","body":"From the Enterprise Computer"}'
```

Voice commands:
- "Computer, check my email"
- "Computer, summarize my inbox"
- "Computer, reply to John's email saying I'll be there at 3"
- "Computer, send an email to user@example.com about the meeting"

---

## Server Components

### Middleware

| File | Purpose |
|------|---------|
| `server/middleware/auth.js` | Bearer token authentication — auto-generated 256-bit token stored in `data/.auth-token` |
| `server/middleware/security.js` | Inbound secret scanning + outbound response redaction |

### Routes

| File | Purpose |
|------|---------|
| `server/routes/api.js` | CRUD for transcripts, analyses, sessions, logs, monitors, comparisons |
| `server/routes/knowledge.js` | Knowledge base: ingest, search, bulk, stats, delete |
| `server/routes/claude.js` | Claude CLI proxy with SSE streaming |
| `server/routes/transcribe.js` | Audio transcription via local Whisper |
| `server/routes/tts.js` | Text-to-speech via local Coqui TTS |
| `server/routes/media.js` | Media upload + analysis via Ollama vision |
| `server/routes/voice.js` | Voice config/status + Moshi control endpoints |
| `server/routes/gateway-extras.js` | Sessions, agents, hooks, tools, nodes, OAuth, inbox, channels |

### Services

| File | Purpose |
|------|---------|
| `server/services/moshi.js` | Moshi MLX sidecar: process lifecycle + WebSocket bridge |
| `server/services/voice-assistant.js` | Dual-model voice: xLAM routing + Scout responses, 25+ tools |
| `server/services/websocket.js` | WebSocket manager: dual-mode audio routing, tool executor, smart charts, web search |
| `server/services/config.js` | JSON config management (data/config.json) |
| `server/services/models.js` | Ollama model listing with capability detection |
| `server/services/sessions.js` | Voice session tracking |
| `server/services/agents.js` | Agent definitions from agents/*.md with YAML frontmatter |
| `server/services/vision.js` | Image/video analysis via Ollama vision models |
| `server/services/node-local.js` | Local machine as node 0 (camera, screen, whitelisted commands) |
| `server/services/cron-scheduler.js` | Local cron with data/cron.json storage |
| `server/services/plugins.js` | Static tool/hook/plugin registry (26 tools, 4 hooks, 2 plugins) |
| `server/services/gmail.js` | Gmail API: OAuth, inbox, send, threads, labels, follow-ups |
| `server/services/vectordb.js` | LanceDB connection management |
| `server/services/embeddings.js` | Ollama nomic-embed-text wrapper |
| `server/services/chunking.js` | 6 chunking strategies |
| `server/services/search.js` | 6 search methods (vector, BM25, hybrid, MMR, RRF) |
| `server/services/storage.js` | JSON file persistence |
| `server/services/transcription.js` | Whisper CLI wrapper |
| `server/services/tts.js` | Coqui TTS with sequential queue |
| `server/services/claude-bridge.js` | LLM bridge via Ollama |
| `server/services/notifications.js` | macOS desktop notifications |

---

## UI Components

### JavaScript Modules

All UI code is vanilla JavaScript ES modules — no build step required.

#### Services

| File | Purpose |
|------|---------|
| `api-client.js` | REST client with auth token |
| `websocket-client.js` | WebSocket with auto-reconnect, binary Moshi frame handling |
| `speech-service.js` | MediaRecorder audio capture |
| `audio-player.js` | TTS queue playback + Moshi Opus streaming via WebCodecs AudioDecoder |
| `vad-service.js` | Silero VAD (Computer mode) + continuous Opus capture via WebCodecs AudioEncoder (Moshi mode) |

#### Voice Assistant

| File | Purpose |
|------|---------|
| `voice-assistant-ui.js` | Dual-mode state machine: IDLE, LISTENING, CAPTURING, PROCESSING, THINKING, SPEAKING, MOSHI_ACTIVE. Mode toggle, wake word detection, Moshi transcript display |

### CSS Design System

#### LCARS Color Palette

| Variable | Hex | Usage |
|----------|-----|-------|
| `--lcars-orange` | `#FF9900` | Primary text, borders |
| `--lcars-peach` | `#FF9966` | Secondary elements |
| `--lcars-lavender` | `#CC99CC` | Headers, labels |
| `--lcars-blue` | `#9999FF` | Tertiary accents |
| `--lcars-light-blue` | `#99CCFF` | Data text, links |
| `--lcars-gold` | `#FFCC00` | Highlights, warnings |
| `--lcars-red` | `#CC4444` | Errors, alerts |
| `--lcars-green` | `#55CC55` | Success, online |
| Cyan | `#33CCFF` | Moshi active state |

---

## Plugin Components

### Commands (17)

| File | Invoke As | Purpose |
|------|-----------|---------|
| `computer.md` | `/computer:computer` | Start/stop LCARS server |
| `analyze.md` | `/computer:analyze` | AI text analysis |
| `search.md` | `/computer:search` | Web search |
| `transcribe.md` | `/computer:transcribe` | Audio transcription |
| `status.md` | `/computer:status` | System diagnostics |
| `compare.md` | `/computer:compare` | Side-by-side comparison |
| `summarize.md` | `/computer:summarize` | Document summarization |
| `monitor.md` | `/computer:monitor` | Set up watches |
| `log.md` | `/computer:log` | Captain's log |
| `brief.md` | `/computer:brief` | Activity briefing |
| `pipeline.md` | `/computer:pipeline` | Chain operations |
| `know.md` | `/computer:know` | Knowledge base |
| `export.md` | `/computer:export` | Generate reports |
| `channels.md` | `/computer:channels` | List channels |
| `send.md` | `/computer:send` | Send messages |
| `gateway.md` | `/computer:gateway` | Service management |
| `audit.md` | `/computer:audit` | Security audit |

### Agents (15)

Agents are defined as Markdown files in `agents/` with optional YAML frontmatter (name, description, model).

| File | Model | Purpose |
|------|-------|---------|
| `analyst.md` | Opus | Sentiment, topics, action items, summaries |
| `researcher.md` | Sonnet | Web research, source evaluation |
| `visualizer.md` | Sonnet | Chart.js config generation |
| `transcription-processor.md` | Sonnet | Transcript cleanup, speaker detection |
| `comparator.md` | Opus | Side-by-side comparison |
| `summarizer.md` | Opus | Multi-level summarization |
| `monitor.md` | Sonnet | URL/file/process monitoring |
| `translator.md` | Sonnet | Multi-language translation |
| `explainer.md` | Opus | Layered explanations |
| `pipeline.md` | Opus | Workflow orchestration |
| `knowledge.md` | Opus | Knowledge store/retrieve |
| `channels.md` | Sonnet | Messaging + compose |
| `automation.md` | Opus | Cron + pipeline orchestration |
| `browser-agent.md` | Sonnet | Web automation |
| `security-agent.md` | Sonnet | Security audits |

### Hooks

**SessionStart hook:** Runs `scripts/status.sh` to auto-start the server on session begin.

---

## Vector Knowledge Base

### Chunking Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| `fixed` | N-character chunks with overlap | Uniform sizes |
| `sentence` | Split on sentence boundaries | Short facts |
| `paragraph` | Split on double newlines (default) | Medium documents |
| `sliding` | Fixed window with step size | Overlapping context |
| `semantic` | Split when cosine similarity drops | Topic shifts |
| `recursive` | Headers, paragraphs, sentences | Long documents |

### Search Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| `vector` | Cosine similarity | Semantic search |
| `keyword` | BM25-style TF-IDF | Exact terms |
| `hybrid` | Vector + keyword (default) | General purpose |
| `mmr` | Maximal Marginal Relevance | Avoid redundancy |
| `multi_query` | Query variations + RRF | Complex queries |

---

## Security

A multi-layer security system:

- **Bearer token auth** — Auto-generated 256-bit token on all `/api/*` routes
- **Helmet** — CSP, X-Frame-Options, and other security headers
- **CORS** — Same-origin only (localhost:3141)
- **Rate limiting** — 200 req/min general, 20 req/min on sensitive endpoints
- **Inbound scanning** — POST/PUT/PATCH bodies scanned for tokens, keys, passwords
- **Outbound redaction** — All JSON responses scanned for leaked secrets
- **Command whitelist** — Node execute endpoint only allows whitelisted commands (ls, df, uptime, etc.)
- **WebSocket auth** — Token required as query parameter on WebSocket connections
- **Agent hardening** — All 15 agent system prompts include security directive

```
GET /api/security/stats  # Redaction audit data
```

---

## Data Storage

```
data/
├── vectordb/              # LanceDB vector database
├── transcripts/           # One JSON file per transcript
├── analyses/              # Analysis results
├── sessions/              # Session data
├── logs/                  # Captain's log entries
├── monitors/              # Monitor configs
├── comparisons/           # Comparison results
├── config.json            # Local service config
├── cron.json              # Cron job definitions
├── agents-config.json     # Agent overrides
├── .auth-token            # Server auth token (gitignored)
└── gmail-*.json           # Gmail OAuth tokens (gitignored)
```

---

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `COMPUTER_PORT` | `3141` | Server port |
| `VOICE_MODEL` | `llama4:scout` | Ollama model for conversation |
| `ACTION_MODEL` | `hf.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf:F16` | Ollama model for tool routing |
| `VISION_MODEL` | `llama4:scout` | Ollama model for vision analysis |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API base |
| `MOSHI_PORT` | `8998` | Moshi sidecar port |
| `WHISPER_PATH` | `/opt/homebrew/bin/whisper` | Whisper binary path |
| `TTS_PATH` | `/opt/homebrew/bin/tts` | Coqui TTS binary path |

---

## Troubleshooting

### Server won't start

```bash
lsof -i :3141                       # Check if port is in use
cat /tmp/lcars-server.log           # Check server log
lsof -i :3141 -t | xargs kill -9   # Kill and restart
cd ~/.claude/plugins/computer && node server/index.js
```

### Moshi not starting

```bash
# Check if venv exists
ls ~/.claude/plugins/computer/moshi-env/bin/python

# Test Moshi standalone
source ~/.claude/plugins/computer/moshi-env/bin/activate
python -m moshi_mlx.local_web -q 4 --hf-repo kyutai/moshika-mlx-q4

# Check port conflict
lsof -i :8998

# Start via API
TOKEN=$(cat ~/.claude/plugins/computer/data/.auth-token)
curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/voice/moshi/start
```

### Ollama not available

```bash
ollama serve
ollama list                          # Check installed models
curl http://localhost:11434/api/tags # Verify API
```

### Voice not working

```bash
# Check voice status
TOKEN=$(cat ~/.claude/plugins/computer/data/.auth-token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/voice/status

# Verify both models are available
ollama list | grep -E "llama4|xLAM"
```

### Gmail OAuth issues

```bash
# Check Gmail status
curl -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/gateway/oauth/status

# Re-authorize
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3141/api/gateway/oauth/gmail/start
```

---

## File Structure

```
~/.claude/plugins/computer/
├── .claude-plugin/
│   └── plugin.json
├── package.json
├── README.md
├── .gitignore
│
├── commands/                          # 17 slash commands
│   ├── computer.md, analyze.md, search.md, transcribe.md
│   ├── status.md, compare.md, summarize.md, monitor.md
│   ├── log.md, brief.md, pipeline.md, know.md, export.md
│   └── channels.md, send.md, gateway.md, audit.md
│
├── agents/                            # 15 AI agents (Markdown + YAML frontmatter)
│   ├── analyst.md, researcher.md, visualizer.md
│   ├── transcription-processor.md, comparator.md, summarizer.md
│   ├── monitor.md, translator.md, explainer.md
│   ├── pipeline.md, knowledge.md
│   └── channels.md, automation.md, browser-agent.md, security-agent.md
│
├── skills/computer-operations/
│   └── SKILL.md
│
├── hooks/hooks.json                   # SessionStart auto-start
│
├── scripts/
│   ├── start.sh, status.sh
│   ├── start-moshi.sh                # Moshi sidecar launcher
│   ├── build-check.js, setup-vad-libs.js
│
├── moshi-env/                         # Python 3.12 venv for Moshi MLX (gitignored)
│
├── server/
│   ├── index.js                       # Express + WS + Moshi lifecycle
│   ├── middleware/
│   │   ├── auth.js                   # Bearer token auth
│   │   └── security.js               # Secret scanning + redaction
│   ├── routes/
│   │   ├── api.js                    # CRUD endpoints
│   │   ├── knowledge.js              # Vector knowledge base
│   │   ├── claude.js                 # Claude CLI proxy (SSE)
│   │   ├── transcribe.js            # Whisper STT
│   │   ├── tts.js                   # Coqui TTS
│   │   ├── media.js                 # Ollama vision analysis
│   │   ├── voice.js                 # Voice config + Moshi control
│   │   └── gateway-extras.js        # Sessions, agents, OAuth, inbox, nodes
│   ├── services/
│   │   ├── moshi.js                 # Moshi sidecar + WS bridge
│   │   ├── voice-assistant.js       # Dual-model (xLAM + Scout) + 25+ tools
│   │   ├── websocket.js             # Dual-mode audio routing + tool executor
│   │   ├── config.js                # JSON config management
│   │   ├── models.js                # Ollama model catalog
│   │   ├── sessions.js              # Voice session tracking
│   │   ├── agents.js                # Agent definitions (YAML frontmatter)
│   │   ├── vision.js                # Ollama vision analysis
│   │   ├── node-local.js            # Local machine node
│   │   ├── cron-scheduler.js        # Local cron scheduler
│   │   ├── plugins.js               # Tool/hook/plugin registry
│   │   ├── gmail.js                 # Gmail OAuth + API
│   │   ├── vectordb.js              # LanceDB
│   │   ├── embeddings.js            # Ollama embeddings
│   │   ├── chunking.js, search.js   # Knowledge base internals
│   │   ├── storage.js               # JSON file persistence
│   │   ├── transcription.js         # Whisper CLI
│   │   ├── tts.js                   # Coqui TTS queue
│   │   ├── claude-bridge.js         # Ollama LLM bridge
│   │   └── notifications.js         # macOS notifications
│   └── utils/
│       ├── helpers.js
│       └── sanitize.js
│
├── ui/
│   ├── index.html                     # SPA with 19 LCARS panels
│   ├── css/
│   │   ├── lcars.css                  # LCARS design system
│   │   └── components.css            # Panel styles + Moshi states
│   └── js/
│       ├── app.js                     # Bootstrap + WS routing
│       ├── components/               # 19 panel components
│       │   ├── dashboard-panel.js, command-input.js
│       │   ├── transcript-panel.js, analysis-panel.js
│       │   ├── chart-panel.js, knowledge-panel.js
│       │   ├── channels-panel.js, search-panel.js
│       │   ├── log-panel.js, monitor-panel.js, comparison-panel.js
│       │   ├── gateway-panel.js, plugins-panel.js
│       │   ├── cron-panel.js, browser-panel.js
│       │   ├── nodes-panel.js, security-panel.js
│       │   ├── voice-input.js, voice-assistant-ui.js
│       │   └── status-bar.js
│       ├── services/
│       │   ├── api-client.js          # REST client
│       │   ├── websocket-client.js    # WS + binary Moshi frames
│       │   ├── speech-service.js      # MediaRecorder capture
│       │   ├── audio-player.js        # TTS queue + Opus streaming
│       │   └── vad-service.js         # Silero VAD + Opus capture
│       └── utils/
│           └── formatters.js, lcars-helpers.js
│
└── data/                              # Runtime data (gitignored)
```

---

## License

MIT
