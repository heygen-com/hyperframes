#!/usr/bin/env bash
# Real-AWS smoke + benchmark for the HyperFrames Lambda adapter.
#
# Run this from a workstation with `aws` CLI credentials. Builds the
# handler ZIP, deploys the SAM template at examples/aws-lambda/ to your
# AWS account, renders a fixture composition through the Step Functions
# state machine at several chunk counts, PSNR-compares each output
# against the in-process baseline, and tears the stack down.
#
# Usage:
#   ./smoke.sh                                   # all defaults
#   ./smoke.sh --chunk-counts 2,4,8
#   ./smoke.sh --fixture mp4-h264-sdr --keep-stack
#   AWS_PROFILE=<your-profile> ./smoke.sh
#
# Required tools on PATH:
#   - aws (v2)
#   - sam (AWS SAM CLI, >= 1.100)
#   - bun (>= 1.3, to build the handler ZIP)
#   - ffmpeg (system or built-in; PSNR computation)
#   - jq
#   - zip
#
# Inputs (flags or env vars):
#   --fixture <name>           (default: mp4-h264-sdr)
#   --chunk-counts <list>      (default: 2,4,8)
#   --psnr-threshold <db>      (default: 40)
#   --stack-name <name>        (default: hyperframes-lambda-smoke-<timestamp>)
#   --region <region>          (default: $AWS_REGION or us-east-1)
#   --profile <name>           (default: $AWS_PROFILE, otherwise the AWS
#                               default profile resolution chain)
#   --keep-stack               (skip `sam delete` at the end)
#   --skip-build               (skip the ZIP rebuild; use the existing one)
#
# Outputs:
#   ./lambda-smoke-artifacts/results.json  (chunkCount x wallClockMs x psnrAvgDb)
#   ./lambda-smoke-artifacts/renders/N<N>-output.mp4
#   ./lambda-smoke-artifacts/renders/N<N>-history.json
#
# Exit codes:
#   0  all good
#   1  argument / pre-flight error
#   2  ZIP build failed
#   3  SAM deploy failed
#   4  one or more renders failed
#   5  PSNR below threshold

set -euo pipefail

# ── Resolve script directory + repo root ──────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
SAM_DIR="$SCRIPT_DIR/.."

# ── Defaults ──────────────────────────────────────────────────────────────
FIXTURE="${FIXTURE:-mp4-h264-sdr}"
CHUNK_COUNTS="${CHUNK_COUNTS:-2,4,8}"
# The producer regression harness uses 50 dB as its PSNR floor for
# distributed-vs-in-process renders within the SAME runtime — both
# modes execute inside the same Dockerfile.test image, so pixel drift
# is minimal. Real Lambda runs against a different ffmpeg build
# (`ffmpeg-static`) and a different Chromium build (`@sparticuz/chromium`)
# than the in-process baseline (Debian-bookworm-slim's apt ffmpeg +
# Puppeteer-managed chrome-headless-shell). Expected drift across those
# environments is ~3 dB on simple fixtures, more on font-heavy ones.
# The gate defaults to 40 dB to absorb that drift; tighten it via
# --psnr-threshold for a stricter check.
PSNR_THRESHOLD="${PSNR_THRESHOLD:-40}"
STACK_NAME="${STACK_NAME:-hyperframes-lambda-smoke-$(date +%s)}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_PROFILE="${AWS_PROFILE:-}"
KEEP_STACK="false"
SKIP_BUILD="false"
# Lambda Map-state concurrency cap. 16 fans out the chunks aggressively
# at the cost of a higher peak Lambda bill. Drop to 2-4 for cheaper runs;
# raise as far as your AWS account's regional concurrency quota allows.
RESERVED_CONCURRENCY="${RESERVED_CONCURRENCY:-16}"
ARTIFACT_DIR="$REPO_ROOT/lambda-smoke-artifacts"

