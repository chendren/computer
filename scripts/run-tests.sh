#!/bin/bash
# Run the voice pipeline regression test suite.
# Usage: scripts/run-tests.sh [--quick]
#
# --quick: skip the WebSocket voice_command test (which waits up to 45s for LLM)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/.."

# Verify server is up
if ! curl -sf http://localhost:3141/api/health >/dev/null 2>&1; then
  echo "Server is not running. Start it first:"
  echo "  $ROOT/scripts/start.sh"
  exit 1
fi

cd "$ROOT" || exit 1
node tests/voice-regression.mjs "$@"
