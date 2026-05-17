# K8s / Cloud Run / ECS reference Dockerfile

This directory ships a reference `Dockerfile.example` for adopters who want to run HyperFrames distributed renders **outside AWS Lambda**. The image bakes Node 22 + `chrome-headless-shell` + `ffmpeg` + the producer source, and works on Kubernetes Jobs, Argo Workflows, Cloud Run Jobs, ECS Fargate, or plain `docker run`.

We do **not** publish this image to a registry — the OSS contract is that adopters build it themselves so Chrome / ffmpeg / producer versions stay pinned to the source checkout they audited, not a floating tag we'd have to keep in sync with every release.

## Build

From the repo root:

```bash
docker build -t hyperframes-chunk-runner:local -f examples/k8s-jobs/Dockerfile.example .
```

The build pulls `chrome-headless-shell` via `@puppeteer/browsers` and installs Debian system packages for the Chromium ABI deps. Expect a ~1.2 GB compressed image; ~3 GB unpacked.

## Use

The producer's distributed primitives are pure functions over local paths. Wire them into your orchestrator however you like:

```ts
import { plan, renderChunk, assemble } from "@hyperframes/producer/distributed";

// Controller-side: produce a self-contained planDir + content-addressed planHash.
const planResult = await plan(projectDir, config, planDir);

// Worker-side: render one chunk (byte-identical on retry for the same input).
const chunk = await renderChunk(planDir, chunkIndex, outputChunkPath);

// Controller-side: stitch chunks into the final deliverable.
await assemble(planDir, chunkPaths, audioPath, outputPath);
```

A typical Kubernetes Jobs orchestration:

1. **Controller** runs a one-shot Job that mounts the project directory + calls `plan()`. Uploads the resulting `planDir/` to your shared storage (S3, GCS, PVC, …).
2. **Per-chunk** Jobs (one per chunk index) download the planDir, call `renderChunk(planDir, i, output)`, upload the output. Argo Workflows' `withSequence` is a natural fit.
3. **Assembler** Job downloads the planDir + every chunk output, calls `assemble(...)`, uploads the final mp4 / mov.

The AWS Lambda implementation in `packages/aws-lambda/src/handler.ts` is one concrete adapter — read it as a reference for the per-activity event shape.

## Lambda?

If you want AWS Lambda specifically, use `hyperframes lambda deploy` instead — it ships a turnkey deployment. See [docs/deploy/aws-lambda.mdx](../../docs/deploy/aws-lambda.mdx).
