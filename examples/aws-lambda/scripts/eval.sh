#!/usr/bin/env bash
# Eval: local in-process renderer vs Lambda distributed across a set of
# fixtures. For each fixture:
#
#   1. Render in-process locally (regression harness) → wall-clock
#   2. Render via Lambda Step Functions at the configured chunk count → wall-clock + output mp4
#   3. ffmpeg-psnr (Lambda output, in-process baseline) → visual equivalence
#
# This is a maintainer-run benchmark, not a CI gate. It deploys a real
# Lambda stack (same template as smoke.sh) and tears it down at the end.
#
# Wall-clock methodology caveat:
#   The "local" timing includes `bun` + `tsx` + harness startup
#   scaffolding, not just renderer-internal time. Lambda timing measures
#   pure Step-Functions execution. The "speedup" column therefore biases
#   AGAINST Lambda on tiny fixtures (where harness boot dominates) and
#   IN FAVOUR of Lambda on larger ones. Treat the speedup as a rough
#   "what does the end-to-end CLI experience feel like" number, not as
#   "renderer-vs-renderer." Use --iterations N to get medians instead of
#   single-sample readings — cold-start variance is ±5-10s.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SAM_DIR="$SCRIPT_DIR/.."

FIXTURES="${FIXTURES:-mp4-h264-sdr,many-cuts,gsap-letters-render-compat,heygen-promo-preview-assets}"
CHUNK_COUNT="${CHUNK_COUNT:-4}"
# Pin chunkSize across all fixtures so wall-clock comparisons are
# meaningful — without a fixed value, each fixture's plan() picks
# `min(default 240, frameCount)` and short compositions render in 1
# chunk regardless of CHUNK_COUNT. 60 frames keeps every fixture in
# the table chunked.
CHUNK_SIZE="${CHUNK_SIZE:-60}"
PSNR_THRESHOLD="${PSNR_THRESHOLD:-40}"
STACK_NAME="${STACK_NAME:-hyperframes-lambda-eval-$(date +%s)}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_PROFILE="${AWS_PROFILE:-}"
KEEP_STACK="false"
SKIP_BUILD="false"
SKIP_LOCAL="false"
# Lambda Map-state concurrency cap. 16 is aggressive; lower for cheaper
# runs, raise as far as your account's regional quota allows.
RESERVED_CONCURRENCY="${RESERVED_CONCURRENCY:-16}"
# Number of Lambda renders per fixture. Cold-start variance is ±5-10s
# per chunk; a single sample is noisy. With --iterations 3+ we report
# the median Lambda wall-clock and use it for the speedup calculation.
ITERATIONS="${ITERATIONS:-1}"
ARTIFACT_DIR="$REPO_ROOT/lambda-eval-artifacts"

