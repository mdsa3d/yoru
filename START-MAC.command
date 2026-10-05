#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 20 or newer, then run this file again."
  exit 1
fi
echo "YORU — starting local game server"
echo "Open http://localhost:8080 in your browser. Press Ctrl+C to stop."
node server.mjs
