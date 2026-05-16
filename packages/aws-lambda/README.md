# @hyperframes/aws-lambda

AWS Lambda adapter for HyperFrames distributed rendering. Wraps the OSS
`plan` / `renderChunk` / `assemble` primitives into a single Lambda handler
that Step Functions can dispatch on, plus a build pipeline that bundles
the handler + Chrome runtime + ffmpeg into a deployable ZIP.

The Lambda adapter ships in two parts: the foundation (this package + the
SAM example) validates the architecture end-to-end on real AWS; the
user-facing surface (CLI, CDK construct, migration guide) lands in
follow-up PRs.

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

## What's NOT in this PR

- `examples/aws-lambda/template.yaml` (SAM template — separate PR).
- Real-AWS deploy + smoke workflow (separate PR).
- `npx hyperframes lambda deploy` CLI — follow-up.
- CDK construct (`HyperframesRenderStack`) — follow-up.
- Migration guide — follow-up.
