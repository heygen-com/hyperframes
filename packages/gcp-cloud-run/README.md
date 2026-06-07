# @hyperframes/gcp-cloud-run

Google Cloud Run + Cloud Workflows adapter for HyperFrames distributed
rendering. The OSS render primitives (`plan` → `renderChunk` × N →
`assemble`) are pure functions over local file paths; this package is the
deployment, orchestration, and storage glue that runs them on Google Cloud —
the GCP counterpart to [`@hyperframes/aws-lambda`](../aws-lambda).

Two surfaces, one package:

- **Server-side handler** (`./server`) — a Cloud Run HTTP service that
  dispatches `plan` / `renderChunk` / `assemble` on the request body's
  `Action` field, bridging GCS ↔ the container's filesystem around each OSS
  primitive. This is what the bundled `Dockerfile` runs.
- **Client-side SDK** (`./sdk`) — `renderToCloudRun`, `getRenderProgress`,
  `deploySite`, `validateDistributedRenderConfig`, and `computeRenderCost`.
  Call these from a Node process (CI, CLI, app backend) to drive a deployed
  stack without writing GCS / Workflows boilerplate.

The package is **not** a dependency of `@hyperframes/producer`; install it
separately.

## Architecture

```
GCS bucket  ←→  Cloud Run service (plan / renderChunk / assemble)
                     ▲
                     │ OIDC-authenticated http.post, one per step
                     │
                Cloud Workflows  (Plan → parallel RenderChunk → Assemble)
```

- **Plan** downloads the project tarball, runs `plan()`, uploads the planDir
  tarball (+ audio) to GCS, and returns the chunk count.
- **RenderChunk** runs in a parallel `for` loop in the workflow, fanned out
  up to the plan's chunk count. Each invocation renders one chunk and uploads
  it.
- **Assemble** downloads every chunk + audio, stitches the final
  deliverable, and uploads it.

Every step is a `POST` to the same Cloud Run URL with a different `Action`.
The workflow accumulates each step's small result body and returns
`{ Plan, Chunks, Assemble }` so `getRenderProgress` can read frame totals and
per-step durations on success.

## Chrome runtime

Unlike the Lambda adapter — which fights a 250 MB ZIP ceiling and
decompresses `@sparticuz/chromium` into `/tmp` at runtime — Cloud Run runs a
container image. The `Dockerfile` installs the same pinned
`chrome-headless-shell` build and font set the production renderer uses, at a
fixed path, and exports `HYPERFRAMES_CHROME_PATH`. CDP-level `BeginFrame`
works because the command lives in the protocol, not the binary. There is no
runtime decompression step and no packaging ceiling.

## Deploying

The `terraform/` module provisions everything: the GCS render bucket, the
Cloud Run service, the Cloud Workflows definition, two least-privilege
service accounts (the service reads/writes the bucket; the workflow invokes
the service), and a runaway-request alert.

```bash
# 1. Build + push the image (Cloud Build or local docker).
gcloud builds submit . \
  --tag REGION-docker.pkg.dev/PROJECT/REPO/hyperframes-render:TAG

# 2. Apply the module.
terraform -chdir=node_modules/@hyperframes/gcp-cloud-run/terraform init
terraform -chdir=node_modules/@hyperframes/gcp-cloud-run/terraform apply \
  -var project_id=PROJECT \
  -var region=us-central1 \
  -var image=REGION-docker.pkg.dev/PROJECT/REPO/hyperframes-render:TAG
```

Terraform outputs `render_bucket_name`, `service_url`, `workflow_name`, and
`region` — pass them straight into the SDK.

## Using the SDK

```ts
import { renderToCloudRun, getRenderProgress } from "@hyperframes/gcp-cloud-run/sdk";

const handle = await renderToCloudRun({
  projectDir: "./my-composition",
  config: { fps: 30, width: 1920, height: 1080, format: "mp4" },
  bucketName: "hyperframes-render-my-project", // from terraform output
  projectId: "my-project",
  location: "us-central1",
  workflowId: "hyperframes-render",
  serviceUrl: "https://hyperframes-render-abc.us-central1.run.app",
});

// Poll until done.
let progress = await getRenderProgress({ executionName: handle.executionName });
while (progress.status === "running") {
  await new Promise((r) => setTimeout(r, 5000));
  progress = await getRenderProgress({ executionName: handle.executionName });
}
console.log(progress.status, progress.outputFile, progress.costs.displayCost);
```

`deploySite` is called implicitly when you pass `projectDir`; call it
yourself to pre-upload once and reuse the `siteHandle` across many renders
(e.g. personalised template batches).

## Running tests

```bash
bun test          # unit tests over an in-memory GCS double — no network
bun run typecheck
```

The live end-to-end smoke (build image → terraform apply → render a fixture
through the workflow → PSNR-compare → destroy) lives at
`examples/gcp-cloud-run/scripts/smoke.sh` and needs a GCP project with
billing enabled.

## What's still ahead

- **Mid-flight per-chunk progress.** `getRenderProgress` reports coarse
  `running` progress and exact numbers on success. Reading the Cloud
  Workflows step-entries API would give per-chunk progress while the render
  is in flight; tracked as a follow-up.
- **Cloud Run Jobs / Firebase Functions variants.** This first version
  targets Cloud Run services + Workflows (the closest analog to Lambda +
  Step Functions). The same handler runs unchanged under Cloud Run Jobs;
  only the orchestration trigger differs.