usage() {
  cat <<'EOF'
Usage: smoke.sh [flags]

Real-AWS smoke + benchmark for the HyperFrames Lambda adapter. Builds the
handler ZIP, deploys the SAM stack to your AWS account, renders a fixture
through Step Functions at several chunk counts, PSNR-compares each
output against the in-process baseline, and tears the stack down.

Flags:
  --fixture <name>              fixture under packages/producer/tests/distributed/ (default: mp4-h264-sdr)
  --chunk-counts <list>         comma-separated chunk counts to benchmark (default: 2,4,8)
  --psnr-threshold <db>         PSNR floor in dB for visual equivalence (default: 40)
  --stack-name <name>           SAM stack name (default: hyperframes-lambda-smoke-<timestamp>)
  --region <region>             AWS region (default: $AWS_REGION or us-east-1)
  --profile <name>              AWS profile (default: $AWS_PROFILE)
  --reserved-concurrency <N>    Lambda Map MaxConcurrency cap (default: 16)
  --keep-stack                  skip `sam delete` at the end (manual teardown later)
  --skip-build                  reuse existing dist/handler.zip
  -h, --help                    show this help and exit

Cost notes:
  Each run: build (free) + SAM deploy (~$0.01 in CFN ops) + per-chunk
  Lambda invocations × MemorySize (default 10240 MB) × wall-clock seconds.
  At 10 GB Lambda + ~30s per chunk × 8 chunks × 3 chunk-counts ≈ $0.04
  per run before S3 PUT/GET. Set --reserved-concurrency lower for
  cost-conscious accounts.

Required tools on PATH: aws (v2), sam (>= 1.100), bun (>= 1.3), ffmpeg, jq, zip.
EOF
}

# ── Arg parsing ───────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --fixture)        FIXTURE="$2"; shift 2 ;;
    --chunk-counts)   CHUNK_COUNTS="$2"; shift 2 ;;
    --psnr-threshold) PSNR_THRESHOLD="$2"; shift 2 ;;
    --stack-name)     STACK_NAME="$2"; shift 2 ;;
    --region)         AWS_REGION="$2"; shift 2 ;;
    --profile)        AWS_PROFILE="$2"; shift 2 ;;
    --keep-stack)     KEEP_STACK="true"; shift ;;
    --skip-build)     SKIP_BUILD="true"; shift ;;
    --reserved-concurrency) RESERVED_CONCURRENCY="$2"; shift 2 ;;
    -h|--help)        usage; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# Export AWS_REGION + AWS_PROFILE so `aws` and `sam` inherit them via the
# standard env-var chain. AWS_PROFILE may be empty — that lets the CLI's
# default resolution (env → ~/.aws/config → IMDS) take over without us
# having to pass `--profile` flags everywhere.
#
# AWS_DEFAULT_REGION is also set because SAM CLI honours it as a higher-
# priority signal than AWS_REGION; without it, sam will read the region
# from the active profile's samconfig.toml or ~/.aws/config and ignore
# whatever AWS_REGION points at.
export AWS_REGION
export AWS_DEFAULT_REGION="$AWS_REGION"
if [ -n "$AWS_PROFILE" ]; then
  export AWS_PROFILE
fi

# ── Cleanup helper (defined early so the failure paths below can call it) ─
BUCKET=""

cleanup_and_exit() {
  local exit_code="${1:-0}"
  # The EXIT trap re-enters cleanup_and_exit on the way out; disarm it
  # so we don't recurse if a teardown step trips set -e.
  trap - EXIT
  if [ "$KEEP_STACK" = "true" ]; then
    echo "→ Keeping stack (--keep-stack); inspect at:"
    echo "    aws cloudformation describe-stacks --stack-name $STACK_NAME"
    if [ -n "$BUCKET" ]; then
      echo "    aws s3 ls s3://$BUCKET/"
    fi
  else
    echo "→ Tearing down stack $STACK_NAME"
    if [ -n "$BUCKET" ]; then
      aws s3 rm "s3://$BUCKET" --recursive >/dev/null 2>&1 || true
      aws s3 rb "s3://$BUCKET" --force >/dev/null 2>&1 || true
    fi
    (cd "$SAM_DIR" && sam delete \
      --stack-name "$STACK_NAME" \
      --no-prompts) >/dev/null 2>&1 || true
  fi
  exit "$exit_code"
}

