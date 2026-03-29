# Computer -- USS Enterprise AI System

A Claude Code plugin that turns your machine into the USS Enterprise main computer. Speak to it. Ask it questions. Have it pull up charts, check your email, search the web, or set a red alert -- all through a real Star Trek LCARS interface running entirely on your own hardware.

![LCARS Interface](https://img.shields.io/badge/UI-LCARS%20Theme-FF9900?style=flat-square&labelColor=000000)
![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-CC99CC?style=flat-square&labelColor=000000)
![Node.js](https://img.shields.io/badge/Node.js-Express%20%2B%20WebSocket-9999FF?style=flat-square&labelColor=000000)
![LanceDB](https://img.shields.io/badge/Vector%20DB-LanceDB-55CC55?style=flat-square&labelColor=000000)
![Voice](https://img.shields.io/badge/Voice-Voxtral%20STT%20%2B%20Kokoro%20TTS-33CCFF?style=flat-square&labelColor=000000)
![Ollama](https://img.shields.io/badge/LLM-Llama%203.1%208B%20via%20Ollama-66CCFF?style=flat-square&labelColor=000000)
![Self-Contained](https://img.shields.io/badge/Mode-100%25%20Local-55CC55?style=flat-square&labelColor=000000)

---

## Table of Contents

- [What Is This?](#what-is-this)
- [Why Build It?](#why-build-it)
- [What Can It Do?](#what-can-it-do)
- [How It Works](#how-it-works)
  - [The Voice Pipeline](#the-voice-pipeline)
  - [The Single-Model Brain](#the-single-model-brain)
  - [The LCARS Interface](#the-lcars-interface)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Deployment Guide](#deployment-guide)
  - [1. Install System Dependencies](#1-install-system-dependencies)
  - [2. Clone and Install](#2-clone-and-install)
  - [3. Pull AI Models](#3-pull-ai-models)
  - [4. Set Up Voxtral STT (Recommended)](#4-set-up-voxtral-stt-recommended)
  - [5. Register as a Claude Code Plugin](#5-register-as-a-claude-code-plugin)
  - [6. Set Up Gmail (Optional)](#6-set-up-gmail-optional)
  - [7. Set Up Telegram (Optional)](#7-set-up-telegram-optional)
  - [8. Start and Verify](#8-start-and-verify)
- [Voice Interaction Guide](#voice-interaction-guide)
  - [Computer Mode -- Tool Commands](#computer-mode--tool-commands)
  - [Moshi Mode -- Natural Conversation (Optional)](#moshi-mode--natural-conversation-optional)
  - [Cloud Voice Modes (Optional)](#cloud-voice-modes-optional)
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

Computer is a self-contained AI assistant styled after the USS Enterprise computer from Star Trek. It runs as a Claude Code plugin -- meaning it auto-starts when you open a Claude Code session and integrates directly with your AI workflow.

You interact with it three ways:

1. **Voice** -- Click the diamond button (or enable always-on mode), speak naturally. The system listens, understands, acts, and speaks back. Say "Computer, what's the gold price?" and it will fetch the actual price from Yahoo Finance, synthesize an answer, and speak it to you -- all within 1-2 seconds. Keyboard shortcut: F5 or Space to toggle.

2. **Text command bar** -- Type commands into the `COMPUTER>` prompt at the bottom of the LCARS interface. Same 50 tools as voice, no microphone needed.

3. **Slash commands** -- Type `/computer:analyze`, `/computer:search`, `/computer:know` etc. directly in your Claude Code session. Results appear both in the terminal and are pushed to the LCARS browser interface in real-time.

Everything runs on your own machine. No cloud voice APIs required (though optional cloud S2S providers are available), no external AI services, no usage costs beyond your hardware.

---

## Why Build It?

**The problem:** AI assistants that depend on cloud APIs are inherently limited -- latency kills conversational flow, data leaves your machine, and costs compound at scale.

**The vision:** What if your AI assistant felt like the Enterprise computer? Instant acknowledgment, conversational speed, always listening, able to take real action -- not just answer questions.

**The approach:**
- **Local STT via Voxtral** -- Mistral's Voxtral Mini 3B runs as a local Python sidecar on port 8997 via mlx-audio, fully accelerated on Apple Silicon Metal GPU. Fast, accurate transcription with no cloud dependency.
- **Local TTS via Kokoro** -- Kokoro 82M runs in-process as a Node.js ONNX model via kokoro-js. 15 voices, ~92MB model, zero-latency startup. No Python subprocess needed.
- **Tool-augmented commands via "Computer"** -- When you say "Computer," you want action, not just conversation. A wake word triggers a single-model tool pipeline: llama3.1:8b handles both tool routing (via OpenAI-compatible tool_calls) and response generation. 50 voice tools cover web search, charts, email, calendar, Telegram, ambient sounds, and more. Full agentic capabilities triggered by voice.
- **Local LLMs only** -- Ollama runs llama3.1:8b entirely on your hardware. No API keys, no per-token cost, no data leaving your network.
- **Optional cloud S2S** -- Gemini Live, OpenAI Realtime, and Amazon Nova Sonic are available as additional voice modes for users who want cloud-powered speech-to-speech conversation.
- **LCARS for real** -- Not just aesthetic. The 19-panel interface is a functional dashboard: live charts, email threads, knowledge base, monitoring, quick action buttons, text command bar, always-on wake word toggle, and more -- all pushed in real-time via WebSocket as the AI completes work.

---

## What Can It Do?

### Voice (Computer Mode -- Default)
- Wake word "Computer" triggers tool-augmented voice commands
- Silero VAD for precise speech detection
- Voxtral STT for local transcription
- Kokoro TTS for natural voice responses with 15 selectable voices
- Mode cycle: CMD -> Gemini -> OpenAI -> Nova -> CMD

### Voice (Cloud S2S Modes -- Optional)
- **Gemini Live** -- Google Gemini speech-to-speech via WebSocket
- **OpenAI Realtime** -- OpenAI GPT-4o Realtime speech-to-speech
- **Amazon Nova Sonic** -- AWS Bedrock bidirectional streaming
- **Moshi** -- Kyutai's local speech-to-speech model (optional, not in default mode cycle)

### Voice (Computer Mode -- Tool Commands)
- **Web search** -- Real-time DuckDuckGo + page fetching. "Computer, search for the latest on GPT-5"
- **Live financial data** -- Spot prices from Swissquote (metals: gold/silver/platinum/palladium) and Google Finance (stocks/crypto). "Computer, what's the gold price?"
- **Smart charts** -- Natural language to Chart.js visualization with historical price data from Yahoo Finance API. "Computer, show me Tesla vs Apple stock this month" -> line chart with actual historical prices
- **Email** -- Check inbox, read emails, send replies, get follow-up summaries. "Computer, summarize my inbox"
- **Knowledge base** -- Semantic search over stored facts. "Computer, what do we know about the project timeline?"
- **Captain's log** -- Dictation with automatic LLM analysis (summary, sentiment, topics), action detection (email, calendar, reminders), and confirmation flow ("Shall I proceed?" / "Make it so"). "Computer, captain's log: mission briefing completed, need to email Admiral about status"
- **Telegram** -- Send and receive Telegram messages via @chadcomputerbot. Incoming messages appear as popups with TTS ("Captain, alert..."). Chat ID auto-learned. "Computer, send a Telegram to [contact]"
- **System control** -- Panel switching, alerts, reminders, monitoring. "Computer, red alert" / "Computer, show me the charts panel"
- **AI analysis** -- Sentiment, topics, entities, action items from text
- **Reminders** -- "Computer, remind me in 30 minutes to check the build"
- **News** -- Live news headlines via DuckDuckGo. "Computer, what's the latest news on SpaceX?"
- **Definitions** -- Instant word definitions via LLM. "Computer, define 'ephemeral'"
- **Notes** -- Quick save/list notes stored in knowledge base. "Computer, save a note: review PR by Friday"
- **Random facts** -- LLM-generated trivia. "Computer, tell me a random fact"
- **Activity reports** -- Daily/weekly summaries of voice commands, analyses, and logs. "Computer, generate a daily report"
- **Document analysis** -- Upload PDF/TXT/MD files for AI analysis. "Computer, analyze this document"
- **Ambient sounds** -- Procedural ambient audio (bridge, engineering, space) via Web Audio API. "Computer, play bridge ambience"
- **Unit conversion** -- 27 unit types integrated into the calculate tool. "Computer, convert 100 miles to kilometers"
- **Bookmarks** -- Save and list URL bookmarks. "Computer, bookmark https://example.com"

### Data Visualization
- Natural language chart requests ("bar chart of population by country")
- Historical financial prices via Yahoo Finance API (stocks, crypto, metals futures)
- Table rendering for structured data
- Source attribution links on every chart

### Knowledge Base
- LanceDB vector database with nomic-embed-text embeddings (768 dimensions)
- 6 chunking strategies: fixed, sentence, paragraph, sliding window, semantic, recursive
- 6 search methods: vector similarity, keyword (BM25), hybrid, MMR, multi-query with RRF
- Store and retrieve facts through voice or API

### Gmail Integration
- Full inbox access via OAuth -- no password stored
- Read full email threads
- Compose and send email
- AI-generated follow-up detection
- All accessible by voice

### Telegram Integration
- Send and receive messages via Telegram Bot API (@chadcomputerbot)
- Incoming messages broadcast via WebSocket as popups with TTS alerts
- Long-polling for incoming messages in the background
- Chat ID auto-learning -- the bot remembers contacts after first interaction
- Voice-triggered: "Computer, send a Telegram to [contact]"

### Monitoring and Cron
- Watch URLs, files, and processes for changes
- Minute-level cron scheduling with event log
- Desktop notifications on macOS

---

## How It Works

### The Voice Pipeline

Here is the complete path from your mouth to the computer's voice, step by step:

#### Computer Mode (default)

```
1. You speak into your microphone
2. Browser captures audio via MediaDevices API
3. Silero VAD (Voice Activity Detection) detects speech start/end in-browser
   -- runs as ONNX Runtime WebAssembly, entirely in-browser, no server round-trip
4. Captured speech sent as WAV blob over WebSocket to LCARS server
5. Voxtral STT (local MLX sidecar, port 8997) transcribes the WAV -> "what time is it"
6. llama3.1:8b receives transcription with 50 tool definitions
   -- OpenAI-compatible tool_calls, backed by 21 keyword safety nets
7. Tool executes locally -> {time, date, stardate}
8. Response shortcut: no LLM needed for known-format tools -> pre-built spoken string
   "The time is 10:07 AM. Wednesday, February 18, 2026. Stardate 102.132."
9. Kokoro TTS (local ONNX, in-process Node.js) synthesizes the text -> WAV
   -- For long responses, text is split at sentence boundaries and streamed as chunks
10. LCARS sends voice_response event with audioUrl to browser
11. Browser fetches WAV, plays through HTML5 Audio
12. VAD resumes listening
```

#### Moshi Mode (optional, not in default mode cycle)

```
1. You speak into your microphone
2. Browser captures audio via MediaDevices API at 24kHz mono
3. WebCodecs AudioEncoder compresses audio to Opus format (~80ms frames)
4. Each Opus frame gets a 0x01 kind byte prefix and is sent over WebSocket
5. LCARS server (port 3141) receives binary frames and forwards them to Moshi (port 8998)
6. Moshi processes audio in real-time -- it's a single neural network, so
   speech understanding and response generation happen simultaneously
7. Moshi sends back:
   - Opus audio frames (0x01 kind) -> LCARS relays to browser -> decoded by WebCodecs
     AudioDecoder -> played through AudioContext (seamlessly scheduled for zero gaps)
   - UTF-8 text tokens (0x02 kind) -> displayed in status bar as live transcript
8. If the transcript contains "Computer, [command]", the server:
   a. Pauses Moshi audio relay to browser (no dual-audio conflict)
   b. Stops sending your mic audio to Moshi
   c. Runs the command through the Computer Mode pipeline (see above)
   d. Resumes Moshi mode when done
```

#### Single-Model Architecture

The pipeline uses a single Ollama model -- llama3.1:8b -- for both tool routing and response generation. Tool routing uses OpenAI-compatible `tool_calls` via the `/v1/chat/completions` endpoint. This simplifies deployment (one model to pull and keep loaded) while maintaining reliable tool selection through 21 keyword-based safety nets that correct any routing misses.

### The Single-Model Brain

```
User input (text or voice)
        |
        v
   +---------------------+
   | llama3.1:8b          |  <- OpenAI-compatible tool_calls for routing
   | (tool routing)       |    Selects from 50 voice tools via structured JSON
   +----------+-----------+
              | tool_calls: [{name: "web_search_and_read", args: {...}}]
              v
   +---------------------+
   |  Tool Executor       |  <- 50 tools: search, charts, email, calendar, Telegram,
   |  (run the tools)     |    knowledge, notes, ambient, reports, etc.
   +----------+-----------+
              | tool_results: [{content: "Gold price: $2,847/oz..."}]
              v
   +---------------------+
   |  llama3.1:8b         |  <- Same model, second pass
   |  (write response)    |    Generates conversational spoken response from data
   +----------+-----------+
              | "The current gold spot price is twenty-eight forty-seven per troy ounce."
              v
      Kokoro TTS -> WAV -> Browser
```

Many tools bypass the second LLM pass entirely (shortcut paths) for speed and accuracy -- `get_time`, `set_alert`, `check_email`, `generate_chart`, `create_reminder`, etc. use pre-built response templates from the tool output, avoiding any chance of the LLM hallucinating numbers or facts.

**Captain's log pipeline:** When "captain's log" is detected, the system records the dictation, runs automatic LLM analysis (summary, sentiment, topics), detects actionable items (emails to send, calendar events, reminders), and presents a confirmation prompt. Saying "Make it so" or "yes" executes the detected actions.

**Conversation memory:** The pipeline maintains session history for pronoun resolution -- saying "chart that" after a search will use the previous search results as context.

**Multi-step chains:** Commands like "search for X, then chart it" are split and executed sequentially through the tool pipeline.

**Safety nets:** 21 keyword-based fallbacks cover all tool categories, ensuring commands route correctly even when the LLM misses the tool call.

### The LCARS Interface

The browser UI is a single-page application (no framework, no build step -- pure vanilla JavaScript ES modules served directly by Express). It maintains a persistent WebSocket connection to the server. As the AI completes work, it pushes results over WebSocket and the relevant panel auto-updates:

- A voice command for a chart -> `chart` WebSocket event -> chart panel renders -> `voice_panel_switch` event -> UI switches to charts panel
- A voice command for email -> `voice_response` with data -> channels panel shown
- An alert -> `alert_status` event -> entire UI flashes the alert color

The 19 panels share a common pattern: they register a WebSocket message handler in their constructor, and the server pushes data to them as events complete. No polling, no manual refresh.

Additional UI features:

- **Always-on wake word** -- AUTO/MANUAL toggle persists via localStorage. In AUTO mode, the system listens continuously for "Computer" without needing to click the diamond button. Auto-activates on page load when enabled.
- **Quick action buttons** -- 8 one-click LCARS buttons in the sidebar: TIME, WEATHER, SYSTEM, EMAIL, CALENDAR, REPORT, CONVERT, RED ALERT.
- **Text command bar** -- `COMPUTER>` prompt at the bottom of the screen. Type commands and press Enter to execute without voice.
- **Keyboard shortcuts** -- F5 or Space toggles voice on/off.
- **Voice suggestions overlay** -- "Try saying..." panel appears when listening, auto-dismisses after a few seconds.
- **Dashboard widgets** -- Live system stats, weather, calendar, and timer countdown displayed on the Dashboard panel.
- **Enhanced status bar** -- Live timer countdown, voice mode indicator (CMD/Gemini/OpenAI/Nova), and connected services count.
- **Streaming TTS** -- Long responses are split at sentence boundaries and streamed as chunks for faster perceived response time.
- **Sound effects** -- 6 Kokoro-generated audio cues (Acknowledged, Red/Yellow/Blue alert, Complete, Error) via the am_michael voice, triggered on specific events.
- **Telegram popups** -- Incoming Telegram messages appear as notification popups with TTS alerts ("Captain, alert from [sender]...").
- **Audio autoplay unlock** -- Silent WAV played on first user gesture to unlock browser autoplay policy.
- **Voice transcript logging** -- All voice interactions auto-saved to the Transcript panel with timestamps.

---

## Architecture

```
  +------------------------------------------------------------------+
  |                    Claude Code CLI Session                        |
  |  /computer:analyze, /computer:know, /computer:search ...         |
  +-------------------------------+----------------------------------+
                                  | HTTP POST
                                  v
  +------------------------------------------------------------------+
  |              Express + WebSocket Server (port 3141)              |
  |                                                                  |
  |  Security Layer                   WebSocket Handler              |
  |  +-- Helmet (CSP, X-Frame)       +-- Auth: ?token= query param  |
  |  +-- CORS (localhost only)        +-- Binary routing:            |
  |  +-- Rate limiting (200/min)      |   0x01 -> Moshi bridge       |
  |  +-- Bearer token auth            |   WAV/WebM -> Voxtral STT    |
  |  +-- Secret redaction             +-- JSON messages:             |
  |                                   |   voice_command -> tool loop  |
  |  REST API Routes                  |   voice_start -> mode connect |
  |  +-- /api/knowledge/*             +-- voice_cancel -> disconnect |
  |  +-- /api/tts/*, /api/transcribe/*                               |
  |  +-- /api/voice/*, /api/media/*                                  |
  |  +-- /api/gmail/*                                                |
  |  +-- /api/gateway/* (local services: agents, nodes, sessions)    |
  +------+-------------------------------------+---------------------+
         |                                     |
         |  WebSocket/HTTP                     | WebSocket push
         v                                     v
  +--------------------+     +------------------------------------------+
  | Voxtral STT Sidecar|     |         LCARS Web UI (Browser)           |
  | port 8997          |     |                                          |
  |                    |     |  Sidebar (19 panels) + Active Panel      |
  | mlx-audio (Python) |     |  * Voice button  | CMD/Gemini/OAI/Nova  |
  | Metal GPU accel    |     |  * Quick actions  | 8 one-click buttons  |
  +--------------------+     |  * Text command bar (COMPUTER> prompt)   |
                             |  Status bar (live transcript)            |
  +--------------------+     |  Silero VAD (ONNX WASM, in-browser)     |
  | Kokoro TTS         |     +------------------------------------------+
  | In-process Node.js |
  | kokoro-js (ONNX)   |     +------------------------------------------+
  | 15 voices, ~92MB   |     | Cloud S2S Providers (optional)           |
  +--------------------+     | +-- Gemini Live (WebSocket)              |
                             | +-- OpenAI Realtime (WebSocket)          |
  +--------------------+     | +-- Amazon Nova Sonic (Bedrock streaming) |
  | Moshi MLX Sidecar  |     +------------------------------------------+
  | port 8998 (opt.)   |
  | Opus I/O at 24kHz  |     +------------------------------------------+
  +--------------------+     | Telegram Bot API (optional)              |
                             | +-- Long-polling for incoming messages   |
  +--------------------+     | +-- WebSocket broadcast to LCARS UI      |
  |  Ollama (:11434)   |     +------------------------------------------+
  |  +-- llama3.1:8b           <- Tool routing + conversation responses
  |  +-- nomic-embed-text      <- Knowledge base embeddings
  +--------------------+
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
| **llama3.1:8b** | 4.9GB | Tool routing + conversation responses | `ollama pull llama3.1:8b` |

> **Apple Silicon note:** llama3.1:8b runs fully on the Metal GPU via Ollama. A Mac with 16GB RAM handles it well. 32GB is comfortable.

### For Voxtral STT (Recommended)

| Tool | Purpose | Install |
|------|---------|---------|
| **Python 3.14+** | Voxtral runtime | `brew install python` |
| **mlx-audio** | STT model (Voxtral Mini 3B) | `pip install mlx-audio` |

The Voxtral model (`mlx-community/Voxtral-Mini-3B-2507-bf16`) is auto-downloaded on first use. The server manages the Voxtral sidecar lifecycle automatically (port 8997).

### For Kokoro TTS (Included)

Kokoro TTS is installed as part of `npm install` via the `kokoro-js` npm package. The ONNX model (`onnx-community/Kokoro-82M-v1.0-ONNX`, q8 quantized, ~92MB) is auto-downloaded on first use. No additional setup required. 15 voices available (af_heart is the default). The model pre-warms on server start for zero-latency first use.

### For Telegram Bot (Optional)

No additional software required. Create a Telegram bot via [@BotFather](https://t.me/BotFather), then place the bot token in `data/telegram.json`:

```json
{
  "botToken": "YOUR_BOT_TOKEN",
  "chatIds": {}
}
```

Chat IDs are auto-learned when users message the bot. The server starts long-polling for incoming messages on launch.

### For Moshi Voice (Optional)

| Tool | Purpose | Install |
|------|---------|---------|
| **Python 3.12** | Moshi runtime | `brew install python@3.12` |
| **moshi_mlx** | Speech-to-speech model | `pip install moshi_mlx` |
| ~5GB disk | Moshi model weights | Auto-downloaded on first run |

---

## Deployment Guide

### 1. Install System Dependencies

```bash
# Node.js (if not installed)
brew install node

# Ollama (local LLM runtime)
brew install ollama

# Python (for Voxtral STT sidecar)
brew install python

# FFmpeg (for audio/video, optional)
brew install ffmpeg

# Start Ollama as a background service
ollama serve &
```

### 2. Clone and Install

```bash
# Clone into the Claude plugins directory
git clone https://github.com/chendren/computer.git ~/.claude/plugins/computer

# Install Node.js dependencies (includes kokoro-js for TTS)
cd ~/.claude/plugins/computer
npm install --omit=dev
```

### 3. Pull AI Models

```bash
# Required: embedding model for knowledge base (~274MB, fast)
ollama pull nomic-embed-text

# Required: tool routing + conversation model (~4.9GB)
ollama pull llama3.1:8b
```

> llama3.1:8b is a ~5GB download. The server will work without it loaded, but voice commands will fail until Ollama has the model available.

### 4. Set Up Voxtral STT (Recommended)

Voxtral STT runs as a Python sidecar on port 8997, managed automatically by the server. Install the Python dependency:

```bash
# Install mlx-audio (includes Voxtral Mini 3B support)
pip install mlx-audio
```

The server will auto-start the Voxtral sidecar (`scripts/voxtral-stt-server.py`) on launch and auto-download the model (`mlx-community/Voxtral-Mini-3B-2507-bf16`) on first transcription request.

To test Voxtral standalone:

```bash
python ~/.claude/plugins/computer/scripts/voxtral-stt-server.py
# Starts on http://localhost:8997 -- POST audio files for transcription
```

> **Browser requirement for voice:** Voice features require Chrome or Edge. Safari does not support all required audio APIs.

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

Gmail integration uses OAuth -- your credentials stay on your machine.

**Step 1: Create Google OAuth credentials**
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Enable the **Gmail API** in the API Library
4. Go to **Credentials** -> **Create Credentials** -> **OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Authorized redirect URIs: `http://localhost:3141/api/gateway/oauth/gmail/callback`
7. Download the JSON credentials file

**Step 2: Place credentials**
```bash
# Copy your downloaded credentials file
cp ~/Downloads/client_secret_*.json ~/.claude/plugins/computer/data/google-oauth.json
```

**Step 3: Authorize Gmail**
Start the server, then open the LCARS UI and go to the **Channels** panel. Click **Authorize Gmail**. This opens a browser OAuth flow -- log in and grant access. Done.

Or via API:
```bash
TOKEN=$(cat ~/.claude/plugins/computer/data/.auth-token)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3141/api/gateway/oauth/gmail/start
```

### 7. Set Up Telegram (Optional)

Create a bot via [@BotFather](https://t.me/BotFather), copy the token, and save it:

```bash
cat > ~/.claude/plugins/computer/data/telegram.json << 'EOF'
{
  "botToken": "YOUR_BOT_TOKEN_HERE",
  "chatIds": {}
}
EOF
```

The server starts Telegram long-polling automatically on launch. Send your bot a message from Telegram -- the chat ID is auto-learned and the message appears as a popup in the LCARS UI.

### 8. Start and Verify

```bash
# Start the server manually (auto-starts with Claude Code via SessionStart hook)
~/.claude/plugins/computer/scripts/start.sh

# Check server health
TOKEN=$(cat ~/.claude/plugins/computer/data/.auth-token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3141/api/health | python3 -m json.tool

# Run the full integration test suite (requires server running)
node ~/.claude/plugins/computer/tests/full-integration.mjs
```

Expected health response when everything is working:
```json
{
  "status": "online",
  "ollama": "online",
  "vectordb": "online",
  "voxtral": { "running": true, "port": 8997 },
  "gmail": { "connected": true, "email": "you@gmail.com" },
  "telegram": { "connected": true, "botUsername": "chadcomputerbot" }
}
```

Open **Chrome** and navigate to [http://localhost:3141](http://localhost:3141). You should see the LCARS interface. Click the diamond button in the title bar to activate voice.

---

## Voice Interaction Guide

> **Browser requirement:** Voice features require Chrome or Edge. Safari does not support all required audio APIs.

### Computer Mode -- Tool Commands

Computer mode is the default voice mode. It uses the full tool pipeline: Silero VAD -> Voxtral STT -> llama3.1:8b tool routing (50 tools, 21 safety nets) -> tool execution -> llama3.1:8b response -> Kokoro TTS (with streaming for long responses).

The mode cycle is: **CMD -> Gemini -> OpenAI -> Nova -> CMD**. Click the mode indicator in the title bar to cycle through modes.

1. Confirm the title bar shows **CMD** -- this is the default mode
2. Click the diamond button -- it pulses amber
3. Say **"Computer, [your command]"**
4. Watch the button states:
   - **Amber pulse** = listening for speech
   - **Bright amber** = speech captured, sending to server
   - **Red pulse** = thinking (running models)
   - **Green pulse** = speaking (TTS playing)
5. After the response, it returns to amber (listening)
6. You can say "Computer" again immediately for the next command

### Moshi Mode -- Natural Conversation (Optional)

Moshi is an optional voice mode providing full-duplex speech-to-speech conversation with ~200ms latency. It is not part of the default mode cycle and must be selected manually.

1. Open [http://localhost:3141](http://localhost:3141) in Chrome
2. Select **MOSHI** mode from the mode selector
3. Click the **diamond button** -- it turns cyan and pulses
4. **Start speaking naturally.** Moshi will respond with voice and text simultaneously
5. You can interrupt Moshi by speaking -- it's truly full-duplex
6. The status bar shows Moshi's live transcript as it speaks

**To issue a tool command from Moshi mode:**
Say **"Computer, [your command]"** -- for example:
- "Computer, what time is it?"
- "Computer, check my email"
- "Computer, show me a chart of gold prices this week"

The system detects "Computer" in Moshi's transcript, switches to Computer mode, runs the command, speaks the result, then returns to natural Moshi conversation.

**To stop:** Click the diamond button again. Moshi disconnects.

> **Browser requirement for Moshi:** Moshi requires WebCodecs API (Opus encode/decode). Use Chrome or Edge -- Safari does not support WebCodecs.

### Cloud Voice Modes (Optional)

Three cloud-based speech-to-speech providers are available as additional voice modes. Each requires its respective API key.

| Mode | Provider | What It Does |
|------|----------|-------------|
| **Gemini** | Google Gemini Live | Full-duplex S2S via WebSocket |
| **OpenAI** | OpenAI Realtime | GPT-4o real-time speech-to-speech |
| **Nova** | Amazon Nova Sonic | AWS Bedrock bidirectional streaming |

Use the TTS-only commands (`/computer:gemini-speak`, `/computer:openai-speak`, `/computer:nova-speak`) for verbatim text-to-speech without conversation.

### Voice Command Reference

| Say... | What Happens |
|--------|-------------|
| `Computer, what time is it?` | Returns time, date, and stardate |
| `Computer, search for [topic]` | DuckDuckGo search + page fetching, results in Search panel |
| `Computer, what is the gold price?` | Live spot price from Swissquote |
| `Computer, show me Tesla stock this week` | Live price + historical price chart (Yahoo Finance data) |
| `Computer, chart Amazon vs Microsoft` | Comparison line chart |
| `Computer, check my email` | Inbox overview in Channels panel |
| `Computer, summarize my inbox` | AI-generated inbox summary |
| `Computer, reply to John saying I'll be there` | Finds the email, opens compose |
| `Computer, send an email to user@example.com` | Opens compose with recipient |
| `Computer, remember [fact]` | Stores in vector knowledge base |
| `Computer, what do we know about [topic]` | Semantic search of knowledge base |
| `Computer, analyze [text]` | Sentiment, topics, entities, action items |
| `Computer, log [note]` | Captain's log entry with stardate, auto-analysis, and action detection |
| `Computer, red alert` | UI flashes red, visual/audio alert |
| `Computer, yellow alert` | UI flashes yellow |
| `Computer, stand down` | Returns to normal operations |
| `Computer, show me the charts panel` | Switches active panel |
| `Computer, remind me in 30 minutes to check the build` | Sets a timed reminder |
| `Computer, monitor https://example.com` | Sets up a URL monitor |
| `Computer, open https://example.com` | Opens URL in Browser panel |
| `Computer, what is my system status?` | Returns health/connectivity summary |
| `Computer, show me the dashboard` | Switches to Dashboard panel |
| `Computer, what's the latest news on [topic]` | News headlines via DuckDuckGo, speaks top 3 |
| `Computer, define [word]` | Instant word definition via LLM |
| `Computer, save a note: [text]` | Saves a quick note to knowledge base |
| `Computer, list my notes` | Lists all saved notes |
| `Computer, tell me a random fact` | LLM-generated trivia |
| `Computer, generate a daily report` | Activity summary of voice commands, analyses, logs |
| `Computer, play bridge ambience` | Procedural ambient sounds (bridge, engineering, space) |
| `Computer, convert 100 miles to kilometers` | Unit conversion (27 unit types) |
| `Computer, analyze this document` | PDF/TXT/MD upload + AI analysis |
| `Computer, send a Telegram to [contact]` | Send message via Telegram bot |
| `Computer, captain's log: [dictation]` | Log with analysis, action detection, and confirmation |
| `Computer, make it so` / `Computer, yes` | Confirm pending actions from captain's log |
| `Computer, bookmark https://example.com` | Save a URL bookmark |
| `Computer, list my bookmarks` | List all saved bookmarks |

---

## The 19 LCARS Panels

The interface is organized into three groups accessible from the sidebar.

### Core Group

| Panel | Purpose |
|-------|---------|
| **Dashboard** | Bridge overview: voice status, Ollama models, Gmail, security score, system uptime |
| **Main** | Text chat with Claude via SSE streaming, command history |
| **Transcript** | Live speech-to-text display, file upload, timestamped entries |
| **Analysis** | AI analysis results: sentiment bars, topic tags, entity list, action items |
| **Charts** | Chart.js visualizations with LCARS orange/lavender color theme, data tables |
| **Knowledge** | Vector search UI: query input, method selector, result cards with scores |

### Comms Group

| Panel | Purpose |
|-------|---------|
| **Channels** | Gmail: inbox list, full thread view, compose window, OAuth authorization. Telegram: incoming message popups, send via voice |
| **Search** | Web search results with clickable links, DuckDuckGo source |
| **Log** | Captain's log entries with stardates, categories (personal/mission/technical), LLM analysis (summary, sentiment, topics), and action detection |
| **Monitor** | Active URL/file monitors, check history with status dots |
| **Compare** | Side-by-side text comparison with similarity score and diff visualization |

### Ops Group

| Panel | Purpose |
|-------|---------|
| **Gateway** | Local service registry: sessions, agent definitions, Ollama model catalog |
| **Plugins** | Tool/hook/plugin registry -- what the computer knows how to do |
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
GET  /api/voice/status              Voice service info
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

Example -- store a fact:
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

Example -- search:
```bash
curl -X POST http://localhost:3141/api/knowledge/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "warp drive efficiency", "method": "hybrid", "limit": 5}'
```

#### Voice / TTS / STT

```
POST /api/tts/speak                 Synthesize text -> WAV file (Kokoro TTS)
GET  /api/tts/audio/:filename       Serve a generated audio file
POST /api/transcribe/file           Transcribe audio via Voxtral STT
```

Example -- generate speech:
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
- `0x00` = Handshake (Moshi -> LCARS server -> browser)
- `0x01` = Opus audio frame (bidirectional)
- `0x02` = UTF-8 text token (Moshi -> LCARS server -> browser)

#### Events the Server Sends to Browser

| Event | Payload | Meaning |
|-------|---------|---------|
| `status` | `{message, connected}` | Server status / welcome |
| `stt_result` | `{text}` | Voxtral transcription complete |
| `voice_thinking` | `{}` | LLM processing started |
| `voice_response` | `{text, audioUrl, toolsUsed, panelSwitch}` | Command result + audio |
| `voice_done` | `{}` | Turn fully complete |
| `voice_error` | `{error}` | Something went wrong |
| `voice_mode_changed` | `{mode, reason}` | Switched between modes |
| `moshi_text` | `{text, fullText}` | Live Moshi transcript token |
| `moshi_handshake` | config object | Moshi bridge connected |
| `moshi_error` | `{error}` | Moshi problem |
| `voice_panel_switch` | `{panel}` | Auto-switch to this panel |
| `chart` | `{chartConfig, sources, table}` | Push chart data to UI |
| `alert_status` | `{level, reason}` | Red/yellow/blue/normal alert |
| Binary `0x01...` | Opus frame bytes | Moshi audio (play immediately) |

#### Events the Browser Sends to Server

| Event | Payload | Meaning |
|-------|---------|---------|
| `voice_command` | `{text}` | Run this text as a voice command |
| `voice_mode` | `{mode}` | Switch to 'moshi', 'computer', 'gemini', 'openai', or 'nova' |
| `voice_start` | `{}` | Activate voice (triggers mode connect) |
| `voice_cancel` | `{}` | Deactivate voice |
| Binary `0x01...` | Opus frame bytes | Your microphone audio to Moshi |
| Binary WAV/WebM | audio bytes | Audio chunk for Voxtral STT |

---

## Configuration

### Environment Variables

Set these before starting the server, or in your shell profile:

| Variable | Default | Purpose |
|----------|---------|---------|
| `COMPUTER_PORT` | `3141` | Server HTTP + WebSocket port |
| `VOICE_MODEL` | `llama3.1:8b` | Ollama model for conversation responses |
| `ACTION_MODEL` | `llama3.1:8b` | Ollama model for tool routing (same as VOICE_MODEL by default) |
| `VISION_MODEL` | `llama3.1:8b` | Ollama model for image analysis |
| `OLLAMA_URL` | `http://localhost:11434` | Ollama API endpoint |
| `MOSHI_PORT` | `8998` | Moshi sidecar WebSocket port |
| `MOSHI_VENV` | `./moshi-env` | Path to Python venv for Moshi |
| `VOXTRAL_STT_PORT` | `8997` | Voxtral STT sidecar HTTP port |
| `VOXTRAL_PYTHON` | `python3` | Python binary for Voxtral sidecar |
| `VOXTRAL_MODEL` | `mlx-community/Voxtral-Mini-3B-2507-bf16` | Voxtral STT model identifier |
| `KOKORO_VOICE` | `af_heart` | Default Kokoro TTS voice |

### Runtime Config

The server reads and writes `data/config.json` at runtime. Access it via the API:

```bash
GET  /api/config       # Read current config
POST /api/config       # Update a config key
```

Key config fields:
- `vad.positiveSpeechThreshold` -- VAD sensitivity (default 0.8, higher = less sensitive)
- `vad.redemptionFrames` -- Frames before VAD decides speech ended (default 15)
- `tts.provider` -- TTS engine selection
- `stt.provider` -- STT engine selection

---

## Running Tests

Two test suites cover the system:

### Full Integration Suite (51 tests)

The comprehensive integration test suite covers all major subsystems:

```bash
# Make sure the server is running first
~/.claude/plugins/computer/scripts/start.sh

# Run all 51 tests
node ~/.claude/plugins/computer/tests/full-integration.mjs
```

What the 51 tests cover:
- Server health (Ollama, VectorDB, gateway)
- Kokoro TTS endpoint generates real audio
- Voxtral STT transcription accuracy
- TTS -> STT round-trip validation
- Knowledge base store/search/delete
- Full voice pipeline: `voice_command` -> tool routing -> tool execution -> response -> TTS
- Gateway endpoints (status, models, agents, sessions)
- Data API CRUD operations
- Security (auth token, secret scanning, rate limiting)
- Gateway extras (channels, cron, plugins)
- Browser UI static asset serving

### Voice Regression Suite (33 tests)

The original regression test suite focused on the voice pipeline:

```bash
# Run all 33 tests (~45 seconds, most of that is LLM warm-up)
node ~/.claude/plugins/computer/tests/voice-regression.mjs

# Or via the shell script
~/.claude/plugins/computer/scripts/run-tests.sh
```

What the tests cover:
- Server health (Ollama, VectorDB, gateway)
- Moshi process + WebSocket reachability
- TTS endpoint generates real audio
- Full WebSocket flow: `voice_start` -> `voice_mode_changed` -> connection
- Full LLM round-trip: `voice_command` -> tool routing -> tool execution -> response -> TTS
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

### Voxtral STT not working

```bash
# Check if mlx-audio is installed
python3 -c "import mlx_audio; print('OK')"

# Check if Voxtral sidecar is running on port 8997
curl http://localhost:8997/health

# Check server logs for sidecar errors
cat ~/.claude/plugins/computer/data/server.log | grep -i voxtral

# Test Voxtral standalone
python3 ~/.claude/plugins/computer/scripts/voxtral-stt-server.py
```

### Moshi not connecting (optional)

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

### Voice button does nothing / audio not working

Voice features require Chrome or Edge. Safari does not support all required audio APIs.

```
OK  Use Chrome or Edge
NO  Do not use Safari
```

If in Chrome and still failing, check the browser console (F12) for errors. Common causes:
- Microphone permission denied -> click the lock icon in the URL bar and allow microphone
- Server not running -> check http://localhost:3141/api/health

### Ollama not available / voice commands fail

```bash
# Check Ollama is running
curl http://localhost:11434/api/tags

# If not running
ollama serve &

# Check models are installed
ollama list | grep -E "llama3|nomic"

# Pull missing models
ollama pull llama3.1:8b
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
| **Inbound scanning** | POST/PUT bodies scanned for API keys, tokens, passwords -- logs and rejects |
| **Outbound redaction** | All JSON responses scanned for leaked secrets before sending to browser |
| **Command whitelist** | Node execute endpoint only allows: `ls`, `df`, `uptime`, `whoami`, `pwd`, `date`, `ps`, `top` |
| **Secret storage** | `.auth-token`, OAuth files, and Telegram bot token in `data/` -- gitignored, 0600 permissions |

The auth token lives at `data/.auth-token` and is automatically used by:
- The browser UI (injected into `index.html` at serve time)
- The Claude Code slash commands
- The regression test suite

---

## Project Structure

```
~/.claude/plugins/computer/
|
+-- README.md                          This document
+-- package.json                       npm dependencies (includes kokoro-js)
+-- .gitignore                         Excludes data/, moshi-env/, node_modules/
|
+-- .claude-plugin/
|   +-- plugin.json                    Claude Code plugin manifest
|
+-- hooks/
|   +-- hooks.json                     SessionStart: auto-starts server on Claude Code launch
|
+-- commands/                          20 slash commands (/computer:*)
|   +-- computer.md                    Launch/stop LCARS server
|   +-- analyze.md                     AI text analysis
|   +-- search.md                      Web search
|   +-- transcribe.md                  Audio transcription
|   +-- status.md                      System diagnostics
|   +-- compare.md                     Side-by-side comparison
|   +-- summarize.md                   Document summarization
|   +-- monitor.md                     URL/file monitoring
|   +-- log.md                         Captain's log
|   +-- brief.md                       Activity briefing
|   +-- pipeline.md                    Chain operations
|   +-- know.md                        Knowledge base
|   +-- export.md                      Generate reports
|   +-- channels.md                    List messaging channels
|   +-- send.md                        Send messages
|   +-- gateway.md                     Service management
|   +-- audit.md                       Security audit
|   +-- gemini-speak.md                TTS via Gemini Live
|   +-- nova-speak.md                  TTS via Amazon Nova Sonic
|   +-- openai-speak.md               TTS via OpenAI Realtime
|
+-- agents/                            15 Claude-based agents
|   +-- analyst.md                     Sentiment, topics, action items
|   +-- researcher.md                  Web research + source evaluation
|   +-- visualizer.md                  Chart.js config generation
|   +-- transcription-processor.md     Transcript cleanup + speaker detection
|   +-- comparator.md                  Side-by-side comparison
|   +-- summarizer.md                  Multi-level summarization
|   +-- monitor.md                     URL/file/process monitoring
|   +-- translator.md                  Multi-language translation
|   +-- explainer.md                   Layered pedagogical explanations
|   +-- pipeline.md                    Workflow orchestration
|   +-- knowledge.md                   Knowledge store/retrieve
|   +-- channels.md                    Messaging + compose
|   +-- automation.md                  Cron + pipeline orchestration
|   +-- browser-agent.md               Web automation
|   +-- security-agent.md              Security audits
|
+-- skills/                            4 skills
|   +-- computer-operations/           Operational knowledge for the plugin
|   |   +-- SKILL.md
|   +-- gemini-live-api/               Gemini Live API reference
|   |   +-- SKILL.md
|   +-- nova-sonic-api/                Amazon Nova Sonic API reference
|   |   +-- SKILL.md
|   +-- openai-realtime-api/           OpenAI Realtime API reference
|       +-- SKILL.md
|
+-- scripts/
|   +-- start.sh                       Start the Express server (idempotent)
|   +-- start-moshi.sh                 Start Moshi sidecar standalone
|   +-- voxtral-stt-server.py          Voxtral STT Python sidecar (port 8997)
|   +-- status.sh                      Check server + sidecar status
|   +-- run-tests.sh                   Run voice regression tests
|   +-- build-check.js                 Verify prerequisites before start
|   +-- setup-vad-libs.js              Download + place ONNX/VAD WASM files
|
+-- tests/
|   +-- full-integration.mjs           51-test full integration suite
|   +-- voice-regression.mjs           33-test voice regression suite
|
+-- server/
|   +-- index.js                       Server entry point: Express + WS + sidecar lifecycle
|   |
|   +-- middleware/
|   |   +-- auth.js                    Bearer token auth + token file management
|   |   +-- security.js                Secret scanning (inbound) + redaction (outbound)
|   |
|   +-- routes/
|   |   +-- api.js                     CRUD: transcripts, analyses, logs, monitors, comparisons
|   |   +-- knowledge.js               Knowledge base: ingest, search, bulk, stats
|   |   +-- claude.js                  Claude CLI proxy with SSE streaming
|   |   +-- transcribe.js              Voxtral STT endpoint
|   |   +-- tts.js                     Kokoro TTS endpoint -> WAV file
|   |   +-- media.js                   Ollama vision: image/video analysis
|   |   +-- voice.js                   Voice status + sidecar control endpoints
|   |   +-- gateway-extras.js          Sessions, agents, nodes, OAuth, Gmail, channels
|   |
|   +-- services/
|       +-- moshi.js                   Moshi sidecar: spawn/stop + WebSocket bridge
|       +-- voxtral-stt.js             Voxtral STT sidecar lifecycle manager
|       +-- voice-assistant.js         Single-model pipeline: llama3.1 tool routing + responses (50 tools, 21 safety nets)
|       +-- websocket.js               WebSocket handler: mode routing, tool executor, charts
|       +-- gemini-live.js             Gemini Live S2S service
|       +-- openai-realtime.js         OpenAI Realtime S2S service
|       +-- nova-sonic.js              Amazon Nova Sonic S2S service
|       +-- monitor-poller.js          Background URL health checks
|       +-- config.js                  JSON config read/write (data/config.json)
|       +-- models.js                  Ollama model catalog + capability detection
|       +-- sessions.js                Voice session history tracking
|       +-- agents.js                  Agent definitions from YAML frontmatter in agents/*.md
|       +-- vision.js                  Ollama vision analysis (base64 image -> structured JSON)
|       +-- node-local.js              Local machine node: camera, screen, whitelisted commands
|       +-- cron-scheduler.js          Cron with minute granularity, persistent in data/cron.json
|       +-- plugins.js                 Static tool/hook/plugin registry (50 tools, 4 hooks)
|       +-- gmail.js                   Gmail API: OAuth, inbox, send, threads, AI summaries
|       +-- vectordb.js                LanceDB connection pool
|       +-- embeddings.js              Ollama nomic-embed-text wrapper
|       +-- chunking.js                6 chunking strategies for knowledge ingestion
|       +-- search.js                  6 search methods (vector, BM25, hybrid, MMR, RRF)
|       +-- storage.js                 JSON file persistence (read/write/list/delete)
|       +-- transcription.js           Voxtral STT invocation + audio prep
|       +-- tts.js                     Kokoro TTS queue with WAV output
|       +-- claude-bridge.js           Ollama LLM bridge (chat completions)
|       +-- notifications.js           macOS desktop notifications via osascript
|       +-- sound-effects.js          Pre-generated Kokoro sound effect WAVs (6 cues)
|       +-- calendar.js               Google Calendar API service
|       +-- telegram.js               Telegram Bot API: long-polling, send/receive, chat ID learning
|       +-- gmail-intelligence.js     AI-powered email analysis and follow-up detection
|
+-- ui/
|   +-- index.html                     SPA shell: auth token injection, 19 panel HTML
|   |
|   +-- css/
|   |   +-- lcars.css                  LCARS design system: typography, layout, color vars
|   |   +-- components.css             Panel styles, voice button states, animations
|   |
|   +-- js/
|       +-- app.js                     Bootstrap: WebSocket connect, panel registration, routing
|       |
|       +-- components/                19 panel components (each self-contained)
|       |   +-- dashboard-panel.js     Bridge overview: voice, Ollama, Gmail, security
|       |   +-- command-input.js       Text chat input with SSE streaming
|       |   +-- transcript-panel.js    STT history + mic toggle + file upload
|       |   +-- analysis-panel.js      Sentiment bars, topic tags, entities, action items
|       |   +-- chart-panel.js         Chart.js v4 with LCARS theming + table mode
|       |   +-- knowledge-panel.js     Vector search UI: query, method, results
|       |   +-- channels-panel.js      Gmail: inbox, thread view, compose, OAuth
|       |   +-- search-panel.js        Web search results with clickable links
|       |   +-- log-panel.js           Captain's log with stardates + category tags
|       |   +-- monitor-panel.js       Active monitors, check history, status dots
|       |   +-- comparison-panel.js    Side-by-side diff with similarity score
|       |   +-- gateway-panel.js       Sessions, agents, models (local service registry)
|       |   +-- plugins-panel.js       Tool/hook/plugin registry display
|       |   +-- cron-panel.js          Cron job grid + execution event log
|       |   +-- browser-panel.js       URL bar + embedded viewport
|       |   +-- nodes-panel.js         Local machine info + camera/screen capture
|       |   +-- security-panel.js      Shield gauge + redaction statistics
|       |   +-- voice-input.js         Microphone controls (MediaRecorder)
|       |   +-- voice-assistant-ui.js  Voice state machine: IDLE/LISTENING/CMD_ACTIVE/...
|       |   +-- status-bar.js          Bottom bar: activity text + system indicators
|       |
|       +-- services/
|       |   +-- api-client.js          HTTP client with auth token injection
|       |   +-- websocket-client.js    WS client: JSON dispatch + binary frame routing
|       |   +-- speech-service.js      MediaRecorder audio capture
|       |   +-- audio-player.js        TTS queue (HTML5 Audio) + streaming playback
|       |   +-- vad-service.js         Silero VAD (Computer mode) + audio capture
|       |   +-- gemini-audio.js        Gemini Live audio bridge
|       |   +-- ambient-audio.js      Web Audio API procedural ambient sounds
|       |
|       +-- utils/
|           +-- formatters.js          Date/number/text formatting helpers
|           +-- lcars-helpers.js       LCARS animation and UI helpers
|
+-- lib/ (inside ui/ -- VAD libraries)
|   +-- ort.min.js                     ONNX Runtime (runs Silero VAD model in browser)
|   +-- vad-bundle.min.js              Silero VAD JavaScript bundle (@ricky0123/vad-web)
|   +-- vad.worklet.bundle.min.js      VAD Web Audio Worklet (runs in audio thread)
|   +-- silero_vad.onnx                Pre-trained voice activity detection model (1.7MB)
|   +-- ort-wasm-simd-threaded.wasm    ONNX WASM with SIMD + threading (10MB)
|   +-- ort-wasm-simd-threaded.mjs     WASM loader module
|
+-- data/                              Runtime data -- gitignored
    +-- .auth-token                    Auto-generated 256-bit auth token
    +-- config.json                    Runtime configuration
    +-- server.log                     Server output log
    +-- vectordb/                      LanceDB database files
    +-- transcripts/                   One JSON per transcript session
    +-- analyses/                      Saved analysis results
    +-- logs/                          Captain's log entries
    +-- monitors/                      Monitor definitions + history
    +-- comparisons/                   Comparison results
    +-- cron.json                      Cron job definitions
    +-- google-oauth.json              Google OAuth credentials (add this yourself)
    +-- telegram.json                  Telegram bot token + learned chat IDs (add this yourself)
    +-- oauth-tokens/                  Gmail access/refresh tokens
```

---

## License

MIT -- use it, fork it, build your own starship.
