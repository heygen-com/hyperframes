# Compare and batch rendering

Use these commands for deliberate visual comparison or variable-driven template output. They do not replace `lint`, `check`, final preview approval, or output verification.

## Contents

- [Compare projects or variants](#compare-projects-or-variants)
- [Compare color grades](#compare-color-grades)
- [Batch template renders](#batch-template-renders)

## Compare projects or variants

Render the same timestamp from two or more project directories or HTML files into one labeled contact sheet:

```bash
npx hyperframes compare <path-a> <path-b> [<path-c> ...] \
  --at <seconds> \
  --labels baseline,candidate \
  --out compare.png \
  --cols 2
```

Useful options:

- `--at <seconds>` selects the shared comparison time.
- `--labels <a,b,...>` labels cells in input order.
- `--out <file>` chooses the sheet path.
- `--cols <n>` controls its grid.
- `--json` returns machine-readable results.
- `--timeout <ms>` changes the per-variant render-ready timeout.

One sheet accepts at most 16 variants. Extra inputs are truncated with a warning; split larger comparisons into several runs.

`compare` is a visual review surface, not a quality gate. Run it when checking a baseline against a candidate, comparing implementation variants, or verifying that a repair preserves the intended look. Inspect the generated image; do not treat command success as visual approval.

## Compare color grades

Create grade candidates from a source frame:

```bash
npx hyperframes grade-compare \
  --for frame.png \
  --grades grades.json \
  --project . \
  --out grade-compare.png
```

`grades.json` is an array of labeled HyperFrames grading blocks:

```json
[{ "label": "warm", "grading": { "temperature": 0.2, "contrast": 0.1 } }]
```

Or compare explicit LUT files:

```bash
npx hyperframes grade-compare \
  --for source.mp4 \
  --luts warm.cube,cool.cube \
  --out grade-compare.png
```

- `--for` accepts an image or a video. For video input, the command extracts the first frame.
- Supply exactly one candidate source: `--grades <json>` or `--luts <a.cube,b.cube>`.
- A neutral baseline is included by default; pass `--no-baseline` only when the baseline is not a useful reference.
- The command accepts at most 16 candidate grades. With the default neutral baseline, the sheet may contain 17 cells. Extra candidates are truncated with a warning; split larger sets into several runs.
- `--timeout <ms>` changes the render-ready timeout for the generated comparison composition.
- Use `--json` for machine-readable output.

This command helps select a grade. It does not apply the selected grade to the composition or replace `/media-use` provenance and LUT validation.

## Batch template renders

`render --batch` accepts either a JSON array of variable objects or an object with a `rows` array:

```json
{
  "rows": [
    { "name": "alpha", "headline": "Hello" },
    { "name": "beta", "headline": "Welcome" }
  ]
}
```

Declare the variables in the composition, then run:

```bash
npx hyperframes render \
  --batch rows.json \
  --output "renders/{name}.mp4" \
  --batch-concurrency 1 \
  --strict-variables
```

Batch rules:

- Do not combine `--batch` with `--variables` or `--variables-file`; each row is the variable set for one render.
- If `--output` is omitted, the generated filename includes `{index}` so rows remain unique.
- Output templates support `{index}` and row keys containing letters, numbers, `_`, `.`, or `-`. A placeholder value must be a string, number, or boolean; `null`, objects, and arrays are invalid. Missing placeholders and output collisions are errors.
- `--batch-concurrency` defaults to `1`. Raise it conservatively because each render already uses workers.
- `--batch-fail-fast` stops scheduling after the first failure. Without it, independent rows keep running and failures remain visible in the manifest.
- `--strict-variables` validates every row before rendering and aborts before output when the declared variable contract is violated.
- `--json` emits progress events suitable for agents and CI.

The command writes `manifest.json` in the common output directory and updates it throughout the run. It records each row's variables, status, output, error, and timing. Completion means the manifest has no failed rows and every completed output exists, is non-empty, and has a plausible duration.
