# Google Cloud Run example

End-to-end deployment + smoke for [`@hyperframes/gcp-cloud-run`](../../packages/gcp-cloud-run) — the Cloud Run + Cloud Workflows adapter for HyperFrames distributed rendering.

## Layout

```
scripts/smoke.sh        Real-GCP smoke: build → deploy → render → PSNR → destroy
sample-events/          Example request bodies for the Cloud Run handler
                        (plan.json, render-chunk.json, assemble.json)
```

The Terraform module and the Cloud Workflows definition that the smoke deploys live with the package, at `packages/gcp-cloud-run/terraform/` (including `workflow.yaml`).

## Prerequisites

- `gcloud` authenticated, with a project that has **billing enabled**
- `terraform` (≥ 1.5), `docker`, `ffmpeg`, `jq` on PATH

## Run the smoke

```bash
# Renders the mp4-h264-sdr fixture through the workflow and PSNR-compares it
# against the in-process baseline, then tears the stack down.
./scripts/smoke.sh --project YOUR_GCP_PROJECT --region us-central1

# Keep the stack up to poke at it:
./scripts/smoke.sh --project YOUR_GCP_PROJECT --keep-stack

# Render at several chunk sizes to see the fan-out scaling:
./scripts/smoke.sh --project YOUR_GCP_PROJECT --chunk-sizes 30,15,10
```

Outputs land in `scripts/gcp-smoke-artifacts/`: `results.json`
(`chunkSize × wallClockMs × psnrAvgDb`), the rendered MP4s, and each
workflow execution's describe output.

## Test the handler locally

The sample events exercise the same body shape Cloud Workflows sends. With the
container running locally (`PORT=8080`) and credentials that can reach a GCS
bucket, you can drive a single action:

```bash
curl -sX POST localhost:8080/ \
  -H 'content-type: application/json' \
  --data @sample-events/plan.json | jq .
```

Replace the `PROJECT` placeholder bucket names and `REPLACE_WITH_PLAN_HASH`
with real values from a prior `plan` response.
