#!/bin/bash
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PLUGIN_ROOT"

# Install dependencies if needed (handles cache rebuilds)
if [ ! -d "node_modules" ] || [ ! -f "node_modules/express/package.json" ]; then
  npm install --omit=dev 2>&1
fi

# Ensure data dirs exist
mkdir -p data/{transcripts,analyses,sessions} 2>/dev/null

# Check if already running
if lsof -i :3141 -t > /dev/null 2>&1; then
  echo "Computer already online at http://localhost:3141"
  exit 0
fi

# Start server in background
nohup node server/index.js > data/server.log 2>&1 &
echo $! > data/server.pid
sleep 2

if lsof -i :3141 -t > /dev/null 2>&1; then
  echo "Computer online at http://localhost:3141"
else
  echo "Failed to start. Check data/server.log"
  exit 1
fi
