#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./_semantic-compare.sh
source "$SCRIPT_DIR/_semantic-compare.sh"
# shellcheck source=./_smoke-config.sh
source "$SCRIPT_DIR/_smoke-config.sh"

for cmd in ffmpeg ffprobe jq sha256sum cmp; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "missing test dependency: $cmd" >&2
    exit 1
  }
done

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

printf '{"minPsnr":25}\n' > "$WORK/meta.json"
[ "$(hf_resolve_psnr_threshold "" "$WORK/meta.json")" = "25" ]
[ "$(hf_resolve_psnr_threshold "37.5" "$WORK/meta.json")" = "37.5" ]

ffmpeg -nostdin -v error -y \
  -f lavfi -i "color=c=red:s=64x64:r=24:d=0.5" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=0.5" \
  -shortest -c:v mpeg4 -q:v 3 -c:a aac "$WORK/original.mp4"

# Rewrapping changes encoded bytes while preserving decoded semantics.
ffmpeg -nostdin -v error -y -i "$WORK/original.mp4" \
  -map 0 -c copy -metadata comment="different container bytes" "$WORK/rewrapped.mp4"
hf_compare_render_semantics "$WORK/original.mp4" "$WORK/rewrapped.mp4" "$WORK/equal"
jq -e '
  .semanticEqual == true and
  .video.equal == true and
  .audio.equal == true and
  .metadata.equal == true and
  .duration.equal == true and
  .encoded.equal == false
' "$WORK/equal.json" >/dev/null

cat > "$WORK/v1-history.json" <<'JSON'
{"events":[
  {"taskSucceededEventDetails":{"output":"{\"Payload\":{\"Action\":\"renderChunk\",\"ChunkIndex\":1,\"Sha256\":\"bbb\",\"FramesEncoded\":12}}"}},
  {"taskSucceededEventDetails":{"output":"{\"Payload\":{\"Action\":\"plan\",\"ChunkCount\":2}}"}},
  {"taskSucceededEventDetails":{"output":"{\"Payload\":{\"Action\":\"renderChunk\",\"ChunkIndex\":0,\"Sha256\":\"aaa\",\"FramesEncoded\":12}}"}}
]}
JSON
cat > "$WORK/v2-history.json" <<'JSON'
{"events":[
  {"taskSucceededEventDetails":{"output":"{\"Payload\":{\"Action\":\"renderChunk\",\"ChunkIndex\":0,\"Sha256\":\"aaa\",\"FramesEncoded\":12}}"}},
  {"taskSucceededEventDetails":{"output":"{\"Payload\":{\"Action\":\"renderChunk\",\"ChunkIndex\":1,\"Sha256\":\"bbb\",\"FramesEncoded\":12}}"}}
]}
JSON
hf_compare_render_semantics \
  "$WORK/original.mp4" "$WORK/rewrapped.mp4" "$WORK/chunks-equal" \
  "$WORK/v1-history.json" "$WORK/v2-history.json"
jq -e '.semanticEqual == true and .chunks == {checked:true,equal:true,v1Count:2,v2Count:2}' \
  "$WORK/chunks-equal.json" >/dev/null

jq '(.events[0].taskSucceededEventDetails.output) =
  "{\"Payload\":{\"Action\":\"renderChunk\",\"ChunkIndex\":0,\"Sha256\":\"different\",\"FramesEncoded\":12}}"' \
  "$WORK/v2-history.json" > "$WORK/v2-history-mismatch.json"
if hf_compare_render_semantics \
  "$WORK/original.mp4" "$WORK/rewrapped.mp4" "$WORK/chunks-mismatch" \
  "$WORK/v1-history.json" "$WORK/v2-history-mismatch.json"; then
  echo "expected chunk-hash mismatch" >&2
  exit 1
fi
jq -e '.semanticEqual == false and .chunks.equal == false' \
  "$WORK/chunks-mismatch.json" >/dev/null

if REQUIRE_ENCODED_SHA_EQUAL=true \
  hf_compare_render_semantics "$WORK/original.mp4" "$WORK/rewrapped.mp4" "$WORK/encoded-gated"; then
  echo "expected encoded-SHA gate to reject rewrapped output" >&2
  exit 1
fi

ffmpeg -nostdin -v error -y \
  -f lavfi -i "color=c=blue:s=64x64:r=24:d=0.5" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=0.5" \
  -shortest -c:v mpeg4 -q:v 3 -c:a aac "$WORK/video-mismatch.mp4"
if hf_compare_render_semantics \
  "$WORK/original.mp4" "$WORK/video-mismatch.mp4" "$WORK/video-mismatch"; then
  echo "expected decoded-video mismatch" >&2
  exit 1
fi
jq -e '.semanticEqual == false and .video.equal == false' \
  "$WORK/video-mismatch.json" >/dev/null

ffmpeg -nostdin -v error -y \
  -f lavfi -i "color=c=red:s=64x64:r=24:d=0.5" \
  -f lavfi -i "sine=frequency=880:sample_rate=48000:duration=0.5" \
  -shortest -c:v mpeg4 -q:v 3 -c:a aac "$WORK/audio-mismatch.mp4"
if hf_compare_render_semantics \
  "$WORK/original.mp4" "$WORK/audio-mismatch.mp4" "$WORK/audio-mismatch"; then
  echo "expected decoded-audio mismatch" >&2
  exit 1
fi
jq -e '.semanticEqual == false and .video.equal == true and .audio.equal == false' \
  "$WORK/audio-mismatch.json" >/dev/null

ffmpeg -nostdin -v error -y \
  -f lavfi -i "color=c=red:s=64x64:r=24:d=0.5" \
  -an -c:v mpeg4 -q:v 3 "$WORK/silent.mp4"
ffmpeg -nostdin -v error -y -i "$WORK/silent.mp4" \
  -map 0 -c copy -metadata comment="silent rewrap" "$WORK/silent-rewrapped.mp4"
hf_compare_render_semantics \
  "$WORK/silent.mp4" "$WORK/silent-rewrapped.mp4" "$WORK/silent-equal"
jq -e '.semanticEqual == true and .audio.state == "no-audio-on-either"' \
  "$WORK/silent-equal.json" >/dev/null

if hf_compare_render_semantics \
  "$WORK/original.mp4" "$WORK/silent.mp4" "$WORK/audio-stream-mismatch"; then
  echo "expected audio-stream presence mismatch" >&2
  exit 1
fi
jq -e '.semanticEqual == false and .audio.state == "audio-stream-mismatch"' \
  "$WORK/audio-stream-mismatch.json" >/dev/null

echo "semantic compare shell tests passed"
