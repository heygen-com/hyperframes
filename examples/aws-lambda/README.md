# AWS Lambda + Step Functions deployment

Reference SAM template for deploying HyperFrames distributed rendering on
AWS. One Lambda function, three roles (Plan / RenderChunk / Assemble),
choreographed by a Step Functions standard workflow with a Map state for
parallel chunk rendering.

See [`packages/aws-lambda/README.md`](../../packages/aws-lambda/README.md)
for the Lambda handler architecture.

## Prerequisites

- AWS account with IAM permissions to deploy CloudFormation stacks
  containing Lambda, Step Functions, S3, IAM, and CloudWatch resources.
- [`sam` CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
  installed (≥ 1.100).
- [`bun`](https://bun.sh) installed (≥ 1.3) to build the handler ZIP.

## One-shot deploy

```bash
# 1. Build the handler ZIP that `template.yaml`'s CodeUri points at.
bun install                                       # at repo root
bun run --cwd packages/aws-lambda build:zip

# 2. Deploy. First time: `--guided` to set stack name + region.
cd examples/aws-lambda
sam deploy --guided --resolve-s3
```

`--resolve-s3` lets SAM pick (or create) a per-account bucket to host the
uploaded ZIP. After the first deploy, subsequent updates can omit
`--guided` and `--resolve-s3` — SAM remembers your choices in
`samconfig.toml`.

## What gets created

| Resource                                 | Purpose                                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `Render Lambda`                          | Single function, handler `handler.handler`. Dispatches on `event.Action`.                          |
| `Render State Machine`                   | Step Functions standard workflow. Plan → Map(N) RenderChunk → Assemble.                            |
| `Render Bucket`                          | S3 bucket for plan tarballs, chunk outputs, and final mp4. `renders/` prefix expires after 7 days. |
| IAM role for the state machine           | Invokes the Lambda; writes CloudWatch logs; X-Ray traces.                                          |
| IAM role for the Lambda (managed by SAM) | S3 CRUD on the render bucket; CloudWatch logs.                                                     |
| Runaway-invocation alarm                 | Fires if RenderChunk runs more than `ChunkInvocationAlarmThreshold` times in an hour.              |

## Running a render

Upload your project as a zip to the render bucket, then start a Step
Functions execution:

```bash
STACK_NAME=hyperframes-render          # whatever you picked at deploy
RENDER_BUCKET=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`RenderBucketName`].OutputValue' \
  --output text)
STATE_MACHINE_ARN=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Outputs[?OutputKey==`RenderStateMachineArn`].OutputValue' \
  --output text)

# Tar + upload the project directory. The handler uses `tar` (not
# `unzip`, which Lambda's base image doesn't ship), so the on-the-wire
# archive format is `.tar.gz`.
tar -czf my-project.tar.gz -C ./my-project .
aws s3 cp my-project.tar.gz "s3://${RENDER_BUCKET}/projects/my-project.tar.gz"

# Start the execution. The input JSON tells the state machine where to
# read inputs and write outputs.
aws stepfunctions start-execution \
  --state-machine-arn "$STATE_MACHINE_ARN" \
  --input "$(cat <<EOF
{
  "ProjectS3Uri": "s3://${RENDER_BUCKET}/projects/my-project.tar.gz",
  "PlanOutputS3Prefix": "s3://${RENDER_BUCKET}/renders/$(date +%s)/",
  "OutputS3Uri": "s3://${RENDER_BUCKET}/output.mp4",
  "Config": {
    "fps": 30,
    "width": 1920,
    "height": 1080,
    "format": "mp4",
    "chunkSize": 240,
    "maxParallelChunks": 8,
    "runtimeCap": "lambda"
  }
}
EOF
)"
```

The Step Functions execution kicks off Plan, fans out RenderChunk via
the Map state, and finally Assemble. Final mp4 lands at `OutputS3Uri`.

## Local invocation

You can test the Lambda handler without deploying anything via SAM
local:

```bash
# Build the ZIP first.
bun run --cwd packages/aws-lambda build:zip

# Launch a local Lambda runtime emulator and run a sample plan event.
cd examples/aws-lambda
sam validate
sam local invoke RenderFunction --event sample-events/plan.json
```

The `sample-events/` directory ships small JSON payloads for each of the
three actions. They reference fake S3 URIs — useful for sanity-checking
the handler's dispatch logic; not for full end-to-end testing (real S3
calls require credentials and a project zip to actually exist).

## End-to-end smoke + benchmark

For full end-to-end validation against real AWS — the gate that proves
the architecture works on a deployed Lambda — use the local smoke
script:

```bash
# All defaults (mp4-h264-sdr fixture, chunk counts 2/4/8, PSNR >= 40 dB).
./scripts/smoke.sh

# Customised:
./scripts/smoke.sh \
  --fixture mp4-h264-sdr \
  --chunk-counts 2,4,8,16 \
  --psnr-threshold 40 \
  --reserved-concurrency 8

# Keep the stack alive for inspection afterward:
./scripts/smoke.sh --keep-stack

# Show all flags including cost notes:
./scripts/smoke.sh --help
```

The script builds the handler ZIP, deploys this template under a
per-run stack name, renders the fixture at each chunk count via the
Step Functions state machine, PSNR-compares against the in-process
baseline (which is git-LFS tracked under
`packages/producer/tests/distributed/<fixture>/output/`), captures
per-execution Step Functions history, and tears the stack down.

**Wall-clock methodology caveat (`eval.sh` only).** `eval.sh` reports a
local-vs-Lambda "speedup" column. The local timing includes `bun` +
`tsx` + harness scaffolding (not just renderer-internal time); the
Lambda timing measures Step Functions execution only. This biases the
speedup against Lambda on tiny fixtures and in favour of Lambda on
larger ones. Treat the number as "end-to-end CLI experience," not as a
renderer-vs-renderer benchmark. Cold-start variance is ±5-10s per
chunk; run with `--iterations 3+` to report medians.

**Cost per pass.** Each `eval.sh` invocation runs `SAM deploy` (~$0.01
in CFN operations) plus N fixtures × ITERATIONS × CHUNK_COUNT Lambda
invocations at `MemorySize` (default 10 GiB) × per-chunk wall clock.
With defaults (4 fixtures, 1 iteration, chunk-count 4) the Lambda
spend is roughly $0.10-$0.20 per pass before S3 transfer. Lower
`--reserved-concurrency` for cost-conscious accounts; higher
`--iterations` improves median stability at proportional cost.

Outputs land under `<repo-root>/lambda-smoke-artifacts/`:

- `results.json` — `chunkCount × wallClockMs × psnrAvgDb`
- `renders/N<N>-output.mp4` — each rendered chunk count
- `renders/N<N>-history.json` — full Step Functions execution history

Prerequisites: `aws` (v2), `sam` (≥ 1.100), `bun` (≥ 1.3), `ffmpeg`,
`jq`, `zip`. AWS credentials come from the standard resolution chain
(env vars → `~/.aws/credentials` → SSO → IMDS). Pin a specific profile
with `--profile <name>` or `AWS_PROFILE=<name>`.

## Parameters

| Parameter                       | Default       | Notes                                                                                           |
| ------------------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| `ProjectName`                   | `hyperframes` | Prefix for created resource names.                                                              |
| `LambdaMemoryMb`                | `10240`       | Lambda memory; Lambda allocates CPU proportionally. 10 GB recommended for 1080p.                |
| `LambdaTimeoutSec`              | `900`         | Per-invocation timeout. 15 min is Lambda's hard ceiling.                                        |
| `ReservedConcurrency`           | `-1`          | Hard cap on simultaneous Lambda invocations. `-1` = unreserved. Set to e.g. `50` to bound cost. |
| `ChromeSource`                  | `sparticuz`   | Must match the `--source=` flag passed to `build-zip.ts`.                                       |
| `ChunkInvocationAlarmThreshold` | `1000`        | CloudWatch alarm threshold (RenderChunk invocations per hour).                                  |

## Cleanup

```bash
sam delete --stack-name hyperframes-render
```

S3 buckets are `Retain`ed on delete to protect rendered artifacts.
Empty + delete the bucket manually after `sam delete` if you want to
fully tear down.

## Cost model

| Service                 | Driver                                  | Approximate cost                                               |
| ----------------------- | --------------------------------------- | -------------------------------------------------------------- |
| Lambda                  | Per-invocation billed duration × memory | ≈ $0.0000167/GB-s; a 10 GB function running 5 min costs ~$0.50 |
| Step Functions Standard | Per state transition                    | $0.025/1k transitions                                          |
| S3                      | Storage + GET/PUT                       | Dominated by mp4 storage; plan tarballs expire in 7 days       |
| CloudWatch Logs         | Ingestion + storage                     | Logs are not throttled; set retention manually if cost matters |

A 60-second 1080p30 composition at default chunkSize=240 (8 chunks)
typically costs ~$0.04 in Lambda time + ~$0.001 in Step Functions.
The eval script under `scripts/eval.sh` produces real per-fixture cost
numbers when you run it against your own AWS account.

## Troubleshooting

- **"Chrome failed to launch"** — the ZIP was likely built with the wrong
  `--source`. Match `ChromeSource` to the build flag.
- **"PLAN_HASH_MISMATCH"** — non-retryable. The plan tarball was written
  by a different version of the producer than the chunk worker is
  running. Re-plan from scratch.
- **"BROWSER_GPU_NOT_SOFTWARE"** — Chromium fell back to a hardware GL
  backend. Should not happen in Lambda (no GPU); file an issue.
- **CloudWatch alarm firing on `runaway-chunk-invocations`** — check
  the state machine execution history for an unintended Map fan-out, or
  raise the threshold if your workload genuinely exceeds it.

## What's NOT in this directory

- CDK construct shipping the same topology programmatically — follow-up.
- `hyperframes lambda deploy / render / progress / destroy` CLI — follow-up.
- Migration guide — follow-up.
- Lambda RIE local smoke harness mode — follow-up.
