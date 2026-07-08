# GSAP Baseline Evaluation

U19 creates the GSAP-main baseline corpus and a per-item PSNR compare tool for the
GSAP-to-anime.js migration. These scripts do not port or render anime.js content.
They render the pinned GSAP fork point through the built HyperFrames CLI and
compare later candidate videos against those baselines.

## Baseline Directory

Default:

```bash
/Users/miguel07code/dev/hyperframes-animejs-eval/baselines
```

Override with either:

```bash
HYPERFRAMES_GSAP_BASELINE_DIR=/path/to/baselines
node --import tsx scripts/eval-gsap-vs-anime/render-baseline.ts
```

or:

```bash
node --import tsx scripts/eval-gsap-vs-anime/render-baseline.ts --baseline-dir /path/to/baselines
```

Layout:

```text
baselines/
  index.json
  render-baseline.log
  17b852784bf3/
    block/<name>.mp4
    component/<name>.mp4
    example/<name>.mp4
  second-baselines/
    17b852784bf3/<item>-<timestamp>.mp4
```

The manifest is keyed by registry item key plus fork SHA and records item name,
kind, relative video path, fork SHA, render timestamp, fps, duration, dimensions,
status, and any render error.

## Render Baselines

Fresh run, including the required clean build:

```bash
node --import tsx scripts/eval-gsap-vs-anime/render-baseline.ts
```

Resume after an interruption without rebuilding:

```bash
node --import tsx scripts/eval-gsap-vs-anime/render-baseline.ts --skip-build
```

Render one item:

```bash
node --import tsx scripts/eval-gsap-vs-anime/render-baseline.ts --skip-build --only block/data-chart
```

The renderer discovers 147 registry items: 109 blocks, 25 components, and 13
examples. It writes pending manifest entries up front, renders serially with the
built CLI (`node packages/cli/dist/cli.js render ...`), updates the manifest
after each item, logs to stdout and `render-baseline.log`, records failures, and
continues.

Examples are rendered from `index.html`. Placeholder `__VIDEO_DURATION__` tokens
are patched from the registry duration, placeholder video/audio tokens are
removed, and awkward deck-style examples use the authored or inferred root span.
If no duration can be inferred, the documented fallback is 5 seconds.

## Compare One Item

Compare explicit videos:

```bash
node --import tsx scripts/eval-gsap-vs-anime/compare-item.ts \
  --baseline /path/to/gsap.mp4 \
  --candidate /path/to/candidate.mp4
```

Compare a candidate against a manifest baseline:

```bash
node --import tsx scripts/eval-gsap-vs-anime/compare-item.ts \
  --item block/data-chart \
  --candidate /path/to/candidate.mp4
```

The compare CLI emits a JSON verdict to stdout and exits non-zero for
`"damaged"`. It samples 100 checkpoints by default, matching the existing
regression harness pattern: one checkpoint per 1 percent of the shared video
duration, with ffmpeg's `psnr` filter applied at the selected frame.

## Damage Criterion

- Hard failure: any evaluated checkpoint below 30 dB is damaged.
- Low band: checkpoints from 30 dB inclusive to below 45 dB trigger a lazy
  second-baseline check.
- Second-baseline waiver: if the second GSAP baseline is also below 45 dB at the
  same checkpoint, that checkpoint is waived as inherent render noise.
- Screening flag: average checkpoint PSNR below 50 dB sets `screening_flag:
true`, but this is informational and not a hard failure by itself.

When `--item` is present and a checkpoint enters the 30-45 dB band, the compare
CLI lazily renders a second GSAP baseline through the built CLI. Disable that
with `--no-render-second-baseline`, or provide an existing file with
`--second-baseline`.
