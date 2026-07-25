#!/usr/bin/env bash
# Owner-isolated real-GCP smoke + v1/v2 parity test for the HyperFrames
# Cloud Run adapter.
#
# The default is intentionally v1-only. Plan protocol v2 must be opted into
# explicitly with --protocols v1,v2. Every invocation derives a unique,
# length-safe resource prefix and uses an isolated Terraform working directory
# and state file. Cleanup verifies every owned resource is absent and fails
# closed on API/authentication errors.
#
# Usage:
#   ./smoke.sh --project <gcp-project>
#   ./smoke.sh --project p --protocols v1,v2 --chunk-sizes 15,30
#   ./smoke.sh --project p --owner james-plan-v2 --keep-stack
#
# Required tools:
#   gcloud, terraform (>= 1.5), ffmpeg, ffprobe, jq, tar, sha256sum
#
# Exit codes:
#   0 success                     1 arguments/pre-flight
#   2 image build/push failed     3 terraform apply failed
#   4 render failed               5 baseline PSNR failed
#   6 v1/v2 parity failed         7 cleanup or cleanup verification failed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TF_SOURCE_DIR="$REPO_ROOT/packages/gcp-cloud-run/terraform"

PROJECT="${GCP_PROJECT:-}"
REGION="${GCP_REGION:-us-central1}"
FIXTURE="${FIXTURE:-mp4-h264-sdr}"
CHUNK_SIZES="${CHUNK_SIZES:-}"
PSNR_THRESHOLD="${PSNR_THRESHOLD:-35}"
PROTOCOLS="${PROTOCOLS:-v1}"
OWNER="${HYPERFRAMES_SMOKE_OWNER:-}"
AR_REPO="${AR_REPO:-}"
AR_REPO_WAS_EXPLICIT=0
[ -z "$AR_REPO" ] || AR_REPO_WAS_EXPLICIT=1
EXPLICIT_IMAGE="${HYPERFRAMES_GCP_IMAGE:-}"
KEEP_STACK=0
SKIP_BUILD=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --region) REGION="$2"; shift 2 ;;
    --fixture) FIXTURE="$2"; shift 2 ;;
    --chunk-sizes) CHUNK_SIZES="$2"; shift 2 ;;
    --psnr-threshold) PSNR_THRESHOLD="$2"; shift 2 ;;
    --protocols) PROTOCOLS="$2"; shift 2 ;;
    --owner) OWNER="$2"; shift 2 ;;
    --repo) AR_REPO="$2"; AR_REPO_WAS_EXPLICIT=1; shift 2 ;;
    --image) EXPLICIT_IMAGE="$2"; shift 2 ;;
    --keep-stack) KEEP_STACK=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    -h|--help) sed -n '2,34p' "$0"; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 1 ;;
  esac
done

[ -n "$PROJECT" ] || {
  echo "ERROR: --project (or GCP_PROJECT) is required" >&2
  exit 1
}

for tool in gcloud terraform ffmpeg ffprobe jq tar sha256sum; do
  command -v "$tool" >/dev/null || {
    echo "ERROR: $tool is not available on PATH" >&2
    exit 1
  }
done

PROTOCOLS="${PROTOCOLS//[[:space:]]/}"
case ",$PROTOCOLS," in
  *,v1,*|*,v2,*) ;;
  *) echo "ERROR: --protocols must contain v1 and/or v2" >&2; exit 1 ;;
esac
IFS=',' read -ra PROTOCOL_LIST <<< "$PROTOCOLS"
declare -A SEEN_PROTOCOLS=()
for protocol in "${PROTOCOL_LIST[@]}"; do
  case "$protocol" in
    v1|v2) ;;
    *) echo "ERROR: unsupported protocol '$protocol'; expected v1 or v2" >&2; exit 1 ;;
  esac
  [ -z "${SEEN_PROTOCOLS[$protocol]:-}" ] || {
    echo "ERROR: duplicate protocol '$protocol'" >&2
    exit 1
  }
  SEEN_PROTOCOLS[$protocol]=1
done

