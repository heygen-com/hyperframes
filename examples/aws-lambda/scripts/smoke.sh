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
#   - ffprobe (normalized stream metadata + duration)
#   - jq
#   - sha256sum + cmp
#   - zip
#
# Inputs (flags or env vars):
#   --fixture <name>           (default: mp4-h264-sdr)
#   --chunk-counts <list>      (default: 2,4,8)
#   --psnr-threshold <db>      (default: fixture meta.json minPsnr)
#   --stack-name <name>        (default: hyperframes-lambda-smoke-<unique-run-id>)
#   --region <region>          (default: $AWS_REGION or us-east-1)
#   --profile <name>           (default: $AWS_PROFILE, otherwise the AWS
#                               default profile resolution chain)
#   --plan-protocol <v1|v2|both> (default: v2)
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
# shellcheck source=./_semantic-compare.sh
source "$SCRIPT_DIR/_semantic-compare.sh"
# shellcheck source=./_s3-purge.sh
source "$SCRIPT_DIR/_s3-purge.sh"
# shellcheck source=./_smoke-config.sh
source "$SCRIPT_DIR/_smoke-config.sh"
# shellcheck source=./_aws-isolation.sh
source "$SCRIPT_DIR/_aws-isolation.sh"

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
# The gate defaults to the fixture's own `meta.json.minPsnr`, which is
# calibrated for that content/runtime boundary. Override it via
# --psnr-threshold (or PSNR_THRESHOLD) for a stricter experiment.
PSNR_THRESHOLD="${PSNR_THRESHOLD-}"
SMOKE_RUN_ID="${HYPERFRAMES_SMOKE_RUN_ID:-$(hf_new_smoke_run_id)}"
STACK_NAME="${STACK_NAME:-hyperframes-lambda-smoke-${SMOKE_RUN_ID}}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_PROFILE="${AWS_PROFILE:-}"
PLAN_PROTOCOL="${PLAN_PROTOCOL:-v2}"
KEEP_STACK="false"
SKIP_BUILD="false"
REQUIRE_ENCODED_SHA_EQUAL="${REQUIRE_ENCODED_SHA_EQUAL:-false}"
# Lambda Map-state concurrency cap. 16 fans out the chunks aggressively
# at the cost of a higher peak Lambda bill. Drop to 2-4 for cheaper runs;
# raise as far as your AWS account's regional concurrency quota allows.
RESERVED_CONCURRENCY="${RESERVED_CONCURRENCY:-16}"
ARTIFACT_DIR="$REPO_ROOT/lambda-smoke-artifacts"
PROJECT_NAME=""
SAM_DEPLOY_BUCKET=""

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
  --psnr-threshold <db>         PSNR floor (default: fixture meta.json minPsnr)
  --stack-name <name>           SAM stack name (default: hyperframes-lambda-smoke-<unique-run-id>)
  --region <region>             AWS region (default: $AWS_REGION or us-east-1)
  --profile <name>              AWS profile (default: $AWS_PROFILE)
  --plan-protocol <v1|v2|both>  plan transport(s) to compare (default: v2)
  --reserved-concurrency <N>    Lambda Map MaxConcurrency cap (default: 16)
  --keep-stack                  skip `sam delete` at the end (manual teardown later)
  --require-encoded-sha-equal   also gate byte-identical encoded MP4 output
  --skip-build                  reuse existing dist/handler.zip
  -h, --help                    show this help and exit

Cost notes:
  Each run: build (free) + SAM deploy (~$0.01 in CFN ops) + per-chunk
  Lambda invocations × MemorySize (default 10240 MB) × wall-clock seconds.
  At 10 GB Lambda + ~30s per chunk × 8 chunks × 3 chunk-counts ≈ $0.04
  per run before S3 PUT/GET. Set --reserved-concurrency lower for
  cost-conscious accounts.