usage() {
  cat <<'EOF'
Usage: eval.sh [flags]

Maintainer-run benchmark comparing local in-process rendering to Lambda
distributed rendering across a set of fixtures. Deploys a real Lambda
stack, renders each fixture twice (locally + via Step Functions), and
tears the stack down.

Flags:
  --fixtures <comma-sep>        fixture names (default: mp4-h264-sdr,many-cuts,gsap-letters-render-compat,heygen-promo-preview-assets)
  --chunk-count <N>             chunk fan-out per Lambda render (default: 4)
  --chunk-size <frames>         frames per chunk; pinned across fixtures (default: 60)
  --psnr-threshold <db>         PSNR floor in dB for visual equivalence (default: 40)
  --iterations <N>              Lambda renders per fixture; report median (default: 1)
  --stack-name <name>           SAM stack name (default: hyperframes-lambda-eval-<timestamp>)
  --region <region>             AWS region (default: $AWS_REGION or us-east-1)
  --profile <name>              AWS profile (default: $AWS_PROFILE)
  --reserved-concurrency <N>    Lambda Map MaxConcurrency cap (default: 16)
  --keep-stack                  skip `sam delete` at the end
  --skip-build                  reuse existing dist/handler.zip
  --skip-local                  skip the in-process local render (Lambda-only)
  -h, --help                    show this help and exit

Cost notes:
  Each pass: SAM deploy (~$0.01) + N fixtures × ITERATIONS × CHUNK_COUNT
  Lambda invocations at MemorySize (default 10240 MB) × per-chunk wall
  clock. With defaults (4 fixtures, 1 iteration, chunk-count 4) the
  Lambda spend is roughly $0.10-$0.20 per pass before S3 PUT/GET. Drop
  --reserved-concurrency for cost-conscious accounts; bump --iterations
  for stable median timing at proportional cost.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --fixtures)        FIXTURES="$2"; shift 2 ;;
    --chunk-count)     CHUNK_COUNT="$2"; shift 2 ;;
    --chunk-size)      CHUNK_SIZE="$2"; shift 2 ;;
    --psnr-threshold)  PSNR_THRESHOLD="$2"; shift 2 ;;
    --iterations)      ITERATIONS="$2"; shift 2 ;;
    --stack-name)      STACK_NAME="$2"; shift 2 ;;
    --region)          AWS_REGION="$2"; shift 2 ;;
    --profile)         AWS_PROFILE="$2"; shift 2 ;;
    --reserved-concurrency) RESERVED_CONCURRENCY="$2"; shift 2 ;;
    --keep-stack)      KEEP_STACK="true"; shift ;;
    --skip-build)      SKIP_BUILD="true"; shift ;;
    --skip-local)      SKIP_LOCAL="true"; shift ;;
    -h|--help)         usage; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# Validate ITERATIONS is a positive integer (used as awk numeric input
# in the median computation; a non-numeric value would silently produce
# garbage timings).
case "$ITERATIONS" in
  ''|*[!0-9]*) echo "ERROR: --iterations must be a positive integer (got '$ITERATIONS')" >&2; exit 1 ;;
esac
if [ "$ITERATIONS" -lt 1 ]; then
  echo "ERROR: --iterations must be >= 1 (got $ITERATIONS)" >&2
  exit 1
fi

# AWS_DEFAULT_REGION is required for SAM (it doesn't honour AWS_REGION
# alone). Export both so any sub-tool resolves the same region.
export AWS_REGION
export AWS_DEFAULT_REGION="$AWS_REGION"
if [ -n "$AWS_PROFILE" ]; then
  export AWS_PROFILE
fi

BUCKET=""

cleanup_and_exit() {
  local code="${1:-0}"
  # The EXIT trap re-enters cleanup_and_exit on the way out; disarm it
  # so we don't recurse infinitely if `aws s3 rm` itself trips set -e.
  trap - EXIT
  if [ "$KEEP_STACK" = "true" ]; then
    echo "→ Keeping stack (--keep-stack); stack=$STACK_NAME"
  else
    echo "→ Tearing down stack $STACK_NAME"
    if [ -n "$BUCKET" ]; then
      aws s3 rm "s3://$BUCKET" --recursive >/dev/null 2>&1 || true
      aws s3 rb "s3://$BUCKET" --force >/dev/null 2>&1 || true
    fi
    (cd "$SAM_DIR" && sam delete --stack-name "$STACK_NAME" --no-prompts) >/dev/null 2>&1 || true
  fi
  exit "$code"
}

# Trap unexpected failures (set -e trips, SIGINT, etc.) so we don't leak
# the deployed stack + S3 bucket on a non-routed error. Explicit
# cleanup_and_exit calls disarm the trap first so the teardown runs
# exactly once.
trap 'cleanup_and_exit $?' EXIT

# ── Pre-flight ───────────────────────────────────────────────────────────
for cmd in aws sam bun ffmpeg jq zip; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: '$cmd' not found on PATH." >&2
    exit 1
  fi
done

echo "→ Verifying AWS credentials"
aws sts get-caller-identity --output text >/dev/null

mkdir -p "$ARTIFACT_DIR/lambda" "$ARTIFACT_DIR/local"
RESULTS_CSV="$ARTIFACT_DIR/results.csv"
echo "fixture,localMs,lambdaMs,speedup,psnrLambdaVsBaselineDb,audioStatus,audioResidualRmsDb" > "$RESULTS_CSV"

