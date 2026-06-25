#!/usr/bin/env bash
# End-to-end: hyperframes render + ffmpeg overlay matte → final.mp4
#
# Usage:
#   bash render-and-composite.sh <project-dir> [hyperframes-repo-path]
#
# Env:
#   HYPERFRAMES_ROOT  override the hyperframes checkout location

set -euo pipefail

PROJECT="${1:?usage: render-and-composite.sh <project-dir> [hyperframes-repo]}"
PROJECT="$(cd "$PROJECT" && pwd)"

# Resolve the hyperframes checkout. Candidate order:
#   1. arg 2   2. $HYPERFRAMES_ROOT   3. repo root if this skill ships INSIDE the
#   hyperframes repo (skills/embedded-captions/scripts → ../../..)   4. ~/Downloads/hyperframes
SKILL_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HF=""
for cand in "${2:-}" "${HYPERFRAMES_ROOT:-}" "$(cd "$SKILL_SCRIPT_DIR/../../.." 2>/dev/null && pwd)" "$HOME/Downloads/hyperframes"; do
  if [[ -n "$cand" && -f "$cand/packages/cli/dist/cli.js" ]]; then HF="$cand"; break; fi
done
if [[ -z "$HF" ]]; then
  echo "[render] hyperframes CLI not found. Set HYPERFRAMES_ROOT to your hyperframes" >&2
  echo "         checkout (needs packages/cli/dist/cli.js — 'bun install && bun run build')." >&2
  exit 1
fi
export HYPERFRAMES_ROOT="$HF"   # so the occlusion gate's measure-layout.cjs finds puppeteer too
HF_CLI="$HF/packages/cli/dist/cli.js"
if [[ ! -d "$PROJECT/frames_fg" ]]; then
  echo "[render] missing matte frames at $PROJECT/frames_fg — run matte.cjs first" >&2
  exit 1
fi
# Which compiler owns this project? Cinematic = make-composition.cjs (plan.json).
# (Standard mode retired 2026-06-12 — rail-surface needs are served by theme
# DNAs like "anchor"; legacy standard.json projects re-render from their
# existing index.html or via the archived compiler in embedded-captions-archive.)
compiler_for() {
  echo "make-composition.cjs"
}
if [[ ! -f "$PROJECT/index.html" ]]; then
  if [[ -f "$PROJECT/plan.json" ]]; then
    C="$(compiler_for)"
    echo "[render] no index.html — auto-compiling via $C"
    node "$(dirname "$0")/$C" "$PROJECT"
  elif [[ -f "$PROJECT/cinematic.json" ]]; then
    # cinematic.json-only project: the full compiler lowers blocks → plan.json → html
    echo "[render] no index.html — auto-compiling via make-cinematic.cjs"
    node "$(dirname "$0")/make-cinematic.cjs" "$PROJECT"
  else
    echo "[render] missing $PROJECT/index.html and standard.json/plan.json/cinematic.json — author + compile first" >&2
    exit 1
  fi
elif [[ -f "$PROJECT/cinematic.json" && "$PROJECT/cinematic.json" -nt "$PROJECT/index.html" ]]; then
  echo "[render] cinematic.json newer than index.html — recompiling"
  node "$(dirname "$0")/make-cinematic.cjs" "$PROJECT"
elif [[ -f "$PROJECT/plan.json" && "$PROJECT/plan.json" -nt "$PROJECT/index.html" ]]; then
  C="$(compiler_for)"
  echo "[render] plan.json newer than index.html — recompiling via $C"
  node "$(dirname "$0")/$C" "$PROJECT"
