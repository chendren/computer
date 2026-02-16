# Computer — Star Trek Enterprise AI Agent

A Claude Code plugin that brings the USS Enterprise computer to life. Combines local AI capabilities with a locally-served LCARS-themed web interface for voice interaction, text analysis, data visualization, web search, monitoring, knowledge management, and conversational AI — all running on your machine with local vector search and dual-model local LLM inference via Ollama (Llama 4 Scout for conversation + xLAM for tool routing). Integrates with OpenClaw gateway for 21 messaging channels, browser automation, cron scheduling, multi-platform nodes, and plugin management.

![LCARS Interface](https://img.shields.io/badge/UI-LCARS%20Theme-FF9900?style=flat-square&labelColor=000000)
![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-CC99CC?style=flat-square&labelColor=000000)
![Node.js](https://img.shields.io/badge/Node.js-Express%20%2B%20WebSocket-9999FF?style=flat-square&labelColor=000000)
![LanceDB](https://img.shields.io/badge/Vector%20DB-LanceDB-55CC55?style=flat-square&labelColor=000000)
![Voice Assistant](https://img.shields.io/badge/Voice-Always%20Listening-CC4444?style=flat-square&labelColor=000000)
![Ollama](https://img.shields.io/badge/LLM-Llama%204%20Scout%20%2B%20xLAM%20via%20Ollama-66CCFF?style=flat-square&labelColor=000000)
![OpenClaw](https://img.shields.io/badge/Gateway-OpenClaw-FFCC00?style=flat-square&labelColor=000000)

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
  - [Gateway API](#gateway-api)
  - [WebSocket Events](#websocket-events)
- [OpenClaw Gateway Integration](#openclaw-gateway-integration)
  - [Gateway Architecture](#gateway-architecture)
  - [21 Messaging Channels](#21-messaging-channels)
  - [OAuth Integration](#oauth-integration)
  - [Inbox & Thread View](#inbox--thread-view)
  - [File Attachments](#file-attachments)
  - [Browser Automation](#browser-automation)
  - [Cron Scheduling](#cron-scheduling)
  - [Multi-Platform Nodes](#multi-platform-nodes)
  - [Plugin System](#plugin-system)
  - [Multi-Provider TTS/STT](#multi-provider-ttsstt)
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

Computer is a Claude Code plugin that functions as an AI assistant modeled after the Star Trek USS Enterprise computer. It runs a local Express + WebSocket server on port 3141, serving an LCARS-themed single-page application with 19 panels covering voice transcription, AI analysis, data visualization, web search, monitoring, knowledge management, 21 messaging channels, browser automation, cron scheduling, multi-platform node management, plugin management, and security auditing.

When the OpenClaw gateway is available, Computer manages it as a supervised subprocess on port 18789, connecting via WebSocket RPC to access all 21 messaging channels, browser automation, cron scheduling, multi-platform nodes, and plugin infrastructure.

**Key design principles:**
- Fully local: Voice transcription via Whisper, text-to-speech via Coqui TTS, dual-model LLM inference via Ollama (Llama 4 Scout for conversation + xLAM for tool routing), embeddings via Ollama — no external APIs required
- Gateway-enhanced: OpenClaw integration adds 21 channels, browser automation, cron, nodes, and advanced TTS/STT providers (ElevenLabs, Deepgram, Google) with local fallback
- Vector-powered knowledge: LanceDB with nomic-embed-text (768-dim) for semantic search with 6 chunking strategies and 6 search methods
- Real-time: WebSocket pushes data to the browser instantly as commands complete
- Vanilla JS: No build step, no framework — ES modules served directly by Express
- Smart voice routing: Spoken commands auto-detect intent and route to the correct slash command
- LCARS aesthetic: Authentic Star Trek computer interface with the signature orange/lavender/blue color palette

---

## Features

### Always-Listening Voice Assistant
- **Wake word activation** — Say "Computer" (or "Hey Computer") followed by a command. Always-on listening via browser microphone with Silero VAD (Voice Activity Detection) running in-browser via ONNX Runtime WebAssembly
- **Dual-model tool use** — Voice commands are routed by xLAM 8B (Salesforce Large Action Model) for deterministic tool selection, then Llama 4 Scout generates conversational responses. 16 tools including web search, charts, panels, knowledge, and more. Zero API cost — runs entirely on your machine
- **Speech-to-speech** — Full pipeline: VAD detects speech → Whisper STT transcribes → wake word detection → xLAM routes tools → Llama 4 Scout generates response → Coqui TTS speaks response → audio plays in browser
- **Interruption support** — Speak during TTS playback to interrupt and issue a new command. VAD pauses during playback to prevent feedback loops
- **Visual state indicator** — Diamond button in title bar with color-coded states: amber pulse (listening), bright amber (capturing), red pulse (thinking), green pulse (speaking)
- **16 voice tools** — search_knowledge, store_knowledge, create_log, display_on_screen, send_message, list_channels, get_status, search_transcripts, create_monitor, get_briefing, generate_chart, browse_url, analyze_text, web_search, web_fetch, web_search_and_read
- **Auto-search for live data** — Queries about prices, weather, stocks, news, or any current data automatically trigger a real web search before the LLM responds, injecting actual page content to prevent hallucination. Uses DuckDuckGo search + Instant Answers API + auto-fetch of top result pages
- **Date-aware** — System prompt includes current date/time for accurate time-relative queries ("last week", "past 3 days")
- **Session memory** — Per-WebSocket conversation history (20 turns, 30min TTL) for multi-turn voice interactions

### Voice Input & Output (Manual Mode)
- **Real-time speech-to-text** — Browser records 3-second audio chunks via MediaRecorder, sends them over WebSocket as binary frames, server transcribes each chunk locally using OpenAI Whisper (`tiny` model for low latency)
- **File-based transcription** — Upload audio files (mp3, wav, m4a, ogg, flac, webm, mp4) for full transcription using Whisper (`base` model for accuracy)
- **Multi-provider TTS** — Gateway-first provider cascade (ElevenLabs, OpenAI, Google TTS) with local Coqui TTS fallback
- **Multi-provider STT** — Gateway-first provider cascade (Deepgram, Google Speech) with local Whisper fallback
- **Smart voice routing** — When you stop the microphone, speech is analyzed for command intent and a green badge indicates the detected route

### 21 Messaging Channels
- **Full channel support** — Discord, Slack, Telegram, IRC, Matrix, WhatsApp, Signal, Email/Gmail, Teams, Twitch, Messenger, LINE, Mastodon, Bluesky, XMPP, SMS, Webhook, REST, CLI, Nostr, WeChat
- **Channel-specific compose** — Per-channel character limits, format badges (markdown, mrkdwn, html, plain, json), capability indicators (media, threads, reactions, embeds, buttons, stickers)
- **OAuth integration** — Gmail, Microsoft Teams, Twitch, Facebook, Mastodon — authorize directly from LCARS config panel
- **File attachments** — Attach files (up to 25MB) on any media-capable channel with image thumbnail preview
- **Inbox view** — Read email and threaded messages with folder navigation, pagination, and full thread expansion
- **Thread replies** — Reply within threads on Discord, Slack, Matrix, Teams, and email

### AI Analysis
- **Sentiment analysis** — Overall tone classification with confidence score and percentage breakdown bar
- **Topic extraction** — 3-7 key themes with relevance scores, displayed as color-coded LCARS tags
- **Action items** — Extracted with priority levels (high/medium/low)
- **Entity recognition** — People, organizations, locations, dates, and technical terms
- **Summary generation** — Concise 2-3 sentence summaries
- **Media analysis** — Upload images/video for AI-powered analysis via gateway vision models
- **Text submission form** — Textarea + Analyze button for manual analysis input
- **Structured JSON output** — Analysis runs through Llama 4 Scout with structured JSON output (`response_format: json_object`)

### Interactive Panels
- **Captain's Log input form** — Textarea + category selector + Record Log button with auto-generated TNG-style stardates
- **Monitor creation form** — Name + URL inputs + Create Monitor button
- **Comparison submission form** — Side-by-side two textareas + name fields + Compare button; comparisons run through Llama 4 Scout LLM producing verdict, similarity score, differences, similarities, recommendation
- **Transcript controls** — Analyze button per entry, Save Session and Clear buttons
- **Search panel linkification** — URL linkification uses string scanning (no regex, per project policy)

### Vector Knowledge Base
- **LanceDB vector storage** — Local vector database with nomic-embed-text embeddings (768 dimensions) via Ollama
- **6 chunking strategies** — Fixed-size, sentence, paragraph, sliding window, semantic (embedding similarity), recursive (hierarchical by headers/paragraphs/sentences)
- **6 search methods** — Vector similarity, BM25 keyword, hybrid (vector+keyword weighted), metadata filtering, MMR (diversity-promoting), multi-query with Reciprocal Rank Fusion

### Data Visualization
- **Chart.js v4 integration** — Dynamic charts rendered with LCARS-themed colors
- **Multiple chart types** — Doughnut, bar, line, radar, pie, polar area, scatter

### Gateway Operations
- **Browser automation** — Navigate URLs, capture screenshots, extract content via gateway browser control
- **Cron scheduling** — Create, list, pause, resume scheduled jobs with event log
- **Multi-platform nodes** — Manage connected devices (macOS, iOS, Android) with remote camera/screen capture
- **Plugin management** — View installed plugins, hooks, and tools with enable/disable controls
- **Session management** — View active sessions across channels with conversation history, token usage, and cost tracking

### Monitoring & Logging
- **Monitor panel** — Active monitor cards with status dots, check history, conditions display (URLs, files, processes, channels, gateway, nodes)
- **Captain's Log** — Stardate-formatted log entries with categories and color-coded tags
- **Security panel** — Shield gauge with security score, redaction stats, pattern coverage summary

### Dashboard
- **Bridge console** — System stats overview, gateway status (warp core indicator), channel activity, active sessions, cron jobs, knowledge base size, security score, node count, recent alerts

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Claude Code CLI Session                    │
│                                                               │
│  /computer:analyze "text"    /computer:channels               │
│  /computer:know "remember"   /computer:send "hello"           │
│  /computer:gateway           /computer:audit                  │
│          │                          │                         │
│          ▼                          ▼                         │
│   Write JSON to /tmp    ──►   curl POST to localhost:3141     │
└─────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────┐
│              Express + WebSocket Server (:3141)               │
│                                                               │
│  Security Middleware         WebSocket Server                  │
│  ├── Bearer token auth       ├── Binary frames → Whisper STT  │
│  ├── Scans POST/PUT/PATCH   ├── Voice protocol (16 tools)    │
│  ├── 26 secret patterns     ├── xLAM routing + Llama 4 Scout    │
│  ├── Sensitive field names   ├── Web search + auto-fetch           │
│  └── Redacts → [REDACTED]   └── Heartbeat every 30s          │
│                                                               │
│  REST API                    Services                         │
│  ├── /api/knowledge/*        ├── gateway-manager.js           │
│  ├── /api/transcribe/*       ├── gateway-client.js (WS RPC)  │
│  ├── /api/tts/*              ├── config-bridge.js             │
│  ├── /api/claude/*           ├── vectordb.js → LanceDB        │
│  ├── /api/media/*            ├── embeddings.js → Ollama       │
│  ├── /api/voice/*            ├── voice-assistant.js → Dual-model (xLAM + Scout)   │
│  ├── /api/gateway/*          ├── storage.js → JSON files      │
│  │   ├── status, restart     ├── transcription.js → Whisper   │
│  │   ├── channels, send      ├── tts.js → Coqui TTS          │
│  │   ├── sessions, agents    ├── notifications.js → macOS     │
│  │   ├── nodes, models       └── websocket.js → Client mgmt  │
│  │   ├── plugins, hooks                                       │
│  │   ├── cron, tools                                          │
│  │   ├── oauth (start/cb)                                     │
│  │   └── inbox, threads                                       │
│  └── /api/security/*                                          │
│               │ WebSocket client                              │
└───────────────┼──────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────────────────────────────────┐
│          OpenClaw Gateway (supervised subprocess)              │
│  Port 18789 — 21 channels, agents, plugins, cron,            │
│  browser, nodes, sessions, tools, media, OAuth                │
│  Managed lifecycle: start/stop/restart/health                 │
└──────────────────────────────────────────────────────────────┘
                                      │
                              WebSocket broadcast
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────┐
│                    LCARS Web UI (Browser)                      │
│                                                                │
│  ┌──────────────┐  ┌────────────────────────────────────────┐ │
│  │ Sidebar      │  │  Active Panel (19 panels)               │ │
│  │              │  │                                          │ │
│  │ ── Core ──   │  │  Dashboard: Bridge console + gateway    │ │
│  │ [Dashboard]  │  │  Main: Chat with Claude via SSE         │ │
│  │ [Main]       │  │  Transcript: Live STT + file upload     │ │
│  │ [Transcript] │  │  Analysis: Sentiment, topics, entities  │ │
│  │ [Analysis]   │  │  Charts: Chart.js visualizations        │ │
│  │ [Knowledge]  │  │  Knowledge: Vector search + stats       │ │
│  │              │  │                                          │ │
│  │ ── Comms ──  │  │  Channels: 21-channel compose + inbox   │ │
│  │ [Channels]   │  │  Search: Web search results             │ │
│  │ [Search]     │  │  Log: Captain's log with stardates      │ │
│  │ [Log]        │  │  Monitor: Active monitors + status      │ │
│  │ [Monitor]    │  │  Compare: Side-by-side diffs            │ │
│  │ [Compare]    │  │                                          │ │
│  │              │  │                                          │ │
│  │ ── Ops ──    │  │  Gateway: Sessions, agents, models      │ │
│  │ [Gateway]    │  │  Plugins: Plugin/hook/tool registry     │ │
│  │ [Plugins]    │  │  Cron: Scheduled jobs + event log       │ │
│  │ [Cron]       │  │  Browser: URL bar + viewport            │ │
│  │ [Browser]    │  │  Nodes: Device grid + camera/screen     │ │
│  │ [Nodes]      │  │  Security: Shield gauge + audit         │ │
│  │ [Security]   │  │                                          │ │
│  └──────────────┘  └────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Status Bar: Connection | Gateway | Uptime | Activity      │ │
│  └──────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
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

### Optional

| Tool | Purpose | Install |
|------|---------|---------|
| **Llama 4 Scout** | Voice assistant LLM (conversation + analysis) | `ollama pull llama4:scout` |
| **xLAM 8B F16** | Voice assistant tool routing | `ollama pull hf.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf:F16` |
| **OpenAI Whisper** | Local speech-to-text | `pip install openai-whisper` |
| **Coqui TTS** | Local text-to-speech | `pip install TTS` |
| **FFmpeg** | Audio format conversion | `brew install ffmpeg` |
| **OpenClaw (clawdbot)** | 21-channel gateway + browser + cron | `git clone` + `pnpm build` in `~/clawdbot/` |

Whisper is expected at `/opt/homebrew/bin/whisper` (or `WHISPER_PATH` env var) and TTS at `/opt/homebrew/bin/tts` (or `TTS_PATH` env var). OpenClaw gateway is optional — Computer degrades gracefully without it. The voice assistant requires Ollama running with both Llama 4 Scout (for conversation and analysis) and xLAM 8B F16 (for tool routing).

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
ollama serve &
ollama pull nomic-embed-text
ollama pull llama4:scout
ollama pull hf.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf:F16
```

### 4. (Optional) Set up OpenClaw gateway

```bash
git clone https://github.com/openclaw/clawdbot.git ~/clawdbot
cd ~/clawdbot && pnpm install && pnpm build
```

The build-check script (`scripts/build-check.js`) verifies `~/clawdbot/dist/index.js` exists on startup. If found, the gateway is auto-started as a supervised subprocess.

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
      "version": "2.0.0",
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

Start a new Claude Code session. The SessionStart hook will auto-start the server. Open [http://localhost:3141](http://localhost:3141) in your browser.

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
| `/computer:status` | System diagnostics + gateway status |
| `/computer:compare <items>` | Side-by-side comparison of files/text |
| `/computer:summarize <text>` | Multi-level document summarization |
| `/computer:monitor <target>` | Set up watches on URLs/files/processes/channels/nodes |
| `/computer:log <entry>` | Captain's log entries |
| `/computer:brief` | Activity briefing and status report |
| `/computer:pipeline <operations>` | Chain operations (including cross-channel) |
| `/computer:know <query-or-fact>` | Store, retrieve, or search knowledge base |
| `/computer:export [format] [timeframe]` | Generate formatted reports |
| `/computer:channels` | List all 21 messaging channels with status |
| `/computer:send <channel> <target> <message>` | Send message to any channel |
| `/computer:gateway` | Gateway status, sessions, agents, models |
| `/computer:audit` | Security audit across Computer + gateway |

### Web UI Panels

The LCARS interface has 19 panels organized in three groups:

#### Core
| Panel | Purpose |
|-------|---------|
| **Dashboard** | Bridge console — system stats, gateway status, channel activity, security score |
| **Main** | Chat input, streaming Claude responses, command history |
| **Transcript** | Mic toggle, file upload, timestamped transcript entries |
| **Analysis** | Collapsible raw input, sentiment bar, topic tags, entities, action items |
| **Charts** | Chart.js renders with LCARS colors, chart history |
| **Knowledge** | Vector search with method selection, metadata filters, tabbed views |

#### Comms
| Panel | Purpose |
|-------|---------|
| **Channels** | 21-channel grid with compose, inbox, threads, OAuth, attachments |
| **Search** | Web search results with clickable links |
| **Log** | Captain's log with stardates, categories, color-coded tags |
| **Monitor** | Active monitors with status dots, check history, conditions |
| **Compare** | Side-by-side comparison with similarity bars, diff grids |

#### Ops
| Panel | Purpose |
|-------|---------|
| **Gateway** | Tabbed: Overview / Sessions (history+cost+reset) / Agents / Models |
| **Plugins** | Tabbed: Plugins / Hooks / Tools — full registry view |
| **Cron** | Job grid with schedule display, event log |
| **Browser** | URL bar + viewport with screenshots and content extraction |
| **Nodes** | Device grid with platform icons, camera/screen capture |
| **Security** | Shield gauge, redaction stats, audit findings |

### Voice Interaction

#### Always-Listening Mode (Recommended)

1. Open the LCARS UI in your browser
2. Click the **diamond button** (◆) in the title bar — it pulses amber
3. Say **"Computer, what is the system status?"** — the button turns bright amber (capturing), then red (thinking)
4. The Computer speaks the response — button turns green (speaking)
5. After the response finishes, it returns to amber (listening) for the next command
6. Click the button again to deactivate

**Voice command flow:**
```
[Always-on mic] → [Silero VAD detects speech] → [Whisper STT transcribes]
  → [Client checks for "Computer" wake word] → [xLAM routes tools → Llama 4 Scout generates response]
  → [Tool execution (web search, charts, panels, etc.)]
  → [Coqui TTS generates audio] → [Browser plays response]
  → [Return to listening]
```

**Interruption:** Speak during TTS playback to stop it and issue a new command.

#### Manual Mode (Transcript Panel)

1. Open the Transcript panel in the browser
2. Click **Start Listening** — the browser requests microphone access
3. Speak naturally — audio is recorded in 3-second chunks
4. Each chunk is sent as a binary WebSocket frame to the server
5. The server transcribes each chunk using Whisper (`tiny` model, ~1s on Apple Silicon)
6. Transcribed text appears in the transcript panel in real time
7. Click **Stop Listening** — accumulated text is analyzed for command intent

#### Computer Speaking Back (TTS)

- **Gateway TTS (preferred)** — ElevenLabs, OpenAI, Google Cloud TTS via gateway
- **Local Coqui TTS (fallback)** — `tts_models/en/ljspeech/vits` — fast English model with ~0.2s generation time
- Voice assistant responses are always spoken; manual mode responses under 200 characters are spoken

### Smart Voice Routing

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
  "gateway": {
    "enabled": true,
    "running": true,
    "connected": true,
    "pid": 12345,
    "port": 18789,
    "uptime": 3600
  }
}
```

#### Data Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | /api/transcripts | Transcripts |
| GET/POST | /api/analyses | Analyses (+ desktop notification) |
| POST | /api/charts | Chart.js visualizations |
| POST | /api/search-results | Search results |
| GET/POST | /api/logs | Captain's log entries |
| GET/POST | /api/monitors | Monitor status tracking |
| GET/POST | /api/comparisons | Side-by-side comparisons |

#### TTS (with provider cascade)

```
POST /api/tts/speak          # Generate speech (gateway first, Coqui fallback)
GET  /api/tts/audio/:file    # Serve generated WAV file
GET  /api/tts/providers      # List available TTS providers
GET  /api/tts/voices         # List available voices
```

#### STT (with provider cascade)

```
POST /api/transcribe/file    # Transcribe audio (gateway first, Whisper fallback)
GET  /api/transcribe/providers  # List available STT providers
```

#### Media Analysis

```
POST /api/media/analyze      # Upload image/video for AI analysis via gateway
```

### Knowledge Base API

See [Vector Knowledge Base](#vector-knowledge-base) section for full API documentation.

### Gateway API

All gateway endpoints are at `/api/gateway/`.

#### Gateway Management

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/gateway/status | Connection health, uptime, config |
| POST | /api/gateway/restart | Restart gateway subprocess |
| POST | /api/gateway/rpc | Arbitrary gateway RPC call |

#### Channels

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/gateway/channels | All channels with connection status |
| POST | /api/gateway/send | Send message (channel, target, text, subject, attachments, threadId) |
| GET | /api/gateway/channel-config | Channel configuration |
| POST | /api/gateway/channel-config/:id | Update channel config |
| GET | /api/gateway/channels/:id/inbox | Inbox messages (limit, offset, folder) |
| GET | /api/gateway/channels/:id/threads/:threadId | Thread messages |
| GET | /api/gateway/channels/:id/folders | Available folders |

#### OAuth

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/gateway/oauth/status | All provider authorization status |
| POST | /api/gateway/oauth/:provider/start | Start OAuth flow (returns authUrl) |
| GET | /api/gateway/oauth/:provider/callback | OAuth callback (auto-closes window) |
| POST | /api/gateway/oauth/:provider/revoke | Revoke authorization |

#### Sessions

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/gateway/sessions | Active sessions list |
| GET | /api/gateway/sessions/:key/history | Conversation history |
| GET | /api/gateway/sessions/:key/cost | Token/cost usage |
| POST | /api/gateway/sessions/:key/reset | Reset a session |

#### Agents, Models, Nodes, Plugins, Cron

| Method | Path | Purpose |
|--------|------|---------|
| GET | /api/gateway/agents | Agent list |
| GET | /api/gateway/agents/:id | Agent details |
| POST | /api/gateway/agents/:id/configure | Configure agent |
| GET | /api/gateway/models | Model catalog |
| GET | /api/gateway/nodes | Connected devices |
| POST | /api/gateway/nodes/:id/camera | Capture camera image |
| POST | /api/gateway/nodes/:id/screen | Capture screenshot |
| POST | /api/gateway/nodes/:id/execute | Execute command on node |
| GET | /api/gateway/plugins | Plugin list |
| GET | /api/gateway/hooks | Hook registry |
| GET | /api/gateway/tools | Tool registry |
| GET | /api/gateway/cron | Cron job list |

### WebSocket Events

Connect to `ws://localhost:3141`. All events use JSON format: `{ "type": "<event>", "data": {...} }`.

#### Server → Client Events

| Event | Trigger | Data Shape |
|-------|---------|------------|
| `status` | Connection, status updates | `{ message, connected?, speak? }` |
| `transcript` | New transcript saved | `{ id, timestamp, source, text }` |
| `analysis` | New analysis saved | `{ id, summary, sentiment, topics }` |
| `chart` | Chart data posted | Chart.js config object |
| `search` | Search results posted | `{ query, summary, results }` |
| `log` | Captain's log entry | `{ id, entry, category, stardate, tags }` |
| `monitor` | Monitor status update | `{ id, name, status, target, lastCheck }` |
| `comparison` | Comparison result | `{ id, subjects, diffs, verdict }` |
| `knowledge` | Knowledge entry ingested | `{ id, title, chunk_count }` |
| `stt_result` | Audio chunk transcribed | `{ text }` |
| `voice_thinking` | Voice assistant processing | `{}` |
| `voice_response` | Voice assistant response | `{ text, audioUrl, toolsUsed, panelSwitch }` |
| `voice_done` | Voice turn complete | `{}` |
| `voice_error` | Voice processing error | `{ error }` |
| `voice_panel_switch` | Voice-triggered panel switch | `{ panel }` |
| `channel_message` | Message on any channel | `{ channel, from, text, timestamp }` |
| `gateway_status` | Gateway connection change | `{ connected }` |
| `gateway_presence` | Gateway presence update | `{ nodes, sessions }` |

---

## OpenClaw Gateway Integration

### Gateway Architecture

Computer manages the OpenClaw gateway as a supervised child process:

- **`gateway-manager.js`** — Starts `node ~/clawdbot/dist/index.js gateway` with stdio piped, auto-restart on crash with exponential backoff, log forwarding
- **`gateway-client.js`** — WebSocket client connecting to port 18789 with authenticated RPC calls, event subscription, and reconnect with exponential backoff
- **`config-bridge.js`** — Reads/writes clawdbot configuration, watches for external changes
- **`build-check.js`** — Pre-start verification that `~/clawdbot/dist/index.js` exists

### 21 Messaging Channels

Every channel runs through the same gateway RPC (`send`) — Computer has zero channel-specific connection code:

| Channel | Max Length | Format | Capabilities |
|---------|-----------|--------|-------------|
| Discord | 2,000 | markdown | embeds, reactions, threads, media |
| Slack | 40,000 | mrkdwn | blocks, threads, reactions, media |
| Telegram | 4,096 | markdown | buttons, media, stickers |
| IRC | 512 | plain | — |
| Matrix | 65,536 | html | reactions, threads, media |
| WhatsApp | 65,536 | plain | media, buttons, templates |
| Signal | 8,000 | plain | media, reactions |
| Email/Gmail | 1,000,000 | html | subject, html, attachments, threads, media |
| Teams | 28,000 | html | cards, reactions, media |
| Twitch | 500 | plain | — |
| Messenger | 2,000 | plain | media, buttons |
| LINE | 5,000 | plain | media, stickers |
| Mastodon | 500 | plain | media |
| Bluesky | 300 | plain | media |
| XMPP | 65,536 | plain | media |
| SMS | 1,600 | plain | media |
| Webhook | 1,000,000 | json | json |
| REST | 1,000,000 | json | json |
| CLI | 1,000,000 | plain | — |
| Nostr | 65,536 | plain | — |
| WeChat | 2,048 | plain | media |

### OAuth Integration

Channels requiring OAuth authorization (Gmail, Teams, Twitch, Facebook, Mastodon) can be authorized directly from the LCARS Channels panel:

1. Select the channel → click **Configure**
2. Click **Authorize [provider]** — opens a popup window
3. Complete the OAuth flow in the popup
4. Window auto-closes, LCARS polls for completion and updates the UI
5. Channel card shows **AUTH** badge when authorized

### Inbox & Thread View

For channels with threads or subject support (Email, Discord, Slack, Matrix, Teams):

1. Select the channel → click the **Inbox** tab
2. Browse messages by folder (Inbox, Sent, Drafts, etc.)
3. Click a message to open the **Thread** view with full conversation
4. Reply from within the thread — message is sent with the thread ID for proper threading

### File Attachments

For channels with media support (16 of 21 channels):

1. Click **Attach** in the compose area
2. Select files (multiple allowed, 25MB limit per file)
3. Image attachments show thumbnail preview, other files show file icon
4. Remove individual attachments with the × button
5. Files are sent as base64 in the gateway payload

### Browser Automation

The Browser panel provides remote web browsing via the gateway:

- URL bar with navigate button
- Live screenshot viewport
- Content extraction (text mode)
- Tab management

### Cron Scheduling

The Cron panel manages scheduled jobs:

- Job grid with name, cron expression, status
- Real-time event log showing job executions
- Pause/resume controls

### Multi-Platform Nodes

The Nodes panel manages connected devices:

- Device grid with platform icons (macOS, iOS, Android)
- Capability badges (camera, screen, etc.)
- Camera capture button with live image display
- Screen capture button with screenshot display

### Plugin System

The Plugins panel shows the gateway's plugin registry:

- **Plugins tab** — Installed plugins with status badges, hook/tool counts
- **Hooks tab** — All registered hooks with source plugin and priority
- **Tools tab** — Available tools with descriptions and source plugins

### Multi-Provider TTS/STT

Both TTS and STT use a provider cascade:

1. **Try gateway first** — ElevenLabs, OpenAI, or Google Cloud (better quality, more voices)
2. **Fall back to local** — Coqui TTS or Whisper STT (always available, no API needed)

The `/api/tts/providers` and `/api/transcribe/providers` endpoints list all available providers with their source (local vs. gateway).

---

## Server Components

### Middleware

| File | Purpose |
|------|---------|
| `server/middleware/auth.js` | Bearer token authentication — auto-generated 256-bit token, required on all /api/* routes |
| `server/middleware/security.js` | Secret redaction: 26 detection patterns + sensitive field name detection |

### Routes

| File | Purpose |
|------|---------|
| `server/routes/api.js` | CRUD for transcripts, analyses, sessions, logs, monitors, comparisons |
| `server/routes/knowledge.js` | Knowledge base: ingest, search, bulk, stats, delete |
| `server/routes/claude.js` | Claude CLI proxy with SSE streaming |
| `server/routes/transcribe.js` | Audio transcription with gateway-first STT cascade |
| `server/routes/tts.js` | Text-to-speech with gateway-first TTS cascade |
| `server/routes/media.js` | Media upload + AI analysis via gateway vision models |
| `server/routes/voice.js` | Voice assistant config/status endpoints |
| `server/routes/gateway-extras.js` | Sessions, agents, hooks, tools, nodes, OAuth, inbox/threads, channel config, TTS/STT providers |

### Services

| File | Purpose |
|------|---------|
| `server/services/gateway-manager.js` | Supervised clawdbot subprocess: start, stop, restart, health |
| `server/services/gateway-client.js` | WebSocket RPC client: `callGateway(method, params)`, event forwarding |
| `server/services/config-bridge.js` | Read/write clawdbot config, watch for changes |
| `server/services/vectordb.js` | LanceDB connection management, two-table schema |
| `server/services/embeddings.js` | Ollama nomic-embed-text wrapper with batch pool |
| `server/services/chunking.js` | 6 chunking strategies |
| `server/services/search.js` | 6 search methods (vector, BM25, hybrid, MMR, RRF) |
| `server/services/storage.js` | JSON file persistence |
| `server/services/transcription.js` | Whisper CLI wrapper |
| `server/services/tts.js` | Coqui TTS with sequential queue |
| `server/services/claude-bridge.js` | LLM bridge — routes queries to Llama 4 Scout via Ollama |
| `server/services/voice-assistant.js` | Dual-model: xLAM F16 for tool routing + Llama 4 Scout for responses, 16 tools, auto-search, model keep-alive, per-session conversation history |
| `server/services/websocket.js` | WebSocket manager with binary audio, voice protocol, tool executor |
| `server/services/notifications.js` | macOS desktop notifications via osascript |

---

## UI Components

### JavaScript Modules

All UI code is vanilla JavaScript using ES module imports. No build step required.

#### Panel Components (19 panels)

| File | Purpose |
|------|---------|
| `dashboard-panel.js` | Bridge console: system stats, gateway status, security score |
| `command-input.js` | Chat interface with Claude streaming, smart voice routing |
| `transcript-panel.js` | Timestamped transcript display with live interim text |
| `analysis-panel.js` | Sentiment bars, topic tags, entities, action items |
| `chart-panel.js` | Chart.js renderer with history |
| `knowledge-panel.js` | Vector search UI: method dropdown, metadata filters |
| `channels-panel.js` | 21-channel compose, OAuth, attachments, inbox, threads |
| `search-panel.js` | Search results with clickable links |
| `log-panel.js` | Captain's log with stardates and categories |
| `monitor-panel.js` | Monitor cards with status dots and check history |
| `comparison-panel.js` | Side-by-side diffs with similarity bars |
| `gateway-panel.js` | Tabbed: Overview / Sessions / Agents / Models |
| `plugins-panel.js` | Tabbed: Plugins / Hooks / Tools registry |
| `cron-panel.js` | Job grid with event log |
| `browser-panel.js` | URL bar + viewport with screenshots |
| `nodes-panel.js` | Device grid with camera/screen capture |
| `security-panel.js` | Shield gauge + redaction stats |
| `voice-input.js` | Mic toggle, file upload, voice-to-command |
| `status-bar.js` | Connection/uptime/activity indicators |

#### Services

| File | Purpose |
|------|---------|
| `api-client.js` | REST client: `get()`, `post()`, `delete()`, `uploadFile()`, `queryClaudeStream()` |
| `websocket-client.js` | WebSocket with auto-reconnect, binary send, event dispatch |
| `speech-service.js` | MediaRecorder → WebSocket → Whisper STT pipeline |
| `audio-player.js` | Queue-based TTS audio playback with interrupt support |
| `vad-service.js` | Silero VAD wrapper: mic access, speech detection, Float32→WAV conversion |

#### Voice Assistant Component

| File | Purpose |
|------|---------|
| `voice-assistant-ui.js` | State machine: IDLE → LISTENING → CAPTURING → PROCESSING → THINKING → SPEAKING. Wake word detection, VAD orchestration, WS protocol |

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

---

## Plugin Components

### Commands (17)

| File | Invoke As | Purpose |
|------|-----------|---------|
| `computer.md` | `/computer:computer` | Start/stop the LCARS server |
| `analyze.md` | `/computer:analyze` | AI text analysis |
| `search.md` | `/computer:search` | Web search with UI push |
| `transcribe.md` | `/computer:transcribe` | Whisper audio transcription |
| `status.md` | `/computer:status` | System diagnostics + gateway |
| `compare.md` | `/computer:compare` | Side-by-side comparison |
| `summarize.md` | `/computer:summarize` | Multi-level summarization |
| `monitor.md` | `/computer:monitor` | Set up watches |
| `log.md` | `/computer:log` | Captain's log entries |
| `brief.md` | `/computer:brief` | Activity briefing |
| `pipeline.md` | `/computer:pipeline` | Chain operations (cross-channel) |
| `know.md` | `/computer:know` | Knowledge base (vector search) |
| `export.md` | `/computer:export` | Generate reports |
| `channels.md` | `/computer:channels` | List channels with status |
| `send.md` | `/computer:send` | Cross-channel messaging |
| `gateway.md` | `/computer:gateway` | Gateway management |
| `audit.md` | `/computer:audit` | Security audit |

### Agents (15)

| File | Model | Purpose |
|------|-------|---------|
| `analyst.md` | Opus | Sentiment, topics, action items, summaries, entity extraction |
| `researcher.md` | Sonnet | Web research, source evaluation, information synthesis |
| `visualizer.md` | Sonnet | Chart.js v4 config generation with LCARS color theming |
| `transcription-processor.md` | Sonnet | Transcript cleanup, speaker detection, segmentation |
| `comparator.md` | Opus | Side-by-side comparison with radar charts |
| `summarizer.md` | Opus | Multi-level summarization (executive → detailed) |
| `monitor.md` | Sonnet | Monitor URLs, files, processes, channels, gateway, nodes |
| `translator.md` | Sonnet | Multi-language translation with cultural context |
| `explainer.md` | Opus | Layered explanations (ELI5 → deep dive) |
| `pipeline.md` | Opus | Cross-channel workflow orchestration |
| `knowledge.md` | Opus | Persistent knowledge store, retrieve, synthesize |
| `channels.md` | Sonnet | Multi-channel messaging, compose, format for constraints |
| `automation.md` | Opus | Cron + pipeline orchestration across channels and tools |
| `browser-agent.md` | Sonnet | Web automation: navigate, screenshot, extract, interact |
| `security-agent.md` | Sonnet | Security audits, analysis, remediation |

### Skills

**`SKILL.md` (v3.0)** — Triggers when the conversation mentions "Computer", "LCARS", "knowledge", "channels", "gateway", etc. Provides operational knowledge about all 17 commands, 15 agents, 19 UI panels, and API endpoints.

### Hooks

**SessionStart hook:** Runs `scripts/status.sh` to auto-start the server and gateway on session begin.

---

## Vector Knowledge Base

The knowledge base uses LanceDB for local vector storage with Ollama nomic-embed-text embeddings (768 dimensions).

### Chunking Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| `fixed` | N-character chunks with configurable overlap | Uniform chunk sizes |
| `sentence` | Split on sentence boundaries, group N sentences | Short facts |
| `paragraph` | Split on double newlines (default) | Medium documents |
| `sliding` | Fixed window with configurable step size | Overlapping context |
| `semantic` | Split when cosine similarity drops below threshold | Topic-shifting content |
| `recursive` | Split by headers → paragraphs → sentences | Long documents with sections |

### Search Methods

| Method | Description | Use Case |
|--------|-------------|----------|
| `vector` | Cosine similarity nearest neighbors | Pure semantic search |
| `keyword` | BM25-style TF-IDF scoring | Exact term matching |
| `hybrid` | Combined vector + keyword (default) | Best general-purpose |
| `mmr` | Maximal Marginal Relevance | Avoid redundant results |
| `multi_query` | Query variations + Reciprocal Rank Fusion | Complex queries |

### Knowledge API Examples

```bash
# Store a fact
curl -X POST http://localhost:3141/api/knowledge \
  -H 'Content-Type: application/json' \
  -d '{"text":"The Enterprise uses dilithium crystals","source":"user","tags":["engineering"]}'

# Semantic search
curl -X POST http://localhost:3141/api/knowledge/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"how does warp drive work","method":"hybrid","limit":5}'

# Get statistics
curl http://localhost:3141/api/knowledge/stats
```

---

## Security

A three-layer failsafe prevents secrets from leaking through the API, UI, or gateway.

### Server-Side Redaction Middleware

Express middleware intercepts every POST/PUT/PATCH request. 26 detection patterns cover: AI API keys (OpenAI, Anthropic), cloud credentials (AWS, Google), source control (GitHub PATs), payment (Stripe), communication (Slack, Discord, SendGrid, Twilio), infrastructure (Vercel, DigitalOcean, Heroku), authentication (JWT, Bearer, private keys), and databases (connection strings).

### Agent System Prompt Hardening

All 15 agent system prompts include a mandatory `SECURITY DIRECTIVE`: never output tokens, API keys, passwords, or credentials. Redact with `[REDACTED]` before including in any output.

### Gateway Security

When the gateway is connected, clawdbot's additional redaction patterns are merged for outbound scanning. The Security panel shows combined findings from both Computer and gateway security audits.

### Security Stats Endpoint

```
GET /api/security/stats
```

Returns redaction audit data with total count, recent redactions, and pattern coverage.

---

## Data Storage

```
data/
├── vectordb/            # LanceDB vector database
├── transcripts/         # One JSON file per transcript
├── analyses/            # One JSON file per analysis
├── sessions/            # One JSON file per session
├── logs/                # One JSON file per captain's log entry
├── monitors/            # One JSON file per monitor config
├── comparisons/         # One JSON file per comparison result
├── knowledge/           # Legacy JSON (auto-migrated to vectordb)
├── server.pid           # PID of running server process
└── server.log           # Server stdout/stderr log
```

---

## Configuration

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `COMPUTER_PORT` | `3141` | Server port |
| `VOICE_MODEL` | `llama4:scout` | Ollama model for voice assistant (conversation + analysis) |
| `ACTION_MODEL` | `hf.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf:F16` | Ollama model for tool routing |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API base URL |
| `WHISPER_PATH` | `/opt/homebrew/bin/whisper` | Path to Whisper binary |
| `TTS_PATH` | `/opt/homebrew/bin/tts` | Path to Coqui TTS binary |

### Hardcoded Paths

| Constant | File | Default |
|----------|------|---------|
| `WHISPER_PATH` | `server/services/transcription.js` | `$WHISPER_PATH` or `/opt/homebrew/bin/whisper` |
| `TTS_PATH` | `server/services/tts.js` | `$TTS_PATH` or `/opt/homebrew/bin/tts` |
| `OLLAMA_URL` | `server/services/embeddings.js` | `http://localhost:11434` |
| `EMBEDDING_MODEL` | `server/services/embeddings.js` | `nomic-embed-text` |
| `GATEWAY_DIST` | `server/services/gateway-manager.js` | `~/clawdbot/dist/index.js` |
| `GATEWAY_PORT` | `server/services/gateway-client.js` | `18789` |

---

## Troubleshooting

### Server won't start

```bash
lsof -i :3141                       # Check if port is in use
cat data/server.log                  # Check server log
lsof -i :3141 -t | xargs kill -9    # Kill and restart
npm start
```

### Gateway not connecting

```bash
# Check if clawdbot dist exists
ls ~/clawdbot/dist/index.js

# Rebuild if needed
cd ~/clawdbot && pnpm build

# Check gateway port
lsof -i :18789

# Check gateway status via API
curl http://localhost:3141/api/gateway/status
```

### Ollama not available

```bash
ollama serve
ollama pull nomic-embed-text
curl http://localhost:3141/api/health
```

### Plugin commands not recognized

Commands use the `computer:` prefix: `/computer:analyze` (not `/computer-analyze`).

---

## File Structure

```
~/.claude/plugins/computer/
├── .claude-plugin/
│   └── plugin.json
├── package.json                       # v3.0.0 — express, ws, @lancedb/lancedb, vad-web
├── README.md
│
├── commands/                          # 17 slash commands
│   ├── computer.md, analyze.md, search.md, transcribe.md
│   ├── status.md, compare.md, summarize.md, monitor.md
│   ├── log.md, brief.md, pipeline.md, know.md, export.md
│   ├── channels.md, send.md, gateway.md, audit.md
│
├── agents/                            # 15 specialized AI agents
│   ├── analyst.md, researcher.md, visualizer.md
│   ├── transcription-processor.md, comparator.md, summarizer.md
│   ├── monitor.md, translator.md, explainer.md
│   ├── pipeline.md, knowledge.md
│   ├── channels.md, automation.md, browser-agent.md, security-agent.md
│
├── skills/computer-operations/
│   ├── SKILL.md
│   └── references/
│
├── hooks/hooks.json                   # SessionStart auto-start
├── scripts/
│   ├── start.sh, status.sh, build-check.js, setup-vad-libs.js
│
├── server/
│   ├── index.js                       # Express + WS + Gateway init
│   ├── middleware/
│   │   ├── auth.js                   # Bearer token authentication
│   │   └── security.js               # 26 detection patterns
│   ├── routes/
│   │   ├── api.js, knowledge.js, claude.js
│   │   ├── transcribe.js, tts.js     # Gateway-first cascades
│   │   ├── media.js                  # Media upload + analysis
│   │   └── gateway-extras.js         # Sessions, agents, OAuth, inbox, nodes
│   ├── services/
│   │   ├── gateway-manager.js        # Subprocess lifecycle
│   │   ├── gateway-client.js         # WS RPC client
│   │   ├── config-bridge.js          # Config read/write
│   │   ├── vectordb.js, embeddings.js, chunking.js, search.js
│   │   ├── storage.js, claude-bridge.js
│   │   ├── transcription.js, tts.js
│   │   ├── voice-assistant.js         # Dual-model (xLAM + Scout) + 16 tools + auto-search
│   │   ├── websocket.js, notifications.js
│   └── utils/
│       ├── helpers.js
│       └── sanitize.js               # Input sanitization
│
├── ui/
│   ├── index.html                     # SPA with 19 LCARS panels
│   ├── css/
│   │   ├── lcars.css                  # LCARS design system
│   │   └── components.css            # All panel styles
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
│       │   ├── api-client.js, websocket-client.js
│       │   ├── speech-service.js, audio-player.js
│       │   └── vad-service.js         # Silero VAD wrapper
│       └── utils/
│           ├── formatters.js, lcars-helpers.js
│
└── data/                              # Created at runtime (gitignored)
```

---

## License

MIT