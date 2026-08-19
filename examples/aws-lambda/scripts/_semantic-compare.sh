#!/usr/bin/env bash
# Canonical decoded-output comparison shared by the real-AWS smoke test and
# its local unit test. This file defines functions only; sourcing it has no
# side effects.

hf_sha256() {
  sha256sum "$1" | awk '{print $1}'
}

hf_canonical_video_framemd5() {
  local input="$1" output="$2" raw
  raw=$(mktemp)
  if ! ffmpeg -nostdin -v error -y -i "$input" \
      -map 0:v:0 -an -vf format=rgba -fps_mode passthrough \
      -f framemd5 "$raw"; then
    rm -f "$raw"
    return 1
  fi
  # Ignore container timestamp/header differences here: normalized ffprobe
  # metadata and duration are gated separately. This file pins decoded pixel
  # bytes, frame order, frame count, and per-frame byte size.
  awk -F',' '
    !/^#/ && NF >= 6 {
      size=$5; hash=$6
      gsub(/[[:space:]]/, "", size)
      gsub(/[[:space:]]/, "", hash)
      print size "," hash
    }
  ' "$raw" > "$output"
  rm -f "$raw"
  [ -s "$output" ]
}

hf_normalized_ffprobe_metadata() {
  local input="$1" output="$2"
  ffprobe -v error \
    -show_entries \
stream=index,codec_type,codec_name,profile,pix_fmt,width,height,sample_aspect_ratio,display_aspect_ratio,r_frame_rate,avg_frame_rate,time_base,color_range,color_space,color_transfer,color_primaries,chroma_location,field_order,sample_fmt,sample_rate,channels,channel_layout \
    -of json "$input" |
    jq -S '{
      streams: ((.streams // [])
        | sort_by(.codec_type, .index)
        | map(del(.index)))
    }' > "$output"
}

hf_duration_seconds() {
  ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$1"
}

hf_has_audio() {
  [ -n "$(ffprobe -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 "$1" 2>/dev/null | head -1)" ]
}

hf_decode_pcm() {
  ffmpeg -nostdin -v error -i "$1" -map 0:a:0 -vn \
    -ac 2 -ar 48000 -c:a pcm_s16le -f s16le "$2"
}

hf_extract_chunk_hashes() {
  local history="$1" output="$2"
  jq '[
    .events[] |
    .taskSucceededEventDetails.output? |
    select(type == "string") |
    (try fromjson catch empty) |
    .Payload |
    select(type == "object" and .Action == "renderChunk") |
    {ChunkIndex, Sha256, FramesEncoded}
  ] | sort_by(.ChunkIndex)' "$history" > "$output"
}

