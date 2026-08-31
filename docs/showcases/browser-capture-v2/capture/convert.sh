#!/bin/bash
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"
dir="$(cd "$(dirname "$0")/../media" && pwd)"

for source in "$dir"/*.webm; do
  [ -e "$source" ] || continue
  base="${source%.webm}"
  ffmpeg -y -hide_banner -loglevel error -i "$source" \
    -vf "scale=1280:-2,fps=30" \
    -c:v libx264 -pix_fmt yuv420p -crf 24 -preset veryfast -movflags +faststart \
    -an "$base.mp4"
  ffmpeg -y -hide_banner -loglevel error -ss 0.5 -i "$base.mp4" -frames:v 1 "$base.poster.jpg"
  duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$base.mp4")"
  echo "$(basename "$base").mp4 ${duration}s"
done
