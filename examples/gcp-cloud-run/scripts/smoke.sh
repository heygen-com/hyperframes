#!/usr/bin/env bash
# Real-GCP smoke + benchmark for the HyperFrames Cloud Run adapter.
#
# Run from a workstation with `gcloud` credentials. Builds the render
# container, pushes it to Artifact Registry, applies the Terraform module at
# packages/gcp-cloud-run/terraform to your project, renders a fixture
# composition through the Cloud Workflows definition, PSNR-compares the
# output against the in-process baseline, and tears the stack down.
#
# Usage:
#   ./smoke.sh --project <gcp-project>
#   ./smoke.sh --project p --fixture mp4-h264-sdr --chunk-sizes 15,30
#   ./smoke.sh --project p --keep-stack
#
# Required tools on PATH:
#   - gcloud (authenticated; the target project must have billing enabled)
#   - terraform (>= 1.5)
#   - docker
#   - ffmpeg (PSNR computation)
#   - jq
#
# Inputs (flags or env vars):
#   --project <id>            (required; or $GCP_PROJECT)
#   --region <region>         (default: us-central1)
#   --fixture <name>          (default: mp4-h264-sdr — under packages/producer/tests/distributed/)
#   --chunk-sizes <list>      (default: from the fixture meta; CSV of chunkSize overrides)
#   --psnr-threshold <db>     (default: 35)
#   --repo <ar-repo>          (Artifact Registry repo name, default: hyperframes)
#   --keep-stack              (skip `terraform destroy` at the end)
#   --skip-build              (reuse the last-pushed image tag in ./gcp-smoke-artifacts/image.txt)
#
# Outputs:
#   ./gcp-smoke-artifacts/results.json          (chunkSize x wallClockMs x psnrAvgDb)
#   ./gcp-smoke-artifacts/renders/c<N>-output.mp4
#   ./gcp-smoke-artifacts/renders/c<N>-execution.json
#
# Exit codes:
#   0 all good   1 arg/pre-flight   2 build/push   3 terraform apply
#   4 a render failed   5 PSNR below threshold

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
TF_DIR="$REPO_ROOT/packages/gcp-cloud-run/terraform"

# ── Defaults ──────────────────────────────────────────────────────────────
PROJECT="${GCP_PROJECT:-}"
REGION="${GCP_REGION:-us-central1}"
FIXTURE="${FIXTURE:-mp4-h264-sdr}"
CHUNK_SIZES="${CHUNK_SIZES:-}"
PSNR_THRESHOLD="${PSNR_THRESHOLD:-35}"
AR_REPO="${AR_REPO:-hyperframes}"
KEEP_STACK=0
SKIP_BUILD=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project)         PROJECT="$2"; shift 2 ;;
    --region)          REGION="$2"; shift 2 ;;
    --fixture)         FIXTURE="$2"; shift 2 ;;
    --chunk-sizes)     CHUNK_SIZES="$2"; shift 2 ;;
    --psnr-threshold)  PSNR_THRESHOLD="$2"; shift 2 ;;
    --repo)            AR_REPO="$2"; shift 2 ;;
    --keep-stack)      KEEP_STACK=1; shift ;;
    --skip-build)      SKIP_BUILD=1; shift ;;
    -h|--help)         sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "Unknown arg: $1" >&2; exit 1 ;;
  esac
done

[ -n "$PROJECT" ] || { echo "ERROR: --project (or \$GCP_PROJECT) is required" >&2; exit 1; }
for tool in gcloud terraform docker ffmpeg jq; do
  command -v "$tool" >/dev/null || { echo "ERROR: $tool not on PATH" >&2; exit 1; }
done

FIXTURE_DIR="$REPO_ROOT/packages/producer/tests/distributed/$FIXTURE"
FIXTURE_META="$FIXTURE_DIR/meta.json"
BASELINE_MP4="$FIXTURE_DIR/output/output.mp4"
[ -d "$FIXTURE_DIR/src" ] || { echo "ERROR: fixture src missing: $FIXTURE_DIR/src" >&2; exit 1; }
[ -f "$BASELINE_MP4" ]   || { echo "ERROR: baseline mp4 missing: $BASELINE_MP4" >&2; exit 1; }

ARTIFACT_DIR="$SCRIPT_DIR/gcp-smoke-artifacts"
mkdir -p "$ARTIFACT_DIR/renders"

echo "→ Project: $PROJECT  Region: $REGION  Fixture: $FIXTURE"

