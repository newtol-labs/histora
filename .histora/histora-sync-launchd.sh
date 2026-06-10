#!/bin/sh
set -u

child_pid=""
cleanup() {
  if [ -n "$child_pid" ]; then
    kill "$child_pid" 2>/dev/null || true
  fi
  exit 143
}
trap cleanup TERM INT HUP

export HISTORA_WORKSPACE='/Users/jet/Documents/Chathub'
export CHATHUB_WORKSPACE='/Users/jet/Documents/Chathub'

echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') launchd-start root=$HISTORA_WORKSPACE"
'/Users/jet/.hermes/node/bin/node' '/Users/jet/Documents/Chathub/src/cli.mjs' 'sync' &
child_pid=$!
elapsed=0
timeout=600

while kill -0 "$child_pid" 2>/dev/null; do
  if [ "$elapsed" -ge "$timeout" ]; then
    echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') launchd-timeout pid=$child_pid timeout=$timeout"
    kill "$child_pid" 2>/dev/null || true
    sleep 5
    kill -9 "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
    exit 124
  fi
  sleep 1
  elapsed=$((elapsed + 1))
done

wait "$child_pid"
status=$?
echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') launchd-exit status=$status runtime=$elapsed"
exit "$status"
