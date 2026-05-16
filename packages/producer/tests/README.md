# Producer regression test fixtures

Each subdirectory under this folder is a **regression fixture** for the
HTML-to-video pipeline. The harness at
`packages/producer/src/regression-harness.ts` walks every subdirectory,
runs the composition, and PSNR-compares the rendered output against a
checked-in golden baseline.

## Fixture layout

```
<fixture-name>/
├── meta.json           # name, tags, PSNR threshold, renderConfig
├── src/
│   ├── index.html      # composition entry point
│   └── assets/...      # any locally-referenced media
└── output/
    ├── compiled.html   # golden compiled HTML (validated as a snapshot)
    └── output.mp4      # golden rendered video
```

`meta.json` is validated by `validateMetadata` in
`src/regression-harness.ts`. The required fields are:

- `name` (string), `description` (string), `tags` (string[])
- `minPsnr` (number, dB)
- `maxFrameFailures` (integer)
- `minAudioCorrelation` (0..1), `maxAudioLagWindows` (integer ≥1)
- `renderConfig.fps` (integer like `30` or a rational string like `"30000/1001"`)

Optional `renderConfig` fields:

- `format` — `"mp4"` (default) or `"webm"`
- `workers` — integer ≥ 1
- `hdr` — boolean (default `false`)
- `variables` — JSON object of render-time variable overrides
- `chunkSize` — integer ≥ 1 (used by `--mode=distributed-simulated`)
- `maxParallelChunks` — integer ≥ 1 (used by `--mode=distributed-simulated`)

## Generating / updating a baseline

**Always inside Docker.** Host Chrome / FFmpeg versions drift across
distros, so a baseline captured on the host won't match the bytes CI
renders.

```bash
# From the repo root.
docker build -t hyperframes-producer:test -f Dockerfile.test .

# Generate a baseline (single fixture):
bun run --cwd packages/producer docker:test:update <fixture-name>

# Generate all baselines (rarely needed):
bun run --cwd packages/producer docker:test:update
```

The `--update` flag writes `output/compiled.html` and `output/output.mp4`
from the current render. Without `--update`, the harness compares against
those baselines.

## Running the harness locally

```bash
# Run every fixture (parallel, in-process mode — the default).
bun run --cwd packages/producer docker:test

# Run a single fixture:
bun run --cwd packages/producer docker:test font-variant-numeric

# Run sequentially (lower memory):
bun run --cwd packages/producer docker:test -- --sequential
```

## Harness modes

`--mode=<value>` chooses which render path the harness exercises:

| Mode | What it calls | Use for |
|---|---|---|
| `in-process` (default) | `executeRenderJob` | Day-to-day baselines. This is the same path the `hyperframes render` CLI takes, and it is what produced every existing `output/output.mp4`. |
| `distributed-simulated` | `plan()` → `renderChunk()` × N → `assemble()` from `@hyperframes/producer/distributed` | Validates the distributed pipeline against the in-process baseline. No Temporal or Lambda involvement — the controller and chunk worker are both this process. |

### `--mode=distributed-simulated`

```bash
bun run --cwd packages/producer docker:test -- --mode=distributed-simulated
bun run --cwd packages/producer docker:test font-variant-numeric -- --mode=distributed-simulated
```

The distributed pipeline cannot run every fixture. Fixtures that fail any
of these gates are **skipped** with a clear log line (and counted as
passing in the summary):

- `fps.den !== 1` — distributed mode is integer-fps only (no NTSC).
- `fps.num ∉ {24, 30, 60}` — closed set per `DistributedRenderConfig`.
- `format === "webm"` — `plan()` refuses webm.
- `hdr === true` — distributed mode is SDR-only at v1.

Both modes use the fixture's authored `minPsnr` as the per-test
threshold — distributed must clear the same quality bar in-process
clears against the same frozen baseline. (`DISTRIBUTED-RENDERING-PLAN.md`
§5.1's 50 dB target is a per-render distributed-vs-in-process contract;
against the frozen baseline file, neither mode reaches it consistently
due to shared encoder/JPEG-capture jitter.) An absolute 10 dB pathology
floor catches fully-black-output regressions when a fixture authors a
permissive threshold. A distributed failure at the fixture's own
threshold means the distributed pipeline has drifted — file an issue
rather than relaxing the fixture.

`--update` is incompatible with `--mode=distributed-simulated`: the
in-process renderer is the source of truth for baselines, and the
distributed mode's job is to verify the contract against the same
baseline.

### Validating PR 4.1 (the harness mode itself)

The smallest fixtures (`font-variant-numeric`, `many-cuts`) are sufficient
to verify the mode plumbing end to end:

```bash
docker build -t hyperframes-producer:test -f Dockerfile.test .

# In-process: existing behavior, unchanged.
bun run --cwd packages/producer docker:test font-variant-numeric
bun run --cwd packages/producer docker:test many-cuts

# Distributed-simulated: same baselines, distributed pipeline.
bun run --cwd packages/producer docker:test font-variant-numeric -- --mode=distributed-simulated
bun run --cwd packages/producer docker:test many-cuts -- --mode=distributed-simulated
```

Both modes must pass at each fixture's authored `minPsnr` against the
existing baseline. If `--mode=distributed-simulated` fails where
`--mode=in-process` passes, the distributed primitive has a regression —
file an issue rather than relaxing the fixture's threshold.

## Distributed-only fixtures

Fixtures under `tests/distributed/<name>/` are authored specifically for
the distributed pipeline. They follow the same `meta.json` schema as the
top-level fixtures, but they always set `chunkSize` / `maxParallelChunks`
so a `plan()` over the fixture produces N>1 chunks. Each fixture
exercises one of:

- per-format chunk-boundary correctness (mp4 H.264, mp4 H.265, ProRes, png-sequence)
- per-adapter chunk-seam state preservation (GSAP, Anime.js, Three.js, Lottie, CSS, WAAPI)

See `DISTRIBUTED-RENDERING-PLAN.md` §10.2 for the equivalence axes each
distributed fixture covers.

### Fixture pattern (4.2 onward)

Each `tests/distributed/<name>/` fixture has the same structure as a
top-level fixture (`meta.json` + `src/index.html` + `output/output.mp4`).
Differences worth knowing:

- `renderConfig.chunkSize` is **required** — pick a value that yields
  N≥2 chunks for your fixture's frame count (e.g. 60 frames at
  `chunkSize: 15` produces N=4). Without this the fixture renders in a
  single chunk and never exercises the seam.
- The fixture's ID on the CLI is just `<name>` (no `distributed/`
  prefix). `bun run --cwd packages/producer docker:test mp4-h264-sdr`
  works the same as for a top-level fixture.
- The `distributed` tag is informational — it doesn't gate any tag-based
  filter today. Add it so the fixture is easy to find by tag.
- The composition should stress *state continuity* across the chunk
  seams: an animation crossing a seam, a counter, a rotation. A
  fully-static composition would pass even if chunk-boundary state was
  broken.
- Baselines must be generated inside Docker — see the section above.
  The baseline is rendered by the in-process renderer (the source of
  truth for golden output); `--mode=distributed-simulated` is validated
  against the same baseline.

## Tags

Common `tags` values control which fixtures the default `bun test`
invocation runs. `--exclude-tags transparency` (the default for
`bun test`) skips webm/png-sequence alpha fixtures that need a working
chrome-headless-shell alpha pipeline.
