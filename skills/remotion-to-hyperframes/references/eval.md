# Eval: how to validate a translation end-to-end

Every translation should be measured. The skill ships three scripts and
a tiered test corpus that, together, gate translation quality.

## The three scripts

| Script                   | Input                       | Output                                                              |
| ------------------------ | --------------------------- | ------------------------------------------------------------------- |
| `scripts/lint_source.py` | Remotion source dir or file | JSON findings + exit code (0 clean, 1 has blockers)                 |
| `scripts/render_diff.sh` | two MP4 paths               | per-frame SSIM + JSON summary (`mean`, `min`, `p05`, `p95`, `pass`) |
| `scripts/frame_strip.sh` | two MP4 paths               | side-by-side comparison strip PNG for visual debugging              |

Run them in this order: **lint → render → diff → (if fail) strip**.

## Per-fixture flow

```bash
# 1. Lint the source — blockers mean stop
python3 ../../scripts/lint_source.py ./remotion-src/src/

# 2. Generate any binary assets (T2+T3 only)
[ -f setup.sh ] && ./setup.sh

# 3. Render Remotion baseline
cd remotion-src && npm install && npm run render
# -> remotion-src/out/baseline.mp4

# 4. Render HF translation
cd .. && node ../../../packages/cli/dist/cli.js render hf-src/ --output hf.mp4
# -> hf.mp4

# 5. SSIM diff
../../scripts/render_diff.sh ./remotion-src/out/baseline.mp4 ./hf.mp4 ./diff
# -> diff/summary.json

# 6. If diff fails, generate frame strip for visual inspection
../../scripts/frame_strip.sh ./remotion-src/out/baseline.mp4 ./hf.mp4 ./strip 8
# -> strip/strip.png
```

## Reading `diff/summary.json`

```json
{
  "frame_count": 90,
  "mean": 0.974,
  "min": 0.972,
  "max": 0.999,
  "p05": 0.972,
  "p95": 0.983,
  "threshold": 0.95,
  "pass": true
}
```

| Field         | What it tells you                                                           |
| ------------- | --------------------------------------------------------------------------- |
| `mean`        | average SSIM across all frames; the headline number                         |
| `min`         | worst frame; below threshold means at least one frame is structurally wrong |
| `p05` / `p95` | 5th / 95th percentile — most frames sit between these                       |
| `threshold`   | from `R2HF_SSIM_THRESHOLD` env var (default 0.85)                           |
| `pass`        | whether `mean >= threshold`                                                 |

## Validated tier thresholds

Calibrated against actual Remotion + HF renders:

| Tier | Composition shape                           | Mean  | Threshold | Margin |
| ---- | ------------------------------------------- | ----- | --------- | ------ |
| T1   | single-element fade-in                      | 0.974 | 0.95      | +0.022 |
| T2   | multi-scene + spring + audio + image        | 0.985 | 0.95      | +0.016 |
| T3   | data-driven, custom subcomponents, count-up | 0.953 | 0.90      | +0.038 |

Each fixture's `expected.json` carries:

- `ssim_threshold` — the gate for `pass`
- `validation` — the actual measured numbers from the calibration run
- `translation_notes` — what's lossy and why

## Critical: encoder config

Both Remotion and HF must output the same pixel format for SSIM to be
meaningful. Remotion's default JPEG output writes `yuvj420p` (full-range);
HF outputs `yuv420p` (limited-range). The mismatch costs ~0.05 SSIM.

Every fixture's `remotion.config.ts` sets:

```ts
Config.setVideoImageFormat("png");
Config.setColorSpace("bt709");
```

If the user's source doesn't have these, add them in the translation
step — otherwise the diff measures encoder differences, not translation
fidelity.

## What the noise floor looks like

The dominant non-translation noise is **system font fallback divergence**.
Remotion's bundled Chromium and HF's `chrome-headless-shell` interpret
`font-weight: 800` differently when there's no real font installed:

- Remotion HELLO at 160px: medium-weight stroke
- HF HELLO at 160px: heavy-weight stroke

This costs ~0.025 mean SSIM. Visible in T1's frame strip.
[fonts.md](fonts.md) covers how to mitigate (use Inter, load explicit
Google Fonts).

## Threshold rule of thumb

Set the threshold ~0.02 below measured `p05`:

- Real translation regressions drop mean by 0.05+ — caught.
- Encoder/font drift between CI runs is bounded at ~0.01 — not caught.

If a calibration run's measured mean is far above your initial threshold
guess, _don't_ tighten the threshold to fit. Leave headroom — fixtures
re-rendered on different hardware will drift.

## When the diff fails

1. **Look at `frame_strip.sh` output first.** A side-by-side strip at 6–10
   evenly-spaced timestamps shows whether the failure is structural
   (wrong scene durations, missing element) or cosmetic (different font
   weight, slight timing skew).
2. **Check `diff/ssim.log`.** Per-frame SSIM tells you _which_ frames
   failed. Cluster of bad frames in the middle of a scene = animation
   problem; bad frames at scene boundaries = sequencing problem.
3. **Re-read the relevant reference.** [timing.md](timing.md) for
   spring/easing issues, [sequencing.md](sequencing.md) for scene
   boundary issues, [media.md](media.md) for asset loading issues.

## CI integration

The fixtures are not yet wired into CI (`packages/producer/tests/` runs
inside Docker; the skill corpus needs the same). PR 7 of the stack adds
the orchestrator that runs all four tiers and emits an aggregated pass
report. For now, evaluate by hand per fixture.
