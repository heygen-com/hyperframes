# Eval: how to validate a translation end-to-end

Every translation should be measured. The skill ships a source linter and
a tiered test corpus; the CLI's `diff` command scores the result. Together
they gate translation quality.

## The tools

| Tool                       | Input                       | Output                                                                        |
| -------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `scripts/lint_source.py`   | Remotion source dir or file | JSON findings + exit code (0 clean, 1 has blockers)                           |
| `npx hyperframes diff A B` | original MP4, HF MP4        | per-frame SSIM, worst cell per frame, cuts, `worst.jpg` sheet; exit 1 on fail |

Run them in this order: **lint → render → diff → (if fail) read the sheet**.

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

# 5. SSIM diff, gated on the tier's mean threshold only
mkdir -p diff && node ../../../packages/cli/dist/cli.js diff ./remotion-src/out/baseline.mp4 ./hf.mp4 \
  --min-mean 0.95 --min-p05 0 --min-cell 0 --out ./diff --json > diff/summary.json
# -> diff/summary.json, diff/worst.jpg, diff/ssim.log
```

Before rendering, `npx hyperframes diff <baseline.mp4> hf-src --at 0.5,2,4.1`
scores the project at chosen times with no render.

## Reading `diff/summary.json`

```json
{
  "pass": true,
  "ssim": { "frames": 90, "mean": 0.974, "p05": 0.972, "min": 0.971, "cell_p05": 0.93 },
  "worst": [
    { "t": 1.2, "frame": 36, "ssim": 0.971, "cell": { "roi": [480, 270, 480, 270], "ssim": 0.88 } }
  ],
  "cuts": { "reference": [1.5], "yours": [1.5], "missing": [], "extra": [], "pass": true },
  "duration": { "reference": 3, "yours": 3, "pass": true },
  "sheet": "diff/worst.jpg"
}
```

| Field           | What it tells you                                                                |
| --------------- | -------------------------------------------------------------------------------- |
| `ssim.mean`     | average SSIM across all frames; the headline number                              |
| `ssim.p05`      | 5th percentile: most frames sit above it                                         |
| `ssim.cell_p05` | each frame's worst cell of a 4x4 grid; a wrong element shows here, not in `mean` |
| `worst`         | the lowest-scoring moments, each with the cell (in original pixels) that failed  |
| `cuts`          | hard cuts on both sides; a missing or extra one is a sequencing problem          |
| `pass`          | every gate held: `--min-mean`, `--min-p05`, `--min-cell`, cuts and duration      |

## Threshold rule of thumb

Set the threshold ~0.02 below measured `p05`:

- Real translation regressions drop mean by 0.05+ — caught.
- Encoder/font drift between CI runs is bounded at ~0.01 — not caught.

If a calibration run's measured mean is far above your initial threshold
guess, _don't_ tighten the threshold to fit. Leave headroom — fixtures
re-rendered on different hardware will drift.

## When the diff fails

1. **Look at `diff/worst.jpg` first.** The worst moments side by side, each
   with its failing cell boxed, show whether the failure is structural
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
