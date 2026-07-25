#!/usr/bin/env bash
# Small configuration helpers shared by smoke.sh and shell tests.

hf_resolve_psnr_threshold() {
  local explicit="$1" fixture_meta="$2"
  if [ -n "$explicit" ]; then
    printf '%s\n' "$explicit"
    return
  fi
  jq -er '(.minPsnr // 40) | numbers' "$fixture_meta"
}
