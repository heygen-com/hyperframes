#!/bin/bash
# make-video.sh — Assemble walkthrough slides + audio into a final MP4.
# Fallback for when hyperframes render is not available.
#
# Usage:
#   ./make-video.sh <slide-dir> <output.mp4> [outro-duration]
#
# Expects in <slide-dir>:
#   slide-00.png, slide-01.png, ...  (one per segment, including outro)
#   audio-00.wav, audio-01.wav, ...  (one per narrated segment)
#
# The last slide PNG without a matching audio WAV is the silent outro.
#
set -euo pipefail

SLIDE_DIR="${1:?Usage: make-video.sh <slide-dir> <output.mp4> [outro-duration]}"
OUTPUT="${2:?Usage: make-video.sh <slide-dir> <output.mp4> [outro-duration]}"
OUTRO_DUR="${3:-3}"

# Resolve relative paths
[[ "$SLIDE_DIR" != /* ]] && SLIDE_DIR="$(pwd)/$SLIDE_DIR"
[[ "$OUTPUT" != /* ]] && OUTPUT="$(pwd)/$OUTPUT"

mkdir -p "$(dirname "$OUTPUT")"

TMPDIR_WORK=$(mktemp -d)
trap "rm -rf $TMPDIR_WORK" EXIT

echo "=== Assembling video ==="
echo "  Slides: $SLIDE_DIR"
echo "  Output: $OUTPUT"

SLIDE_COUNT=$(ls "$SLIDE_DIR"/slide-*.png 2>/dev/null | wc -l | tr -d ' ')
AUDIO_COUNT=$(ls "$SLIDE_DIR"/audio-*.wav 2>/dev/null | wc -l | tr -d ' ')

echo "  Found $SLIDE_COUNT slides, $AUDIO_COUNT audio clips"
echo "  Last slide (no audio) = outro (${OUTRO_DUR}s)"

CONCAT_LIST="$TMPDIR_WORK/concat.txt"
> "$CONCAT_LIST"

for i in $(seq 0 $((SLIDE_COUNT - 1))); do
  NUM=$(printf "%02d" $i)
  SLIDE="$SLIDE_DIR/slide-${NUM}.png"
  AUDIO="$SLIDE_DIR/audio-${NUM}.wav"
  SEGMENT="$TMPDIR_WORK/segment-${NUM}.mp4"

  if [ -f "$AUDIO" ]; then
    DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUDIO")
    echo "  segment-${NUM}: slide + audio (${DUR}s)"

    ffmpeg -y -loop 1 -i "$SLIDE" -i "$AUDIO" \
      -c:v libx264 -tune stillimage -pix_fmt yuv420p \
      -vf "scale=1600:900:force_original_aspect_ratio=decrease,pad=1600:900:(ow-iw)/2:(oh-ih)/2" \
      -c:a aac -b:a 192k -ar 48000 \
      -shortest -movflags +faststart \
      "$SEGMENT" 2>/dev/null
  else
    echo "  segment-${NUM}: silent outro (${OUTRO_DUR}s)"
    ffmpeg -y -loop 1 -i "$SLIDE" -f lavfi -i anullsrc=r=48000:cl=mono \
      -c:v libx264 -tune stillimage -pix_fmt yuv420p \
      -vf "scale=1600:900:force_original_aspect_ratio=decrease,pad=1600:900:(ow-iw)/2:(oh-ih)/2" \
      -c:a aac -b:a 192k -ar 48000 \
      -t "$OUTRO_DUR" -movflags +faststart \
      "$SEGMENT" 2>/dev/null
  fi

  echo "file '$SEGMENT'" >> "$CONCAT_LIST"
done

echo ""
echo "  Concatenating ${SLIDE_COUNT} segments..."
ffmpeg -y -f concat -safe 0 -i "$CONCAT_LIST" \
  -c copy -movflags +faststart \
  "$OUTPUT" 2>/dev/null

FINAL_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUTPUT")
FINAL_SIZE=$(ls -lh "$OUTPUT" | awk '{print $5}')
echo ""
echo "=== Done ==="
echo "  Output: $OUTPUT"
echo "  Duration: ${FINAL_DUR}s"
echo "  Size: $FINAL_SIZE"
