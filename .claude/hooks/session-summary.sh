#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
mkdir -p "$root/.claude/session-summaries"
ts="$(date +%Y%m%dT%H%M%S%z)"
out="$root/.claude/session-summaries/$ts.md"
{
  echo "# Claude Session Summary — $ts"
  echo
  echo "## Git status"
  git -C "$root" status --short || true
  echo
  echo "## Recent commits"
  git -C "$root" log --oneline -5 || true
  echo
  echo "## Reminder"
  echo "Before compaction or handoff, preserve modified files, test status, unresolved issues, decisions, PR/issue links, and next command."
} > "$out"
echo "Session summary written: $out"