else
  # the COMPILERS themselves may have changed since this project last compiled —
  # rendering stale HTML after a compiler fix silently re-ships the old bug
  C="$(compiler_for)"
  RECOMPILER="$C"
  # for cinematic projects the FULL compiler is make-cinematic (compiler_for points
  # at make-composition, which only re-emits html from an already-compiled plan)
  if [[ -f "$PROJECT/cinematic.json" && "$C" == "make-composition.cjs" ]]; then RECOMPILER="make-cinematic.cjs"; fi
  ENGINE="$(dirname "$0")/../modes/cinematic/engine.html"
  if [[ "$(dirname "$0")/$RECOMPILER" -nt "$PROJECT/index.html" || "$(dirname "$0")/lib-dna.cjs" -nt "$PROJECT/index.html" || ( -f "$ENGINE" && "$ENGINE" -nt "$PROJECT/index.html" ) ]]; then
    echo "[render] compiler/engine newer than index.html — recompiling via $RECOMPILER"
    node "$(dirname "$0")/$RECOMPILER" "$PROJECT"
  fi
fi

# Embed template fonts BEFORE the gates + render. hyperframes only auto-supplies
# its ~18 canonical fonts; every other template family (Anton, Bangers, VT323,
# Press Start 2P, …) silently falls back to a generic font on a clean/offline/CI
# machine — it only "looks right" locally when that font happens to be installed
# as a system font. inject-fonts inlines the @font-face (base64 woff2, from
# modes/standard/fonts/fonts.css) for whatever non-canonical families each HTML
# actually uses, so measure-layout AND the capture see the true glyph metrics.
# Idempotent; a no-op when every font is canonical/system or already declared.
node "$(dirname "$0")/inject-fonts.cjs" "$PROJECT" \
  || echo "[render] (font embed skipped — inject-fonts.cjs/fonts.css unavailable)" >&2

# gate ledger — each gate appends one line; echoed as a summary before "done"
# (verdicts were drowning hundreds of lines up in ffmpeg logs)
GATES="$PROJECT/_gates.txt"; : > "$GATES"

# Gate: plan.json word timings must align with transcript.json within 80ms.
# A caption whose animation fires 500ms before or after the word is spoken
# breaks the "belongs to the scene" illusion — hard fail, not a warning.
# Skip only if transcript.json is missing (custom mode without transcript).
if [[ -f "$PROJECT/plan.json" && -f "$PROJECT/transcript.json" ]]; then
  if ! node "$(dirname "$0")/check-timing.cjs" "$PROJECT" --strict; then
    echo "[render] ABORTED — fix plan.json word timings to match transcript.json, then re-run." >&2
    exit 2
  fi
  echo "timing            PASS (strict)" >> "$GATES"
fi

