#!/bin/bash
# Start Moshi MLX speech-to-speech sidecar
# Runs on port 8998 by default (set MOSHI_PORT to override)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="$(dirname "$SCRIPT_DIR")"
VENV="$PLUGIN_ROOT/moshi-env"

if [ ! -d "$VENV" ]; then
  echo "[moshi] Virtual environment not found at $VENV"
  echo "[moshi] Create it: python3.12 -m venv $VENV && $VENV/bin/pip install moshi_mlx"
  exit 1
fi

source "$VENV/bin/activate"
echo "[moshi] Starting Moshi MLX (q4, port ${MOSHI_PORT:-8998})..."
exec python -m moshi_mlx.local_web -q 4 --hf-repo kyutai/moshika-mlx-q4
