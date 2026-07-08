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

## Anime.js determinism gate

The `animejs-determinism-*` fixture family is not only a PSNR baseline
suite. These fixtures also feed a direct browser conformance gate that
drives the compiled pages through `window.__hf.seek(t)` and compares DOM
state snapshots. Run it before any registry or content porting work
depends on anime.js behavior:

```bash
bun run --cwd packages/producer check:runtime-conformance
```

`check:runtime-conformance` first verifies the built HyperFrames runtime
manifest and producer file-server injection wiring, then runs the anime.js
determinism gate across `animejs-adapter` and all
`animejs-determinism-*` fixtures. To run only the browser gate:

```bash
bun run --cwd packages/producer check:animejs-determinism
```

The browser gate differs from the Docker PSNR flow above. It does not
render MP4 output or compare video frames. Instead it compiles each fixture
through the producer compiler, serves it through the render file server so
the real runtime bridge is injected, opens isolated Puppeteer pages, and
asserts:

- same-frame repeatability on the same page
- random seek order `[90, 10, 50, 10]` followed by direct equivalence at
  frame `42`
- forward seek followed by backward seek to exact `0`
- negative seek clamping to the `0` state
- past-duration seek matching the fixture end state for finite anime
  instances
- no active anime.js engine work remains, plus prompt `page.close()`

The timer leak check is intentionally scoped: the HyperFrames runtime owns a
transport `requestAnimationFrame` loop, so the gate does not claim every page
timer handle is absent. It introspects `anime.engine` for active anime.js
work and separately asserts that each throwaway page closes promptly.

The fixture targets are:

- `animejs-determinism-springs` — spring easing on transform state
- `animejs-determinism-morph` — `anime.svg.morphTo` path interpolation
- `animejs-determinism-drawable` — `anime.svg.createDrawable` line draw
- `animejs-determinism-split-text` — `anime.text.split` per-character
  animation
- `animejs-determinism-nested-sync` — parent timeline driving a child
  timeline through `.sync()`
- `animejs-determinism-seeded-stagger` — fixed-grid `anime.stagger`
  delays with no random seed or wall-clock input
- `animejs-determinism-backward-seek` — delayed animation state after
  forward-then-backward seek

If a fixture fails this gate, do not relax the check to make the fixture
pass. Record the fixture, check name, and expected/actual snapshot artifact
paths from `.debug/animejs-determinism-gate/`; that feature should be
scoped out of the v1 anime.js authoring contract until the failure is
understood.

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
clears against the same frozen baseline. (Internal contract: distributed
vs in-process renders of the same fixture should clear 50 dB PSNR
against each other within the same Docker image. Against the frozen
committed baseline, neither mode reaches that consistently due to
shared encoder/JPEG-capture jitter — that's why the fixture's authored
threshold gates here, not the 50 dB contract value.) An absolute 10 dB
pathology floor catches fully-black-output regressions when a fixture
authors a permissive threshold. A distributed failure at the fixture's
own threshold means the distributed pipeline has drifted — file an
issue rather than relaxing the fixture.

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

Each distributed fixture covers one or more equivalence axes — see the
`meta.json` `description` field for what a given fixture is locking in.

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
