#!/usr/bin/env python3
"""
Voxtral STT Sidecar — Persistent HTTP server for local speech-to-text.

Loads the Voxtral Mini 3B model once via mlx-audio and serves transcription
requests over HTTP. Keeps the model warm in memory to avoid cold-start latency.

Endpoints:
  POST /transcribe  — accepts audio file (multipart), returns JSON with text
  POST /transcribe-buffer — accepts raw audio bytes in body, returns JSON
  GET  /health      — returns model status and memory usage

Port: 8997 (VOXTRAL_STT_PORT env var)
"""

import io
import json
import os
import sys
import time
import tempfile
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler

# Force HuggingFace to use local cache
os.environ.setdefault("HF_HOME", os.path.expanduser("~/.cache/huggingface"))

import mlx.core as mx
from mlx_audio.stt import load_model
from mlx_audio.stt.utils import load_audio

PORT = int(os.environ.get("VOXTRAL_STT_PORT", "8997"))
MODEL_ID = os.environ.get("VOXTRAL_MODEL", "mlx-community/Voxtral-Mini-3B-2507-bf16")

# Global model reference — loaded once on startup
model = None
model_load_time = 0


def load_stt_model():
    global model, model_load_time
    print(f"[voxtral-stt] Loading model: {MODEL_ID}")
    start = time.time()
    model = load_model(MODEL_ID)
    model_load_time = time.time() - start
    print(f"[voxtral-stt] Model loaded in {model_load_time:.1f}s")


def transcribe_audio(audio_path, language="en", max_tokens=256):
    """Transcribe an audio file using the loaded Voxtral model."""
    # Pass file path directly — processor handles loading, resampling, feature extraction
    result = model.generate(audio_path, language=language, max_tokens=max_tokens)
    return {
        "text": result.text.strip() if result.text else "",
        "prompt_tokens": result.prompt_tokens,
        "generation_tokens": result.generation_tokens,
        "total_time": result.total_time,
        "generation_tps": result.generation_tps,
    }


class STTHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[voxtral-stt] {args[0]}")

    def do_GET(self):
        if self.path == "/health":
            status = {
                "status": "ready" if model is not None else "loading",
                "model": MODEL_ID,
                "model_load_time": round(model_load_time, 1),
                "peak_memory_gb": round(mx.get_peak_memory() / 1e9, 2),
                "port": PORT,
            }
            self._respond(200, status)
        else:
            self._respond(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/transcribe" or self.path == "/transcribe-buffer":
            self._handle_transcribe()
        else:
            self._respond(404, {"error": "not found"})

    def _handle_transcribe(self):
        if model is None:
            self._respond(503, {"error": "Model not loaded yet"})
            return

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length == 0:
            self._respond(400, {"error": "No audio data"})
            return

        # Read params from query string or headers
        language = self.headers.get("X-Language", "en")
        max_tokens = int(self.headers.get("X-Max-Tokens", "256"))

        # Save incoming audio to temp file
        tmp_fd, tmp_path = tempfile.mkstemp(suffix=".wav")
        try:
            body = self.rfile.read(content_length)
            os.write(tmp_fd, body)
            os.close(tmp_fd)

            start = time.time()
            result = transcribe_audio(tmp_path, language=language, max_tokens=max_tokens)
            result["latency_ms"] = round((time.time() - start) * 1000)

            self._respond(200, result)
        except Exception as e:
            traceback.print_exc()
            self._respond(500, {"error": str(e)})
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    def _respond(self, code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    load_stt_model()

    server = HTTPServer(("127.0.0.1", PORT), STTHandler)
    print(f"[voxtral-stt] Listening on http://127.0.0.1:{PORT}")
    print(f"[voxtral-stt] Ready for transcription requests")
    sys.stdout.flush()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[voxtral-stt] Shutting down")
        server.server_close()
