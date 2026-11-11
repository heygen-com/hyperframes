#!/usr/bin/env bash
# smoke.sh — exercise the skill's source linter against fixture .tsx files.
#
# Scoring a translation is the CLI's `hyperframes diff`, tested with the CLI.
#
# Usage: ./smoke.sh
# Exit 0 on pass.

set -euo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$THIS_DIR/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> smoke: lint_source.py on clean fixture (expect exit 0)"
set +e
python3 "$SCRIPTS_DIR/lint_source.py" "$THIS_DIR/fixtures/clean.tsx" --json >"$WORK/clean.json"
RC=$?
set -e
BLOCKERS=$(python3 -c "import json; print(json.load(open('$WORK/clean.json'))['blockers'])")
if [[ "$RC" -ne 0 || "$BLOCKERS" -ne 0 ]]; then
  echo "FAIL: clean fixture reported $BLOCKERS blockers (rc=$RC)"
  exit 1
fi
INFOS=$(python3 -c "import json; print(json.load(open('$WORK/clean.json'))['infos'])")
echo "    clean.tsx → 0 blockers, $INFOS info findings"

echo "==> smoke: lint_source.py on blocker fixture (expect exit 1)"
set +e
python3 "$SCRIPTS_DIR/lint_source.py" "$THIS_DIR/fixtures/blocker.tsx" --json >"$WORK/blocker.json"
RC=$?
set -e
BLOCKERS=$(python3 -c "import json; print(json.load(open('$WORK/blocker.json'))['blockers'])")
if [[ "$RC" -eq 0 || "$BLOCKERS" -lt 3 ]]; then
  echo "FAIL: blocker fixture reported $BLOCKERS blockers, expected >=3 (rc=$RC)"
  cat "$WORK/blocker.json"
  exit 1
fi
echo "    blocker.tsx → $BLOCKERS blockers detected (correctly refused)"

echo
echo "✅ smoke tests passed"
