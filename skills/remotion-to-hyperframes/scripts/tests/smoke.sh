#!/usr/bin/env bash
# smoke.sh — exercise the eval harness scripts against synthetic inputs.
#
# Generates two synthetic videos with ffmpeg's testsrc filter, runs render_diff
# and frame_strip against them, and runs lint_source against fixture .tsx files.
# Asserts the harness produces sensible output without depending on a real
# Remotion or HyperFrames render pipeline being installed.
#
# Usage: ./smoke.sh
# Exit 0 on pass.

set -euo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$THIS_DIR/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> smoke: render_diff.sh against identical inputs"
# Generate the same test pattern twice. Identical inputs → SSIM should be ~1.0.
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc=duration=2:size=320x240:rate=30" \
  -pix_fmt yuv420p "$WORK/baseline.mp4"
cp "$WORK/baseline.mp4" "$WORK/translated.mp4"

R2HF_SSIM_THRESHOLD=0.99 "$SCRIPTS_DIR/render_diff.sh" \
  "$WORK/baseline.mp4" "$WORK/translated.mp4" "$WORK/diff" >/dev/null

MEAN=$(python3 -c "import json,sys; print(json.load(open('$WORK/diff/summary.json'))['mean'])")
PASS=$(python3 -c "import json,sys; print(json.load(open('$WORK/diff/summary.json'))['pass'])")
if [[ "$PASS" != "True" ]]; then
  echo "FAIL: identical inputs failed pass check (mean=$MEAN)"
  exit 1
fi
echo "    identical inputs → mean SSIM=$MEAN (pass=True)"

echo "==> smoke: render_diff.sh against different inputs"
# Different test pattern → SSIM should be lower. With a high threshold it should fail.
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=duration=2:size=320x240:rate=30" \
  -pix_fmt yuv420p "$WORK/different.mp4"

set +e
R2HF_SSIM_THRESHOLD=0.99 "$SCRIPTS_DIR/render_diff.sh" \
  "$WORK/baseline.mp4" "$WORK/different.mp4" "$WORK/diff2" >/dev/null
RC=$?
set -e
if [[ "$RC" -eq 0 ]]; then
  echo "FAIL: different inputs unexpectedly passed at threshold 0.99"
  exit 1
fi
DIFF_MEAN=$(python3 -c "import json; print(json.load(open('$WORK/diff2/summary.json'))['mean'])")
echo "    different inputs → mean SSIM=$DIFF_MEAN (correctly failed at 0.99)"

echo "==> smoke: frame_strip.sh produces a strip"
"$SCRIPTS_DIR/frame_strip.sh" "$WORK/baseline.mp4" "$WORK/different.mp4" "$WORK/strip" 4 >/dev/null
if [[ ! -f "$WORK/strip/strip.png" ]]; then
  echo "FAIL: frame_strip.sh did not produce strip.png"
  exit 1
fi
echo "    strip.png written ($(stat -c%s "$WORK/strip/strip.png" 2>/dev/null || stat -f%z "$WORK/strip/strip.png") bytes)"

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
