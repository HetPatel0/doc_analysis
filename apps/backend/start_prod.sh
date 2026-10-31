#!/usr/bin/env bash

set -euo pipefail

BIND_HOST="${BIND_HOST:-0.0.0.0}"
PORT="${PORT:-8000}"

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Local runs use the app venv; Railway/containers use the interpreter that has
# the requirements installed (no .venv there).
if [[ -x "$SCRIPT_DIR/.venv/bin/python" ]]; then
  PYTHON_BIN="$SCRIPT_DIR/.venv/bin/python"
else
  PYTHON_BIN="${PYTHON_BIN:-python3}"
fi

exec "$PYTHON_BIN" -m uvicorn main:app \
  --host "$BIND_HOST" \
  --port "$PORT" \
  --proxy-headers \
  --forwarded-allow-ips "*"