# ── 1. Build + deploy once ───────────────────────────────────────────────
if [ "$SKIP_BUILD" = "false" ]; then
  echo "→ Building handler ZIP"
  bun run --cwd "$REPO_ROOT/packages/aws-lambda" build:zip
fi

echo "→ SAM deploy (stack=$STACK_NAME)"
(cd "$SAM_DIR" && sam deploy \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --no-confirm-changeset \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    ChromeSource=sparticuz \
    "ReservedConcurrency=$RESERVED_CONCURRENCY") || cleanup_and_exit 3

BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='RenderBucketName'].OutputValue" \
  --output text)
STATE_MACHINE_ARN=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='RenderStateMachineArn'].OutputValue" \
  --output text)
echo "→ Stack ready: bucket=$BUCKET"

# ── 2. Per-fixture eval ──────────────────────────────────────────────────
IFS=',' read -ra FIXTURE_LIST <<< "$FIXTURES"
for FIXTURE in "${FIXTURE_LIST[@]}"; do
  echo
  echo "================== Fixture: $FIXTURE =================="

  FIXTURE_DIR=""
  for cand in "$REPO_ROOT/packages/producer/tests/distributed/$FIXTURE" "$REPO_ROOT/packages/producer/tests/$FIXTURE"; do
    if [ -f "$cand/meta.json" ] && [ -f "$cand/src/index.html" ]; then
      FIXTURE_DIR="$cand"
      break
    fi
  done
  if [ -z "$FIXTURE_DIR" ]; then
    echo "WARN: fixture $FIXTURE not found, skipping" >&2
    continue
  fi
  BASELINE_MP4="$FIXTURE_DIR/output/output.mp4"
  LAMBDA_MP4="$ARTIFACT_DIR/lambda/$FIXTURE.mp4"

  # ── 2a. Local in-process timing via the regression harness ────────────
  # The harness renders the fixture in-process locally and compares it to
  # the committed Docker-built baseline. We don't keep the rendered mp4
  # (the harness discards its tempdir); we only need its wall-clock here
  # because the PSNR comparisons below all run against the committed
  # `output/output.mp4` baseline — the same artifact the harness produced
  # when the fixture was first authored.
  LOCAL_MS=""
  if [ "$SKIP_LOCAL" = "false" ]; then
    echo "→ Local in-process render via regression harness"
    LOCAL_START=$(date +%s%3N)
    if bun run --cwd "$REPO_ROOT/packages/producer" --silent test -- "$FIXTURE" \
         >"$ARTIFACT_DIR/local/$FIXTURE.harness.log" 2>&1; then
      LOCAL_END=$(date +%s%3N)
      LOCAL_MS=$((LOCAL_END - LOCAL_START))
      echo "  local wall=${LOCAL_MS}ms"
    else
      echo "WARN: regression harness failed for $FIXTURE (see $ARTIFACT_DIR/local/$FIXTURE.harness.log)" >&2
      LOCAL_MS=""
    fi
  else
    echo "→ Skipping local render (--skip-local)"
    LOCAL_MS="0"
  fi

  # ── 2b. Lambda render ───────────────────────────────────────────────────
  echo "→ Lambda render (N=$CHUNK_COUNT, iterations=$ITERATIONS)"
  FIXTURE_META="$FIXTURE_DIR/meta.json"
  # Some fixtures store fps as a number (e.g. 30), others as {num,den}.
  # Pick the integer fps the Lambda config wants out of either shape.
  BASE_FPS=$(jq -r '
    .renderConfig.fps
    | if type == "object" then .num // 30 else . end
    // 30
  ' "$FIXTURE_META")
  BASE_W=$(jq -r '.renderConfig.width // 640' "$FIXTURE_META")
  BASE_H=$(jq -r '.renderConfig.height // 360' "$FIXTURE_META")

  # Pack + upload once per fixture (the project tarball is content-
  # addressable; iterations reuse the same S3 object).
  TMP=$(mktemp -d)
  tar -czf "$TMP/project.tar.gz" -C "$FIXTURE_DIR/src" .
  aws s3 cp "$TMP/project.tar.gz" "s3://$BUCKET/projects/$FIXTURE.tar.gz" >/dev/null
  rm -rf "$TMP"

  ITER_TIMINGS=()
  ITER_FAILED=0
  for ITER in $(seq 1 "$ITERATIONS"); do
    if [ "$ITERATIONS" -gt 1 ]; then
      echo "  iter $ITER/$ITERATIONS"
    fi
    EXEC_NAME="eval-$FIXTURE-$(date +%s)-${ITER}"
    OUTPUT_KEY="renders/$EXEC_NAME/output.mp4"
    INPUT_JSON=$(jq -n \
      --arg project "s3://$BUCKET/projects/$FIXTURE.tar.gz" \
      --arg prefix "s3://$BUCKET/renders/$EXEC_NAME/" \
      --arg output "s3://$BUCKET/$OUTPUT_KEY" \
      --argjson n "$CHUNK_COUNT" \
      --argjson cs "$CHUNK_SIZE" \
      --argjson fps "$BASE_FPS" \
      --argjson w "$BASE_W" \
      --argjson h "$BASE_H" \
      '{ProjectS3Uri:$project,PlanOutputS3Prefix:$prefix,OutputS3Uri:$output,Config:{fps:$fps,width:$w,height:$h,format:"mp4",chunkSize:$cs,maxParallelChunks:$n,runtimeCap:"lambda"}}')

    LAMBDA_START=$(date +%s%3N)
    EXEC_ARN=$(aws stepfunctions start-execution \
      --state-machine-arn "$STATE_MACHINE_ARN" \
      --name "$EXEC_NAME" \
      --input "$INPUT_JSON" \
      --query executionArn --output text)
    STATUS="RUNNING"
    for _ in $(seq 1 360); do
      sleep 5
      STATUS=$(aws stepfunctions describe-execution \
        --execution-arn "$EXEC_ARN" --query status --output text)
      if [ "$STATUS" != "RUNNING" ]; then break; fi
    done
    LAMBDA_END=$(date +%s%3N)
    ITER_MS=$((LAMBDA_END - LAMBDA_START))

    if [ "$STATUS" != "SUCCEEDED" ]; then
      echo "WARN: Lambda render of $FIXTURE (iter $ITER) failed ($STATUS); saving execution history" >&2
      aws stepfunctions describe-execution --execution-arn "$EXEC_ARN" \
        > "$ARTIFACT_DIR/lambda/$FIXTURE.iter${ITER}.execution.json" 2>/dev/null || true
      aws stepfunctions get-execution-history --execution-arn "$EXEC_ARN" --max-results 1000 --output json \
        > "$ARTIFACT_DIR/lambda/$FIXTURE.iter${ITER}.history.json" 2>/dev/null || true
      cause=$(jq -r '.events[] | select(.type=="ExecutionFailed" or .type=="TaskFailed") | (.executionFailedEventDetails // .taskFailedEventDetails) | .cause // .error' "$ARTIFACT_DIR/lambda/$FIXTURE.iter${ITER}.history.json" 2>/dev/null | head -1)
      [ -n "$cause" ] && echo "  cause: $(echo "$cause" | head -c 300)" >&2
      ITER_FAILED=1
      break
    fi

    # Keep the last successful iteration's mp4 as the PSNR/audio input.
    aws s3 cp "s3://$BUCKET/$OUTPUT_KEY" "$LAMBDA_MP4" >/dev/null
    ITER_TIMINGS+=("$ITER_MS")
    if [ "$ITERATIONS" -gt 1 ]; then
      echo "    iter $ITER wall=${ITER_MS}ms"
    fi
  done

  if [ "$ITER_FAILED" -eq 1 ] || [ ${#ITER_TIMINGS[@]} -eq 0 ]; then
    continue
  fi

  # Median of the iteration wall-clocks. Awk handles both odd (middle
  # element) and even (mean of middle two) sample counts without
  # bash-side branching. For ITERATIONS=1 the median is just the sample.
  LAMBDA_MS=$(printf '%s\n' "${ITER_TIMINGS[@]}" \
    | sort -n \
    | awk '
        { a[NR] = $1 }
        END {
          n = NR
          if (n % 2 == 1) print a[int((n + 1) / 2)]
          else printf("%.0f\n", (a[n/2] + a[n/2 + 1]) / 2)
        }
      ')
  if [ "$ITERATIONS" -gt 1 ]; then
    echo "  lambda median wall=${LAMBDA_MS}ms (samples: ${ITER_TIMINGS[*]})"
  else
    echo "  lambda wall=${LAMBDA_MS}ms"
  fi

  # ── 2c. PSNR comparisons ───────────────────────────────────────────────
  psnr_of() {
    local a="$1" b="$2"
    local log
    log=$(mktemp)
    ffmpeg -nostdin -v error -i "$a" -i "$b" -lavfi "psnr=stats_file=$log" -f null - 2>/dev/null || true
    awk '/psnr_avg:/ { for(i=1;i<=NF;i++) if($i ~ /^psnr_avg:/){split($i,kv,":"); sum+=kv[2]; c++} } END { if(c>0) printf("%.2f", sum/c); else print "0" }' "$log"
    rm -f "$log"
  }
  # The "local" mp4 IS the baseline (we don't keep a fresh in-process
  # render — the harness above discards its tempdir, and the baseline
  # IS the canonical in-process output). So `psnr(lambda, baseline)` is
  # the only PSNR we report. A future revision that retains a fresh
  # local render could split this back into three comparisons.
  PSNR_LAMBDA_BASE=$(psnr_of "$LAMBDA_MP4" "$BASELINE_MP4")

  # ── 2d. Audio equivalence (residual RMS) ──────────────────────────────
  # Subtract baseline audio from Lambda audio; measure residual RMS in
  # dBFS. A perfectly-equivalent track produces residual silence
  # (≤ -90 dBFS in practice for AAC-vs-AAC); we treat ≤ -50 dBFS as
  # "effectively identical." For fixtures with no audio stream on either
  # side, we emit `n/a` rather than a number.
  audio_residual_rms_db() {
    local a="$1" b="$2"
    local has_a has_b
    has_a=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$a" 2>/dev/null | head -1)
    has_b=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$b" 2>/dev/null | head -1)
    if [ -z "$has_a" ] && [ -z "$has_b" ]; then
      printf "no-audio-on-either"
      return
    fi
    if [ -z "$has_a" ] || [ -z "$has_b" ]; then
      printf "audio-stream-mismatch"
      return
    fi
    # ffmpeg emits astats summary at log level `info`; -v error would
    # suppress it. Use -v info and parse from the combined stderr.
    #
    # `amix normalize=0` is load-bearing: the default normalize=true
    # scales each input by 1/N before summing, so a 2-input subtract
    # reports the residual at -6 dB versus the true difference, making
    # the -50 dBFS gate effectively -44 dBFS. Disabling normalization
    # gives the actual sample-cancellation reading.
    local out
    out=$(ffmpeg -nostdin -v info -i "$a" -i "$b" \
            -filter_complex "[0:a]aresample=48000,pan=stereo|c0=c0|c1=c1,asetpts=N/SR/TB[a0];[1:a]aresample=48000,pan=stereo|c0=c0|c1=c1,asetpts=N/SR/TB,volume=-1[a1];[a0][a1]amix=inputs=2:duration=shortest:dropout_transition=0:normalize=0,astats=metadata=1:reset=1[out]" \
            -map "[out]" -f null - 2>&1)
    # Match the Overall-RMS line (variant forms across ffmpeg versions).
    local rms
    rms=$(printf '%s\n' "$out" | grep -oE "Overall RMS level(\s*dB)?\s*:\s*(-?inf|[-0-9.]+)" | head -1 | sed -E 's/.*:\s*//')
    if [ -z "$rms" ]; then
      # Fallback 1: per-channel "RMS level dB:" lines, which most modern
      # ffmpeg builds emit. Picks the first (most pessimistic).
      rms=$(printf '%s\n' "$out" | grep -oE "RMS level\s*dB\s*:\s*(-?inf|[-0-9.]+)" | head -1 | sed -E 's/.*:\s*//')
    fi
    if [ -z "$rms" ]; then
      # Fallback 2: very old ffmpeg builds emit `RMS level:` with no `dB`
      # suffix and the unit trailing the value (e.g. `RMS level: -42.3 dB`).
      # Use word boundaries to avoid eating `RMS peak level` lines.
      rms=$(printf '%s\n' "$out" | grep -oE "\bRMS level\b\s*:\s*(-?inf|[-0-9.]+)" | head -1 | sed -E 's/.*:\s*//')
    fi
    if [ -z "$rms" ]; then
      rms="0"
    fi
    # Normalize ffmpeg's "-inf" / "inf" sentinels to a sortable number well
    # below any sensible threshold so downstream awk comparisons don't trip
    # on the literal string. ("-inf" = perfect cancellation; -200 dBFS is
    # far below the -50 dBFS gate.) Done in an if/then/fi rather than
    # `[ A ] || [ B ] && C` — that compound form is parsed as `(A||B)&&C`
    # and silently returns nonzero when both LHS checks fail, which trips
    # `set -e` callers.
    if [ "$rms" = "-inf" ] || [ "$rms" = "inf" ]; then
      rms="-200"
    fi
    printf "%s" "$rms"
  }
  AUDIO_RMS=$(audio_residual_rms_db "$LAMBDA_MP4" "$BASELINE_MP4")
  if [[ "$AUDIO_RMS" =~ ^-?[0-9.]+$ ]]; then
    if awk -v r="$AUDIO_RMS" 'BEGIN{exit !(r<=-50)}'; then
      AUDIO_STATUS="OK"
    else
      AUDIO_STATUS="DRIFT"
    fi
  else
    AUDIO_STATUS="$AUDIO_RMS"
    AUDIO_RMS="n/a"
  fi

  if [ -n "$LOCAL_MS" ] && [ "$LOCAL_MS" != "0" ] && [ "$LAMBDA_MS" != "0" ]; then
    SPEEDUP=$(awk -v a="$LOCAL_MS" -v b="$LAMBDA_MS" 'BEGIN { printf("%.2f", a/b) }')
  else
    SPEEDUP="n/a"
  fi
  LOCAL_MS_FOR_CSV="${LOCAL_MS:-n/a}"
  echo "  psnr(lambda,baseline)=${PSNR_LAMBDA_BASE}dB"
  echo "  audio(lambda,baseline)=${AUDIO_STATUS} (residual RMS=${AUDIO_RMS} dBFS)  speedup=${SPEEDUP}x"

  echo "$FIXTURE,$LOCAL_MS_FOR_CSV,$LAMBDA_MS,$SPEEDUP,$PSNR_LAMBDA_BASE,$AUDIO_STATUS,$AUDIO_RMS" >> "$RESULTS_CSV"
done

# ── 3. Summary ───────────────────────────────────────────────────────────
echo
echo "================ RESULTS ================"
column -t -s, < "$RESULTS_CSV"
echo
echo "Artifacts: $ARTIFACT_DIR"

# Gate on lambda-vs-baseline PSNR (visual equivalence) AND audio status.
# Pass states: "OK" (residual ≤ -50 dBFS, audio matches), "no-audio-on-either"
# (fixture intentionally silent on both sides). Everything else
# ("DRIFT", "audio-stream-mismatch", "n/a", future statuses) fails.
#
# Use process substitution `done < <(tail ...)` rather than the pipeline
# form `tail | while`. The pipeline form runs the while loop in a
# subshell where FAILED=1 mutations are discarded when the subshell
# exits, so the parent's FAILED stays 0 forever — the gate would
# silently pass even on real failures.
FAILED=0
while IFS=, read -r fixture localMs lambdaMs speedup psnr audioStatus audioRms; do
  if awk -v p="$psnr" -v t="$PSNR_THRESHOLD" 'BEGIN{exit !(p<t)}'; then
    echo "FAIL: $fixture lambda-vs-baseline PSNR=$psnr dB below threshold $PSNR_THRESHOLD" >&2
    FAILED=1
  fi
  case "$audioStatus" in
    OK|no-audio-on-either) ;;
    *)
      echo "FAIL: $fixture audio status=$audioStatus (residual RMS=$audioRms dBFS)" >&2
      FAILED=1
      ;;
  esac
done < <(tail -n +2 "$RESULTS_CSV")

cleanup_and_exit "$FAILED"