# ── 1. Enable APIs ──────────────────────────────────────────────────────────
echo "→ Enabling required APIs (idempotent)"
gcloud services enable \
  run.googleapis.com workflows.googleapis.com workflowexecutions.googleapis.com \
  artifactregistry.googleapis.com cloudbuild.googleapis.com monitoring.googleapis.com \
  --project "$PROJECT" >/dev/null

# ── 2. Build + push the render image ────────────────────────────────────────
IMAGE_TXT="$ARTIFACT_DIR/image.txt"
if [ "$SKIP_BUILD" -eq 1 ] && [ -f "$IMAGE_TXT" ]; then
  IMAGE="$(cat "$IMAGE_TXT")"
  echo "→ Reusing image $IMAGE"
else
  gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" --project "$PROJECT" >/dev/null 2>&1 || \
    gcloud artifacts repositories create "$AR_REPO" --repository-format docker \
      --location "$REGION" --project "$PROJECT" >/dev/null
  TAG="$(date +%Y%m%d-%H%M%S)"
  IMAGE="$REGION-docker.pkg.dev/$PROJECT/$AR_REPO/hyperframes-render:$TAG"
  echo "→ Building + pushing $IMAGE via Cloud Build"
  # The Dockerfile lives at packages/gcp-cloud-run/Dockerfile, not the repo
  # root, so we drive the build with an inline cloudbuild config rather than
  # `--tag` (which assumes a root Dockerfile).
  CB_CONFIG="$ARTIFACT_DIR/cloudbuild.yaml"
  cat > "$CB_CONFIG" <<EOF
steps:
- name: gcr.io/cloud-builders/docker
  args: ["build","-f","packages/gcp-cloud-run/Dockerfile","-t","$IMAGE","."]
images: ["$IMAGE"]
timeout: 3600s
options:
  machineType: E2_HIGHCPU_8
EOF
  gcloud builds submit "$REPO_ROOT" --project "$PROJECT" --config "$CB_CONFIG" \
    || { echo "ERROR: image build/push failed" >&2; exit 2; }
  echo "$IMAGE" > "$IMAGE_TXT"
fi

# ── 3. terraform apply ──────────────────────────────────────────────────────
# The google provider authenticates via Application Default Credentials. If
# ADC isn't configured (common on a box set up with only `gcloud auth login`),
# fall back to a short-lived access token from the active gcloud account.
if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
  echo "→ ADC not configured; using a gcloud access token for Terraform"
  export GOOGLE_OAUTH_ACCESS_TOKEN="$(gcloud auth print-access-token)"
  export GOOGLE_PROJECT="$PROJECT"
fi
echo "→ terraform apply"
terraform -chdir="$TF_DIR" init -input=false >/dev/null
terraform -chdir="$TF_DIR" apply -input=false -auto-approve \
  -var "project_id=$PROJECT" -var "region=$REGION" -var "image=$IMAGE" \
  || { echo "ERROR: terraform apply failed" >&2; exit 3; }

BUCKET="$(terraform -chdir="$TF_DIR" output -raw render_bucket_name)"
SERVICE_URL="$(terraform -chdir="$TF_DIR" output -raw service_url)"
WORKFLOW="$(terraform -chdir="$TF_DIR" output -raw workflow_name)"
echo "  bucket=$BUCKET service=$SERVICE_URL workflow=$WORKFLOW"

cleanup() {
  if [ "$KEEP_STACK" -eq 0 ]; then
    echo "→ terraform destroy"
    # Apply force_destroy=true into state FIRST. Terraform reads the bucket's
    # force_destroy from prior state during the destroy step, so a destroy
    # alone can't flip it; a quick apply updates the attribute, then destroy
    # can empty + remove the (scratch) bucket.
    terraform -chdir="$TF_DIR" apply -input=false -auto-approve \
      -var "project_id=$PROJECT" -var "region=$REGION" -var "image=$IMAGE" \
      -var "bucket_force_destroy=true" >/dev/null 2>&1 || true
    terraform -chdir="$TF_DIR" destroy -input=false -auto-approve \
      -var "project_id=$PROJECT" -var "region=$REGION" -var "image=$IMAGE" \
      -var "bucket_force_destroy=true" || true
  else
    echo "→ --keep-stack set; leaving the stack up. Destroy with:"
    echo "  terraform -chdir=$TF_DIR destroy -var project_id=$PROJECT -var region=$REGION -var image=$IMAGE -var bucket_force_destroy=true"
  fi
}
trap cleanup EXIT

