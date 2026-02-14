---
description: Launch or stop the Computer LCARS web interface
argument-hint: "[stop]"
allowed-tools: [Bash, Read]
---

# Computer — Launch LCARS Interface

Start the Computer web interface server, or stop it if "stop" is passed.

## Process

User arguments: $ARGUMENTS

### If the argument is "stop":

1. Find the server process: `lsof -i :3141 -t`
2. If running, kill it: `kill $(lsof -i :3141 -t)`
3. Remove the PID file: `rm -f "${CLAUDE_PLUGIN_ROOT}/data/server.pid"`
4. Report: "Computer offline."

### Otherwise (start the server):

1. Check if already running: `lsof -i :3141 -t`
   - If running, report "Computer already online at http://localhost:3141"

2. If not running, install dependencies if needed:
   - Check for node_modules: `ls "${CLAUDE_PLUGIN_ROOT}/node_modules" 2>/dev/null`
   - If missing: `cd "${CLAUDE_PLUGIN_ROOT}" && npm install --production`

3. Start the server in the background:
   ```
   cd "${CLAUDE_PLUGIN_ROOT}" && nohup node server/index.js > data/server.log 2>&1 &
   echo $! > data/server.pid
   ```

4. Wait 2 seconds, then verify: `lsof -i :3141 -t`

5. Open the browser: `open http://localhost:3141`

6. Report status:
   ```
   Computer online at http://localhost:3141

   Available panels:
   - Main: Conversational AI interface
   - Transcript: Live voice transcription + file upload
   - Analysis: AI-powered text analysis with sentiment, topics, and action items
   - Charts: Dynamic Chart.js visualizations
   - Search: Web search with AI synthesis
   ```
