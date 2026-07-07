#!/usr/bin/env bash
# Re-extract (offline) → regenerate → render → verify, across all 11 captures. Sequential so each
# site gets its own Chrome without port/resource contention.
set -u
cd "$(dirname "$0")"
SITES="stripe livekit doordash snowflake linear elevenlabs kuse heygen opus descript bmw"
for s in $SITES; do
  echo "=== $s ==="
  node reextract-design.mjs --capture "../$s-capture" 2>&1 | grep -E "✓|✗|backgrounds" || echo "  reextract FAIL"
  node build-frame-from-capture.mjs --capture "../$s-capture" >/dev/null 2>&1 && echo "  gen: ok" || echo "  gen: FAIL"
  node render-showcase.mjs --frame "../$s-capture/frame.md" --no-sandbox >/dev/null 2>&1 && echo "  render: ok" || echo "  render: FAIL"
  node verify-frame.mjs --frame "../$s-capture/frame.md" --capture "../$s-capture" 2>&1 | grep -iE "all gates pass|FAIL|✗" | tail -1
done
echo "=== DONE ==="
