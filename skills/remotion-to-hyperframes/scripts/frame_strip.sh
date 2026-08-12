#!/usr/bin/env bash
# frame_strip.sh — produce a side-by-side comparison strip from two videos.
#
# Used to debug failing render_diff.sh runs visually: pick a sample timestamp
# range, extract frames from both videos, lay them out as a grid for review.
#
# Usage:
#   frame_strip.sh <baseline.mp4> <translated.mp4> [output-dir] [samples]
#
# Defaults: output-dir=./strip-out, samples=8 (evenly spaced across duration).
# Output:
#   strip.png         — single PNG with `samples` rows, each row is
#                       (baseline frame | translated frame) at one timestamp
#   timestamps.txt    — the timestamps sampled

set -euo pipefail

if [[ $# -lt 2 || $# -gt 4 ]]; then
  echo "usage: $0 <baseline.mp4> <translated.mp4> [output-dir] [samples]" >&2
  exit 2
fi

BASELINE="$1"
TRANSLATED="$2"
OUTDIR="${3:-./strip-out}"
SAMPLES="${4:-8}"

if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  echo "error: ffmpeg/ffprobe not on PATH" >&2
  exit 2
fi

mkdir -p "$OUTDIR"

# Build the strip in a single ffmpeg invocation. Two inputs (baseline and
# translated) are sampled at N evenly-spaced timestamps via the `select`
# filter, then assembled with hstack (per-row pairs) + vstack (rows).
# Earlier versions spawned 3 ffmpeg calls per timestamp + a final vstack;
# this is one call regardless of N.
python3 - "$BASELINE" "$TRANSLATED" "$OUTDIR" "$SAMPLES" <<'PY'
import json
import shutil
import subprocess
import sys
from pathlib import Path

baseline, translated, outdir, samples = sys.argv[1], sys.argv[2], Path(sys.argv[3]), int(sys.argv[4])

# Read fps + duration from the baseline so we can map timestamps to frame
# indexes for the `select` filter (frame-accurate, doesn't depend on
# keyframe alignment).
probe = subprocess.run(
    ["ffprobe", "-v", "error", "-select_streams", "v:0",
     "-show_entries", "stream=r_frame_rate,nb_read_frames,duration",
     "-show_entries", "format=duration",
     "-of", "json", "-count_frames", "--", baseline],
    check=True, capture_output=True, text=True,
)
data = json.loads(probe.stdout)
stream = data["streams"][0]
num, den = stream["r_frame_rate"].split("/")
fps = float(num) / float(den)
nb_frames = int(stream.get("nb_read_frames") or 0)
if nb_frames <= 0:
    duration = float(stream.get("duration") or data["format"]["duration"])
    nb_frames = int(duration * fps)

# Even-spaced sample frames in the 5%-95% window (skip fade-in/out noise).
start = max(0, int(nb_frames * 0.05))
end = max(start, int(nb_frames * 0.95) - 1)
if samples == 1:
    frames = [start]
else:
    step = (end - start) / (samples - 1)
    frames = [int(start + i * step) for i in range(samples)]

(outdir / "timestamps.txt").write_text(
    "\n".join(f"{f / fps:.3f}" for f in frames) + "\n"
)

# select='eq(n,F1)+eq(n,F2)+...' picks exactly the listed frames from each
# input. We then hstack per-frame pairs and vstack the result.
select_expr = "+".join(f"eq(n,{f})" for f in frames)
n = len(frames)
filter_parts = [
    f"[0:v]select='{select_expr}',setpts=N/FRAME_RATE/TB,split={n}"
    + "".join(f"[b{i}]" for i in range(n)),
    f"[1:v]select='{select_expr}',setpts=N/FRAME_RATE/TB,split={n}"
    + "".join(f"[t{i}]" for i in range(n)),
]
for i in range(n):
    filter_parts.append(f"[b{i}][t{i}]hstack=inputs=2[row{i}]")
filter_parts.append(
    "".join(f"[row{i}]" for i in range(n)) + f"vstack=inputs={n}[out]"
)
filter_graph = ";".join(filter_parts)

cmd = [
    "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
    "-i", baseline, "-i", translated,
    "-filter_complex", filter_graph,
    "-map", "[out]", "-frames:v", "1",
    str(outdir / "strip.png"),
]
subprocess.run(cmd, check=True)
print(f"wrote {outdir / 'strip.png'} ({n} samples)")
PY
