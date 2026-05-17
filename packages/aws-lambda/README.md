# @hyperframes/aws-lambda

AWS Lambda adapter for HyperFrames distributed rendering. Ships three
things together:

1. The **Lambda handler** that wraps the OSS `plan` / `renderChunk` /
   `assemble` primitives behind a single dispatch boundary Step Functions
   can drive (`src/handler.ts`).
2. A **client-side SDK** — `renderToLambda`, `getRenderProgress`,
   `deploySite`, plus `validateDistributedRenderConfig` and
   `computeRenderCost` (`src/sdk/`).
3. An **`aws-cdk-lib` L2 construct** (`HyperframesRenderStack`) that
   provisions the same topology as `examples/aws-lambda/template.yaml`
   inside an adopter's own CDK app (`src/cdk/`).

The handler ZIP and the SAM template still drive a maintainer-run real-AWS
smoke flow; the SDK + CDK are the supported public surface for adopters.

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ Step Functions state machine                                     │
│   Plan → Map(N) RenderChunk → Assemble                           │
└──────────────────────────────────────────────────────────────────┘
                              │ dispatches by event.Action
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ One Lambda function (this package's `dist/handler.zip`)          │
│   handler.mjs                                                    │
│     ├─ Action="plan"        → @hyperframes/producer/distributed  │
│     ├─ Action="renderChunk" → @hyperframes/producer/distributed  │
│     └─ Action="assemble"    → @hyperframes/producer/distributed  │
│   bin/ffmpeg                — ffmpeg-static                      │
│   node_modules/@sparticuz/chromium/ — Lambda-optimised Chromium  │
└──────────────────────────────────────────────────────────────────┘
                              │ pure functions over local paths
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ S3 bucket — plan tarball + per-chunk outputs + final mp4         │
└──────────────────────────────────────────────────────────────────┘
```

The handler downloads inputs from S3 into `/tmp`, calls the OSS primitive,
uploads outputs back to S3, and returns a small JSON result that fits
inside Step Functions' history budget (under 200 bytes per chunk).

## Chrome runtime

The package supports two Chromium sources:

| Source                          | Default | Size               | When to pick it                                                                                                       |
| ------------------------------- | ------- | ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `@sparticuz/chromium`           | yes     | ~70 MiB compressed | Lambda. Decompresses into `/tmp` at runtime; the rest of the ecosystem already uses it for headless-Chrome-in-Lambda. |
| Bundled `chrome-headless-shell` | no      | ~140 MiB           | Fallback. Used if `@sparticuz/chromium` ever drops `HeadlessExperimental.beginFrame` support.                         |

Pick the source at build time:

```bash
bun run --cwd packages/aws-lambda build:zip
bun run --cwd packages/aws-lambda build:zip -- --source=chrome-headless-shell
```

The handler reads `HYPERFRAMES_LAMBDA_CHROME_SOURCE` at boot. The build
script sets that env var via Lambda function configuration in
`examples/aws-lambda/template.yaml`.

## BeginFrame regression guard

HyperFrames' renderer drives Chrome via the CDP
`HeadlessExperimental.beginFrame` command — same path the K8s deploy uses.
The Lambda adapter assumes that `@sparticuz/chromium`'s
chrome-headless-shell build honours BeginFrame. To prove it (and re-prove
it on every release), the package ships a Docker probe:

```bash
# Build the Lambda-like container and run the probe.
bun run --cwd packages/aws-lambda probe:beginframe:docker
```

The probe boots `@sparticuz/chromium` inside
`public.ecr.aws/lambda/nodejs:22` and asserts CDP `beginFrame` with
`screenshot: true` returns a PNG buffer. Exit code 0 = green; non-zero =
fall back to bundling chrome-headless-shell directly via `--source=chrome-headless-shell`.

## Building the ZIP

```bash
bun install                                          # at the monorepo root
bun run --cwd packages/aws-lambda build:zip          # → packages/aws-lambda/dist/handler.zip
bun run --cwd packages/aws-lambda verify:zip-size    # CI gate
```

The build script bundles `src/handler.ts` via esbuild, stages
`@sparticuz/chromium` and `puppeteer-core` under `node_modules/`, copies
ffmpeg-static into `bin/`, and zips the result. The unzipped layout is
designed to extract cleanly into Lambda's `/var/task/`.

`verify:zip-size` enforces:

- Unzipped ≤ 248 MiB (in-house budget; Lambda hard ceiling is 250 MiB unzipped — AWS docs label this "250 MB" but use binary mebibytes)
- Zipped ≤ 150 MiB (in-house budget; Lambda has no hard zipped cap for S3-deployed functions)

CI fails the PR if either is exceeded.

## Running tests

```bash
bun run --cwd packages/aws-lambda test               # unit tests (no Chrome)
bun run --cwd packages/aws-lambda probe:beginframe   # local probe (Linux only)
```

## Using the SDK

After deploying the stack (via the SAM template, CDK construct below, or
your own CFN of choice), drive renders from Node:

```ts
import { deploySite, getRenderProgress, renderToLambda } from "@hyperframes/aws-lambda";

// One-time upload per project version.
const site = await deploySite({
  projectDir: "./my-composition",
  bucketName: "hyperframes-render-bucket",
});

// Start a render. Returns immediately — does NOT poll.
const handle = await renderToLambda({
  siteHandle: site,
  bucketName: site.bucketName,
  stateMachineArn: "arn:aws:states:us-east-1:123:stateMachine:hyperframes-render",
  config: {
    fps: 30,
    width: 1920,
    height: 1080,
    format: "mp4",
    chunkSize: 240,
    maxParallelChunks: 16,
    runtimeCap: "lambda",
  },
});

// Poll progress + cost on your own cadence.
const progress = await getRenderProgress({ executionArn: handle.executionArn });
console.log(progress.overallProgress, progress.costs.displayCost);
if (progress.status === "SUCCEEDED" && progress.outputFile) {
  console.log("Render landed at", progress.outputFile.s3Uri);
}
```

`renderToLambda` validates the config client-side via
`validateDistributedRenderConfig` and throws a typed `InvalidConfigError`
before the Step Functions execution starts, so shape errors surface
synchronously instead of as opaque `ExecutionFailed` results.

`getRenderProgress` reports an approximate per-render cost
(`accruedSoFarUsd` plus a formatted `displayCost`) derived from Lambda
billed-duration × memory × the us-east-1 on-demand rate plus the Step
Functions transition price. The math is documented in
`src/sdk/costAccounting.ts`; numbers are best-effort and exclude S3
transfer.

## Using the CDK construct

```ts
import { App, Stack } from "aws-cdk-lib";
import { HyperframesRenderStack } from "@hyperframes/aws-lambda/cdk";

const app = new App();
const stack = new Stack(app, "MyApp");
const render = new HyperframesRenderStack(stack, "Render", {
  // optional: reservedConcurrency: 8,
  // optional: lambdaMemoryMb: 10240,
  // optional: chromeSource: "sparticuz",
});

// Re-export so an adopter app can wire dashboards / SNS topics.
new CfnOutput(stack, "RenderBucketName", { value: render.bucket.bucketName });
new CfnOutput(stack, "StateMachineArn", { value: render.stateMachine.stateMachineArn });
```

`aws-cdk-lib` and `constructs` are **optional peer dependencies**: SDK-only
consumers don't pull them at runtime. The construct itself imports from
`@hyperframes/aws-lambda/cdk`.

## What's still ahead

- `hyperframes lambda` CLI (deploy / sites create / render / progress / destroy) — PR 6.5.
- IAM bootstrap subcommand (`policies role | user | validate`) — PR 6.9.
- Lambda-local regression harness (`--mode=lambda-local`) — PR 6.6.
- Adopter-facing migration guide — PR 6.8.