Required tools on PATH: aws (v2), sam (>= 1.100), bun (>= 1.3),
ffmpeg, ffprobe, jq, sha256sum, cmp, zip.
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
    --plan-protocol)  PLAN_PROTOCOL="$2"; shift 2 ;;
    --keep-stack)     KEEP_STACK="true"; shift ;;
    --require-encoded-sha-equal) REQUIRE_ENCODED_SHA_EQUAL="true"; shift ;;
    --skip-build)     SKIP_BUILD="true"; shift ;;
    --reserved-concurrency) RESERVED_CONCURRENCY="$2"; shift 2 ;;
    -h|--help)        usage; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

if [ "$PLAN_PROTOCOL" != "v1" ] && [ "$PLAN_PROTOCOL" != "v2" ] && [ "$PLAN_PROTOCOL" != "both" ]; then
  echo "ERROR: --plan-protocol must be v1, v2, or both." >&2
  exit 1
fi
PROJECT_NAME=$(hf_derive_project_name "$STACK_NAME")

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
STATE_MACHINE_ARN=""

verify_absent_api() {
  local label="$1" absent_pattern="$2"
  shift 2
  local output_file status
  output_file=$(mktemp)
  if "$@" >"$output_file" 2>&1; then
    leaks+=("$label")
    rm -f "$output_file"
    return
  else
    status=$?
  fi
  if ! grep -Eiq "$absent_pattern" "$output_file"; then
    local detail
    detail=$(tr '\n' ' ' < "$output_file" | cut -c1-240)
    leaks+=("verification-error:$label:exit=$status:$detail")
  fi
  rm -f "$output_file"
}

verify_log_group_absent() {
  local log_group="$1" output_file output status detail
  output_file=$(mktemp)
  if output=$(aws logs describe-log-groups \
    --log-group-name-prefix "$log_group" \
    --query "logGroups[?logGroupName=='$log_group'].logGroupName" \
    --output text 2>"$output_file"); then
    if [ -n "$output" ]; then
      leaks+=("log-group:$log_group")
    fi
  else
    status=$?
    detail=$(tr '\n' ' ' < "$output_file" | cut -c1-240)
    leaks+=("verification-error:log-group:$log_group:exit=$status:$detail")
  fi
  rm -f "$output_file"
}

