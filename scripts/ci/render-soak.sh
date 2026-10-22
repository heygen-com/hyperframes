#!/usr/bin/env bash
# render-soak.sh: with every core kept busy, renders the CLI smoke project RUNS times (each must pass with no empty
# frame), then renders the counter fixture twice losslessly (frame hashes must match, no frame may repeat the last).
# Races that an idle runner never hits, like #5795's blank worker pages, show up under this load.
set -uo pipefail
RUNS="${RUNS:-30}" LOAD="${LOAD:-$(nproc)}"
CLI=(node "${HF_CLI:-packages/cli/dist/cli.js}")
FIXTURE="$(cd "$(dirname "$0")/fixtures/render-soak" && pwd)"
WORK="$(mktemp -d /tmp/render-soak-XXXX)"
export HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_SKIP_SKILLS=1

LOAD_PIDS=()
stop_load() { kill "${LOAD_PIDS[@]}" 2>/dev/null; }
trap stop_load EXIT
for _ in $(seq "$LOAD"); do (while :; do :; done) & LOAD_PIDS+=($!); done
echo "load: ${#LOAD_PIDS[@]} busy loops"

testsrc() {
  ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=size=640x360:rate=30 \
    -f lavfi -i sine=frequency=880:sample_rate=48000 -t 3 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -y "$1"
}
testsrc "$WORK/input.mp4"

failed=0
for i in $(seq "$RUNS"); do
  dir="$WORK/smoke-$i" start=$SECONDS
  "${CLI[@]}" init "$dir" --example warm-grain --video "$WORK/input.mp4" --skip-transcribe --non-interactive \
    --skip-skills >"$WORK/init-$i.log" 2>&1
  # 4 workers on CI's 4 cores hit #5795's race in 7 of 30 renders; auto (2 workers) hit it in 1 of 30.
  "${CLI[@]}" render "$dir" --quality standard --workers 4 --strict --output "$dir/out.mp4" >"$WORK/render-$i.log" 2>&1
  status=$?
  if ((status != 0)) || [ ! -s "$dir/out.mp4" ] || grep -qE 'empty frame|Invalid JPEG input' "$WORK/render-$i.log"; then
    failed=$((failed + 1))
    echo "::error::soak render $i failed (exit $status): $(grep -m1 -oE 'Invalid JPEG input[^"]*|empty frame[^"]*' "$WORK/render-$i.log")"
    tail -20 "$WORK/render-$i.log"
  else
    echo "soak render $i ok ($((SECONDS - start)) s)"
  fi
done

hashes() { ffmpeg -hide_banner -loglevel error -i "$1" -map 0:v:0 -f framemd5 - | grep -v '^#' | awk -F', *' '{print $6}'; }
cp -R "$FIXTURE" "$WORK/counter" && testsrc "$WORK/counter/clip.mp4"
for pass in a b; do
  "${CLI[@]}" render "$WORK/counter" --workers auto --strict --crf 0 --output "$WORK/counter-$pass.mp4" \
    >"$WORK/counter-$pass.log" 2>&1 || { echo "::error::counter render $pass failed"; tail -20 "$WORK/counter-$pass.log"; }
  hashes "$WORK/counter-$pass.mp4" >"$WORK/counter-$pass.md5"
done
frames=$(wc -l <"$WORK/counter-a.md5")
repeats=$(awk 'NR > 1 && $0 == prev { n++ } { prev = $0 } END { print n + 0 }' "$WORK/counter-a.md5")
differ=$(paste -d' ' "$WORK/counter-a.md5" "$WORK/counter-b.md5" | awk '$1 != $2 { n++ } END { print n + 0 }')
echo "counter: $frames frames, $repeats repeat the previous frame, $differ differ between the two renders"
deterministic=1
if ((frames != 90 || repeats != 0 || differ != 0)); then
  deterministic=0
  echo "::error::counter fixture is not frame-exact under load (want 90 frames, 0 repeats, 0 differences)"
fi

echo "soak: $((RUNS - failed)) of $RUNS renders passed, counter exact: $deterministic, wall $SECONDS s"
((failed == 0 && deterministic == 1))
