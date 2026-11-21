#!/usr/bin/env bash
# Run the offline backend test suite without risking the desktop.
#
# Why this exists:
#   - Desktop/agent shells can inject PYTHONHOME/PYTHONPATH from a bundled
#     runtime. Mixing those with the project venv makes pytest slow or stuck.
#   - tiktoken downloads its gpt2 vocab on first use and has no request timeout,
#     so a stalled network can freeze the first run. We pre-warm it with a
#     bounded timeout instead.
#   - The suite is capped at 2 GB RAM / no swap and a hard 2 minute timeout, so
#     a regression cannot OOM or hang the machine.
#
# Usage:
#   bash scripts/test.sh                 # whole suite
#   bash scripts/test.sh tests/test_store.py -q
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PYTHON="${PYTHON:-.venv/bin/python}"
if [[ ! -x "$PYTHON" ]]; then
  PYTHON=python3
fi

# Drop runtime paths injected by desktop app bundles.
unset PYTHONHOME PYTHONPATH __PYVENV_LAUNCHER__ LD_LIBRARY_PATH

# Warm tiktoken once, but never wait more than 30s for the network.
timeout 30 "$PYTHON" - <<'PY' >/dev/null 2>&1 || true
try:
    import tiktoken

    tiktoken.get_encoding("gpt2")
except Exception:
    pass
PY

if command -v systemd-run >/dev/null 2>&1 &&
  systemd-run --user --scope -q \
    -p MemoryMax=2G -p MemorySwapMax=0 -p RuntimeMaxSec=120 -- true >/dev/null 2>&1; then
  exec systemd-run --user --scope -q \
    -p MemoryMax=2G -p MemorySwapMax=0 -p RuntimeMaxSec=120 -- \
    "$PYTHON" -m pytest -q "$@"
fi

# Fallback when cgroups are unavailable: cap address space at 3 GB.
(
  ulimit -v 3145728 2>/dev/null || true
  exec timeout 120 "$PYTHON" -m pytest -q "$@"
)
