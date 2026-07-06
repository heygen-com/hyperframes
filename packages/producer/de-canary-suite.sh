#!/usr/bin/env bash
# drawElement release canary suite — run before/after any DE-path change and on a
# schedule once DE is default-on. macOS + hardware GPU only (DE never engages
# elsewhere). Each canary renders with the full DE stack + safety net; the suite
# asserts the render COMPLETES and the safety net's verdict matches expectation:
#   clean    — DE end-to-end, no fallback; cross-checked vs a screenshot render (PSNR)
#   fallback — self-verify/blank-guard fires and the auto-fallback completes (these
#              comps have known intermittent DE damage or are defect comps; the net
#              diverting them IS the pass condition)
#   any      — either outcome passes (known-flaky DE damage: fallback ~2/3 of runs)
# Exit nonzero on any FAIL. Usage: COMP_ROOT=/tmp/cc-all bash de-canary-suite.sh
set -euo pipefail
cd "$(dirname "$0")"
ROOT="${COMP_ROOT:-/tmp/cc-all}"
OUT="${1:-/tmp/de-canary-suite}"
MIN_DB="${MIN_DB:-32}"
mkdir -p "$OUT"

# id expectation — see fast-capture-architecture.md § Runtime safety net for provenance
CANARIES="
d95f20b6 any       # paint-race canary; intermittent background-image drop (16.4dB when it fires)
0531c45f clean     # video comp + clip-boundary frames (Lim 6 regression guard)
3bea8c73 clean     # dense motion graphics, deterministic small dark frames (blank-guard guard)
11c1c878 clean     # media-heavy; false de-fail history (harness artifacts)
398c0655 any       # marginal DE-vs-truth divergence hovering at the 32dB line (32-34dB post seek-fix, 23dB before); flips run to run
3e051c00 fallback  # broken comp (runtime error banner) — must divert, not ship
42e7c33e fallback  # error comp — must divert, not ship
"

DE_ENV="PRODUCER_BROWSER_GPU_MODE=hardware PRODUCER_ENABLE_BROWSER_POOL=false PRODUCER_EXPERIMENTAL_FAST_CAPTURE=true HF_DE_WORKER_ENCODE=true HF_DE_BATCH=4"
SS_ENV="PRODUCER_BROWSER_GPU_MODE=hardware PRODUCER_ENABLE_BROWSER_POOL=false PRODUCER_EXPERIMENTAL_FAST_CAPTURE=false"

fail=0
echo "$CANARIES" | grep -v '^\s*$' | while read -r pre expect _; do
  dir=$(find "$ROOT/" -maxdepth 1 -type d -name "${pre}*" | head -1)
  if [ -z "$dir" ]; then echo "FAIL $pre: comp not found under $ROOT"; exit 1; fi
  log="$OUT/$pre.log"
  env $DE_ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 bun we-render.mjs "$dir" "$OUT/$pre-de.mp4" </dev/null >"$log" 2>&1 || true
  if ! grep -q "RENDER_OK" "$log"; then echo "FAIL $pre: render did not complete (see $log)"; exit 1; fi
  if grep -q "re-rendering via screenshot" "$log"; then verdict=fallback; else verdict=clean; fi
  case "$expect" in
    any) : ;;
    "$verdict") : ;;
    *) echo "FAIL $pre: expected $expect, got $verdict (see $log)"; exit 1 ;;
  esac
  # Clean DE renders get a cross-path quality check against a screenshot render.
  # "any"-expectation comps are exempt: they are in the suite BECAUSE their
  # DE-vs-screenshot agreement is marginal/intermittent — the check would fail
  # on their intrinsic divergence, not on a regression.
  if [ "$verdict" = clean ] && [ "$expect" != any ]; then
    env $SS_ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 bun we-render.mjs "$dir" "$OUT/$pre-ss.mp4" </dev/null >"$OUT/$pre-ss.log" 2>&1 || true
    if ! grep -q "RENDER_OK" "$OUT/$pre-ss.log"; then echo "FAIL $pre: screenshot arm failed"; exit 1; fi
    db=$(ffmpeg -nostdin -hide_banner -i "$OUT/$pre-de.mp4" -i "$OUT/$pre-ss.mp4" -lavfi psnr -f null - 2>&1 \
      | grep -oE "average:(inf|[0-9.]+)" | head -1 | cut -d: -f2 || true)
    if [ -z "$db" ]; then echo "FAIL $pre: PSNR compare produced no value"; exit 1; fi
    if [ "$db" != "inf" ] && awk -v d="$db" -v m="$MIN_DB" 'BEGIN{exit !(d<m)}'; then
      echo "FAIL $pre: DE-vs-screenshot ${db}dB < ${MIN_DB}dB"; exit 1
    fi
    echo "PASS $pre ($verdict, ${db:-?}dB)"
  else
    echo "PASS $pre ($verdict)"
  fi
done || fail=1
[ "$fail" = 0 ] && echo "CANARY_SUITE_OK" || { echo "CANARY_SUITE_FAILED"; exit 1; }
