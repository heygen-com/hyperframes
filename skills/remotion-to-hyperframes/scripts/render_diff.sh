#!/usr/bin/env bash
# render_diff.sh — compute per-frame SSIM between two video files.
#
# The eval primitive for the remotion-to-hyperframes skill: given a Remotion
# render and a HyperFrames render of the same composition, report whether the
# translation is visually equivalent.
#
# Usage:
#   render_diff.sh <baseline.mp4> <translated.mp4> [output-dir]
#
# Output (in output-dir, defaults to ./diff-out):
#   ssim.log          — per-frame SSIM lines from ffmpeg
#   summary.json      — { mean, min, p05, p95, frame_count, pass, threshold }
#
# Exit codes:
#   0  — pass (mean SSIM >= threshold)
#   1  — fail (mean SSIM <  threshold)
#   2  — usage / setup error
#
# Threshold defaults to 0.85 (loose; tier-specific thresholds are applied by
# the orchestrator). Override with R2HF_SSIM_THRESHOLD=0.95 in the environment.

set -euo pipefail

THRESHOLD="${R2HF_SSIM_THRESHOLD:-0.85}"

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "usage: $0 <baseline.mp4> <translated.mp4> [output-dir]" >&2
  exit 2
fi

BASELINE="$1"
TRANSLATED="$2"
OUTDIR="${3:-./diff-out}"

if [[ ! -f "$BASELINE" ]]; then
  echo "error: baseline not found: $BASELINE" >&2
  exit 2
fi
if [[ ! -f "$TRANSLATED" ]]; then
  echo "error: translated not found: $TRANSLATED" >&2
  exit 2
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "error: ffmpeg not on PATH" >&2
  exit 2
fi

mkdir -p "$OUTDIR"
SSIM_LOG="$OUTDIR/ssim.log"
SUMMARY="$OUTDIR/summary.json"

# ffmpeg's ssim filter writes one line per frame to stats_file and a single
# Mean SSIM line to stderr. We capture both — per-frame for distribution
# stats, and the mean for the headline number.
ffmpeg -hide_banner -nostats -loglevel info \
  -i "$BASELINE" -i "$TRANSLATED" \
  -lavfi "[0:v]scale=iw:ih[ref];[1:v]scale=iw:ih[main];[main][ref]ssim=stats_file=$SSIM_LOG" \
  -f null - 2>"$OUTDIR/ffmpeg.stderr"

# Parse: each line in ssim.log looks like
#   n:1 Y:0.987655 U:0.992345 V:0.991234 All:0.989012 (19.512345)
# We want the All:N column.
python3 - "$SSIM_LOG" "$SUMMARY" "$THRESHOLD" <<'PY'
import json, math, re, sys
from pathlib import Path

log_path = Path(sys.argv[1])
out_path = Path(sys.argv[2])
threshold = float(sys.argv[3])

values = []
pattern = re.compile(r"All:([\d.]+)")
for line in log_path.read_text().splitlines():
    m = pattern.search(line)
    if m:
        try:
            values.append(float(m.group(1)))
        except ValueError:
            pass

if not values:
    print(f"error: no SSIM samples parsed from {log_path}", file=sys.stderr)
    sys.exit(2)

values.sort()
n = len(values)
mean = sum(values) / n
p_idx = lambda p: min(n - 1, max(0, int(math.floor(p * n))))
summary = {
    "frame_count": n,
    "mean": round(mean, 6),
    "min": round(values[0], 6),
    "max": round(values[-1], 6),
    "p05": round(values[p_idx(0.05)], 6),
    "p95": round(values[p_idx(0.95)], 6),
    "threshold": threshold,
    "pass": bool(mean >= threshold),
}
out_path.write_text(json.dumps(summary, indent=2) + "\n")
print(json.dumps(summary, indent=2))
sys.exit(0 if summary["pass"] else 1)
PY
