# Computer — USS Enterprise AI System

A Claude Code plugin that turns your machine into the USS Enterprise main computer. Speak to it. Ask it questions. Have it pull up charts, check your email, search the web, or set a red alert — all through a real Star Trek LCARS interface running entirely on your own hardware.

![LCARS Interface](https://img.shields.io/badge/UI-LCARS%20Theme-FF9900?style=flat-square&labelColor=000000)
![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-CC99CC?style=flat-square&labelColor=000000)
![Node.js](https://img.shields.io/badge/Node.js-Express%20%2B%20WebSocket-9999FF?style=flat-square&labelColor=000000)
![LanceDB](https://img.shields.io/badge/Vector%20DB-LanceDB-55CC55?style=flat-square&labelColor=000000)
![Moshi](https://img.shields.io/badge/Voice-Moshi%20Speech--to--Speech-33CCFF?style=flat-square&labelColor=000000)
![Ollama](https://img.shields.io/badge/LLM-Llama%204%20Scout%20%2B%20xLAM%20via%20Ollama-66CCFF?style=flat-square&labelColor=000000)
![Self-Contained](https://img.shields.io/badge/Mode-100%25%20Local-55CC55?style=flat-square&labelColor=000000)

---

## Table of Contents

- [What Is This?](#what-is-this)
- [Why Build It?](#why-build-it)
- [What Can It Do?](#what-can-it-do)
- [How It Works](#how-it-works)
  - [The Voice Pipeline](#the-voice-pipeline)
  - [The Dual-Model Brain](#the-dual-model-brain)
  - [The LCARS Interface](#the-lcars-interface)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Deployment Guide](#deployment-guide)
  - [1. Install System Dependencies](#1-install-system-dependencies)
  - [2. Clone and Install](#2-clone-and-install)
  - [3. Pull AI Models](#3-pull-ai-models)
  - [4. Set Up Moshi Voice (Recommended)](#4-set-up-moshi-voice-recommended)
  - [5. Register as a Claude Code Plugin](#5-register-as-a-claude-code-plugin)
  - [6. Set Up Gmail (Optional)](#6-set-up-gmail-optional)
  - [7. Start and Verify](#7-start-and-verify)
- [Voice Interaction Guide](#voice-interaction-guide)
  - [Moshi Mode — Natural Conversation](#moshi-mode--natural-conversation)
  - [Computer Mode — Tool Commands](#computer-mode--tool-commands)
  - [Voice Command Reference](#voice-command-reference)
- [The 19 LCARS Panels](#the-19-lcars-panels)
- [API Reference](#api-reference)
  - [Authentication](#authentication)
  - [REST Endpoints](#rest-endpoints)
  - [WebSocket Protocol](#websocket-protocol)
- [Configuration](#configuration)
- [Running Tests](#running-tests)
- [Troubleshooting](#troubleshooting)
- [Security Model](#security-model)
- [Project Structure](#project-structure)

---

## What Is This?

Computer is a self-contained AI assistant styled after the USS Enterprise computer from Star Trek. It runs as a Claude Code plugin — meaning it auto-starts when you open a Claude Code session and integrates directly with your AI workflow.

You interact with it two ways:

1. **Voice** — Click the diamond button in the browser UI, speak naturally. The system listens, understands, acts, and speaks back. Say "Computer, what's the gold price?" and it will search the web, synthesize an answer, and speak it to you — all within 1–2 seconds.

2. **Slash commands** — Type `/computer:analyze`, `/computer:search`, `/computer:know` etc. directly in your Claude Code session. Results appear both in the terminal and are pushed to the LCARS browser interface in real-time.

Everything runs on your own machine. No cloud voice APIs, no external AI services, no usage costs beyond your hardware.

---

## Why Build It?

**The problem:** AI assistants that depend on cloud APIs are inherently limited — latency kills conversational flow, data leaves your machine, and costs compound at scale.

**The vision:** What if your AI assistant felt like the Enterprise computer? Instant acknowledgment, conversational speed, always listening, able to take real action — not just answer questions.

**The approach:**
- **Speech-to-speech via Moshi** — Kyutai's Moshi model runs the full voice loop (hear→understand→respond) as a single neural network on Apple Silicon via MLX. ~200ms latency instead of ~3-5 seconds for chain-of-models approaches. No STT→LLM→TTS pipeline needed.
- **Tool-augmented commands via "Computer"** — When you say "Computer," you want action, not just conversation. A wake word triggers a switch to a dual-model tool pipeline: xLAM 8B routes to tools (web search, charts, email, etc.), Llama 4 Scout generates the spoken response. Full agentic capabilities triggered by voice.
- **Local LLMs only** — Ollama runs Llama 4 Scout and xLAM entirely on your hardware. No API keys, no per-token cost, no data leaving your network.
- **LCARS for real** — Not just aesthetic. The 19-panel interface is a functional dashboard: live charts, email threads, knowledge base, monitoring, and more — all pushed in real-time via WebSocket as the AI completes work.

---

## What Can It Do?

### Voice (Moshi Full-Duplex)
- Natural conversation at ~200ms latency
- Always-on listening in Moshi mode — no button press needed
- Say "Computer" to trigger tool-augmented commands without leaving conversation mode
- Hear responses in Moshi's synthesized voice while the panel auto-updates with visual data

### Voice (Computer Mode — Tool Commands)
- **Web search** — Real-time DuckDuckGo + page fetching. "Computer, search for the latest on GPT-5"
- **Live financial data** — Spot prices from Swissquote (metals: gold/silver/platinum/palladium) and Google Finance (stocks/crypto). "Computer, what's the gold price?"
- **Smart charts** — Natural language to Chart.js visualization. "Computer, show me Tesla vs Apple stock this month" → line chart with live data
- **Email** — Check inbox, read emails, send replies, get follow-up summaries. "Computer, summarize my inbox"
- **Knowledge base** — Semantic search over stored facts. "Computer, what do we know about the project timeline?"
- **Captain's log** — Timestamped log entries with stardates. "Computer, log: mission briefing completed"
- **System control** — Panel switching, alerts, reminders, monitoring. "Computer, red alert" / "Computer, show me the charts panel"
- **AI analysis** — Sentiment, topics, entities, action items from text
- **Reminders** — "Computer, remind me in 30 minutes to check the build"

### Data Visualization
- Natural language chart requests ("bar chart of population by country")
- Live financial prices as time-series charts
- Table rendering for structured data
- Source attribution links on every chart

### Knowledge Base
- LanceDB vector database with nomic-embed-text embeddings (768 dimensions)
- 6 chunking strategies: fixed, sentence, paragraph, sliding window, semantic, recursive
- 6 search methods: vector similarity, keyword (BM25), hybrid, MMR, multi-query with RRF
- Store and retrieve facts through voice or API

### Gmail Integration
- Full inbox access via OAuth — no password stored
- Read full email threads
- Compose and send email
- AI-generated follow-up detection
- All accessible by voice

### Monitoring and Cron
- Watch URLs, files, and processes for changes
- Minute-level cron scheduling with event log
- Desktop notifications on macOS

---

## How It Works

### The Voice Pipeline

Here is the complete path from your mouth to the computer's voice, step by step:

#### Moshi Mode (default)

```
1. You speak into your microphone
2. Browser captures audio via MediaDevices API at 24kHz mono
3. WebCodecs AudioEncoder compresses audio to Opus format (~80ms frames)
4. Each Opus frame gets a 0x01 kind byte prefix and is sent over WebSocket
5. LCARS server (port 3141) receives binary frames and forwards them to Moshi (port 8998)
6. Moshi processes audio in real-time — it's a single neural network, so
   speech understanding and response generation happen simultaneously
7. Moshi sends back:
   - Opus audio frames (0x01 kind) → LCARS relays to browser → decoded by WebCodecs
     AudioDecoder → played through AudioContext (seamlessly scheduled for zero gaps)
   - UTF-8 text tokens (0x02 kind) → displayed in status bar as live transcript
8. If the transcript contains "Computer, [command]", the server:
   a. Pauses Moshi audio relay to browser (no dual-audio conflict)
   b. Stops sending your mic audio to Moshi
   c. Runs the command through the Computer Mode pipeline (see below)
   d. Resumes Moshi mode when done
```

#### Computer Mode (wake word triggered)

```
1. Wake word "Computer" detected in Moshi transcript (or you're in Computer mode)
2. Silero VAD (Voice Activity Detection) detects speech start/end in-browser
   — runs as ONNX Runtime WebAssembly, entirely in-browser, no server round-trip
3. Captured speech sent as WAV blob over WebSocket to LCARS server
4. Whisper STT transcribes the WAV → "what time is it"
5. xLAM 8B (Salesforce Large Action Model) receives transcription
   — deterministic tool routing: picks get_time tool, returns structured JSON
6. get_time executes locally → {time, date, stardate}
7. Response shortcut: no LLM needed for known-format tools → pre-built spoken string
   "The time is 10:07 AM. Wednesday, February 18, 2026. Stardate 102.132."
8. Coqui TTS synthesizes the text → WAV file saved to disk
9. LCARS sends voice_response event with audioUrl to browser
10. Browser fetches WAV, plays through HTML5 Audio
11. VAD resumes listening, state returns to MOSHI_ACTIVE
```

#### Why Two Models Instead of One?

Routing tool calls deterministically requires a model fine-tuned for JSON function calling — xLAM 8B (Salesforce's Large Action Model) is specifically trained for this and is faster and more reliable at tool selection than a general-purpose LLM. Llama 4 Scout handles the conversational response because it's a 17B MoE model with much better natural language quality for longer/nuanced answers. Each model does what it's best at.

#### Why Moshi Instead of Whisper+TTS?

The traditional chain — Whisper (STT) → LLM → TTS — has irreducible latency from three sequential model inferences. Moshi is a single end-to-end speech model: it processes audio continuously and generates audio continuously. The result is ~200ms perceived latency versus 3–5 seconds for the chain. It also enables true full-duplex: Moshi can start responding before you've finished speaking.

### The Dual-Model Brain

```
User input (text or voice)
        │
        ▼
   ┌─────────────┐
   │   xLAM 8B   │  ← Salesforce Large Action Model, fine-tuned for tool routing
   │  (tool pick)│    Fast, deterministic, returns JSON tool calls
   └──────┬──────┘
          │ tool_calls: [{name: "web_search_and_read", args: {...}}]
          ▼
   ┌─────────────────┐
   │  Tool Executor  │  ← 25+ tools: search, charts, email, knowledge, etc.
   │  (run the tools)│    Results are real data, not hallucinated
   └──────┬──────────┘
          │ tool_results: [{content: "Gold price: $2,847/oz..."}]
          ▼
   ┌──────────────────┐
   │  Llama 4 Scout   │  ← Meta Llama 4 Scout (17B MoE), runs on Ollama
   │  (write response)│    Generates conversational spoken response from data
   └──────┬───────────┘
          │ "The current gold spot price is twenty-eight forty-seven per troy ounce."
          ▼
      Coqui TTS → WAV → Browser
```

Many tools bypass Llama 4 Scout entirely (shortcut paths) for speed and accuracy — `get_time`, `set_alert`, `check_email`, `generate_chart`, `create_reminder`, etc. use pre-built response templates from the tool output, avoiding any chance of the LLM hallucinating numbers or facts.

### The LCARS Interface

The browser UI is a single-page application (no framework, no build step — pure vanilla JavaScript ES modules served directly by Express). It maintains a persistent WebSocket connection to the server. As the AI completes work, it pushes results over WebSocket and the relevant panel auto-updates:

- A voice command for a chart → `chart` WebSocket event → chart panel renders → `voice_panel_switch` event → UI switches to charts panel
- A voice command for email → `voice_response` with data → channels panel shown
- An alert → `alert_status` event → entire UI flashes the alert color

The 19 panels share a common pattern: they register a WebSocket message handler in their constructor, and the server pushes data to them as events complete. No polling, no manual refresh.

---

## Architecture

```
  ┌──────────────────────────────────────────────────────────────────┐
  │                    Claude Code CLI Session                        │
  │  /computer:analyze, /computer:know, /computer:search ...         │
  └───────────────────────────────┬──────────────────────────────────┘
                                  │ HTTP POST
                                  ▼
  ┌──────────────────────────────────────────────────────────────────┐
  │              Express + WebSocket Server (port 3141)              │
  │                                                                  │
  │  Security Layer                   WebSocket Handler              │
  │  ├── Helmet (CSP, X-Frame)       ├── Auth: ?token= query param   │
  │  ├── CORS (localhost only)        ├── Binary routing:            │
  │  ├── Rate limiting (200/min)      │   0x01 → Moshi bridge        │
  │  ├── Bearer token auth            │   WAV/WebM → Whisper STT     │
  │  └── Secret redaction            ├── JSON messages:              │
  │                                  │   voice_command → tool loop   │
  │  REST API Routes                  │   voice_start → Moshi connect │
  │  ├── /api/knowledge/*            └── voice_cancel → disconnect   │
  │  ├── /api/tts/*, /api/transcribe/*                               │
  │  ├── /api/voice/*, /api/media/*                                  │
  │  ├── /api/gmail/*                                                │
  │  └── /api/gateway/* (local services: agents, nodes, sessions)    │
  └──────────────┬───────────────────────────────────┬───────────────┘
                 │ WebSocket bridge                   │ WebSocket push
                 ▼                                    ▼
  ┌──────────────────────┐     ┌────────────────────────────────────────┐
  │   Moshi MLX Sidecar  │     │         LCARS Web UI (Browser)         │
  │   port 8998          │     │                                        │
  │                      │     │  Sidebar (19 panels) + Active Panel    │
  │  Opus I/O at 24kHz   │     │  ◆ Voice button  │ MOSHI/CMD toggle   │
  │  ~200ms S2S latency  │     │  Status bar (live transcript)          │
  │  MLX on Apple Silicon│     │                                        │
  └──────────────────────┘     │  WebCodecs: Opus encode/decode         │
                                │  Silero VAD (ONNX WASM, in-browser)   │
  ┌──────────────────────┐     └────────────────────────────────────────┘
  │    Ollama (:11434)   │
  │  ├── llama4:scout    │  ← Conversational responses
  │  ├── xLAM 8B F16     │  ← Tool routing
  │  └── nomic-embed-text│  ← Knowledge base embeddings
  └──────────────────────┘
```

---

## Prerequisites

### Required

| Tool | Version | Purpose | Install |
|------|---------|---------|---------|
| **Node.js** | v18+ | Server runtime | `brew install node` |
| **Ollama** | latest | Local LLM inference | `brew install ollama` |
| **Claude Code** | latest | Plugin host | [Install guide](https://docs.anthropic.com/en/docs/claude-code) |

### Required AI Models (via Ollama)

| Model | Size | Purpose | Command |
|-------|------|---------|---------|
| **nomic-embed-text** | 274MB | Knowledge base embeddings | `ollama pull nomic-embed-text` |
| **llama4:scout** | ~30GB | Conversation + analysis | `ollama pull llama4:scout` |
| **xLAM 8B F16** | ~16GB | Deterministic tool routing | `ollama pull hf.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf:F16` |

> **Apple Silicon note:** Llama 4 Scout and xLAM will run fully on the Metal GPU via Ollama's MLX backend. A Mac with 32GB RAM handles both simultaneously. 64GB is comfortable.

### For Moshi Voice (Recommended)

| Tool | Purpose | Install |
|------|---------|---------|
| **Python 3.12** | Moshi runtime | `brew install python@3.12` |
| **moshi_mlx** | Speech-to-speech model | `pip install moshi_mlx` |
| ~5GB disk | Moshi model weights | Auto-downloaded on first run |

### For Computer Mode Voice (Optional — Moshi preferred)

| Tool | Purpose | Install |
|------|---------|---------|
| **OpenAI Whisper** | Speech transcription (STT) | `pip install openai-whisper` |
| **Coqui TTS** | Text-to-speech | `pip install TTS` |
| **FFmpeg** | Audio/video processing | `brew install ffmpeg` |

> You can run Computer Mode voice commands without Moshi if you have Whisper + Coqui installed. Moshi gives a dramatically better conversational experience.

---

## Deployment Guide

### 1. Install System Dependencies

```bash
# Node.js (if not installed)
brew install node

# Ollama (local LLM runtime)
brew install ollama

# Python 3.12 (for Moshi)
brew install python@3.12

# FFmpeg (for audio/video, optional)
brew install ffmpeg

# Start Ollama as a background service
ollama serve &
```

### 2. Clone and Install

```bash
# Clone into the Claude plugins directory
git clone https://github.com/chendren/computer.git ~/.claude/plugins/computer

# Install Node.js dependencies
cd ~/.claude/plugins/computer
npm install --omit=dev
```

### 3. Pull AI Models

```bash
# Required: embedding model for knowledge base (~274MB, fast)
ollama pull nomic-embed-text

# Recommended: voice conversation model (~30GB download)
ollama pull llama4:scout

# Recommended: tool routing model (~16GB download)
ollama pull hf.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf:F16
```

> These are large downloads. Start them and let them run. The server will work without the voice models — you'll just get an error when you try to use voice commands.

### 4. Set Up Moshi Voice (Recommended)

Moshi is the heart of the voice experience. Skip this if you only want typed commands.

```bash
cd ~/.claude/plugins/computer

# Create a Python virtual environment for Moshi
python3.12 -m venv moshi-env

# Install Moshi MLX (Apple Silicon optimized)
source moshi-env/bin/activate
pip install moshi_mlx huggingface_hub

# Optional: pre-download the model (~5GB, saves time on first voice session)
python -c "from huggingface_hub import snapshot_download; snapshot_download('kyutai/moshika-mlx-q4')"
```

The LCARS server will auto-start Moshi on launch. To test Moshi standalone:

```bash
source ~/.claude/plugins/computer/moshi-env/bin/activate
python -m moshi_mlx.local_web -q 4 --hf-repo kyutai/moshika-mlx-q4
# Opens on http://localhost:8998 — try the built-in Moshi web UI
```

> **Browser requirement for voice:** Moshi requires WebCodecs API (Opus encode/decode). Use **Chrome or Edge** — Safari does not support WebCodecs yet.

### 5. Register as a Claude Code Plugin

Claude Code discovers plugins through a marketplace directory. Here's how to set it up:

```bash
# Create the marketplace directory structure
mkdir -p ~/.claude/plugins/computer-marketplace/.claude-plugin/plugins

# Link the computer plugin into the marketplace
ln -s ~/.claude/plugins/computer \
  ~/.claude/plugins/computer-marketplace/.claude-plugin/plugins/computer
```

Create the marketplace manifest at `~/.claude/plugins/computer-marketplace/.claude-plugin/marketplace.json`:

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "computer-local",
  "description": "Local Computer plugin marketplace",
  "owner": { "name": "Your Name" },
  "plugins": [
    {
      "name": "computer",
      "description": "USS Enterprise AI computer with LCARS interface",
      "version": "3.0.0",
      "author": { "name": "Your Name" },
      "source": "../../../computer",
      "category": "productivity"
    }
  ]
}
```

Register and install:

```bash
# Add the local marketplace
claude plugin marketplace add computer-local \
  --source directory \
  --path ~/.claude/plugins/computer-marketplace

# Install the plugin from the marketplace
claude plugin install computer@computer-local

# Verify installation
claude plugin list
```

The plugin includes a **SessionStart hook** that auto-starts the server every time you open Claude Code. Open [http://localhost:3141](http://localhost:3141) in Chrome to access the LCARS UI.

### 6. Set Up Gmail (Optional)

Gmail integration uses OAuth — your credentials stay on your machine.

**Step 1: Create Google OAuth credentials**
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Enable the **Gmail API** in the API Library
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Authorized redirect URIs: `http://localhost:3141/api/gateway/oauth/gmail/callback`
7. Download the JSON credentials file

**Step 2: Place credentials**
```bash
# Copy your downloaded credentials file
cp ~/Downloads/client_secret_*.json ~/.claude/plugins/computer/data/google-oauth.json
```

**Step 3: Authorize Gmail**
Start the server, then open the LCARS UI and go to the **Channels** panel. Click **Authorize Gmail**. This opens a browser OAuth flow — log in and grant access. Done.

Or via API:
```bash
TOKEN=$(cat ~/.claude/plugins/computer/data/.auth-token)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3141/api/gateway/oauth/gmail/start
```

### 7. Start and Verify

```bash
# Start the server manually (auto-starts with Claude Code via SessionStart hook)
~/.claude/plugins/computer/scripts/start.sh

# Check server health
TOKEN=$(cat ~/.claude/plugins/computer/data/.auth-token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/health | python3 -m json.tool

# Run the regression test suite (requires server + Moshi running)
node ~/.claude/plugins/computer/tests/voice-regression.mjs
```

Expected health response when everything is working:
```json
{
  "status": "online",
  "ollama": "online",
  "vectordb": "online",
  "moshi": { "running": true, "ready": true, "pid": 12345 },
  "gmail": { "connected": true, "email": "you@gmail.com" }
}
```

Open **Chrome** and navigate to [http://localhost:3141](http://localhost:3141). You should see the LCARS interface. Click the diamond button ◆ in the title bar to activate voice.

---

## Voice Interaction Guide

> **Browser requirement:** Voice features require Chrome or Edge. WebCodecs API (Opus encode/decode) is not yet available in Safari.

### Moshi Mode — Natural Conversation

Moshi is the default voice mode. It provides full-duplex speech-to-speech conversation with ~200ms latency.

1. Open [http://localhost:3141](http://localhost:3141) in Chrome
2. Confirm the title bar shows **MOSHI** (not CMD) — this is the mode indicator
3. Click the **diamond button ◆** — it turns cyan and pulses
4. **Start speaking naturally.** Moshi will respond with voice and text simultaneously
5. You can interrupt Moshi by speaking — it's truly full-duplex
6. The status bar shows Moshi's live transcript as it speaks

**To issue a tool command from Moshi mode:**
Say **"Computer, [your command]"** — for example:
- "Computer, what time is it?"
- "Computer, check my email"
- "Computer, show me a chart of gold prices this week"

The system detects "Computer" in Moshi's transcript, switches to Computer mode, runs the command, speaks the result, then returns to natural Moshi conversation.

**To stop:** Click the diamond button again. Moshi disconnects.

### Computer Mode — Tool Commands

Computer mode uses the full tool pipeline: Silero VAD → Whisper STT → xLAM routing → tool execution → Llama 4 Scout response → Coqui TTS.

1. Click **MOSHI** to toggle to **CMD** mode (or it auto-selects if Moshi is unavailable)
2. Click the diamond button — it pulses amber
3. Say **"Computer, [your command]"**
4. Watch the button states:
   - **Amber pulse** = listening for speech
   - **Bright amber** = speech captured, sending to server
   - **Red pulse** = thinking (running models)
   - **Green pulse** = speaking (TTS playing)
5. After the response, it returns to amber (listening)
6. You can say "Computer" again immediately for the next command

### Voice Command Reference

| Say... | What Happens |
|--------|-------------|
| `Computer, what time is it?` | Returns time, date, and stardate |
| `Computer, search for [topic]` | DuckDuckGo search + page fetching, results in Search panel |
| `Computer, what is the gold price?` | Live spot price from Swissquote |
| `Computer, show me Tesla stock this week` | Live price + simulated trend chart |
| `Computer, chart Amazon vs Microsoft` | Comparison line chart |
| `Computer, check my email` | Inbox overview in Channels panel |
| `Computer, summarize my inbox` | AI-generated inbox summary |
| `Computer, reply to John saying I'll be there` | Finds the email, opens compose |
| `Computer, send an email to user@example.com` | Opens compose with recipient |
| `Computer, remember [fact]` | Stores in vector knowledge base |
| `Computer, what do we know about [topic]` | Semantic search of knowledge base |
| `Computer, analyze [text]` | Sentiment, topics, entities, action items |
| `Computer, log [note]` | Captain's log entry with stardate |
| `Computer, red alert` | UI flashes red, visual/audio alert |
| `Computer, yellow alert` | UI flashes yellow |
| `Computer, stand down` | Returns to normal operations |
| `Computer, show me the charts panel` | Switches active panel |
| `Computer, remind me in 30 minutes to check the build` | Sets a timed reminder |
| `Computer, monitor https://example.com` | Sets up a URL monitor |
| `Computer, open https://example.com` | Opens URL in Browser panel |
| `Computer, what is my system status?` | Returns health/connectivity summary |
| `Computer, show me the dashboard` | Switches to Dashboard panel |

---

## The 19 LCARS Panels

The interface is organized into three groups accessible from the sidebar.

### Core Group

| Panel | Purpose |
|-------|---------|
| **Dashboard** | Bridge overview: Moshi status, Ollama models, Gmail, security score, system uptime |
| **Main** | Text chat with Claude via SSE streaming, command history |
| **Transcript** | Live speech-to-text display, file upload, timestamped entries |
| **Analysis** | AI analysis results: sentiment bars, topic tags, entity list, action items |
| **Charts** | Chart.js visualizations with LCARS orange/lavender color theme, data tables |
| **Knowledge** | Vector search UI: query input, method selector, result cards with scores |

### Comms Group

| Panel | Purpose |
|-------|---------|
| **Channels** | Gmail: inbox list, full thread view, compose window, OAuth authorization |
| **Search** | Web search results with clickable links, DuckDuckGo source |
| **Log** | Captain's log entries with stardates, categories (personal/mission/technical) |
| **Monitor** | Active URL/file monitors, check history with status dots |
| **Compare** | Side-by-side text comparison with similarity score and diff visualization |

### Ops Group

| Panel | Purpose |
|-------|---------|
| **Gateway** | Local service registry: sessions, agent definitions, Ollama model catalog |
| **Plugins** | Tool/hook/plugin registry — what the computer knows how to do |
| **Cron** | Scheduled job grid with next-run times and execution event log |
| **Browser** | URL bar + embedded viewport for browsing within LCARS |
| **Nodes** | Local machine as "node 0": hardware info, camera/screen capture |
| **Security** | Shield gauge, secret redaction statistics, security audit log |

---

## API Reference

### Authentication

All `/api/*` routes require a Bearer token. The token is auto-generated on first server start and saved to `data/.auth-token`.

```bash
TOKEN=$(cat ~/.claude/plugins/computer/data/.auth-token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/health
```

WebSocket connections authenticate via a query parameter (not a header):
```javascript
const ws = new WebSocket(`ws://localhost:3141?token=${token}`);
```

### REST Endpoints

#### System

```
GET  /api/health                    System status (no auth required)
GET  /api/voice/status              Voice service + Moshi info
GET  /api/voice/config              VAD settings + mode descriptions
GET  /api/voice/moshi/status        Moshi process health (auth required)
POST /api/voice/moshi/start         Start Moshi sidecar
POST /api/voice/moshi/stop          Stop Moshi sidecar
```

#### Knowledge Base

```
GET    /api/knowledge               List all stored knowledge entries
POST   /api/knowledge               Store a new fact or document
POST   /api/knowledge/search        Semantic/keyword/hybrid search
DELETE /api/knowledge/:id           Delete an entry
GET    /api/knowledge/stats         Embedding count, storage size
```

Example — store a fact:
```bash
curl -X POST http://localhost:3141/api/knowledge \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "The dilithium crystal chamber operates at 4.7 cochrane units",
    "title": "Engineering note",
    "tags": ["engineering", "warp"]
  }'
```

Example — search:
```bash
curl -X POST http://localhost:3141/api/knowledge/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "warp drive efficiency", "method": "hybrid", "limit": 5}'
```

#### Voice / TTS / STT

```
POST /api/tts/speak                 Synthesize text → WAV file
GET  /api/tts/audio/:filename       Serve a generated audio file
POST /api/transcribe/file           Transcribe audio via Whisper
```

Example — generate speech:
```bash
curl -X POST http://localhost:3141/api/tts/speak \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text": "Computer online. All systems nominal."}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['audioUrl'])"
```

#### Data (CRUD)

```
GET/POST   /api/transcripts         Speech-to-text transcript entries
GET/POST   /api/analyses            Analysis results
GET/POST   /api/logs                Captain's log entries
GET/POST   /api/monitors            URL/file monitors
GET/POST   /api/comparisons         Comparison results
```

#### Gmail

```
GET  /api/gmail/inbox               Recent inbox messages
GET  /api/gmail/search              Search emails (query string ?q=)
GET  /api/gmail/messages/:id        Read full message
POST /api/gmail/send                Send an email
GET  /api/gmail/summary             AI inbox summary
GET  /api/gmail/followups           Follow-up detection
```

#### Gateway (Local Services)

```
GET  /api/gateway/status            Local service registry status
GET  /api/gateway/channels          Connected channels (Gmail, etc.)
GET  /api/gateway/agents            Agent definitions from agents/*.md
GET  /api/gateway/models            Ollama model catalog
GET  /api/gateway/sessions          Active voice sessions
GET  /api/gateway/plugins           Tool/hook/plugin registry
GET  /api/gateway/cron              Cron job definitions
POST /api/gateway/nodes/0/camera    Capture from camera
POST /api/gateway/nodes/0/screen    Capture screenshot
POST /api/gateway/oauth/gmail/start Start Gmail OAuth flow
```

### WebSocket Protocol

Connect: `ws://localhost:3141?token=<your-auth-token>`

Binary messages use a 1-byte kind prefix (Moshi protocol):
- `0x00` = Handshake (Moshi → LCARS server → browser)
- `0x01` = Opus audio frame (bidirectional)
- `0x02` = UTF-8 text token (Moshi → LCARS server → browser)

#### Events the Server Sends to Browser

| Event | Payload | Meaning |
|-------|---------|---------|
| `status` | `{message, connected}` | Server status / welcome |
| `stt_result` | `{text}` | Whisper transcription complete |
| `voice_thinking` | `{}` | LLM processing started |
| `voice_response` | `{text, audioUrl, toolsUsed, panelSwitch}` | Command result + audio |
| `voice_done` | `{}` | Turn fully complete |
| `voice_error` | `{error}` | Something went wrong |
| `voice_mode_changed` | `{mode, reason}` | Switched between Moshi/Computer |
| `moshi_text` | `{text, fullText}` | Live Moshi transcript token |
| `moshi_handshake` | config object | Moshi bridge connected |
| `moshi_error` | `{error}` | Moshi problem |
| `voice_panel_switch` | `{panel}` | Auto-switch to this panel |
| `chart` | `{chartConfig, sources, table}` | Push chart data to UI |
| `alert_status` | `{level, reason}` | Red/yellow/blue/normal alert |
| Binary `0x01…` | Opus frame bytes | Moshi audio (play immediately) |

#### Events the Browser Sends to Server

| Event | Payload | Meaning |
|-------|---------|---------|
| `voice_command` | `{text}` | Run this text as a voice command |
| `voice_mode` | `{mode}` | Switch to 'moshi' or 'computer' |
| `voice_start` | `{}` | Activate voice (triggers Moshi connect) |
| `voice_cancel` | `{}` | Deactivate voice |
| Binary `0x01…` | Opus frame bytes | Your microphone audio to Moshi |
| Binary WAV/WebM | audio bytes | Audio chunk for Whisper STT |

---

## Configuration

### Environment Variables

Set these before starting the server, or in your shell profile:

| Variable | Default | Purpose |
|----------|---------|---------|
| `COMPUTER_PORT` | `3141` | Server HTTP + WebSocket port |
| `VOICE_MODEL` | `llama4:scout` | Ollama model for conversation responses |
| `ACTION_MODEL` | `hf.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf:F16` | Ollama model for tool routing |
| `VISION_MODEL` | `llama4:scout` | Ollama model for image analysis |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API endpoint |
| `MOSHI_PORT` | `8998` | Moshi sidecar WebSocket port |
| `WHISPER_PATH` | `whisper` (in PATH) | Path to Whisper CLI binary |
| `TTS_PATH` | `tts` (in PATH) | Path to Coqui TTS binary |
| `MOSHI_VENV` | `./moshi-env` | Path to Python venv for Moshi |

### Runtime Config

The server reads and writes `data/config.json` at runtime. Access it via the API:

```bash
GET  /api/config       # Read current config
POST /api/config       # Update a config key
```

Key config fields:
- `vad.positiveSpeechThreshold` — VAD sensitivity (default 0.8, higher = less sensitive)
- `vad.redemptionFrames` — Frames before VAD decides speech ended (default 15)
- `tts.provider` — TTS engine selection
- `stt.provider` — STT engine selection

---

## Running Tests

A full regression test suite covers the entire voice pipeline:

```bash
# Make sure the server is running first
~/.claude/plugins/computer/scripts/start.sh

# Run all 33 tests (~45 seconds, most of that is LLM warm-up)
node ~/.claude/plugins/computer/tests/voice-regression.mjs

# Or via the shell script
~/.claude/plugins/computer/scripts/run-tests.sh
```

What the tests cover:
- Server health (Ollama, VectorDB, gateway)
- Moshi process + WebSocket reachability
- TTS endpoint generates real audio
- Full WebSocket flow: `voice_start` → `voice_mode_changed:moshi` → `moshi_handshake`
- Full LLM round-trip: `voice_command` → xLAM → tool execution → Scout response → TTS
- Wake word detection logic (9 cases, unit test, no mic needed)
- VAD WASM libs served with correct MIME types
- Static code regression checks for all four bug fixes:
  - Log spam fix (Ollama polling)
  - Dual-audio fix (Moshi audio gate)
  - Wake word loop fix (Computer mode guard)
  - THINKING pause fix (mic stops during processing)

---

## Troubleshooting

### Server won't start / port in use

```bash
# Find what's on port 3141
lsof -i :3141

# Kill it
lsof -i :3141 -t | xargs kill -9

# Check logs
cat ~/.claude/plugins/computer/data/server.log | tail -50

# Start manually with visible output
cd ~/.claude/plugins/computer && node server/index.js
```

### Moshi not connecting

```bash
# Check if Moshi Python venv exists
ls ~/.claude/plugins/computer/moshi-env/bin/python

# Check if Moshi is running
curl http://localhost:8998

# Check its status via the API
TOKEN=$(cat ~/.claude/plugins/computer/data/.auth-token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/voice/moshi/status

# Test Moshi standalone
source ~/.claude/plugins/computer/moshi-env/bin/activate
python -m moshi_mlx.local_web -q 4 --hf-repo kyutai/moshika-mlx-q4

# If using wrong Python version
python3.12 -m venv ~/.claude/plugins/computer/moshi-env
source ~/.claude/plugins/computer/moshi-env/bin/activate
pip install moshi_mlx
```

### Voice button does nothing / "WebCodecs not available"

WebCodecs (required for Opus encode/decode) is Chrome/Edge only. Safari does not support it.

```
✓ Use Chrome or Edge
✗ Do not use Safari
```

If in Chrome and still failing, check the browser console (F12) for errors. Common causes:
- Microphone permission denied → click the lock icon in the URL bar and allow microphone
- Server not running → check http://localhost:3141/api/health

### Ollama not available / voice commands fail

```bash
# Check Ollama is running
curl http://localhost:11434/api/tags

# If not running
ollama serve &

# Check models are installed
ollama list | grep -E "llama4|xLAM|nomic"

# Pull missing models
ollama pull llama4:scout
ollama pull hf.co/Salesforce/Llama-xLAM-2-8b-fc-r-gguf:F16
ollama pull nomic-embed-text
```

### Gmail auth failing

```bash
TOKEN=$(cat ~/.claude/plugins/computer/data/.auth-token)

# Check current auth status
curl -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/gateway/oauth/status

# Re-authorize
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3141/api/gateway/oauth/gmail/start
```

If OAuth fails, make sure:
1. `data/google-oauth.json` exists with your client credentials
2. `http://localhost:3141/api/gateway/oauth/gmail/callback` is in your Google Cloud authorized redirect URIs

### Knowledge base errors

```bash
TOKEN=$(cat ~/.claude/plugins/computer/data/.auth-token)

# Check VectorDB stats
curl -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/knowledge/stats

# Verify nomic-embed-text is installed
ollama pull nomic-embed-text
```

---

## Security Model

The system is designed for **single-user local use** with these protections:

| Layer | What It Does |
|-------|-------------|
| **Bearer token auth** | Auto-generated 256-bit random token on first start, required on all `/api/*` routes |
| **WebSocket token** | Same token required as `?token=` query parameter on WebSocket upgrade |
| **Helmet headers** | Content-Security-Policy, X-Frame-Options, HSTS, X-Content-Type-Options |
| **CORS** | localhost-only, blocks cross-origin requests |
| **Rate limiting** | 200 requests/minute general; 20/minute on sensitive endpoints |
| **Inbound scanning** | POST/PUT bodies scanned for API keys, tokens, passwords — logs and rejects |
| **Outbound redaction** | All JSON responses scanned for leaked secrets before sending to browser |
| **Command whitelist** | Node execute endpoint only allows: `ls`, `df`, `uptime`, `whoami`, `pwd`, `date`, `ps`, `top` |
| **Secret storage** | `.auth-token` and OAuth files in `data/` — gitignored, 0600 permissions |

The auth token lives at `data/.auth-token` and is automatically used by:
- The browser UI (injected into `index.html` at serve time)
- The Claude Code slash commands
- The regression test suite

---

## Project Structure

```
~/.claude/plugins/computer/
│
├── README.md                          This document
├── package.json                       npm dependencies
├── .gitignore                         Excludes data/, moshi-env/, node_modules/
│
├── .claude-plugin/
│   └── plugin.json                    Claude Code plugin manifest
│
├── hooks/
│   └── hooks.json                     SessionStart: auto-starts server on Claude Code launch
│
├── commands/                          17 slash commands (/computer:*)
│   ├── computer.md                    Launch/stop LCARS server
│   ├── analyze.md                     AI text analysis
│   ├── search.md                      Web search
│   ├── transcribe.md                  Audio transcription
│   ├── status.md                      System diagnostics
│   ├── compare.md                     Side-by-side comparison
│   ├── summarize.md                   Document summarization
│   ├── monitor.md                     URL/file monitoring
│   ├── log.md                         Captain's log
│   ├── brief.md                       Activity briefing
│   ├── pipeline.md                    Chain operations
│   ├── know.md                        Knowledge base
│   ├── export.md                      Generate reports
│   ├── channels.md                    List messaging channels
│   ├── send.md                        Send messages
│   ├── gateway.md                     Service management
│   └── audit.md                       Security audit
│
├── agents/                            15 Claude-based agents
│   ├── analyst.md                     Sentiment, topics, action items
│   ├── researcher.md                  Web research + source evaluation
│   ├── visualizer.md                  Chart.js config generation
│   ├── transcription-processor.md     Transcript cleanup + speaker detection
│   ├── comparator.md                  Side-by-side comparison
│   ├── summarizer.md                  Multi-level summarization
│   ├── monitor.md                     URL/file/process monitoring
│   ├── translator.md                  Multi-language translation
│   ├── explainer.md                   Layered pedagogical explanations
│   ├── pipeline.md                    Workflow orchestration
│   ├── knowledge.md                   Knowledge store/retrieve
│   ├── channels.md                    Messaging + compose
│   ├── automation.md                  Cron + pipeline orchestration
│   ├── browser-agent.md               Web automation
│   └── security-agent.md              Security audits
│
├── skills/
│   └── computer-operations/           Operational knowledge for the plugin
│       └── SKILL.md
│
├── scripts/
│   ├── start.sh                       Start the Express server (idempotent)
│   ├── start-moshi.sh                 Start Moshi sidecar standalone
│   ├── status.sh                      Check server + Moshi status
│   ├── run-tests.sh                   Run voice regression tests
│   ├── build-check.js                 Verify prerequisites before start
│   └── setup-vad-libs.js              Download + place ONNX/VAD WASM files
│
├── tests/
│   └── voice-regression.mjs           33-test regression suite (voice pipeline)
│
├── server/
│   ├── index.js                       Server entry point: Express + WS + Moshi lifecycle
│   │
│   ├── middleware/
│   │   ├── auth.js                    Bearer token auth + token file management
│   │   └── security.js                Secret scanning (inbound) + redaction (outbound)
│   │
│   ├── routes/
│   │   ├── api.js                     CRUD: transcripts, analyses, logs, monitors, comparisons
│   │   ├── knowledge.js               Knowledge base: ingest, search, bulk, stats
│   │   ├── claude.js                  Claude CLI proxy with SSE streaming
│   │   ├── transcribe.js              Whisper CLI wrapper endpoint
│   │   ├── tts.js                     Coqui TTS endpoint → WAV file
│   │   ├── media.js                   Ollama vision: image/video analysis
│   │   ├── voice.js                   Voice status + Moshi control endpoints
│   │   └── gateway-extras.js          Sessions, agents, nodes, OAuth, Gmail, channels
│   │
│   └── services/
│       ├── moshi.js                   Moshi sidecar: spawn/stop + WebSocket bridge
│       ├── voice-assistant.js         Dual-model pipeline: xLAM routing + Scout responses
│       ├── websocket.js               WebSocket handler: mode routing, tool executor, charts
│       ├── config.js                  JSON config read/write (data/config.json)
│       ├── models.js                  Ollama model catalog + capability detection
│       ├── sessions.js                Voice session history tracking
│       ├── agents.js                  Agent definitions from YAML frontmatter in agents/*.md
│       ├── vision.js                  Ollama vision analysis (base64 image → structured JSON)
│       ├── node-local.js              Local machine node: camera, screen, whitelisted commands
│       ├── cron-scheduler.js          Cron with minute granularity, persistent in data/cron.json
│       ├── plugins.js                 Static tool/hook/plugin registry (26 tools, 4 hooks)
│       ├── gmail.js                   Gmail API: OAuth, inbox, send, threads, AI summaries
│       ├── vectordb.js                LanceDB connection pool
│       ├── embeddings.js              Ollama nomic-embed-text wrapper
│       ├── chunking.js                6 chunking strategies for knowledge ingestion
│       ├── search.js                  6 search methods (vector, BM25, hybrid, MMR, RRF)
│       ├── storage.js                 JSON file persistence (read/write/list/delete)
│       ├── transcription.js           Whisper CLI invocation + WAV prep
│       ├── tts.js                     Coqui TTS queue with WAV output
│       ├── claude-bridge.js           Ollama LLM bridge (chat completions)
│       └── notifications.js           macOS desktop notifications via osascript
│
├── ui/
│   ├── index.html                     SPA shell: auth token injection, 19 panel HTML
│   │
│   ├── css/
│   │   ├── lcars.css                  LCARS design system: typography, layout, color vars
│   │   └── components.css             Panel styles, voice button states, Moshi animations
│   │
│   └── js/
│       ├── app.js                     Bootstrap: WebSocket connect, panel registration, routing
│       │
│       ├── components/                19 panel components (each self-contained)
│       │   ├── dashboard-panel.js     Bridge overview: Moshi, Ollama, Gmail, security
│       │   ├── command-input.js       Text chat input with SSE streaming
│       │   ├── transcript-panel.js    STT history + mic toggle + file upload
│       │   ├── analysis-panel.js      Sentiment bars, topic tags, entities, action items
│       │   ├── chart-panel.js         Chart.js v4 with LCARS theming + table mode
│       │   ├── knowledge-panel.js     Vector search UI: query, method, results
│       │   ├── channels-panel.js      Gmail: inbox, thread view, compose, OAuth
│       │   ├── search-panel.js        Web search results with clickable links
│       │   ├── log-panel.js           Captain's log with stardates + category tags
│       │   ├── monitor-panel.js       Active monitors, check history, status dots
│       │   ├── comparison-panel.js    Side-by-side diff with similarity score
│       │   ├── gateway-panel.js       Sessions, agents, models (local service registry)
│       │   ├── plugins-panel.js       Tool/hook/plugin registry display
│       │   ├── cron-panel.js          Cron job grid + execution event log
│       │   ├── browser-panel.js       URL bar + embedded viewport
│       │   ├── nodes-panel.js         Local machine info + camera/screen capture
│       │   ├── security-panel.js      Shield gauge + redaction statistics
│       │   ├── voice-input.js         Microphone controls (MediaRecorder)
│       │   ├── voice-assistant-ui.js  Voice state machine: IDLE/LISTENING/MOSHI_ACTIVE/...
│       │   └── status-bar.js          Bottom bar: activity text + system indicators
│       │
│       ├── services/
│       │   ├── api-client.js          HTTP client with auth token injection
│       │   ├── websocket-client.js    WS client: JSON dispatch + binary Moshi frame routing
│       │   ├── speech-service.js      MediaRecorder audio capture
│       │   ├── audio-player.js        TTS queue (HTML5 Audio) + Moshi Opus streaming
│       │   └── vad-service.js         Silero VAD (Computer mode) + Opus capture (Moshi mode)
│       │
│       └── utils/
│           ├── formatters.js          Date/number/text formatting helpers
│           └── lcars-helpers.js       LCARS animation and UI helpers
│
├── lib/ (inside ui/ — VAD libraries)
│   ├── ort.min.js                     ONNX Runtime (runs Silero VAD model in browser)
│   ├── vad-bundle.min.js              Silero VAD JavaScript bundle (@ricky0123/vad-web)
│   ├── vad.worklet.bundle.min.js      VAD Web Audio Worklet (runs in audio thread)
│   ├── silero_vad.onnx                Pre-trained voice activity detection model (1.7MB)
│   ├── ort-wasm-simd-threaded.wasm    ONNX WASM with SIMD + threading (10MB)
│   └── ort-wasm-simd-threaded.mjs     WASM loader module
│
└── data/                              Runtime data — gitignored
    ├── .auth-token                    Auto-generated 256-bit auth token
    ├── config.json                    Runtime configuration
    ├── server.log                     Server output log
    ├── vectordb/                      LanceDB database files
    ├── transcripts/                   One JSON per transcript session
    ├── analyses/                      Saved analysis results
    ├── logs/                          Captain's log entries
    ├── monitors/                      Monitor definitions + history
    ├── comparisons/                   Comparison results
    ├── cron.json                      Cron job definitions
    ├── google-oauth.json              Google OAuth credentials (add this yourself)
    └── oauth-tokens/                  Gmail access/refresh tokens
```

---

## License

MIT — use it, fork it, build your own starship.