# Gate: subject occlusion + frame-edge overflow — pixel-perfect via Chromium DOM
# rects (measure-layout.cjs) × the subject-matte alpha (sharp). Template mode only
# (skipped when plan.json is absent; custom mode uses check-overflow.cjs below).
if [[ -f "$PROJECT/plan.json" && -d "$PROJECT/frames_fg" ]]; then
  # check-occlusion prints its verdict, then can intermittently hang on native
  # (sharp/libvips) teardown — which would wedge the whole render. Run it under a
  # watchdog: once the verdict is printed, a stuck exit can't block us. We read the
  # pass/fail from its OUTPUT, not its exit code, so the hang is harmless.
  OCC_LOG="$PROJECT/_occlusion.log"
  node "$(dirname "$0")/check-occlusion.cjs" "$PROJECT" --strict > "$OCC_LOG" 2>&1 &
  OCC_PID=$!; occ_t0=$SECONDS; OCC_RC=""; verdict_at=""
  while kill -0 "$OCC_PID" 2>/dev/null; do
    # mark when the verdict header is printed (analysis done). if-form: a failed grep
    # must NOT trip set -e (it silently killed the whole render on fresh projects).
    if [[ -z "$verdict_at" ]] && grep -qE '\[v2\].*word-fail' "$OCC_LOG" 2>/dev/null; then verdict_at=$SECONDS; fi
    # verdict printed but still alive 8s later → native (sharp) teardown hang; or no
    # verdict after 150s → measure/analysis stuck. Either way: kill + read verdict.
    if { [[ -n "$verdict_at" ]] && (( SECONDS - verdict_at > 8 )); } || (( SECONDS - occ_t0 > 150 )); then
      kill -9 "$OCC_PID" 2>/dev/null
      if grep -q 'cap(s) FAIL' "$OCC_LOG"; then OCC_RC=2; else OCC_RC=0; fi
      echo "[render] occlusion gate hung after verdict (sharp teardown) — killed zombie; verdict rc=$OCC_RC" >&2
      break
    fi
    sleep 2
  done
  if [[ -z "$OCC_RC" ]]; then OCC_RC=0; wait "$OCC_PID" 2>/dev/null || OCC_RC=$?; fi   # capture rc without tripping set -e
  cat "$OCC_LOG"
  if (( OCC_RC != 0 )); then
    echo "[render] ABORTED — fix plan.json layout to reduce subject occlusion / frame-edge overflow, then re-run." >&2
    echo "         Override: OCCLUSION_SKIP=1 bash render-and-composite.sh <project>" >&2
    if [[ "${OCCLUSION_SKIP:-0}" != "1" ]]; then
      exit 2
    fi
    echo "[render] OCCLUSION_SKIP=1 set — continuing despite occlusion/overflow warnings." >&2
    echo "occlusion+overflow OVERRIDDEN (OCCLUSION_SKIP=1 — conscious accept)" >> "$GATES"
  fi
  if (( OCC_RC == 0 )); then echo "occlusion+overflow PASS" >> "$GATES"; fi
fi

# Custom mode (no plan.json) skips the template gates above. Run a lightweight,
# mode-agnostic frame-overflow check as a WARNING only — custom designs may bleed
# off-frame intentionally, so it never aborts, but it surfaces captions that fall
# off the canvas (the failure we otherwise only catch by eye).
if [[ ! -f "$PROJECT/plan.json" && -f "$PROJECT/index.html" && -f "$(dirname "$0")/check-overflow.cjs" ]]; then
  node "$(dirname "$0")/check-overflow.cjs" "$PROJECT" \
    || echo "[render] (overflow check skipped — Chromium/puppeteer unavailable)" >&2
  echo "overflow(index)   checked (custom mode, warning-only)" >> "$GATES"
fi
# rail.html gets NO other automated coverage (the occlusion gate only reads plan.json
# caps) — run its overflow check whenever it exists. Was dead code inside the
# no-plan.json branch: Standard always HAS a derived plan.json, so it never ran.
if [[ -f "$PROJECT/rail.html" && -f "$(dirname "$0")/check-overflow.cjs" ]]; then
  if node "$(dirname "$0")/check-overflow.cjs" "$PROJECT" rail.html; then
    echo "overflow(rail)    PASS" >> "$GATES"
  else
    echo "[render] (rail overflow check skipped — Chromium/puppeteer unavailable)" >&2
    echo "overflow(rail)    skipped (infra)" >> "$GATES"
  fi
fi

# Standard hand-off gate: the PROMOTED climax word must NOT also be revealed in the
# rail during the climax's on-screen window (PIPELINE.md "Rail ↔ climax hand-off").
# Hard-fails on a CONFIRMED duplicate; infra issues (no puppeteer, etc.) exit 0 and
# never block. Override with RAIL_CLIMAX_SKIP=1 for a deliberate exception.
if [[ -f "$PROJECT/rail.html" && -f "$PROJECT/index.html" && -f "$(dirname "$0")/check-rail-climax.cjs" ]]; then
  if ! node "$(dirname "$0")/check-rail-climax.cjs" "$PROJECT"; then
    echo "[render] ABORTED — the promoted climax word is duplicated in the rail." >&2
    echo "         Apply the rail↔climax hand-off (PIPELINE.md), then re-run." >&2
    echo "         Override: RAIL_CLIMAX_SKIP=1 bash render-and-composite.sh <project>" >&2
    if [[ "${RAIL_CLIMAX_SKIP:-0}" != "1" ]]; then
      exit 2
    fi
    echo "[render] RAIL_CLIMAX_SKIP=1 — continuing despite the rail/climax duplicate." >&2
    echo "rail-climax       OVERRIDDEN (RAIL_CLIMAX_SKIP=1)" >> "$GATES"
  else
    echo "rail-climax       PASS (no duplicate reveal)" >> "$GATES"
  fi
