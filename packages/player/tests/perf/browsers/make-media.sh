#!/usr/bin/env bash
# Generates the heavy fixtures' media into fixtures/_media (gitignored): too large to commit, cheap to rebuild.
set -euo pipefail
out="$(cd "$(dirname "$0")/.." && pwd)/fixtures/_media"
mkdir -p "$out"
cd "$out"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
src() { echo "testsrc2=size=$1:rate=30:duration=12"; }
alpha_vf="format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(hypot(X-240,Y-135),110+20*sin(T*3)),255,0)'"

[ -s h264-1080.mp4 ] || ff -f lavfi -i "$(src 1920x1080)" -c:v libx264 -preset veryfast -pix_fmt yuv420p -b:v 8M -g 60 -movflags +faststart h264-1080.mp4
[ -s h264-2160.mp4 ] || ff -f lavfi -i "$(src 3840x2160)" -c:v libx264 -preset veryfast -pix_fmt yuv420p -b:v 25M -g 60 -movflags +faststart h264-2160.mp4
if [ ! -s hevc-2160.mp4 ]; then
  if [ "$(uname)" = Darwin ]; then
    ff -f lavfi -i "$(src 3840x2160)" -c:v hevc_videotoolbox -b:v 20M -g 60 -tag:v hvc1 -movflags +faststart hevc-2160.mp4
  else
    ff -f lavfi -i "$(src 3840x2160)" -c:v libx265 -preset ultrafast -b:v 20M -g 60 -tag:v hvc1 -movflags +faststart hevc-2160.mp4
  fi
fi
[ -s alpha-vp9.webm ] || ff -f lavfi -i "$(src 480x270)" -vf "$alpha_vf" -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 1M -deadline realtime -cpu-used 8 -auto-alt-ref 0 alpha-vp9.webm
# HEVC with alpha only encodes through VideoToolbox; Linux iteration runs without it.
if [ "$(uname)" = Darwin ] && [ ! -s alpha-hevc.mov ]; then
  ff -f lavfi -i "$(src 480x270)" -vf "$alpha_vf,format=bgra" -c:v hevc_videotoolbox -alpha_quality 0.75 -b:v 2M -tag:v hvc1 alpha-hevc.mov
fi
[ -s tone.m4a ] || ff -f lavfi -i "sine=frequency=440:duration=12" -c:a aac -b:a 128k tone.m4a
ls -l "$out"
