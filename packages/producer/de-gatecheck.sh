#!/usr/bin/env bash
# Init-only gate classification over the full 500. The gate decision is logged at init
# ("drawElement canvas injected" OR "falling back to ... — <reason>"), so launch the fast
# render, wait for that line, kill before frames render. Writes /tmp/gatecheck/<pre>.txt.
# Resumable. PAR workers. Usage: PAR=4 bash de-gatecheck.sh
set -euo pipefail
cd "$(dirname "$0")"
OUT=/tmp/gatecheck; mkdir -p "$OUT"
PAR=${PAR:-4}
SAMPLE=${SAMPLE:-/tmp/sweep-sample.txt}
GPU="PRODUCER_BROWSER_GPU_MODE=hardware PRODUCER_ENABLE_BROWSER_POOL=false HF_DE_WORKER_ENCODE=false HF_STATIC_DEDUP=false PRODUCER_EXPERIMENTAL_FAST_CAPTURE=true"
export GPU OUT CAP
worker(){
  local pre=$1
  [ -f "$OUT/$pre.txt" ] && return
  local dir; dir=$(find /tmp/cc-all/ -maxdepth 1 -type d -name "${pre}*" | head -1 || true)
  [ -z "$dir" ] && { echo "$pre NODIR" > "$OUT/$pre.txt"; return; }
  local log=/tmp/gc-$pre.log
  ( eval "env $GPU bun we-render.mjs \"$dir\" /tmp/gc-$pre.mp4" >"$log" 2>&1 </dev/null ) & local p=$!
  local t=0
  while kill -0 "$p" 2>/dev/null; do
    sleep 1; t=$((t+1))
    if grep -qE "drawElement canvas injected|falling back to (screenshot|beginframe) capture —|Fast capture: composition uses|render-mode compatibility hint" "$log" 2>/dev/null; then break; fi
    [ "$t" -ge "${CAP:-120}" ] && break
  done
  # kill the render tree (don't need full render)
  for c in $(pgrep -P "$p" 2>/dev/null || true); do kill -9 "$c" 2>/dev/null || true; done
  kill -9 "$p" 2>/dev/null || true
  pkill -f "we-render.mjs $dir" 2>/dev/null || true
  wait "$p" 2>/dev/null || true
  if grep -q "drawElement canvas injected" "$log" 2>/dev/null; then
    echo "$pre drawelement" > "$OUT/$pre.txt"
  else
    local reason; reason=$(grep -oE "falling back to (screenshot|beginframe) capture — [^(]*" "$log" | head -1 | sed -E 's/.*— //' || true)
    # Compile-time gates (3D / mix-blend-mode) log a different shape than the
    # engine's init-time gates — "Fast capture: composition uses X — disabling".
    if [ -z "$reason" ]; then
      reason=$(grep -oE "Fast capture: composition uses [a-z0-9 -]*" "$log" | head -1 | sed -E 's/.*uses /compile:/' || true)
    fi
    # Compat-hint routing (raw rAF etc.): "fast capture: falling back to screenshot — render-mode ..."
    if [ -z "$reason" ] && grep -q "render-mode compatibility hint" "$log" 2>/dev/null; then
      reason="render-mode compat hint (raw rAF/alpha)"
    fi
    if [ -n "$reason" ]; then echo "$pre gated $reason" > "$OUT/$pre.txt"
    elif grep -q "zero duration" "$log" 2>/dev/null; then echo "$pre comp-defect zero-duration" > "$OUT/$pre.txt"
    elif grep -qiE "Failure summary|error:" "$log" 2>/dev/null; then echo "$pre comp-defect error" > "$OUT/$pre.txt"
    else echo "$pre unknown" > "$OUT/$pre.txt"; fi
  fi
  rm -f /tmp/gc-$pre.mp4 /tmp/gc-$pre.log
}
export -f worker
awk '{print $1}' "$SAMPLE" | xargs -P "$PAR" -I{} bash -c 'set -uo pipefail; worker "$@"' _ {} || true
echo "GATECHECK_DONE ($(ls "$OUT"/*.txt 2>/dev/null | wc -l | tr -d ' ') comps)"
