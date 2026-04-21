# Producer Performance Benchmarks

End-to-end render benchmark harness driven by `src/benchmark.ts`. Discovers
fixtures under `packages/producer/tests/<fixture>/` (any directory with a
`meta.json`), runs them through the full producer pipeline, and emits per-stage
timing plus peak memory metrics into `benchmark-results.json`.

The harness is deliberately lightweight — it doesn't enforce thresholds. It's
designed for **regression spotting**: capture a baseline, change something,
re-run, eyeball the diff. For pass/fail thresholds see `tests/perf/baseline.json`
and the perf-regression checks in the integration test suite.

## Quick start

```bash
# Run every non-slow fixture once
cd packages/producer
bun run benchmark

# HDR-only baseline (PQ + HLG fixtures, ~50s on M-series Macs)
bun run bench:hdr

# Average a fixture across multiple runs
bunx tsx src/benchmark.ts --tags hdr --runs 3

# Just the PQ regression
bunx tsx src/benchmark.ts --only hdr-regression

# Skip slow fixtures explicitly (default behavior; here for clarity)
bunx tsx src/benchmark.ts --exclude-tags slow
```

Results are written to
`packages/producer/tests/perf/benchmark-results.json` and a summary table is
printed to stdout.

## CLI flags

| Flag | Description |
| --- | --- |
| `--runs N` | Run each fixture `N` times and average (default: 1). |
| `--only <id>` | Run a single fixture by directory name. |
| `--tags a,b` | **Positive** filter: only fixtures whose `meta.json#tags` contains *any* of the listed tags. |
| `--exclude-tags a,b` | **Negative** filter: skip fixtures with any matching tag. Defaults to `slow`. |

`--tags` and `--exclude-tags` apply independently — a fixture must match the
positive filter (if any) **and** must not match the negative filter.

## Reading the output

Each fixture row prints averaged stage timings plus peak memory:

```
Fixture                       Total   Compile   Extract     Audio   Capture    Encode   PeakRSS  PeakHeap
hdr-hlg-regression          11549ms     187ms     520ms      36ms    8373ms    2394ms    227MiB     69MiB
hdr-regression              34452ms      94ms    1268ms      48ms   27034ms    5914ms    272MiB    118MiB
```

- **Total** — wall-clock time from job submission to mux-complete.
- **Capture** — frame extraction + composition + alpha blit (HDR path).
- **Encode** — chunked or streaming HDR encoder time (HEVC Main10 for HDR).
- **PeakRSS / PeakHeap** — sampled every 250ms inside `executeRenderJob` from
  `process.memoryUsage()`; surfaces gross memory regressions (e.g. unbounded
  image-cache growth) that wall-clock numbers miss. RSS includes native
  ffmpeg/Chrome allocations; heap is JS-side V8 only.

## HDR baseline (April 2026)

Captured on macOS arm64 (M-series), Bun runtime, 1 worker, default config,
single run. These are illustrative — re-baseline locally before comparing your
own runs.

| Fixture | Total | Capture | Encode | PeakRSS | PeakHeap | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `hdr-hlg-regression` | 11.5s | 8.4s (72%) | 2.4s (21%) | 227 MiB | 69 MiB | 150 frames, 2 HLG sources |
| `hdr-regression` | 34.5s | 27.0s (78%) | 5.9s (17%) | 272 MiB | 118 MiB | 600 frames, 9 PQ sources, shader transition |

Capture dominates HDR runs (~72-78%). The second-biggest cost is HEVC Main10
encode. Memory peaks scale with source count and resolution — the PQ
regression's nine HDR sources push heap from ~70 MiB → ~120 MiB.

When evaluating an HDR optimization (image cache, gated debug logging, etc.)
the metric to watch first is **Capture** ms-per-frame:

```
hdr-regression: capture avg 45ms/frame
hdr-hlg-regression: capture avg 56ms/frame
```

## When to re-baseline

- After landing any change that touches `renderOrchestrator.ts`,
  `streamingEncoder.ts`, the HDR alpha-blit path, or `frameDirCache.ts`.
- Before opening a PR that claims a perf win — paste before/after numbers in
  the PR description.
- Quarterly, even without code changes, to track infra/dependency drift.

The `bench:hdr` script is the recommended command for routine HDR perf checks
because it filters out non-HDR fixtures (which can be 10× slower without
contributing signal to HDR-specific work).
