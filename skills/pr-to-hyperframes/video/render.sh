#!/bin/bash
# render.sh — Render a pr-walkthrough video from a manifest JSON file using
# hyperframes. The pipeline:
#   1. Copy referenced audio/image files into ./assets/
#   2. Run whisper transcription on each audio file → ./transcripts/
#   3. Run build.mjs to generate index.html
#   4. Lint + render via npx hyperframes (1080p/30fps)
#   5. Downscale + recompress to 1280×720 with ffmpeg → final MP4
#
# Usage:
#   ./render.sh <manifest.json> <output.mp4>
#
set -euo pipefail

MANIFEST="${1:?Usage: render.sh <manifest.json> <output.mp4>}"
OUTPUT="${2:?Usage: render.sh <manifest.json> <output.mp4>}"

# Resolve relative paths
[[ "$MANIFEST" != /* ]] && MANIFEST="$(pwd)/$MANIFEST"
[[ "$OUTPUT" != /* ]] && OUTPUT="$(pwd)/$OUTPUT"

if [ ! -f "$MANIFEST" ]; then
	echo "Error: Manifest not found: $MANIFEST" >&2
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSETS_DIR="$SCRIPT_DIR/assets"
TRANSCRIPTS_DIR="$SCRIPT_DIR/transcripts"
RENDERS_DIR="$SCRIPT_DIR/renders"
MANIFEST_DIR="$(dirname "$MANIFEST")"

mkdir -p "$ASSETS_DIR" "$TRANSCRIPTS_DIR" "$RENDERS_DIR"
mkdir -p "$(dirname "$OUTPUT")"

echo "=== Rendering walkthrough video ==="
echo "  Manifest: $MANIFEST"
echo "  Output:   $OUTPUT"
echo ""

# --- 1. Extract referenced audio/image filenames from the manifest ---------
REFERENCED_FILES=$(python3 -c "
import json, sys
with open(sys.argv[1]) as f:
    m = json.load(f)
files = set()
for s in m['slides']:
    if 'audio' in s and s['audio']: files.add(s['audio'])
    if 'src' in s and s['src']:     files.add(s['src'])
# Copy logo if specified in branding
b = m.get('branding', {})
if b.get('logo'):
    files.add(b['logo'])
print('\n'.join(sorted(files)))
" "$MANIFEST")

# --- 2. Copy referenced files into ./assets/ -------------------------------
echo "  [1/5] Copying assets..."
rm -rf "$ASSETS_DIR"
mkdir -p "$ASSETS_DIR"
for FILE in $REFERENCED_FILES; do
	SRC="$MANIFEST_DIR/$FILE"
	if [ -f "$SRC" ]; then
		cp "$SRC" "$ASSETS_DIR/$FILE"
	else
		echo "    Warning: Referenced file not found: $SRC" >&2
	fi
done

# --- 3. Whisper transcribe each audio file (idempotent per file) ----------
echo "  [2/5] Transcribing audio (whisper)..."
for WAV in "$ASSETS_DIR"/*.wav; do
	[ -f "$WAV" ] || continue
	BASE=$(basename "$WAV" .wav)
	OUT_JSON="$TRANSCRIPTS_DIR/$BASE.json"
	if [ -f "$OUT_JSON" ] && [ "$OUT_JSON" -nt "$WAV" ]; then
		continue
	fi
	echo "    transcribing $BASE..."
	(cd "$SCRIPT_DIR" && npx --yes hyperframes transcribe "assets/$BASE.wav" --json >/dev/null)
	if [ -f "$SCRIPT_DIR/transcript.json" ]; then
		mv "$SCRIPT_DIR/transcript.json" "$OUT_JSON"
	fi
done

# --- 4. Generate index.html ------------------------------------------------
echo "  [3/5] Building composition..."
(cd "$SCRIPT_DIR" && node build.mjs "$MANIFEST")

# --- 5. Lint (warn but don't fail) ------------------------------------------
(cd "$SCRIPT_DIR" && npx --yes hyperframes lint) || {
	echo "  Warning: lint reported issues (continuing)" >&2
}

# --- 6. Render at 1080p/30fps with hyperframes -----------------------------
echo "  [4/5] Rendering 1080p frames..."
RENDER_NAME="walkthrough-$$"
TEMP_RENDER="$RENDERS_DIR/$RENDER_NAME.mp4"
rm -f "$TEMP_RENDER"
(cd "$SCRIPT_DIR" && npx --yes hyperframes render \
	-q draft --crf 30 \
	-o "renders/$RENDER_NAME.mp4") >/dev/null 2>&1 &
RENDER_PID=$!

PREV_SIZE=-1
STABLE=0
while kill -0 "$RENDER_PID" 2>/dev/null; do
	if [ -f "$TEMP_RENDER" ]; then
		SIZE=$(stat -f '%z' "$TEMP_RENDER" 2>/dev/null || stat -c '%s' "$TEMP_RENDER" 2>/dev/null || echo 0)
		if [ "$SIZE" -gt 0 ] && [ "$SIZE" -eq "$PREV_SIZE" ]; then
			STABLE=$((STABLE + 1))
			if [ "$STABLE" -ge 3 ]; then break; fi
		else
			STABLE=0
		fi
		PREV_SIZE=$SIZE
	fi
	sleep 2
done

pkill -P "$RENDER_PID" 2>/dev/null || true
kill "$RENDER_PID" 2>/dev/null || true
wait "$RENDER_PID" 2>/dev/null || true

if [ ! -f "$TEMP_RENDER" ]; then
	echo "Error: hyperframes did not produce $TEMP_RENDER" >&2
	exit 1
fi

# --- 7. Downscale 1080p → 720p, recompress for smaller file ---------------
echo "  [5/5] Downscaling to 720p / 30fps..."
ffmpeg -y -i "$TEMP_RENDER" \
	-vf "scale=1280:720:flags=lanczos,fps=30" \
	-c:v libx264 -preset slow -crf 26 -pix_fmt yuv420p \
	-c:a aac -b:a 96k -ar 48000 \
	-movflags +faststart \
	"$OUTPUT" 2>/dev/null

rm -f "$TEMP_RENDER"

# --- Report ------------------------------------------------------------------
if [ -f "$OUTPUT" ]; then
	FINAL_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUTPUT" 2>/dev/null || echo "?")
	FINAL_SIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')
	echo ""
	echo "=== Done ==="
	echo "  Output:     $OUTPUT"
	echo "  Resolution: 1280×720"
	echo "  FPS:        30"
	echo "  Duration:   ${FINAL_DUR}s"
	echo "  Size:       $FINAL_SIZE"
else
	echo "Error: render failed — output file not created" >&2
	exit 1
fi
