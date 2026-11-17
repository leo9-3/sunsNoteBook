#!/bin/sh
# Intranet Notebook launcher (Linux / macOS)
# Uses the bundled offline runtime if present, otherwise the system Node.js (>=18).
cd "$(dirname "$0")" || exit 1
export PORT="${PORT:-4173}"
if [ -x "./runtime/linux-x64/bin/node" ]; then
  NODE="./runtime/linux-x64/bin/node"
else
  NODE="$(command -v node || true)"
fi
if [ -z "$NODE" ]; then
  echo "Node.js not found. Use the offline package with the bundled runtime, or install Node.js >= 18." >&2
  exit 1
fi
echo "Intranet Notebook: http://localhost:$PORT  (intranet: http://THIS-SERVER-IP:$PORT)"
exec "$NODE" server.js
