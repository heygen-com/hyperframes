#!/usr/bin/env bash
# Generates the joined preview files the two edits cut from into _media (gitignored, cheap to rebuild).
# 720x1280 H.264 High, keyframe every 1 s, AAC-LC 48 kHz mono 126 kb/s; audio is voice-like plus position markers
# (a 0.5 s stepped tone and a 16 s block tone), so a sample can be traced back to its place in the file.
set -euo pipefail
out="$(cd "$(dirname "$0")" && pwd)/_media"
mkdir -p "$out"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
audio='0.05*sin(2*PI*(600+60*mod(floor(t/0.5),32))*t)+0.04*sin(2*PI*(3000+100*mod(floor(t/16),24))*t)+0.18*sin(2*PI*(130+25*sin(2*PI*0.4*t))*t)*(0.5+0.5*sin(2*PI*3.1*t))+0.1*sin(2*PI*(700+80*sin(2*PI*0.23*t))*t)*(0.5+0.5*sin(2*PI*2.3*t))'
# name fps seconds video-kbit
make() {
  [ -s "$1.mp4" ] || ff -f lavfi -i "testsrc2=size=720x1280:rate=$2:duration=$3" -f lavfi -i "aevalsrc='$audio':s=48000:d=$3" \
    -c:v libx264 -profile:v high -preset veryfast -pix_fmt yuv420p -b:v "${4}k" -g "$2" -keyint_min "$2" -sc_threshold 0 \
    -c:a aac -b:a 126k -ac 1 -ar 48000 -shortest -movflags +faststart "$1.mp4"
}
cd "$out"
make primary 30 52.27 1710
make tentake 25 321.12 1760
ls -l "$out"
