#!/bin/bash
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Ensure node_modules exist (cache may be rebuilt)
if [ ! -d "$PLUGIN_ROOT/node_modules" ]; then
  cd "$PLUGIN_ROOT" && npm install --omit=dev --silent 2>/dev/null
fi

# Ensure data dirs exist
mkdir -p "$PLUGIN_ROOT/data"/{transcripts,analyses,sessions} 2>/dev/null

# Auto-start server if not running
if lsof -i :3141 -t > /dev/null 2>&1; then
  echo '{"systemMessage": "Computer LCARS interface is ONLINE at http://localhost:3141. Commands: /computer:search, /computer:analyze, /computer:transcribe, /computer:status"}'
else
  cd "$PLUGIN_ROOT" && nohup node server/index.js > data/server.log 2>&1 &
  sleep 2
  if lsof -i :3141 -t > /dev/null 2>&1; then
    echo '{"systemMessage": "Computer LCARS interface auto-started at http://localhost:3141. Commands: /computer:search, /computer:analyze, /computer:transcribe, /computer:status"}'
  else
    echo '{"systemMessage": "Computer LCARS interface is OFFLINE. Use /computer:computer to start it. Check data/server.log for errors."}'
  fi
fi