if [ -z "$OWNER" ]; then
  OWNER="$(id -un)-$(date -u +%Y%m%dT%H%M%SZ)-$$"
fi
# Include an invocation nonce even when the human-readable owner is reused.
# This prevents a new run from ever inheriting an old run's Terraform state or
# colliding with old resources.
RUN_NONCE="$(date -u +%Y%m%dT%H%M%S)-$$-$RANDOM"
OWNER_HASH="$(printf '%s' "$OWNER:$PROJECT:$REGION:$RUN_NONCE" | sha256sum | cut -c1-10)"
# 19 chars. With the longest "-run"/"-wf" suffix, service-account IDs stay
# comfortably under GCP's 30-character limit.
STACK_NAME="hf-smoke-$OWNER_HASH"
[ "$STACK_NAME" != "hyperframes" ] || {
  echo "ERROR: refusing to use the shared static resource prefix" >&2
  exit 1
}
[ -n "$AR_REPO" ] || AR_REPO="$STACK_NAME"

ARTIFACT_ROOT="$SCRIPT_DIR/gcp-smoke-artifacts"
ARTIFACT_DIR="$ARTIFACT_ROOT/$OWNER_HASH"
RENDER_DIR="$ARTIFACT_DIR/renders"
TF_WORK_DIR="$ARTIFACT_DIR/terraform"
TF_DATA_DIR="$ARTIFACT_DIR/terraform-data"
mkdir -p "$RENDER_DIR" "$TF_WORK_DIR" "$TF_DATA_DIR"
export TF_DATA_DIR