# Trap unexpected failures (set -e trips, SIGINT, etc.) so we don't leak
# the deployed stack + bucket on a non-routed error path. Explicit
# cleanup_and_exit calls disarm the trap first so teardown runs once.
trap 'cleanup_and_exit $?' EXIT

# ── Pre-flight checks ─────────────────────────────────────────────────────
for cmd in aws sam bun ffmpeg jq zip; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "ERROR: '$cmd' not found on PATH." >&2
    exit 1
  fi
done

FIXTURE_DIR="$REPO_ROOT/packages/producer/tests/distributed/$FIXTURE"
BASELINE_MP4="$FIXTURE_DIR/output/output.mp4"
if [ ! -d "$FIXTURE_DIR" ] || [ ! -f "$FIXTURE_DIR/src/index.html" ]; then
  echo "ERROR: fixture not found or malformed: $FIXTURE_DIR" >&2
  exit 1
fi
if [ ! -f "$BASELINE_MP4" ]; then
  echo "ERROR: baseline mp4 missing: $BASELINE_MP4" >&2
  echo "       (this is git-LFS tracked; run 'git lfs pull' to fetch it)" >&2
  exit 1
fi

# Verify AWS credentials before building anything heavy. We don't print
# the profile name in error text — operators are expected to know which
# credentials they configured.
echo "→ Pre-flight: verifying AWS credentials (region=$AWS_REGION${AWS_PROFILE:+, profile=$AWS_PROFILE})"
if ! aws sts get-caller-identity --output text >/dev/null 2>&1; then
  echo "ERROR: aws sts get-caller-identity failed." >&2
  echo "       Configure AWS credentials (env vars, ~/.aws/credentials, SSO, IMDS) or set AWS_PROFILE." >&2
  exit 1
fi

mkdir -p "$ARTIFACT_DIR/renders"

# ── 1. Build the handler ZIP ──────────────────────────────────────────────
if [ "$SKIP_BUILD" = "false" ]; then
  echo "→ Building handler ZIP"
  if ! bun run --cwd "$REPO_ROOT/packages/aws-lambda" build:zip; then
    echo "ERROR: handler ZIP build failed." >&2
    exit 2
  fi
  bun run --cwd "$REPO_ROOT/packages/aws-lambda" verify:zip-size
else
  echo "→ Skipping ZIP build (--skip-build)"
fi
ls -lh "$REPO_ROOT/packages/aws-lambda/dist/handler.zip"

# ── 2. SAM validate + deploy ──────────────────────────────────────────────
echo "→ SAM validate"
(cd "$SAM_DIR" && sam validate --lint --region "$AWS_REGION")

echo "→ SAM deploy (stack=$STACK_NAME, region=$AWS_REGION)"
# ProjectName is intentionally NOT set to $STACK_NAME — the template
# uses ProjectName only for the function/state-machine human-facing
# names, and forcing it long here doesn't help. The BucketName is
# auto-generated by CloudFormation per stack so concurrent smoke runs
# don't collide. Pass --region explicitly here even though
# AWS_DEFAULT_REGION is set, so a stray samconfig.toml in the working
# directory can't override the script's choice.
if ! (cd "$SAM_DIR" && sam deploy \
        --stack-name "$STACK_NAME" \
        --region "$AWS_REGION" \
        --resolve-s3 \
        --capabilities CAPABILITY_IAM \
        --no-confirm-changeset \
        --no-fail-on-empty-changeset \
        --parameter-overrides \
          ChromeSource=sparticuz \
          "ReservedConcurrency=$RESERVED_CONCURRENCY"); then
  echo "ERROR: sam deploy failed; tearing down rollback'd stack..." >&2
  cleanup_and_exit 3
