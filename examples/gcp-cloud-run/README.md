# Google Cloud Run example

End-to-end deployment and parity testing for
[`@hyperframes/gcp-cloud-run`](../../packages/gcp-cloud-run), the Cloud Run +
Cloud Workflows adapter for HyperFrames distributed rendering.

## Layout

```text
scripts/smoke.sh        Owner-isolated real-GCP deploy, render, parity, cleanup
sample-events/          v1 and v2 handler request examples
```

The Terraform module and Cloud Workflows definition live in
`packages/gcp-cloud-run/terraform/`.

## Protocol rollout

The workflow defaults to plan protocol v1 when `PlanProtocol` is absent. V2 is
accepted only when the caller explicitly sends `PlanProtocol: "v2"`.

V1 and v2 use disjoint plan locators:

- v1: `PlanGcsUri`
- v2: `PlanV2ManifestGcsUri` and `PlanV2ArtifactGcsPrefix`

The workflow validates that the plan response matches the selected protocol
before starting chunk fan-out. It never silently falls back from v2 to v1.
Deploy the v2 workflow only with a Cloud Run image whose handler implements
the matching v2 request/response contract. An older v1-only handler will keep
serving default v1 requests, but explicit v2 smoke executions will fail closed.

## Prerequisites

- `gcloud` authenticated to a project with billing enabled
- `terraform` (>= 1.5), `ffmpeg`, `ffprobe`, `jq`, `tar`, and `sha256sum`
- the required project APIs already enabled, plus permission to run Cloud
  Build and manage Cloud Run, Workflows, GCS, IAM service accounts,
  Monitoring, and Artifact Registry resources

## Run the smoke

V1 remains the safe default:

```bash
./scripts/smoke.sh \
  --project YOUR_GCP_PROJECT \
  --region us-central1
```

Explicitly run v1/v2 end-to-end parity at one or more chunk sizes:

```bash
./scripts/smoke.sh \
  --project YOUR_GCP_PROJECT \
  --region us-central1 \
  --protocols v1,v2 \
  --chunk-sizes 30,15,10 \
  --owner plan-v2-parity
```

For each chunk size, parity requires exact equality of:

- decoded RGBA video frames
- decoded 48 kHz stereo PCM audio
- normalized `ffprobe` stream and duration metadata

The encoded MP4 hash and byte count are recorded but are not the equality
oracle because mux metadata can differ without changing decoded output.
Each render is also PSNR-compared with the checked-in in-process fixture
baseline.

## Isolation and cleanup

Every invocation hashes the owner, project, region, and a fresh invocation
nonce into a unique resource prefix such as `hf-smoke-a1b2c3d4e5`. Reusing an
owner label does not reuse old Terraform state or cloud resources. This prefix
stays within GCP service account naming limits. The smoke:

- never uses the static `hyperframes` prefix
- copies the Terraform module into an owner-scoped work directory and uses an
  isolated Terraform data directory and state file
- scopes GCS keys, render outputs, the image package/tag, and the default
  Artifact Registry repository to that owner
- deletes only an image it built
- deletes the Artifact Registry repository only when that invocation created it
- refuses to enable project APIs, because APIs are shared project state
- stages the bounded Cloud Build source archive in an owner-scoped bucket,
  writes build logs to Cloud Logging, and deletes the staging bucket

Cleanup is on by default. It empties and destroys the owner-scoped bucket and
stack, deletes owned image/repository/build-staging resources, then verifies
the Cloud Run service, workflow, buckets, both service accounts, image, and any
test-created repository are absent. Cleanup fails on API or authentication
errors rather than interpreting them as successful deletion. GCP retains the
Cloud Build execution record and Cloud Logging audit entries as project-level
operational history; the smoke test does not attempt to erase audit records.

`--keep-stack` deliberately retains the stack, image, and repository and
prints the exact isolated state directory and Terraform cleanup commands.
Never use it for unattended CI.

Evidence lands under:

```text
scripts/gcp-smoke-artifacts/<owner-hash>/
  results.json
  parity.json
  renders/
  terraform/
  terraform-data/
```

Use `--image` to test a caller-owned existing image. That image is never
deleted. `--skip-build` requires `--image`; new invocations never inherit an
old invocation's state or image implicitly.

## Test the handler locally

The sample events mirror the request bodies sent by Cloud Workflows:

```bash
# V1
curl -sX POST localhost:8080/ \
  -H 'content-type: application/json' \
  --data @sample-events/plan.json | jq .

# Explicit v2
curl -sX POST localhost:8080/ \
  -H 'content-type: application/json' \
  --data @sample-events/plan-v2.json | jq .
```

Replace `PROJECT`, locator placeholders, and plan hashes with values returned
by the preceding plan action. A complete action sequence is
`plan → renderChunk(s) → assemble`.
