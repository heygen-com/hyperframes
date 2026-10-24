#!/bin/bash
# Runs on the bare Lambda base with only /opt/hf-media added: every codec the engine calls must work.
# Prints a deterministic summary to stdout; the artifact stage keeps it.
set -euo pipefail
ff() { /opt/hf-media/bin/ffmpeg -hide_banner -loglevel error -nostdin "$@"; }
probe() { local input=$1; shift; /opt/hf-media/bin/ffprobe -hide_banner -loglevel error "$@" -- "$input"; }
listed() { # listed <ffmpeg list flag> <awk field> <name...>
  local names
  names=$(/opt/hf-media/bin/ffmpeg -hide_banner "$1" | awk -v f="$2" '{ print $f }')
  for name in "${@:3}"; do grep -qx -- "$name" <<<"$names" || { echo "missing $1 $name" >&2; exit 1; }; done
  echo "${1#-}: ${*:3}"
}
frames() { probe "$1" -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "${@:2}"; }

cd "$(mktemp -d)"
listed -encoders 2 libx264 libx265 libvpx-vp9 libopus prores_ks aac png mjpeg
listed -decoders 2 libvpx-vp9 libvpx libdav1d h264 hevc prores aac opus png mjpeg
listed -filters 2 zscale tonemap setparams ebur128 alphamerge overlay
listed -protocols 1 https tls file

src=(-f lavfi -i "testsrc2=s=320x240:r=25:d=1")
ff "${src[@]}" -c:v libx264 -pix_fmt yuv420p -bf 0 h264.mp4
ff "${src[@]}" -c:v libx265 -pix_fmt yuv420p -tag:v hvc1 -x265-params log-level=error h265.mp4
ff "${src[@]}" -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le prores.mov
ff -f lavfi -i "sine=d=1" -c:a libopus -b:a 128k opus.webm
ff -f lavfi -i "sine=d=1" -c:a aac -b:a 192k aac.m4a
ff "${src[@]}" -frames:v 1 frame.png
for f in h264.mp4 h265.mp4 prores.mov; do [ "$(frames "$f")" = 25 ] || { echo "decode $f" >&2; exit 1; }; done
for f in opus.webm aac.m4a; do ff -i "$f" -f null -; done
[ "$(probe frame.png -show_entries stream=width -of csv=p=0)" = 320 ]
echo "encode+decode: h264 h265 prores opus aac png"

# VP9 with alpha: left half transparent, decoded through libvpx-vp9 as the engine does.
ff "${src[@]}" -vf "format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='if(lt(X,W/2),0,255)'" \
  -c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 0 -crf 30 alpha.webm
ff -c:v libvpx-vp9 -i alpha.webm -frames:v 1 -vf alphaextract,crop=40:40:20:100 -f rawvideo -pix_fmt gray left.raw
ff -c:v libvpx-vp9 -i alpha.webm -frames:v 1 -vf alphaextract,crop=40:40:260:100 -f rawvideo -pix_fmt gray right.raw
node -e '
  const fs = require("fs"), mean = (f) => fs.readFileSync(f).reduce((a, b) => a + b, 0) / 1600;
  if (!(mean("left.raw") < 16 && mean("right.raw") > 240)) throw new Error("vp9 alpha lost");'
echo "vp9 alpha: encode+decode"

# The engine's HDR to SDR chain (core/src/hdrToneMap.ts) on tagged 10-bit HEVC.
ff "${src[@]}" -c:v libx265 -pix_fmt yuv420p10le -color_primaries bt2020 -color_trc smpte2084 \
  -colorspace bt2020nc -x265-params log-level=error hdr.mp4
[ "$(probe hdr.mp4 -select_streams v:0 -show_entries stream=pix_fmt -of csv=p=0)" = yuv420p10le ]
ff -i hdr.mp4 -vf "zscale=t=linear:npl=100,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv" \
  -f null -
echo "hdr: 10-bit hevc encode, zscale tonemap"

# TLS against the system trust store: a trusted host passes, a wrong host name is refused.
exec 4< <(node -e '
  const fs = require("fs");
  require("https").createServer({ key: fs.readFileSync("/certs/server.key"), cert: fs.readFileSync("/certs/server.crt") },
    (_, res) => res.end(fs.readFileSync("h264.mp4"))).listen(8443, () => console.log("ready"));')
server=$!
trap 'kill $server' EXIT
read -r -t 30 -u 4 ready && [ "$ready" = ready ]
[ "$(frames https://localhost:8443/h264.mp4 -tls_verify 1)" = 25 ]
if frames https://127.0.0.1:8443/h264.mp4 -tls_verify 1 2>/dev/null; then echo "tls accepted a wrong host" >&2; exit 1; fi
echo "tls: verified, wrong host refused"
