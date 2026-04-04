#!/bin/bash
set -e

# Claude Code UI hook script
# Called by Claude CLI via ~/.claude/settings.json hooks
# Reads hook input from stdin (JSON) and forwards to Claude Code UI server

# Read JSON input from stdin
INPUT=$(cat)

# Extract event name from input
EVENT=$(echo "$INPUT" | grep -o '"hook_event_name":"[^"]*"' | cut -d'"' -f4)

# Forward to Claude Code UI server
# Try all known ports (dev=9001, stable=9002, default=3001)
for PORT in 9001 9002 3001; do
  curl -s -X POST "http://localhost:${PORT}/api/hook-event" \
    -H "Content-Type: application/json" \
    -d "$INPUT" \
    --connect-timeout 1 \
    --max-time 2 \
    >/dev/null 2>&1 && break || true
done

# Always exit 0 to not block Claude
exit 0