fi

# ── 3. Read stack outputs ─────────────────────────────────────────────────
BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='RenderBucketName'].OutputValue" \
  --output text)
STATE_MACHINE_ARN=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='RenderStateMachineArn'].OutputValue" \
  --output text)
echo "→ Stack outputs: bucket=$BUCKET state_machine=$STATE_MACHINE_ARN"

# ── 4. Upload fixture as a project tarball ────────────────────────────────
# tar.gz (not zip): Lambda's Node 22 base image ships GNU `tar` but not
# `unzip` in /usr/bin. See packages/aws-lambda/src/handler.ts for the
# matching untar call on the Lambda side.
echo "→ Uploading fixture to s3://$BUCKET/projects/$FIXTURE.tar.gz"
TMP_ARCHIVE=$(mktemp -d)
tar -czf "$TMP_ARCHIVE/project.tar.gz" -C "$FIXTURE_DIR/src" .
aws s3 cp "$TMP_ARCHIVE/project.tar.gz" "s3://$BUCKET/projects/$FIXTURE.tar.gz"
rm -rf "$TMP_ARCHIVE"

# ── 5. Render at each chunk count ─────────────────────────────────────────
FIXTURE_META="$FIXTURE_DIR/meta.json"
BASE_FPS=$(jq -r '.renderConfig.fps // 30' "$FIXTURE_META")
BASE_W=$(jq -r '.renderConfig.width // 640' "$FIXTURE_META")
BASE_H=$(jq -r '.renderConfig.height // 360' "$FIXTURE_META")

RESULTS_JSON="$ARTIFACT_DIR/results.json"
echo "[]" > "$RESULTS_JSON"