# ── 4. Upload the fixture as a project tarball ──────────────────────────────
SITE_TAR="$ARTIFACT_DIR/project.tar.gz"
tar -czf "$SITE_TAR" -C "$FIXTURE_DIR/src" .
PROJECT_GCS="gs://$BUCKET/sites/$FIXTURE/project.tar.gz"
gcloud storage cp "$SITE_TAR" "$PROJECT_GCS" --project "$PROJECT" >/dev/null
echo "→ Uploaded fixture to $PROJECT_GCS"

BASE_FPS=$(jq -r '.renderConfig.fps // 30' "$FIXTURE_META")
META_CHUNK=$(jq -r '.renderConfig.chunkSize // empty' "$FIXTURE_META")
[ -n "$CHUNK_SIZES" ] || CHUNK_SIZES="${META_CHUNK:-15}"

echo "[]" > "$ARTIFACT_DIR/results.json"
OVERALL_RC=0

IFS=',' read -ra SIZES <<< "$CHUNK_SIZES"
for CS in "${SIZES[@]}"; do
  RENDER_ID="hf-smoke-c${CS}-$(date +%s)"
  OUT_GCS="gs://$BUCKET/renders/$RENDER_ID/output.mp4"
  ARG=$(jq -n \
    --arg svc "$SERVICE_URL" \
    --arg proj "$PROJECT_GCS" \
    --arg prefix "gs://$BUCKET/renders/$RENDER_ID/" \
    --arg out "$OUT_GCS" \
    --argjson fps "$BASE_FPS" \
    --argjson cs "$CS" \
    '{ServiceUrl:$svc, ProjectGcsUri:$proj, PlanOutputGcsPrefix:$prefix, OutputGcsUri:$out,
      Config:{fps:$fps, width:640, height:360, format:"mp4", chunkSize:$cs}}')

  echo "→ Render chunkSize=$CS (renderId=$RENDER_ID)"
  START_MS=$(date +%s%3N)
  EXEC=$(gcloud workflows execute "$WORKFLOW" --location "$REGION" --project "$PROJECT" \
           --data "$ARG" --format='value(name)')
  # Poll until terminal.
  STATE="ACTIVE"
  while [ "$STATE" = "ACTIVE" ] || [ "$STATE" = "QUEUED" ]; do
    sleep 5
    STATE=$(gcloud workflows executions describe "$EXEC" --location "$REGION" \
              --project "$PROJECT" --format='value(state)')
  done
  END_MS=$(date +%s%3N)
  WALL=$((END_MS - START_MS))

  gcloud workflows executions describe "$EXEC" --location "$REGION" --project "$PROJECT" \
    --format=json > "$ARTIFACT_DIR/renders/c$CS-execution.json"

  if [ "$STATE" != "SUCCEEDED" ]; then
    echo "  ✗ execution state=$STATE"
    jq -r '.error.payload // empty' "$ARTIFACT_DIR/renders/c$CS-execution.json" | head -c 800
    OVERALL_RC=4
    continue
  fi

  OUT_LOCAL="$ARTIFACT_DIR/renders/c$CS-output.mp4"
  gcloud storage cp "$OUT_GCS" "$OUT_LOCAL" --project "$PROJECT" >/dev/null

  # PSNR vs the in-process baseline.
  PSNR_LOG="$ARTIFACT_DIR/renders/c$CS-psnr.log"
  ffmpeg -y -i "$OUT_LOCAL" -i "$BASELINE_MP4" \
    -lavfi "psnr=stats_file=$PSNR_LOG" -f null - 2>/dev/null || true
  PSNR_AVG=$(awk -F'psnr_avg:' '/psnr_avg:/{split($2,a," "); s+=a[1]; n++} END{if(n>0) printf "%.2f", s/n; else print "0"}' "$PSNR_LOG" 2>/dev/null || echo "0")

  echo "  ✓ state=SUCCEEDED wall=${WALL}ms psnr_avg=${PSNR_AVG}dB"
  jq --argjson cs "$CS" --argjson wall "$WALL" --arg psnr "$PSNR_AVG" \
    '. += [{chunkSize:$cs, wallClockMs:$wall, psnrAvgDb:($psnr|tonumber)}]' \
    "$ARTIFACT_DIR/results.json" > "$ARTIFACT_DIR/results.json.tmp" && \
    mv "$ARTIFACT_DIR/results.json.tmp" "$ARTIFACT_DIR/results.json"

  if awk "BEGIN{exit !($PSNR_AVG < $PSNR_THRESHOLD)}"; then
    echo "  ✗ PSNR ${PSNR_AVG}dB below threshold ${PSNR_THRESHOLD}dB"
    OVERALL_RC=5
  fi
done

echo "→ Results:"; cat "$ARTIFACT_DIR/results.json" | jq .
exit $OVERALL_RC
