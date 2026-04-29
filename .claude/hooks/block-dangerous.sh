#!/usr/bin/env bash
set -euo pipefail
payload="$(cat || true)"
cmd="$(printf '%s' "$payload" | python3 -c 'import json,sys
try:
 data=json.load(sys.stdin)
 print((data.get("tool_input") or {}).get("command", ""))
except Exception:
 print("")')"
if printf '%s' "$cmd" | grep -Eiq '(^|[;&|[:space:]])(sudo|rm[[:space:]]+-rf[[:space:]]+/|chmod[[:space:]]+777|git[[:space:]]+push[[:space:]].*--force|git[[:space:]]+reset[[:space:]]+--hard|npm[[:space:]]+publish|curl[^
]*\|[[:space:]]*(sh|bash)|wget[^
]*\|[[:space:]]*(sh|bash))'; then
  echo "Blocked dangerous command: $cmd"
  exit 2
fi
exit 0