verify_state_machine_name_absent() {
  local state_machine_name="$1" output_file output status detail
  output_file=$(mktemp)
  if output=$(aws stepfunctions list-state-machines \
    --query "stateMachines[?name=='$state_machine_name'].stateMachineArn" \
    --output text 2>"$output_file"); then
    if [ -n "$output" ]; then
      leaks+=("state-machine-name:$state_machine_name:$output")
    fi
  else
    status=$?
    detail=$(tr '\n' ' ' < "$output_file" | cut -c1-240)
    leaks+=("verification-error:state-machine-name:$state_machine_name:exit=$status:$detail")
  fi
  rm -f "$output_file"
}

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
    local cleanup_identity_ok=true
    local stack_cleanup_allowed=false
    local ownership_status=""
    local discovery_errors=()
    if ! aws sts get-caller-identity >/dev/null; then
      cleanup_identity_ok=false
      echo "ERROR: AWS identity check failed before cleanup; absence cannot be trusted" >&2
    fi
    if [ "$cleanup_identity_ok" = true ]; then
      if ownership_status=$(hf_stack_ownership_status "$STACK_NAME" "$SMOKE_RUN_ID"); then
        if [ "$ownership_status" = "owned" ]; then
          stack_cleanup_allowed=true
        else
          echo "→ Stack is absent; skipping stack-scoped destructive cleanup"
        fi
      else
        discovery_errors+=("verification-error:cloudformation-stack-ownership")
      fi
    fi
    if [ "$stack_cleanup_allowed" = true ]; then
      local discovered
      if discovered=$(hf_discover_stack_resources "$STACK_NAME"); then
        if [ -z "$BUCKET" ]; then
          BUCKET=$(jq -r '.renderBucket' <<<"$discovered")
        fi
        if [ -z "$STATE_MACHINE_ARN" ]; then
          STATE_MACHINE_ARN=$(jq -r '.stateMachineArn' <<<"$discovered")
        fi
      else
        discovery_errors+=("verification-error:cloudformation-resource-discovery")
      fi
      if [ -n "$BUCKET" ]; then
        if ! hf_delete_s3_bucket_completely "$BUCKET"; then
          echo "WARN: failed to purge/delete retained render bucket s3://$BUCKET" >&2
        fi
      fi
      if ! (cd "$SAM_DIR" && sam delete \
        --stack-name "$STACK_NAME" \
        --region "$AWS_REGION" \
        --no-prompts); then
        echo "WARN: sam delete failed for $STACK_NAME" >&2
      fi
      if ! aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME"; then
        echo "WARN: CloudFormation did not confirm stack deletion for $STACK_NAME" >&2
      fi
      if aws logs describe-log-groups \
        --log-group-name-prefix "/aws/lambda/${PROJECT_NAME}-render" \
        --query "logGroups[?logGroupName=='/aws/lambda/${PROJECT_NAME}-render'].logGroupName" \
        --output text | grep -q .; then
        if ! aws logs delete-log-group --log-group-name "/aws/lambda/${PROJECT_NAME}-render"; then
          echo "WARN: failed to delete Lambda log group" >&2
        fi
      fi
    fi
    if [ -n "$SAM_DEPLOY_BUCKET" ]; then
      if ! hf_delete_s3_bucket_completely "$SAM_DEPLOY_BUCKET"; then
        echo "WARN: failed to purge/delete SAM deployment bucket s3://$SAM_DEPLOY_BUCKET" >&2
      fi
    fi

    local leaks=()
    if [ "${#discovery_errors[@]}" -gt 0 ]; then
      leaks+=("${discovery_errors[@]}")
    fi
    if [ "$cleanup_identity_ok" != true ]; then
      leaks+=("verification-error:aws-identity-unavailable")
    fi
    verify_absent_api "cloudformation-stack:$STACK_NAME" \
      "does not exist" \
      aws cloudformation describe-stacks --stack-name "$STACK_NAME"
    if [ -n "$BUCKET" ]; then
      verify_absent_api "render-bucket:s3://$BUCKET" \
        "404|Not Found|NoSuchBucket" \
        aws s3api head-bucket --bucket "$BUCKET"
    fi
    if [ -n "$SAM_DEPLOY_BUCKET" ]; then
      verify_absent_api "sam-bucket:s3://$SAM_DEPLOY_BUCKET" \
        "404|Not Found|NoSuchBucket" \
        aws s3api head-bucket --bucket "$SAM_DEPLOY_BUCKET"
    fi
    verify_absent_api "lambda-function:${PROJECT_NAME}-render" \
      "ResourceNotFoundException|Function not found" \
      aws lambda get-function --function-name "${PROJECT_NAME}-render"
    if [ -n "$STATE_MACHINE_ARN" ]; then
      verify_absent_api "state-machine:$STATE_MACHINE_ARN" \
        "StateMachineDoesNotExist|does not exist" \
        aws stepfunctions describe-state-machine --state-machine-arn "$STATE_MACHINE_ARN"
    fi
    verify_state_machine_name_absent "${PROJECT_NAME}-render"
    local lambda_log="/aws/lambda/${PROJECT_NAME}-render"
    local states_log="/aws/states/${PROJECT_NAME}-render"
    verify_log_group_absent "$lambda_log"
    verify_log_group_absent "$states_log"
    if [ "${#leaks[@]}" -gt 0 ]; then
      echo "ERROR: AWS cleanup verification found leaked resources:" >&2
      printf '  - %s\n' "${leaks[@]}" >&2
      if [ "$exit_code" -eq 0 ]; then
        exit_code=7
      fi
    else
      echo "→ Cleanup verified: no scoped AWS resources remain"
    fi
    mkdir -p "$ARTIFACT_DIR"
    local cleanup_lines
    cleanup_lines=$(mktemp)
    if [ "${#leaks[@]}" -gt 0 ]; then
      printf '%s\n' "${leaks[@]}" > "$cleanup_lines"
    fi
    jq -Rn \
      --arg stackName "$STACK_NAME" \
      --arg projectName "$PROJECT_NAME" \
      --arg checkedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --argjson originalExitCode "${1:-0}" \
      '{
        stackName: $stackName,
        projectName: $projectName,
        checkedAt: $checkedAt,
        originalExitCode: $originalExitCode,
        leaks: [inputs | select(length > 0)],
        cleanupVerified: false
      } | .cleanupVerified = (.leaks | length == 0)' \
      < "$cleanup_lines" > "$ARTIFACT_DIR/cleanup-verification.json"
    rm -f "$cleanup_lines"
  fi
  exit "$exit_code"
}

