# Golden baseline regression gate

A minimal project showing the `hyperframes check --golden` workflow: commit
reference frames ("golden baselines") of a composition, then let CI — or an
AI agent's own verification loop — fail loudly whenever a change moves pixels
it was not supposed to move.

## Layout

```
examples/golden-baseline/
  index.html                          # 640x360, 4s composition
  golden/
    golden-baseline-demo/             # <compositionId>
      golden.json                     # sample times + diff tuning (optional)
      500.png                         # baseline at t=0.5s   (<timeMs>.png)
      2000.png                        # baseline at t=2.0s
      3500.png                        # baseline at t=3.5s
```

Baselines follow the convention `golden/<compositionId>/<timeMs>.png`. The
`golden.json` manifest pins the sample times and can tune the diff:

```json
{
  "times": [0.5, 2, 3.5],
  "threshold": 0.1,
  "maxDiffRatio": 0,
  "ignoreAntialiasing": true
}
```

- `times` — timeline sample times in seconds.
- `threshold` — per-channel pixel tolerance as a fraction of 255 (default 0.1).
- `maxDiffRatio` — fraction of differing pixels allowed before the gate fails
  (default 0: fail on any counted diff).
- `ignoreAntialiasing` — exclude 1px rasterization edge shifts from the count
  (default true).

## Workflow

```bash
cd examples/golden-baseline

# 1. Create (or refresh) the baselines from a state you have reviewed, then
#    commit golden/ to the repo.
npx hyperframes check --update-golden     # or: npx hyperframes snapshot --update-golden

# 2. Gate every subsequent change. Exits non-zero on any regression.
npx hyperframes check --golden

# 3. Agent-readable result (the golden summary rides inside the check report).
npx hyperframes check --golden --json
```

On failure the gate writes `golden-diff/<compositionId>/` containing the
current frame, a red-highlight diff PNG per failed time, and a
`contact-sheet.jpg` with one `baseline | current | diff` row per failure —
one image an agent (or a human) can read to see exactly what moved.

The JSON envelope includes:

```json
{
  "ok": false,
  "golden": {
    "ok": false,
    "failed": [
      {
        "id": "golden-baseline-demo",
        "time": 2,
        "maxDelta": 210,
        "diffRatio": 0.0042,
        "reason": "pixel-diff"
      }
    ],
    "diffSheet": "golden-diff/golden-baseline-demo/contact-sheet.jpg"
  }
}
```

## Try a regression

Change `#accent-bar`'s `background-color` in `index.html` (say `#f5a623` →
`#e0245e`) and run `npx hyperframes check --golden` — the gate fails, names the
regressed times, and writes the diff sheet. If the change was intentional,
refresh with `--update-golden` and commit the new baselines.

Deterministic rendering matters here: capture baselines and gate on the same
rendering stack (CI runner, `--no-browser-gpu` for SwiftShader determinism if
your machines differ). See the visual regression guide in the docs for CI
wiring.
