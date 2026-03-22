#!/usr/bin/env bash
# Start the OpenClaw gateway using Claude Code's OAuth token.
# Reads the token fresh from ~/.claude/.credentials.json on each start.
# Token auto-refreshes via Claude Code, so restart the gateway if it expires.

set -euo pipefail

CREDS_FILE="$HOME/.claude/.credentials.json"
OPENCLAW_BIN="$HOME/.nemoclaw/source/node_modules/.bin/openclaw"

if [[ ! -f "$CREDS_FILE" ]]; then
  echo "Error: Claude Code credentials not found at $CREDS_FILE" >&2
  echo "Run Claude Code first to authenticate." >&2
  exit 1
fi

# Extract the OAuth access token
TOKEN=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['claudeAiOauth']['accessToken'])")

if [[ -z "$TOKEN" ]]; then
  echo "Error: Could not extract OAuth token from $CREDS_FILE" >&2
  exit 1
fi

# Kill any existing gateway
pkill -f "openclaw-gatewa" 2>/dev/null || true
sleep 1

export OPENCLAW_CONFIG_PATH="$HOME/.openclaw/openclaw.json"
export NODE_COMPILE_CACHE=/var/tmp/openclaw-compile-cache
export OPENCLAW_NO_RESPAWN=1
export ANTHROPIC_OAUTH_TOKEN="$TOKEN"

echo "Starting OpenClaw gateway with Claude Code OAuth token..."
exec "$OPENCLAW_BIN" gateway run "$@"
