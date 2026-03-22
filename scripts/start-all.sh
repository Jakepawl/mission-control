#!/usr/bin/env bash
# Start both the OpenClaw gateway and Mission Control.
# Reads Claude Code OAuth token for gateway auth.

set -euo pipefail

CREDS_FILE="$HOME/.claude/.credentials.json"
MC_DIR="$HOME/.nemoclaw/source/mission-control"
OPENCLAW_BIN="$HOME/.nemoclaw/source/node_modules/.bin/openclaw"

if [[ ! -f "$CREDS_FILE" ]]; then
  echo "Error: Claude Code credentials not found at $CREDS_FILE" >&2
  exit 1
fi

TOKEN=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['claudeAiOauth']['accessToken'])")

# --- Gateway ---
pkill -f "openclaw-gatewa" 2>/dev/null || true
sleep 1

export OPENCLAW_CONFIG_PATH="$HOME/.openclaw/openclaw.json"
export NODE_COMPILE_CACHE=/var/tmp/openclaw-compile-cache
export OPENCLAW_NO_RESPAWN=1
export ANTHROPIC_OAUTH_TOKEN="$TOKEN"

echo "Starting OpenClaw gateway..."
nohup "$OPENCLAW_BIN" gateway run > /tmp/openclaw-gateway.log 2>&1 &
GW_PID=$!
sleep 3

if curl -s http://127.0.0.1:18789/health | grep -q '"ok":true'; then
  echo "  Gateway running (PID $GW_PID)"
else
  echo "  Warning: Gateway may not be ready yet"
fi

# --- Mission Control ---
kill "$(lsof -t -i:3001 2>/dev/null)" 2>/dev/null || true
sleep 1

cd "$MC_DIR"

PORT=3001 HOSTNAME=0.0.0.0 \
MISSION_CONTROL_DATA_DIR="$MC_DIR/.data" \
OPENCLAW_CONFIG_PATH="$HOME/.openclaw/openclaw.json" \
OPENCLAW_BIN="$OPENCLAW_BIN" \
OPENCLAW_GATEWAY_HOST=127.0.0.1 \
OPENCLAW_GATEWAY_PORT=18789 \
OPENCLAW_GATEWAY_TOKEN=d39629cde30ff56d8aea7178ea45de315f514e85e03ade2d4ee272e21de10a6b \
NEXT_PUBLIC_GATEWAY_HOST=trinitypressed.com \
NEXT_PUBLIC_GATEWAY_PORT=18789 \
NEXT_PUBLIC_GATEWAY_OPTIONAL=false \
NEXT_PUBLIC_BASE_PATH=/admin \
MC_ALLOWED_HOSTS=localhost,127.0.0.1,trinitypressed.com \
NEMOCLAW_STATE_DIR=~/.nemoclaw \
NEMOCLAW_SOURCE_DIR=~/.nemoclaw/source \
MC_DEFAULT_ADAPTER=nemoclaw \
nohup node .next/standalone/mission-control/server.js > /tmp/mission-control.log 2>&1 &
MC_PID=$!
sleep 3

if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/admin/login | grep -q "200"; then
  echo "  Mission Control running (PID $MC_PID)"
else
  echo "  Mission Control running (PID $MC_PID) - may need /admin/setup first"
fi

echo ""
echo "Done. Gateway: ws://127.0.0.1:18789 | MC: http://trinitypressed.com/admin"