for module_file in "$TF_SOURCE_DIR"/*.tf "$TF_SOURCE_DIR/workflow.yaml"; do
  cp "$module_file" "$TF_WORK_DIR/"
done

FIXTURE_DIR="$REPO_ROOT/packages/producer/tests/distributed/$FIXTURE"
FIXTURE_META="$FIXTURE_DIR/meta.json"
BASELINE_MP4="$FIXTURE_DIR/output/output.mp4"
[ -d "$FIXTURE_DIR/src" ] || {
  echo "ERROR: fixture source missing: $FIXTURE_DIR/src" >&2
  exit 1
}
[ -f "$FIXTURE_META" ] || {
  echo "ERROR: fixture metadata missing: $FIXTURE_META" >&2
  exit 1
}
[ -f "$BASELINE_MP4" ] || {
  echo "ERROR: baseline video missing: $BASELINE_MP4" >&2
  exit 1
}

BUCKET="$STACK_NAME-render-$PROJECT"
SERVICE_NAME="$STACK_NAME-render"
WORKFLOW_NAME="$STACK_NAME-render"
RUN_SA="$STACK_NAME-run@$PROJECT.iam.gserviceaccount.com"
WORKFLOW_SA="$STACK_NAME-wf@$PROJECT.iam.gserviceaccount.com"
IMAGE=""
IMAGE_PACKAGE=""
CREATED_IMAGE=0
CREATED_REPO=0
CREATED_BUILD_BUCKET=0
STACK_APPLIED=0
BUILD_BUCKET="$STACK_NAME-build-$PROJECT"

is_not_found() {
  grep -Eqi 'NOT_FOUND|not found|does not exist|was not found|could not be found|cannot find' "$1"
}

verify_absent() {
  local label="$1"
  shift
  local error_file="$ARTIFACT_DIR/cleanup-${label//[^a-zA-Z0-9]/-}.stderr"
  if "$@" >/dev/null 2>"$error_file"; then
    echo "  ✗ $label still exists" >&2
    return 1
  fi
  if is_not_found "$error_file"; then
    echo "  ✓ $label absent"
    return 0
  fi
  echo "  ✗ could not verify $label absence (API/auth error):" >&2
  sed -n '1,12p' "$error_file" >&2
  return 1
}

verify_service_account_absent() {
  local label="$1"
  local email="$2"
  local error_file="$ARTIFACT_DIR/cleanup-${label//[^a-zA-Z0-9]/-}.stderr"
  local matches
  if ! matches="$(gcloud iam service-accounts list \
      --project "$PROJECT" \
      --filter "email:$email" \
      --format 'value(email)' 2>"$error_file")"; then
    echo "  ✗ could not verify $label absence (API/auth error):" >&2
    sed -n '1,12p' "$error_file" >&2
    return 1
  fi
  if [ -n "$matches" ]; then
    echo "  ✗ $label still exists" >&2
    return 1
  fi
  echo "  ✓ $label absent"
}

delete_owned_image() {
  local error_file="$ARTIFACT_DIR/cleanup-image-delete.stderr"
  [ "$CREATED_IMAGE" -eq 1 ] || return 0
  echo "→ Deleting owner-scoped test image package $IMAGE_PACKAGE"
  if gcloud artifacts docker images delete "$IMAGE_PACKAGE" --delete-tags --quiet \
      --project "$PROJECT" >/dev/null 2>"$error_file"; then
    return 0
  fi
  if is_not_found "$error_file"; then
    return 0
  fi
  sed -n '1,12p' "$error_file" >&2
  return 1
}

cleanup() {
  local original_rc=$?
  local cleanup_rc=0
  trap - EXIT
  set +e

  if [ "$KEEP_STACK" -eq 1 ]; then
    echo "→ --keep-stack set; retaining this invocation's stack, image, and repository."
    echo "  Owner: $OWNER ($OWNER_HASH)"
    echo "  Isolated Terraform state: $TF_WORK_DIR/terraform.tfstate"
    echo "  Destroy with TF_DATA_DIR=$TF_DATA_DIR terraform -chdir=$TF_WORK_DIR apply -auto-approve -var project_id=$PROJECT -var region=$REGION -var project_name=$STACK_NAME -var image=$IMAGE -var bucket_force_destroy=true"
    echo "  Then run the matching terraform destroy command with the same variables."
    exit "$original_rc"
  fi

  if [ "$STACK_APPLIED" -eq 1 ]; then
    echo "→ Destroying owner-scoped Terraform stack $STACK_NAME"
    # Update force_destroy only when this isolated state already owns the
    # bucket. A partial apply that failed before bucket creation must not make
    # cleanup create a new bucket merely to destroy it.
    if terraform -chdir="$TF_WORK_DIR" state show google_storage_bucket.render \
        >/dev/null 2>&1; then
      terraform -chdir="$TF_WORK_DIR" apply -input=false -auto-approve \
        -target=google_storage_bucket.render \
        -var "project_id=$PROJECT" \
        -var "region=$REGION" \
        -var "project_name=$STACK_NAME" \
        -var "image=$IMAGE" \
        -var "bucket_force_destroy=true" >/dev/null
      [ $? -eq 0 ] || cleanup_rc=1
    fi
    terraform -chdir="$TF_WORK_DIR" destroy -input=false -auto-approve \
      -var "project_id=$PROJECT" \
      -var "region=$REGION" \
      -var "project_name=$STACK_NAME" \
      -var "image=$IMAGE" \
      -var "bucket_force_destroy=true"
    [ $? -eq 0 ] || cleanup_rc=1

    verify_absent "cloud-run-service" \
      gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT"
    [ $? -eq 0 ] || cleanup_rc=1
    verify_absent "workflow" \
      gcloud workflows describe "$WORKFLOW_NAME" --location "$REGION" --project "$PROJECT"
    [ $? -eq 0 ] || cleanup_rc=1
    verify_absent "render-bucket" \
      gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT"
    [ $? -eq 0 ] || cleanup_rc=1
    verify_service_account_absent "run-service-account" "$RUN_SA"
    [ $? -eq 0 ] || cleanup_rc=1
    verify_service_account_absent "workflow-service-account" "$WORKFLOW_SA"
    [ $? -eq 0 ] || cleanup_rc=1
  fi

  delete_owned_image
  [ $? -eq 0 ] || cleanup_rc=1
  if [ "$CREATED_IMAGE" -eq 1 ]; then
    verify_absent "artifact-image" \
      gcloud artifacts docker images describe "$IMAGE_PACKAGE" --project "$PROJECT"
    [ $? -eq 0 ] || cleanup_rc=1
  fi

  if [ "$CREATED_BUILD_BUCKET" -eq 1 ]; then
    echo "→ Deleting owner-scoped Cloud Build staging bucket $BUILD_BUCKET"
    gcloud storage rm --recursive "gs://$BUILD_BUCKET" --project "$PROJECT" >/dev/null
    [ $? -eq 0 ] || cleanup_rc=1
    verify_absent "cloud-build-staging-bucket" \
      gcloud storage buckets describe "gs://$BUILD_BUCKET" --project "$PROJECT"
    [ $? -eq 0 ] || cleanup_rc=1
  fi

  if [ "$CREATED_REPO" -eq 1 ]; then
    echo "→ Deleting test-created Artifact Registry repository $AR_REPO"
    gcloud artifacts repositories delete "$AR_REPO" --location "$REGION" \
      --project "$PROJECT" --quiet
    [ $? -eq 0 ] || cleanup_rc=1
    verify_absent "artifact-repository" \
      gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" --project "$PROJECT"
    [ $? -eq 0 ] || cleanup_rc=1
  fi

  if [ "$cleanup_rc" -ne 0 ]; then
    echo "ERROR: cleanup or cleanup verification failed; see $ARTIFACT_DIR/cleanup-*.stderr" >&2
    exit 7
  fi
  exit "$original_rc"
}
trap cleanup EXIT

echo "→ Project: $PROJECT"
echo "  Region: $REGION"
echo "  Owner: $OWNER ($OWNER_HASH)"
echo "  Resource prefix: $STACK_NAME"
echo "  Protocols: $PROTOCOLS"
echo "  Isolated Terraform directory: $TF_WORK_DIR"

echo "→ Verifying required project APIs are already enabled"
for api in \
  run.googleapis.com \
  workflows.googleapis.com \
  workflowexecutions.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  monitoring.googleapis.com; do
  enabled_api="$(gcloud services list \
    --enabled \
    --project "$PROJECT" \
    --filter "config.name=$api" \
    --format 'value(config.name)')" || {
    echo "ERROR: could not verify required API $api" >&2
    exit 1
  }
  [ "$enabled_api" = "$api" ] || {
    echo "ERROR: required API $api is not enabled; refusing to mutate project-shared API state" >&2
    exit 1
  }
done

echo "→ Verifying the unique resource names are unused"
verify_absent "preflight-cloud-run-service" \
  gcloud run services describe "$SERVICE_NAME" --region "$REGION" --project "$PROJECT" || exit 1
verify_absent "preflight-workflow" \
  gcloud workflows describe "$WORKFLOW_NAME" --location "$REGION" --project "$PROJECT" || exit 1
verify_absent "preflight-render-bucket" \
  gcloud storage buckets describe "gs://$BUCKET" --project "$PROJECT" || exit 1
verify_absent "preflight-run-service-account" \
  gcloud iam service-accounts describe "$RUN_SA" --project "$PROJECT" || exit 1
verify_absent "preflight-workflow-service-account" \
  gcloud iam service-accounts describe "$WORKFLOW_SA" --project "$PROJECT" || exit 1
verify_absent "preflight-cloud-build-staging-bucket" \
  gcloud storage buckets describe "gs://$BUILD_BUCKET" --project "$PROJECT" || exit 1

IMAGE_TXT="$ARTIFACT_DIR/image.txt"
if [ -n "$EXPLICIT_IMAGE" ]; then
  IMAGE="$EXPLICIT_IMAGE"
  echo "→ Using caller-owned image $IMAGE"
elif [ "$SKIP_BUILD" -eq 1 ]; then
  echo "ERROR: --skip-build requires --image; new runs never reuse prior owner state" >&2
  exit 1
else
  REPO_ERROR="$ARTIFACT_DIR/repository-describe.stderr"
  if gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" \
      --project "$PROJECT" >/dev/null 2>"$REPO_ERROR"; then
    if [ "$AR_REPO_WAS_EXPLICIT" -eq 0 ]; then
      echo "ERROR: generated repository $AR_REPO already exists; refusing to reuse owner state" >&2
      exit 1
    fi
    echo "→ Reusing caller-selected Artifact Registry repository $AR_REPO"
  elif is_not_found "$REPO_ERROR"; then
    echo "→ Creating owner-scoped Artifact Registry repository $AR_REPO"
    gcloud artifacts repositories create "$AR_REPO" \
      --repository-format docker \
      --location "$REGION" \
      --project "$PROJECT" >/dev/null
    CREATED_REPO=1
  else
    echo "ERROR: repository lookup failed (not a NOT_FOUND response)" >&2
    sed -n '1,12p' "$REPO_ERROR" >&2
    exit 1
  fi

  IMAGE_PACKAGE="$REGION-docker.pkg.dev/$PROJECT/$AR_REPO/$STACK_NAME-render"
  IMAGE="$IMAGE_PACKAGE:$OWNER_HASH"
  verify_absent "preflight-artifact-image" \
    gcloud artifacts docker images describe "$IMAGE_PACKAGE" --project "$PROJECT" || exit 1
  CREATED_IMAGE=1
  BUILD_CONFIG="$ARTIFACT_DIR/cloudbuild.json"
  BUILD_IGNORE_FILE="$ARTIFACT_DIR/gcloudignore"
  cat > "$BUILD_IGNORE_FILE" <<'EOF'
**
!package.json
!bun.lock
!scripts/
!scripts/package-subpaths.mjs
!packages/
!packages/core/
!packages/core/**
!packages/engine/
!packages/engine/**
!packages/producer/
!packages/producer/**
!packages/gcp-cloud-run/
!packages/gcp-cloud-run/**
!packages/lint/
!packages/lint/**
!packages/parsers/
!packages/parsers/**
!packages/sdk/
!packages/sdk/**
!packages/sdk-playground/
!packages/sdk-playground/**
!packages/studio-server/
!packages/studio-server/**
!packages/player/
!packages/player/package.json
!packages/cli/
!packages/cli/package.json
!packages/studio/
!packages/studio/package.json
!packages/shader-transitions/
!packages/shader-transitions/package.json
!packages/aws-lambda/
!packages/aws-lambda/package.json
packages/**/node_modules/**
packages/**/dist/**
packages/**/coverage/**
packages/**/output/**
packages/**/tests/**
packages/**/*.test.ts
packages/**/*.test.tsx
packages/gcp-cloud-run/terraform/**
EOF
  jq -n --arg image "$IMAGE" '{
    steps: [{
      name: "gcr.io/cloud-builders/docker",
      args: ["build", "-f", "packages/gcp-cloud-run/Dockerfile", "-t", $image, "."]
    }],
    images: [$image],
    timeout: "3600s",
    options: {
      machineType: "E2_HIGHCPU_8",
      logging: "CLOUD_LOGGING_ONLY"
    }
  }' > "$BUILD_CONFIG"
  echo "→ Creating owner-scoped Cloud Build staging bucket $BUILD_BUCKET"
  gcloud storage buckets create "gs://$BUILD_BUCKET" \
    --location "$REGION" \
    --uniform-bucket-level-access \
    --project "$PROJECT" >/dev/null
  CREATED_BUILD_BUCKET=1
  echo "→ Building and pushing owner-scoped image $IMAGE via Cloud Build"
  gcloud builds submit "$REPO_ROOT" \
    --project "$PROJECT" \
    --config "$BUILD_CONFIG" \
    --ignore-file "$BUILD_IGNORE_FILE" \
    --gcs-source-staging-dir "gs://$BUILD_BUCKET/source" || {
    echo "ERROR: image build/push failed" >&2
    exit 2
  }
  printf '%s\n' "$IMAGE" > "$IMAGE_TXT"
fi

# Terraform can use ADC or a short-lived token from the active gcloud login.
if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
  echo "→ ADC not configured; using a short-lived gcloud token for Terraform"
  export GOOGLE_OAUTH_ACCESS_TOKEN
  GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)"
  export GOOGLE_PROJECT="$PROJECT"
fi

echo "→ Applying isolated Terraform stack"
terraform -chdir="$TF_WORK_DIR" init -input=false >/dev/null
# Mark the stack cleanup-eligible before apply. Terraform may persist a
# partially-created stack even when apply itself exits nonzero.
STACK_APPLIED=1
terraform -chdir="$TF_WORK_DIR" apply -input=false -auto-approve \
  -var "project_id=$PROJECT" \
  -var "region=$REGION" \
  -var "project_name=$STACK_NAME" \
  -var "image=$IMAGE" || {
  echo "ERROR: terraform apply failed" >&2
  exit 3
}

BUCKET="$(terraform -chdir="$TF_WORK_DIR" output -raw render_bucket_name)"
SERVICE_URL="$(terraform -chdir="$TF_WORK_DIR" output -raw service_url)"
WORKFLOW_NAME="$(terraform -chdir="$TF_WORK_DIR" output -raw workflow_name)"
echo "  bucket=$BUCKET service=$SERVICE_URL workflow=$WORKFLOW_NAME"

SITE_TAR="$ARTIFACT_DIR/project.tar.gz"
tar -czf "$SITE_TAR" -C "$FIXTURE_DIR/src" .
PROJECT_GCS="gs://$BUCKET/sites/smoke/$STACK_NAME/$FIXTURE/project.tar.gz"
gcloud storage cp "$SITE_TAR" "$PROJECT_GCS" --project "$PROJECT" >/dev/null
echo "→ Uploaded fixture to $PROJECT_GCS"

BASE_FPS="$(jq -r '.renderConfig.fps // 30' "$FIXTURE_META")"
META_CHUNK="$(jq -r '.renderConfig.chunkSize // empty' "$FIXTURE_META")"
[ -n "$CHUNK_SIZES" ] || CHUNK_SIZES="${META_CHUNK:-15}"
IFS=',' read -ra SIZES <<< "$CHUNK_SIZES"
for chunk_size in "${SIZES[@]}"; do
  [[ "$chunk_size" =~ ^[1-9][0-9]*$ ]] || {
    echo "ERROR: invalid positive integer chunk size '$chunk_size'" >&2
    exit 1
  }
done

jq -n '[]' > "$ARTIFACT_DIR/results.json"
jq -n '[]' > "$ARTIFACT_DIR/parity.json"
OVERALL_RC=0

for protocol in "${PROTOCOL_LIST[@]}"; do
  for chunk_size in "${SIZES[@]}"; do
    RENDER_ID="$STACK_NAME-$protocol-c$chunk_size"
    OUTPUT_GCS="gs://$BUCKET/renders/smoke/$STACK_NAME/$protocol/c$chunk_size/output.mp4"
    PLAN_PREFIX="gs://$BUCKET/renders/smoke/$STACK_NAME/$protocol/c$chunk_size/plan/"
    ARGUMENTS="$(jq -n \
      --arg service "$SERVICE_URL" \
      --arg project_uri "$PROJECT_GCS" \
      --arg plan_prefix "$PLAN_PREFIX" \
      --arg output_uri "$OUTPUT_GCS" \
      --arg protocol "$protocol" \
      --argjson fps "$BASE_FPS" \
      --argjson chunk_size "$chunk_size" \
      '{
        ServiceUrl: $service,
        ProjectGcsUri: $project_uri,
        PlanOutputGcsPrefix: $plan_prefix,
        OutputGcsUri: $output_uri,
        PlanProtocol: $protocol,
        Config: {fps: $fps, width: 640, height: 360, format: "mp4", chunkSize: $chunk_size}
      }')"

    echo "→ Render protocol=$protocol chunkSize=$chunk_size (renderId=$RENDER_ID)"
    START_MS="$(date +%s%3N)"
    EXECUTION="$(gcloud workflows execute "$WORKFLOW_NAME" \
      --location "$REGION" \
      --project "$PROJECT" \
      --data "$ARGUMENTS" \
      --format='value(name)')"
    STATE="ACTIVE"
    while [ "$STATE" = "ACTIVE" ] || [ "$STATE" = "QUEUED" ]; do
      sleep 5
      STATE="$(gcloud workflows executions describe "$EXECUTION" \
        --location "$REGION" \
        --project "$PROJECT" \
        --format='value(state)')"
    done
    END_MS="$(date +%s%3N)"
    WALL_MS=$((END_MS - START_MS))

    EXECUTION_JSON="$RENDER_DIR/$protocol-c$chunk_size-execution.json"
    gcloud workflows executions describe "$EXECUTION" \
      --location "$REGION" \
      --project "$PROJECT" \
      --format=json > "$EXECUTION_JSON"

    if [ "$STATE" != "SUCCEEDED" ]; then
      echo "  ✗ execution state=$STATE"
      jq -r '.error.payload // empty' "$EXECUTION_JSON" | head -c 800
      [ "$OVERALL_RC" -ne 0 ] || OVERALL_RC=4
      continue
    fi

    OUTPUT_LOCAL="$RENDER_DIR/$protocol-c$chunk_size-output.mp4"
    gcloud storage cp "$OUTPUT_GCS" "$OUTPUT_LOCAL" --project "$PROJECT" >/dev/null

    PSNR_LOG="$RENDER_DIR/$protocol-c$chunk_size-psnr.log"
    ffmpeg -y -i "$OUTPUT_LOCAL" -i "$BASELINE_MP4" \
      -lavfi "psnr=stats_file=$PSNR_LOG" -f null - 2>/dev/null || true
    PSNR_AVG="$(awk -F'psnr_avg:' \
      '/psnr_avg:/{split($2,a," "); s+=a[1]; n++} END{if(n>0) printf "%.2f", s/n; else print "0"}' \
      "$PSNR_LOG" 2>/dev/null || echo "0")"
    ENCODED_SHA="$(sha256sum "$OUTPUT_LOCAL" | cut -d' ' -f1)"
    ENCODED_BYTES="$(wc -c < "$OUTPUT_LOCAL" | tr -d ' ')"

    echo "  ✓ state=SUCCEEDED wall=${WALL_MS}ms psnr_avg=${PSNR_AVG}dB"
    jq \
      --arg protocol "$protocol" \
      --argjson chunk_size "$chunk_size" \
      --argjson wall_ms "$WALL_MS" \
      --arg psnr "$PSNR_AVG" \
      --arg encoded_sha "$ENCODED_SHA" \
      --argjson encoded_bytes "$ENCODED_BYTES" \
      '. += [{
        planProtocol: $protocol,
        chunkSize: $chunk_size,
        wallClockMs: $wall_ms,
        psnrAvgDb: ($psnr | tonumber),
        encodedSha256: $encoded_sha,
        encodedBytes: $encoded_bytes
      }]' \
      "$ARTIFACT_DIR/results.json" > "$ARTIFACT_DIR/results.json.tmp"
    mv "$ARTIFACT_DIR/results.json.tmp" "$ARTIFACT_DIR/results.json"

    if awk "BEGIN{exit !($PSNR_AVG < $PSNR_THRESHOLD)}"; then
      echo "  ✗ PSNR ${PSNR_AVG}dB below threshold ${PSNR_THRESHOLD}dB"
      [ "$OVERALL_RC" -ne 0 ] || OVERALL_RC=5
    fi
  done
done

canonicalize_output() {
  local media_file="$1"
  local output_prefix="$2"
  ffmpeg -v error -i "$media_file" -map 0:v:0 -pix_fmt rgba \
    -f framemd5 "$output_prefix.frames.md5"
  grep -v '^#' "$output_prefix.frames.md5" > "$output_prefix.frames.data"

  if ffprobe -v error -select_streams a:0 -show_entries stream=index \
      -of csv=p=0 "$media_file" | grep -q .; then
    ffmpeg -v error -i "$media_file" -map 0:a:0 -vn -ac 2 -ar 48000 \
      -f hash -hash sha256 - > "$output_prefix.audio.sha256"
  else
    printf '%s\n' "NO_AUDIO" > "$output_prefix.audio.sha256"
  fi

  ffprobe -v error \
    -show_entries \
      format=duration:stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,r_frame_rate,nb_frames,sample_rate,channels,channel_layout \
    -of json "$media_file" | jq -S . > "$output_prefix.probe.json"
}

if [ -n "${SEEN_PROTOCOLS[v1]:-}" ] && [ -n "${SEEN_PROTOCOLS[v2]:-}" ]; then
  echo "→ Comparing v1 and v2 decoded outputs"
  for chunk_size in "${SIZES[@]}"; do
    V1_OUTPUT="$RENDER_DIR/v1-c$chunk_size-output.mp4"
    V2_OUTPUT="$RENDER_DIR/v2-c$chunk_size-output.mp4"
    if [ ! -f "$V1_OUTPUT" ] || [ ! -f "$V2_OUTPUT" ]; then
      echo "  ✗ c$chunk_size parity unavailable because one protocol did not render"
      [ "$OVERALL_RC" -ne 0 ] || OVERALL_RC=6
      continue
    fi

    V1_PREFIX="$RENDER_DIR/v1-c$chunk_size-canonical"
    V2_PREFIX="$RENDER_DIR/v2-c$chunk_size-canonical"
    canonicalize_output "$V1_OUTPUT" "$V1_PREFIX"
    canonicalize_output "$V2_OUTPUT" "$V2_PREFIX"

    FRAMES_EQUAL=false
    AUDIO_EQUAL=false
    METADATA_EQUAL=false
    cmp -s "$V1_PREFIX.frames.data" "$V2_PREFIX.frames.data" && FRAMES_EQUAL=true
    cmp -s "$V1_PREFIX.audio.sha256" "$V2_PREFIX.audio.sha256" && AUDIO_EQUAL=true
    cmp -s "$V1_PREFIX.probe.json" "$V2_PREFIX.probe.json" && METADATA_EQUAL=true

    jq \
      --argjson chunk_size "$chunk_size" \
      --argjson frames_equal "$FRAMES_EQUAL" \
      --argjson audio_equal "$AUDIO_EQUAL" \
      --argjson metadata_equal "$METADATA_EQUAL" \
      --arg v1_frame_sha "$(sha256sum "$V1_PREFIX.frames.data" | cut -d' ' -f1)" \
      --arg v2_frame_sha "$(sha256sum "$V2_PREFIX.frames.data" | cut -d' ' -f1)" \
      --arg v1_audio_sha "$(sed -n '1p' "$V1_PREFIX.audio.sha256")" \
      --arg v2_audio_sha "$(sed -n '1p' "$V2_PREFIX.audio.sha256")" \
      '. += [{
        chunkSize: $chunk_size,
        decodedFramesEqual: $frames_equal,
        decodedAudioEqual: $audio_equal,
        normalizedMetadataEqual: $metadata_equal,
        v1FrameManifestSha256: $v1_frame_sha,
        v2FrameManifestSha256: $v2_frame_sha,
        v1AudioSha256: $v1_audio_sha,
        v2AudioSha256: $v2_audio_sha
      }]' \
      "$ARTIFACT_DIR/parity.json" > "$ARTIFACT_DIR/parity.json.tmp"
    mv "$ARTIFACT_DIR/parity.json.tmp" "$ARTIFACT_DIR/parity.json"

    if [ "$FRAMES_EQUAL" = true ] && [ "$AUDIO_EQUAL" = true ] && [ "$METADATA_EQUAL" = true ]; then
      echo "  ✓ c$chunk_size decoded video, audio, and metadata match"
    else
      echo "  ✗ c$chunk_size parity mismatch: frames=$FRAMES_EQUAL audio=$AUDIO_EQUAL metadata=$METADATA_EQUAL"
      [ "$OVERALL_RC" -ne 0 ] || OVERALL_RC=6
    fi
  done
fi

echo "→ Results"
jq . "$ARTIFACT_DIR/results.json"
if [ -n "${SEEN_PROTOCOLS[v1]:-}" ] && [ -n "${SEEN_PROTOCOLS[v2]:-}" ]; then
  echo "→ Parity"
  jq . "$ARTIFACT_DIR/parity.json"
fi
echo "→ Evidence: $ARTIFACT_DIR"
exit "$OVERALL_RC"