fi

# FPS: matte.fps (written by matte.cjs at the source's NATIVE rate) is authoritative
# so the matte overlay stays frame-aligned with the render. Falls back to plan.fps /
# frame-count inference / 24. Warn if plan.json fps disagrees with the matte.
FPS=""
if [[ -f "$PROJECT/matte.fps" ]]; then
  FPS="$(tr -dc '0-9' < "$PROJECT/matte.fps")"
  if [[ -f "$PROJECT/plan.json" ]]; then
    PFPS="$(node -e 'try{process.stdout.write(String(require(process.argv[1]).fps??""))}catch(e){}' "$PROJECT/plan.json" 2>/dev/null || true)"
    if [[ -n "$PFPS" && "$PFPS" != "$FPS" ]]; then
      echo "[render] WARN: plan.json fps=$PFPS != matte fps=$FPS — using matte fps to keep occlusion aligned" >&2
    fi
  fi
fi
if [[ -z "$FPS" || "$FPS" == "0" ]]; then
  if [[ -f "$PROJECT/plan.json" ]]; then
    FPS="$(node -e 'process.stdout.write(String(require(process.argv[1]).fps??24))' "$PROJECT/plan.json")"
  elif [[ -d "$PROJECT/frames_fg" ]]; then
    N="$(ls "$PROJECT/frames_fg" | wc -l | tr -d ' ')"
    DUR="$(grep -oE 'data-duration="[0-9.]+"' "$PROJECT/index.html" | head -1 | grep -oE '[0-9.]+' || echo '')"
    if [[ -n "$DUR" && "$N" -gt 0 ]]; then
      FPS="$(awk "BEGIN{printf \"%d\", $N/$DUR + 0.5}")"
    else
      FPS=24
    fi
  else
    FPS=24
  fi
fi

# Caption layer: "bg" (classic embed — matte overlays subject on top of caps)
# or "fg" (captions always on top — announcement feel, used for 9:16 portraits
# where the subject fills the frame and bg mode loses too much to occlusion).
# Precedence: CLI env flag > plan.json > HTML data attribute > "bg".
CAPTION_LAYER="${CAPTION_LAYER_FLAG:-}"
if [[ -z "$CAPTION_LAYER" && -f "$PROJECT/plan.json" ]]; then
  CAPTION_LAYER="$(node -e 'process.stdout.write(String(require(process.argv[1]).caption_layer??"bg"))' "$PROJECT/plan.json")"
fi
if [[ -z "$CAPTION_LAYER" && -f "$PROJECT/index.html" ]]; then
  ATTR="$(grep -oE 'data-caption-layer="(bg|fg)"' "$PROJECT/index.html" | head -1 | grep -oE '(bg|fg)' || true)"
  if [[ -n "$ATTR" ]]; then CAPTION_LAYER="$ATTR"; fi
fi
CAPTION_LAYER="${CAPTION_LAYER:-bg}"
echo "[render] caption_layer=$CAPTION_LAYER"

BG="$PROJECT/bg_plus_caps.mp4"
FINAL="$PROJECT/final.mp4"

# Snapshot the current index.html + plan.json into history/ so the user
# can recover a prior iteration's design after further edits overwrite it.
HISTORY_DIR="$PROJECT/history"
mkdir -p "$HISTORY_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
cp "$PROJECT/index.html" "$HISTORY_DIR/index-${STAMP}.html"
cp "$PROJECT/plan.json"  "$HISTORY_DIR/plan-${STAMP}.json" 2>/dev/null || true
echo "[render] snapshot → history/index-${STAMP}.html"