IFS=',' read -ra COUNTS <<< "$CHUNK_COUNTS"
for N in "${COUNTS[@]}"; do
  EXEC_NAME="smoke-N$N-$(date +%s)"
  OUTPUT_KEY="renders/$EXEC_NAME/output.mp4"
  INPUT_JSON=$(jq -n \
    --arg project "s3://$BUCKET/projects/$FIXTURE.tar.gz" \
    --arg prefix "s3://$BUCKET/renders/$EXEC_NAME/" \
    --arg output "s3://$BUCKET/$OUTPUT_KEY" \
    --argjson n "$N" \
    --argjson fps "$BASE_FPS" \
    --argjson w "$BASE_W" \
    --argjson h "$BASE_H" \
    '{
      ProjectS3Uri: $project,
      PlanOutputS3Prefix: $prefix,
      OutputS3Uri: $output,
      Config: {
        fps: $fps,
        width: $w,
        height: $h,
        format: "mp4",
        maxParallelChunks: $n,
        runtimeCap: "lambda"
      }
    }')

  echo
  echo "================== N=$N =================="
  echo "$INPUT_JSON" | jq .

  START_MS=$(date +%s%3N)
  EXEC_ARN=$(aws stepfunctions start-execution \
    --state-machine-arn "$STATE_MACHINE_ARN" \
    --name "$EXEC_NAME" \
    --input "$INPUT_JSON" \
    --query executionArn --output text)
  echo "Started: $EXEC_ARN"

  STATUS="RUNNING"
  for _ in $(seq 1 300); do
    sleep 5
    STATUS=$(aws stepfunctions describe-execution \
      --execution-arn "$EXEC_ARN" --query status --output text)
    if [ "$STATUS" != "RUNNING" ]; then break; fi
  done
  END_MS=$(date +%s%3N)
  WALL_MS=$((END_MS - START_MS))

  if [ "$STATUS" != "SUCCEEDED" ]; then
    echo "ERROR: N=$N execution did not succeed ($STATUS)." >&2
    aws stepfunctions describe-execution \
      --execution-arn "$EXEC_ARN" \
      > "$ARTIFACT_DIR/renders/N$N-execution.json"
    aws stepfunctions get-execution-history \
      --execution-arn "$EXEC_ARN" --max-results 200 \
      > "$ARTIFACT_DIR/renders/N$N-history.json" || true
    cleanup_and_exit 4
  fi

  aws stepfunctions get-execution-history \
    --execution-arn "$EXEC_ARN" --max-results 1000 --output json \
    > "$ARTIFACT_DIR/renders/N$N-history.json"

  OUTPUT_LOCAL="$ARTIFACT_DIR/renders/N$N-output.mp4"
  aws s3 cp "s3://$BUCKET/$OUTPUT_KEY" "$OUTPUT_LOCAL"

  PSNR_LOG=$(mktemp)
  # ffmpeg's psnr filter prints per-frame stats `psnr_avg:X.XX` to its
  # stats_file. We average those across frames to get the rendering's
  # overall PSNR vs the baseline. The filter also prints a final summary
  # line `PSNR ... average:X.XX ...` to stderr; we'd rather compute from
  # per-frame data because the summary line is missing on some ffmpeg
  # builds when the stream is too short.
  ffmpeg -nostdin -v error \
    -i "$OUTPUT_LOCAL" -i "$BASELINE_MP4" \
    -lavfi "psnr=stats_file=$PSNR_LOG" -f null - 2>/dev/null || true
  PSNR_AVG=$(awk '
    /psnr_avg:/ {
      for (i = 1; i <= NF; i++) {
        if ($i ~ /^psnr_avg:/) {
          split($i, kv, ":")
          sum += kv[2]; count++
        }
      }
    }
    END { if (count > 0) printf("%.2f", sum / count); else print "0" }
  ' "$PSNR_LOG")
  rm -f "$PSNR_LOG"

  echo "N=$N  wall=${WALL_MS}ms  psnr=${PSNR_AVG} dB"
  jq --argjson n "$N" \
     --argjson wall "$WALL_MS" \
     --arg psnr "$PSNR_AVG" \
     '. += [{chunkCount: $n, wallClockMs: $wall, psnrAvgDb: ($psnr|tonumber), output: "renders/N\($n)-output.mp4", history: "renders/N\($n)-history.json"}]' \
     "$RESULTS_JSON" > "$RESULTS_JSON.tmp" && mv "$RESULTS_JSON.tmp" "$RESULTS_JSON"
done

# ── 6. Gate on PSNR threshold ─────────────────────────────────────────────
FAILED=0
while read -r row; do
  N=$(echo "$row" | jq -r .chunkCount)
  P=$(echo "$row" | jq -r .psnrAvgDb)
  if awk -v p="$P" -v t="$PSNR_THRESHOLD" 'BEGIN{exit !(p<t)}'; then
    echo "FAIL: N=$N PSNR=$P dB below threshold $PSNR_THRESHOLD" >&2
    FAILED=$((FAILED + 1))
  fi
done < <(jq -c '.[]' "$RESULTS_JSON")

# ── 7. Summary ────────────────────────────────────────────────────────────
echo
echo "================ RESULTS ================"
printf '%-10s %-12s %-10s\n' "ChunkCount" "WallMs" "PSNR (dB)"
jq -r '.[] | [.chunkCount, .wallClockMs, .psnrAvgDb] | @tsv' "$RESULTS_JSON" \
  | awk -F'\t' '{printf "%-10s %-12s %-10s\n", $1, $2, $3}'
echo
echo "Artifacts: $ARTIFACT_DIR"

if [ "$FAILED" -gt 0 ]; then
  echo "FAILED ($FAILED renders below PSNR threshold)" >&2
  cleanup_and_exit 5
fi

echo "PASS"
cleanup_and_exit 0
