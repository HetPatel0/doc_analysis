#!/usr/bin/env bash

set -euo pipefail

BIND_HOST="${BIND_HOST:-127.0.0.1}"
PORT="${PORT:-8000}"

SCRIPT_DIR="$(cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="$SCRIPT_DIR/.venv/bin/python"

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "Python virtual environment not found at $PYTHON_BIN" >&2
  exit 1
fi

exec "$PYTHON_BIN" -m uvicorn main:app \
  --host "$BIND_HOST" \
  --port "$PORT" \
  --reload \
  --reload-exclude ".venv" \
  --reload-exclude "uploads" \
  --reload-exclude "vectorstores" \
  --reload-exclude "chroma_db" \
  --reload-exclude "__pycache__"