echo "[render] hyperframes render @ ${FPS}fps"

# Hyperframes occasionally hangs on Chromium shutdown *after* the output file
# is successfully written (seen multiple times on 15–30s clips). Without a
# guard the shell waits forever. This helper enforces a max wall-clock budget,
# and if the output is already on disk when we hit it, treats the run as
# successful and kills the zombie. Tune HF_TIMEOUT_S via env if needed.
# Default SCALES with clip size: two parallel Chromium passes on a long clip
# legitimately exceed a fixed 240s (a 38s/1151-frame render was killed at 244s
# while healthy). ~1.5s per source frame, floor 240s.
N_FRAMES="$(ls "$PROJECT/frames_fg" 2>/dev/null | wc -l | tr -d ' ')"
HF_TIMEOUT_S="${HF_TIMEOUT_S:-$(( N_FRAMES * 3 / 2 > 240 ? N_FRAMES * 3 / 2 : 240 ))}"
# hf_render_dir: render one hyperframes composition.
# args: <output.mp4> <label> <project_dir>
# watches for the Chromium-shutdown-hang; if output file exists and is >1MB
# past timeout, treats as success and kills the zombie.
hf_render_dir() {
  local out="$1" label="$2" proj="$3" fmt="${4:-}"
  # bash 3.2 (macOS) throws on empty-array expansion under `set -u`, so branch
  # explicitly instead of splatting an optional --format array.
  if [[ -n "$fmt" ]]; then
    node "$HF_CLI" render --skill=embedded-captions --dir "$proj" --fps "$FPS" --format "$fmt" --crf 11 -o "$out" &
  else
    node "$HF_CLI" render --skill=embedded-captions --dir "$proj" --fps "$FPS" --crf 11 -o "$out" &
  fi
  local pid=$! start=$SECONDS elapsed
  while kill -0 "$pid" 2>/dev/null; do
    elapsed=$((SECONDS - start))
    if (( elapsed > HF_TIMEOUT_S )); then
      local sz=0
      [[ -f "$out" ]] && sz=$(stat -f%z "$out" 2>/dev/null || echo 0)
      if (( sz > 1000000 )); then
        echo "[render] ${label}: node hung ${elapsed}s after shutdown (output ${sz}B exists, treating as success)"
        kill -9 "$pid" 2>/dev/null
        pkill -9 -f "puppeteer_dev_chrome_profile" 2>/dev/null
        return 0
      fi
      echo "[render] ${label}: hung ${elapsed}s with no output — killing and failing" >&2
      kill -9 "$pid" 2>/dev/null
      pkill -9 -f "puppeteer_dev_chrome_profile" 2>/dev/null
      return 2
    fi
    sleep 5
  done
  wait "$pid" 2>/dev/null
  [[ -f "$out" ]]
}