# Compare two rendered outputs. Writes durable evidence at <prefix>.* and a
# machine-readable <prefix>.json. Returns 0 only for semantic equivalence.
hf_compare_render_semantics() {
  local v1="$1" v2="$2" prefix="$3"
  local v1_history="${4:-}" v2_history="${5:-}"
  local tolerance="${SEMANTIC_DURATION_TOLERANCE_SECONDS:-0.001}"
  local work
  work=$(mktemp -d)

  local v1_frames="${prefix}.v1.framemd5"
  local v2_frames="${prefix}.v2.framemd5"
  local v1_meta="${prefix}.v1.ffprobe.json"
  local v2_meta="${prefix}.v2.ffprobe.json"
  local v1_duration v2_duration duration_delta
  local v1_encoded_sha v2_encoded_sha encoded_equal
  local video_equal metadata_equal duration_equal
  local audio_state audio_equal v1_audio_sha="" v2_audio_sha=""
  local v1_audio_bytes=0 v2_audio_bytes=0
  local encoded_gated=false
  local chunks_checked=false chunks_equal=true v1_chunk_count=0 v2_chunk_count=0
  if [ "${REQUIRE_ENCODED_SHA_EQUAL:-false}" = true ]; then encoded_gated=true; fi

  if ! hf_canonical_video_framemd5 "$v1" "$v1_frames" ||
     ! hf_canonical_video_framemd5 "$v2" "$v2_frames" ||
     ! hf_normalized_ffprobe_metadata "$v1" "$v1_meta" ||
     ! hf_normalized_ffprobe_metadata "$v2" "$v2_meta"; then
    rm -rf "$work"
    return 2
  fi

  if cmp -s "$v1_frames" "$v2_frames"; then video_equal=true; else video_equal=false; fi
  if cmp -s "$v1_meta" "$v2_meta"; then metadata_equal=true; else metadata_equal=false; fi

  if ! v1_duration=$(hf_duration_seconds "$v1") ||
     ! v2_duration=$(hf_duration_seconds "$v2"); then
    rm -rf "$work"
    return 2
  fi
  duration_delta=$(awk -v a="$v1_duration" -v b="$v2_duration" \
    'BEGIN { d=a-b; if (d<0) d=-d; printf("%.9f", d) }')
  if awk -v d="$duration_delta" -v t="$tolerance" 'BEGIN { exit !(d <= t) }'; then
    duration_equal=true
  else
    duration_equal=false
  fi

  local v1_has_audio=false v2_has_audio=false
  if hf_has_audio "$v1"; then v1_has_audio=true; fi
  if hf_has_audio "$v2"; then v2_has_audio=true; fi
  if [ "$v1_has_audio" = false ] && [ "$v2_has_audio" = false ]; then
    audio_state="no-audio-on-either"
    audio_equal=true
  elif [ "$v1_has_audio" != "$v2_has_audio" ]; then
    audio_state="audio-stream-mismatch"
    audio_equal=false
  else
    audio_state="decoded-pcm"
    if ! hf_decode_pcm "$v1" "$work/v1.pcm" ||
       ! hf_decode_pcm "$v2" "$work/v2.pcm"; then
      rm -rf "$work"
      return 2
    fi
    v1_audio_sha=$(hf_sha256 "$work/v1.pcm")
    v2_audio_sha=$(hf_sha256 "$work/v2.pcm")
    v1_audio_bytes=$(wc -c < "$work/v1.pcm" | tr -d '[:space:]')
    v2_audio_bytes=$(wc -c < "$work/v2.pcm" | tr -d '[:space:]')
    if [ "$v1_audio_sha" = "$v2_audio_sha" ] && [ "$v1_audio_bytes" = "$v2_audio_bytes" ]; then
      audio_equal=true
    else
      audio_equal=false
    fi
  fi

  v1_encoded_sha=$(hf_sha256 "$v1")
  v2_encoded_sha=$(hf_sha256 "$v2")
  if [ "$v1_encoded_sha" = "$v2_encoded_sha" ]; then encoded_equal=true; else encoded_equal=false; fi

  local semantic_equal=false
  if [ "$video_equal" = true ] &&
     [ "$metadata_equal" = true ] &&
     [ "$duration_equal" = true ] &&
     [ "$audio_equal" = true ]; then
    semantic_equal=true
  fi
  if [ "$encoded_gated" = true ] && [ "$encoded_equal" != true ]; then
    semantic_equal=false
  fi

  if [ -n "$v1_history" ] || [ -n "$v2_history" ]; then
    chunks_checked=true
    if [ -z "$v1_history" ] || [ -z "$v2_history" ] ||
       ! hf_extract_chunk_hashes "$v1_history" "${prefix}.v1.chunk-hashes.json" ||
       ! hf_extract_chunk_hashes "$v2_history" "${prefix}.v2.chunk-hashes.json"; then
      rm -rf "$work"
      return 2
    fi
    v1_chunk_count=$(jq 'length' "${prefix}.v1.chunk-hashes.json")
    v2_chunk_count=$(jq 'length' "${prefix}.v2.chunk-hashes.json")
    if [ "$v1_chunk_count" -eq 0 ] ||
       [ "$v2_chunk_count" -eq 0 ] ||
       ! cmp -s "${prefix}.v1.chunk-hashes.json" "${prefix}.v2.chunk-hashes.json"; then
      chunks_equal=false
      semantic_equal=false
    fi
  fi

  jq -n \
    --arg v1 "$v1" --arg v2 "$v2" \
    --argjson semanticEqual "$semantic_equal" \
    --argjson videoEqual "$video_equal" \
    --argjson v1VideoFrameCount "$(wc -l < "$v1_frames" | tr -d '[:space:]')" \
    --argjson v2VideoFrameCount "$(wc -l < "$v2_frames" | tr -d '[:space:]')" \
    --argjson metadataEqual "$metadata_equal" \
    --arg v1Duration "$v1_duration" --arg v2Duration "$v2_duration" \
    --arg durationDelta "$duration_delta" --arg durationTolerance "$tolerance" \
    --arg audioState "$audio_state" --argjson audioEqual "$audio_equal" \
    --arg v1AudioSha256 "$v1_audio_sha" --arg v2AudioSha256 "$v2_audio_sha" \
    --argjson v1AudioBytes "$v1_audio_bytes" --argjson v2AudioBytes "$v2_audio_bytes" \
    --arg v1EncodedSha256 "$v1_encoded_sha" --arg v2EncodedSha256 "$v2_encoded_sha" \
    --argjson encodedShaEqual "$encoded_equal" \
    --argjson encodedShaGated "$encoded_gated" \
    --argjson chunksChecked "$chunks_checked" \
    --argjson chunksEqual "$chunks_equal" \
    --argjson v1ChunkCount "$v1_chunk_count" \
    --argjson v2ChunkCount "$v2_chunk_count" \
    '{
      v1: $v1,
      v2: $v2,
      semanticEqual: $semanticEqual,
      video: {
        equal: $videoEqual,
        v1FrameCount: $v1VideoFrameCount,
        v2FrameCount: $v2VideoFrameCount
      },
      metadata: {equal: $metadataEqual},
      chunks: {
        checked: $chunksChecked,
        equal: $chunksEqual,
        v1Count: $v1ChunkCount,
        v2Count: $v2ChunkCount
      },
      duration: {
        v1Seconds: ($v1Duration | tonumber),
        v2Seconds: ($v2Duration | tonumber),
        deltaSeconds: ($durationDelta | tonumber),
        toleranceSeconds: ($durationTolerance | tonumber),
        equal: (($durationDelta | tonumber) <= ($durationTolerance | tonumber))
      },
      audio: {
        state: $audioState,
        equal: $audioEqual,
        v1Sha256: $v1AudioSha256,
        v2Sha256: $v2AudioSha256,
        v1Bytes: $v1AudioBytes,
        v2Bytes: $v2AudioBytes
      },
      encoded: {
        equal: $encodedShaEqual,
        gated: $encodedShaGated,
        v1Sha256: $v1EncodedSha256,
        v2Sha256: $v2EncodedSha256
      }
    }' > "${prefix}.json"

  rm -rf "$work"
  [ "$semantic_equal" = true ]
}
