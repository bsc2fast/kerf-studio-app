#!/usr/bin/env bash
# serve.sh — run the Cutter Studio bridge (serves the app AND forwards .plt to the
# machine over TCP). Open http://localhost:8080/ in Chrome/Edge.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${1:-8080}"
echo "Starting Cutter Studio bridge on http://localhost:$PORT/"
echo "(serves app/ + POST /api/send → machine over TCP. Ctrl+C to stop.)"
exec node "$ROOT/server.mjs" "$PORT"