# Link a project's assets into a shadow render dir EXCEPT the files we manage
# (the HTML we override + render outputs/intermediates). Links every other entry by
# its real name, so the shadow resolves whatever media the HTML references — including
# the ORIGINAL video filename `hyperframes init` scaffolds (e.g. clip.mp4), not just a
# fixed allow-list. Prevents the shadow-render 404 → silent/frozen output → abort.
link_assets() {  # <project> <shadow>
  local proj="$1" sh="$2" b
  for p in "$proj"/*; do
    [[ -e "$p" ]] || continue
    b="$(basename "$p")"
    case "$b" in
      index.html|rail.html|index_fg.html|final.mp4|bg_plus_caps.mp4|fg_caps.mp4|rail.webm|history|_*) continue;;
    esac
    ln -sf "$p" "$sh/$b"
  done
}

# Hybrid renders need 2 independent hyperframes passes. They share no state, so
# we run them in parallel (one in the main PROJECT, one in a shadow dir with
# index_fg.html renamed to index.html). Saves ~half of the Chromium cost.
FG_SHADOW=""
if [[ -f "$PROJECT/index_fg.html" ]]; then
  FG_SHADOW="$PROJECT/_fg_shadow"
  rm -rf "$FG_SHADOW" && mkdir -p "$FG_SHADOW"
  # Link shared assets (any media filename); copy index_fg.html into shadow as index.html.
  link_assets "$PROJECT" "$FG_SHADOW"
  cp "$PROJECT/index_fg.html" "$FG_SHADOW/index.html"

  FG_CAPS="$PROJECT/fg_caps.mp4"
  echo "[render] hybrid fg/bg — launching both passes in parallel"
  hf_render_dir "$BG" "bg_plus_caps" "$PROJECT" &
  BG_PID=$!
  hf_render_dir "$FG_CAPS" "fg_caps" "$FG_SHADOW" &
  FG_PID=$!
  # Wait for both; fail if either fails.
  BG_RC=0; wait "$BG_PID" || BG_RC=$?
  FG_RC=0; wait "$FG_PID" || FG_RC=$?
  rm -rf "$FG_SHADOW"
  if (( BG_RC != 0 )); then echo "[render] bg render failed" >&2; exit 1; fi
  if (( FG_RC != 0 )); then echo "[render] fg render failed" >&2; exit 1; fi
elif [[ -f "$PROJECT/rail.html" ]]; then
  # Standard mode: TWO independent hyperframes passes (base = index.html with the
  # embed; rail = rail.html transparent). Each renders from its own shadow dir (the
  # multiple-root ambiguity), and they share no state — run them IN PARALLEL like
  # the fg-hybrid above (~halves the Chromium wall time). The rail webm is consumed
  # by the composite stage below, which finds it already rendered.
  BASE_SHADOW="$PROJECT/_base_shadow"; rm -rf "$BASE_SHADOW"; mkdir -p "$BASE_SHADOW"
  link_assets "$PROJECT" "$BASE_SHADOW"
  cp "$PROJECT/index.html" "$BASE_SHADOW/index.html"
  RAIL_SHADOW="$PROJECT/_rail_shadow"; rm -rf "$RAIL_SHADOW"; mkdir -p "$RAIL_SHADOW"
  link_assets "$PROJECT" "$RAIL_SHADOW"
  cp "$PROJECT/rail.html" "$RAIL_SHADOW/index.html"
  RAIL_WEBM="$PROJECT/rail.webm"
  echo "[render] standard base + rail — launching both passes in parallel"
  hf_render_dir "$BG" "bg_plus_caps" "$BASE_SHADOW" &
  BASE_PID=$!
  hf_render_dir "$RAIL_WEBM" "rail" "$RAIL_SHADOW" "webm" &
  RAIL_PID=$!
  BASE_RC=0; wait "$BASE_PID" || BASE_RC=$?
  RAIL_RC=0; wait "$RAIL_PID" || RAIL_RC=$?
  rm -rf "$BASE_SHADOW" "$RAIL_SHADOW"
  if (( BASE_RC != 0 )); then echo "[render] bg render failed" >&2; exit 1; fi
  if (( RAIL_RC != 0 )); then echo "[render] rail render failed" >&2; exit 1; fi
else
  hf_render_dir "$BG" "bg_plus_caps" "$PROJECT" \
    || { echo "[render] bg render failed" >&2; exit 1; }
fi

# Probe render dims for ffmpeg scale
W="$(ffprobe -v error -select_streams v:0 -show_entries stream=width  -of default=nw=1:nk=1 "$BG")"
H="$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of default=nw=1:nk=1 "$BG")"

# Clamp every composite to the matte (= source-video) length. The render uses
# plan.duration / data-duration, which can exceed the source (e.g. Whisper word
# timestamps overrun the clip). Past the source the a-roll is gone (black) but the
# matte overlay repeats its last frame → the tail shows the subject floating on
# black. frames_fg count/fps APPROXIMATES the source length, but fractional-rate
# sources (29.97) get over-extracted by integer-fps rounding (e.g. 544 frames for
# a 542-frame 18.085s clip -> 544/30 = 18.133s -> ~1.5 trailing BLACK frames after
# the a-roll stream ends). The true a-roll duration is authoritative: clamp to
# min(matte frames / fps, source duration).
MATTE_DUR="$(awk "BEGIN{printf \"%.3f\", $(ls "$PROJECT/frames_fg" | wc -l)/$FPS}")"
SRC_DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$PROJECT/source.mp4" 2>/dev/null || true)"
if [[ -n "${SRC_DUR:-}" ]]; then
  MATTE_DUR="$(awk "BEGIN{m=$MATTE_DUR; s=$SRC_DUR; printf \"%.3f\", (s>0 && s<m) ? s : m}")"
fi
echo "[render] clamp output to source/matte length: ${MATTE_DUR}s"

# Bug-1 guard: the background plate ($BG) must be at least the matte/source length,
# else the tail (where the bg ran out but the matte continues) shows ONLY the
# foreground subject on black. Cinematic auto-fixes this (make-composition sets the
# canvas = source length); this catches a hand-authored Standard duration set to the
# last-caption time instead of the clip length. Clamp to the bg length so we never
# ship the only-foreground tail, and tell the author the real fix.
if [[ -f "$BG" ]]; then
  BG_DUR="$(ffprobe -v error -show_entries format=duration -of default=nokey=1:noprint_wrappers=1 "$BG" 2>/dev/null | tr -dc '0-9.')"
  if [[ -n "$BG_DUR" ]] && awk "BEGIN{exit !($BG_DUR < $MATTE_DUR - 0.3)}"; then
    echo "[render] ⚠ background plate is ${BG_DUR}s but the clip is ${MATTE_DUR}s — the composition is shorter than the footage." >&2
    echo "         The tail would show ONLY the foreground subject on black. FIX: set the composition" >&2
    echo "         duration to the SOURCE clip length (data-duration on #root/#a-roll); captions may still" >&2
    echo "         end earlier. Clamping output to ${BG_DUR}s for now to avoid the broken tail." >&2
    MATTE_DUR="$BG_DUR"
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# STANDARD mode (rail + embed) — detected by rail.html.
#   $BG = index.html rendered (source video + the embed climax).
#   (1) overlay the subject matte so the subject occludes the climax (embed = behind).
#   (2) render rail.html → transparent WebM (the verbatim rail).
#   (3) alpha-composite the rail IN FRONT so it is never occluded (rail = on top).
# The existing Cinematic paths below are untouched.
if [[ -f "$PROJECT/rail.html" ]]; then
  MATTED="$PROJECT/_matted.mp4"
  if [[ "$CAPTION_LAYER" == "fg" ]]; then
    # caption_layer:fg — the climax sits IN FRONT of the subject (no behind-subject
    # embed possible, e.g. a frame-filling 9:16 subject). bg_plus_caps already has the
    # climax drawn over the video, so we SKIP the matte overlay (which would push the
    # subject back in front of it). The rail still overlays on top below.
    echo "[render] STANDARD (rail + FRONT climax) — caption_layer=fg, matte overlay skipped (${W}x${H})"
    cp "$BG" "$MATTED"
  else
    echo "[render] STANDARD (rail + embed) — embed behind subject, rail alpha-overlaid in front (${W}x${H})"
    ffmpeg -y -i "$BG" \
      -framerate "$FPS" -i "$PROJECT/frames_fg/f_%04d.png" \
      -filter_complex "[1:v]scale=${W}:${H},format=yuva420p[m];[0:v][m]overlay=format=auto[v]" \
      -map "[v]" -map 0:a -r "$FPS" -t "$MATTE_DUR" -c:v libx264 -crf 11 -preset medium -c:a copy "$MATTED"
  fi

  # rail.webm was already rendered IN PARALLEL with the base pass above.
  RAIL_WEBM="$PROJECT/rail.webm"
  [[ -f "$RAIL_WEBM" ]] || { echo "[render] rail.webm missing (parallel rail pass failed?)" >&2; exit 1; }

  # alpha-overlay the transparent rail in front of the matted video (force vp9
  # decode so the WebM alpha plane is honoured by overlay)
  ffmpeg -y -i "$MATTED" -c:v libvpx-vp9 -i "$RAIL_WEBM" \
    -filter_complex "[0:v][1:v]overlay=format=auto[v]" \
    -map "[v]" -map 0:a -r "$FPS" -t "$MATTE_DUR" -c:v libx264 -crf 11 -preset medium -c:a copy "$FINAL"
  rm -f "$MATTED"
  if [[ -s "$GATES" ]]; then echo "[render] ── gates ──"; sed 's/^/[render]   /' "$GATES"; fi
echo "[render] done → $FINAL"
  exit 0
fi

# Decide composite mode:
#  - If make-composition emitted index_fg.html (any group has layer:fg),
#    use hybrid regardless of plan-level caption_layer.
#  - Else if caption_layer=fg globally, skip matte.
#  - Else (default), matte embed.
if [[ -f "$PROJECT/index_fg.html" ]]; then
  # Hybrid: bg_plus_caps and fg_caps were both rendered above in parallel.
  # Now composite: bg_plus_caps + matte (subject on top) + fg_caps (screen).
  FG_CAPS="$PROJECT/fg_caps.mp4"
  echo "[render] hybrid — composite (bg_plus_caps + matte + fg_caps[screen blend])"
  # fg_caps is bright caption on pure black. blend=screen makes it behave
  # like CSS mix-blend-mode: screen on the matted video — captions pick up
  # scene luminance, NOT a flat opaque overlay (which looks sticker-like).
  # Use rgb format to avoid YUV-space color drift, then convert back for libx264.
  ffmpeg -y -i "$BG" \
    -framerate "$FPS" -i "$PROJECT/frames_fg/f_%04d.png" \
    -i "$FG_CAPS" \
    -filter_complex "[1:v]scale=${W}:${H},format=yuva420p[matte];[0:v][matte]overlay=format=auto,format=gbrp[matted];[2:v]format=gbrp[fg];[matted][fg]blend=all_mode=screen,format=yuv420p[v]" \
    -map "[v]" -map 0:a \
    -r "$FPS" -t "$MATTE_DUR" -c:v libx264 -crf 12 -preset medium -c:a copy \
    "$FINAL"
elif [[ "$CAPTION_LAYER" == "fg" ]]; then
  # Global FG mode: skip matte overlay entirely. bg_plus_caps.mp4 already
  # has captions on top of a-roll. Re-encode for consistency.
  echo "[render] fg mode (global) — skipping matte, re-encoding ${W}x${H}"
  ffmpeg -y -i "$BG" \
    -r "$FPS" -t "$MATTE_DUR" -c:v libx264 -crf 12 -preset medium -c:a copy \
    "$FINAL"
else
  echo "[render] bg mode — overlay matte (${W}x${H})"
  ffmpeg -y -i "$BG" \
    -framerate "$FPS" -i "$PROJECT/frames_fg/f_%04d.png" \
    -filter_complex "[1:v]scale=${W}:${H},format=yuva420p[fg];[0:v][fg]overlay=format=auto[v]" \
    -map "[v]" -map 0:a \
    -r "$FPS" -t "$MATTE_DUR" -c:v libx264 -crf 12 -preset medium -c:a copy \
    "$FINAL"
fi

if [[ -s "$GATES" ]]; then echo "[render] ── gates ──"; sed 's/^/[render]   /' "$GATES"; fi
echo "[render] done → $FINAL"