# ── Pre-flight checks ─────────────────────────────────────────────────────
for cmd in aws sam bun ffmpeg ffprobe jq zip sha256sum cmp; do
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

# This check runs before cleanup is armed or any resource is created.
echo "→ Pre-flight: proving exact AWS resource names are unused"
if ! hf_assert_deploy_isolation "$STACK_NAME" "$PROJECT_NAME"; then
  echo "ERROR: refusing to reuse or clean resources not created by this run." >&2
  exit 1
fi

# Arm cleanup before atomically reserving the stack name. If another smoke run
# wins the create-stack race, ownership verification prevents this run from
# touching it. If this run wins, every later destructive action requires the
# same ownership tag.
trap 'cleanup_and_exit $?' EXIT

echo "→ Pre-flight: atomically reserving stack name for this smoke run"
if ! hf_reserve_smoke_stack "$STACK_NAME" "$SMOKE_RUN_ID"; then
  echo "ERROR: could not reserve stack name; another run may have won the race." >&2
  cleanup_and_exit 1
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
# Use a per-run resource prefix and deployment bucket. The template has
# explicit FunctionName/StateMachineName properties, so leaving ProjectName
# at its default makes concurrent smoke stacks overwrite/collide. A dedicated
# SAM bucket also lets teardown remove every object created by this run.
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
SAM_DEPLOY_BUCKET=$(hf_sam_deploy_bucket_name "$ACCOUNT_ID" "$AWS_REGION" "$SMOKE_RUN_ID")
if [ "$AWS_REGION" = "us-east-1" ]; then
  aws s3api create-bucket --bucket "$SAM_DEPLOY_BUCKET" >/dev/null
else
  aws s3api create-bucket \
    --bucket "$SAM_DEPLOY_BUCKET" \
    --create-bucket-configuration "LocationConstraint=$AWS_REGION" >/dev/null
fi
if ! (cd "$SAM_DIR" && sam deploy \
        --stack-name "$STACK_NAME" \
        --region "$AWS_REGION" \
        --s3-bucket "$SAM_DEPLOY_BUCKET" \
        --capabilities CAPABILITY_IAM \
        --no-confirm-changeset \
        --no-fail-on-empty-changeset \
        --tags "HyperframesSmokeRun=$SMOKE_RUN_ID" \
        --parameter-overrides \
          "ProjectName=$PROJECT_NAME" \
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
jq -n \
  --arg stackName "$STACK_NAME" \
  --arg projectName "$PROJECT_NAME" \
  --arg region "$AWS_REGION" \
  --arg renderBucket "$BUCKET" \
  --arg samDeployBucket "$SAM_DEPLOY_BUCKET" \
  --arg lambdaFunction "${PROJECT_NAME}-render" \
  --arg stateMachineArn "$STATE_MACHINE_ARN" \
  --arg lambdaLogGroup "/aws/lambda/${PROJECT_NAME}-render" \
  --arg statesLogGroup "/aws/states/${PROJECT_NAME}-render" \
  '{
    stackName: $stackName,
    projectName: $projectName,
    region: $region,
    renderBucket: $renderBucket,
    samDeployBucket: $samDeployBucket,
    lambdaFunction: $lambdaFunction,
    stateMachineArn: $stateMachineArn,
    lambdaLogGroup: $lambdaLogGroup,
    statesLogGroup: $statesLogGroup
  }' > "$ARTIFACT_DIR/aws-resource-scope.json"

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
PSNR_THRESHOLD=$(hf_resolve_psnr_threshold "$PSNR_THRESHOLD" "$FIXTURE_META")
BASE_FPS=$(jq -r '.renderConfig.fps // 30' "$FIXTURE_META")
BASE_W=$(jq -r '.renderConfig.width // 640' "$FIXTURE_META")
BASE_H=$(jq -r '.renderConfig.height // 360' "$FIXTURE_META")

RESULTS_JSON="$ARTIFACT_DIR/results.json"
echo "[]" > "$RESULTS_JSON"

IFS=',' read -ra COUNTS <<< "$CHUNK_COUNTS"
if [ "$PLAN_PROTOCOL" = "both" ]; then
  PROTOCOLS=(v1 v2)
else
  PROTOCOLS=("$PLAN_PROTOCOL")
fi
for PROTOCOL in "${PROTOCOLS[@]}"; do
for N in "${COUNTS[@]}"; do
  EXEC_NAME="smoke-$PROTOCOL-N$N-$(date +%s)"
  OUTPUT_KEY="renders/$EXEC_NAME/output.mp4"
  INPUT_JSON=$(jq -n \
    --arg project "s3://$BUCKET/projects/$FIXTURE.tar.gz" \
    --arg prefix "s3://$BUCKET/renders/$EXEC_NAME/" \
    --arg output "s3://$BUCKET/$OUTPUT_KEY" \
    --arg protocol "$PROTOCOL" \
    --argjson n "$N" \
    --argjson fps "$BASE_FPS" \
    --argjson w "$BASE_W" \
    --argjson h "$BASE_H" \
    '{
      ProjectS3Uri: $project,
      PlanOutputS3Prefix: $prefix,
      OutputS3Uri: $output,
      PlanProtocol: $protocol,
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
  echo "================== protocol=$PROTOCOL N=$N =================="
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
    echo "ERROR: protocol=$PROTOCOL N=$N execution did not succeed ($STATUS)." >&2
    aws stepfunctions describe-execution \
      --execution-arn "$EXEC_ARN" \
      > "$ARTIFACT_DIR/renders/$PROTOCOL-N$N-execution.json"
    aws stepfunctions get-execution-history \
      --execution-arn "$EXEC_ARN" --max-results 200 \
      > "$ARTIFACT_DIR/renders/$PROTOCOL-N$N-history.json" || true
    cleanup_and_exit 4
  fi

  aws stepfunctions get-execution-history \
    --execution-arn "$EXEC_ARN" --max-results 1000 --output json \
    > "$ARTIFACT_DIR/renders/$PROTOCOL-N$N-history.json"

  OUTPUT_LOCAL="$ARTIFACT_DIR/renders/$PROTOCOL-N$N-output.mp4"
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

  echo "protocol=$PROTOCOL N=$N  wall=${WALL_MS}ms  psnr=${PSNR_AVG} dB"
  jq --argjson n "$N" \
     --argjson wall "$WALL_MS" \
     --arg psnr "$PSNR_AVG" \
     --arg protocol "$PROTOCOL" \
     '. += [{planProtocol: $protocol, chunkCount: $n, wallClockMs: $wall, psnrAvgDb: ($psnr|tonumber), output: "renders/\($protocol)-N\($n)-output.mp4", history: "renders/\($protocol)-N\($n)-history.json"}]' \
     "$RESULTS_JSON" > "$RESULTS_JSON.tmp" && mv "$RESULTS_JSON.tmp" "$RESULTS_JSON"
done
done

# ── 6. Direct v1 ↔ v2 semantic equivalence ────────────────────────────────
SEMANTIC_FAILED=0
SEMANTIC_RESULTS_JSON="$ARTIFACT_DIR/semantic-comparisons.json"
echo "[]" > "$SEMANTIC_RESULTS_JSON"
if [ "$PLAN_PROTOCOL" = "both" ]; then
  for N in "${COUNTS[@]}"; do
    V1_OUTPUT="$ARTIFACT_DIR/renders/v1-N$N-output.mp4"
    V2_OUTPUT="$ARTIFACT_DIR/renders/v2-N$N-output.mp4"
    V1_HISTORY="$ARTIFACT_DIR/renders/v1-N$N-history.json"
    V2_HISTORY="$ARTIFACT_DIR/renders/v2-N$N-history.json"
    SEMANTIC_PREFIX="$ARTIFACT_DIR/renders/v1-v2-N$N"
    COMPARE_STATUS=0
    if hf_compare_render_semantics \
      "$V1_OUTPUT" "$V2_OUTPUT" "$SEMANTIC_PREFIX" "$V1_HISTORY" "$V2_HISTORY"; then
      echo "PASS: v1/v2 semantic equivalence at N=$N"
    else
      COMPARE_STATUS=$?
      if [ ! -f "${SEMANTIC_PREFIX}.json" ]; then
        jq -n --argjson status "$COMPARE_STATUS" \
          '{semanticEqual: false, comparisonError: true, comparisonExitCode: $status}' \
          > "${SEMANTIC_PREFIX}.json"
      fi
      echo "FAIL: v1/v2 semantic comparison at N=$N exited $COMPARE_STATUS (see ${SEMANTIC_PREFIX}.json)" >&2
      SEMANTIC_FAILED=$((SEMANTIC_FAILED + 1))
    fi
    jq --argjson n "$N" --slurpfile comparison "${SEMANTIC_PREFIX}.json" \
      '. += [($comparison[0] + {chunkCount: $n})]' \
      "$SEMANTIC_RESULTS_JSON" > "$SEMANTIC_RESULTS_JSON.tmp" &&
      mv "$SEMANTIC_RESULTS_JSON.tmp" "$SEMANTIC_RESULTS_JSON"
    jq -r '"  chunks=\(.chunks.equal // "error") decoded-video=\(.video.equal // "error") audio=\(.audio.equal // "error") metadata=\(.metadata.equal // "error") duration=\(.duration.equal // "error") encoded-sha=\(.encoded.equal // "error") (informational unless gated)"' \
      "${SEMANTIC_PREFIX}.json"
  done
fi

# ── 7. Gate on baseline PSNR threshold ────────────────────────────────────
FAILED=0
while read -r row; do
  N=$(echo "$row" | jq -r .chunkCount)
  PROTOCOL=$(echo "$row" | jq -r .planProtocol)
  P=$(echo "$row" | jq -r .psnrAvgDb)
  if awk -v p="$P" -v t="$PSNR_THRESHOLD" 'BEGIN{exit !(p<t)}'; then
    echo "FAIL: protocol=$PROTOCOL N=$N PSNR=$P dB below threshold $PSNR_THRESHOLD" >&2
    FAILED=$((FAILED + 1))
  fi
done < <(jq -c '.[]' "$RESULTS_JSON")

# ── 8. Summary ────────────────────────────────────────────────────────────
echo
echo "================ RESULTS ================"
printf '%-10s %-10s %-12s %-10s\n' "Protocol" "ChunkCount" "WallMs" "PSNR (dB)"
jq -r '.[] | [.planProtocol, .chunkCount, .wallClockMs, .psnrAvgDb] | @tsv' "$RESULTS_JSON" \
  | awk -F'\t' '{printf "%-10s %-10s %-12s %-10s\n", $1, $2, $3, $4}'
echo
echo "Artifacts: $ARTIFACT_DIR"

if [ "$SEMANTIC_FAILED" -gt 0 ]; then
  echo "FAILED ($SEMANTIC_FAILED v1/v2 semantic mismatches)" >&2
  cleanup_and_exit 6
fi
if [ "$FAILED" -gt 0 ]; then
  echo "FAILED ($FAILED renders below PSNR threshold)" >&2
  cleanup_and_exit 5
fi

echo "PASS"
cleanup_and_exit 0
