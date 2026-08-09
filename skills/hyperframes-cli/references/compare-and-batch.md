# Compare and batch rendering

Use these commands for deliberate visual comparison or variable-driven template output. They do not replace `lint`, `check`, final preview approval, or output verification.

## Contents

- [Compare projects or variants](#compare-projects-or-variants)
- [Measure against a reference](#measure-against-a-reference)
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

Without `--against`, `compare` is a visual review surface, not a quality gate. Run it when checking a baseline against a candidate, comparing implementation variants, or verifying that a repair preserves the intended look. Inspect the generated image; do not treat command success as visual approval.

## Measure against a reference

Every other gate in the CLI is self-referential: `lint` and `check` audit the composition against its own rules, so a scene that renders nothing like the artifact it is supposed to reproduce still passes them. When a reference artifact exists (the video being rebuilt, an approved cut, a design still, yesterday's render), measure against it:

```bash
npx hyperframes compare <project> \
  --against reference.mp4 \
  --at 0,4,10,21 \
  --out compare.png \
  --json
```

Exactly one composition path is allowed with `--against`. The reference may be a video (frames are pulled at each `--at` time) or a still image (the same target at every time). Up to 8 times per run; `--at` defaults to `0`.

Each run produces three instruments:

| Artifact                     | Where                  | Reads as                                                                                      |
| ---------------------------- | ---------------------- | --------------------------------------------------------------------------------------------- |
| Reference-over-replica sheet | `--out` path           | Row 1 reference, row 2 replica, one column per sampled time                                   |
| Red/cyan deviation overlay   | `<out>-overlay-NN.png` | Agreement grey, reference-only ink red, replica-only ink cyan                                 |
| Numbers                      | stdout and `--json`    | `ssim`, `meanAbsDiff`, `meanSignedDiff`, ink-box deltas `dw` / `dh` / `dcx` / `dcy` / `scale` |

How to read them:

- **`ssim`** is full-frame structural similarity, 1.0 = identical. What counts as good depends on the content, so read it against the floor below rather than against 1.0.
- **`meanAbsDiff` vs `meanSignedDiff`** separates two things a single number confuses. `meanSignedDiff` is the same average without the absolute value, so when the two are close the replica is uniformly lighter or darker, which is a level shift from encoding or colour conversion and not a mistake you can fix in the composition. Signed near zero with a large absolute value means the deviation is real and localized. The CLI prints it as `diff X% (bias +Y%)`.
- **Ink-box deltas** answer "is my title the right size and in the right place": `dw`/`dh` are the replica's ink bounding box minus the reference's in reference pixels, `dcx`/`dcy` the centre offset, `scale` the width ratio. They are meaningful for type and graphic frames; a full-bleed photograph makes every pixel ink and the box degenerates to the whole canvas.
- **The overlay** localizes the deviation the numbers only total up. A flat tint across the whole frame is the level shift `meanSignedDiff` already quantified; localized red/cyan ghosting is a position, size or timing error.

### The floor is set by content, not by your composition

A replica is a live browser paint; a reference is a decoded compressed video. The gap between those two decode paths is a floor no correction can go below, and it depends entirely on what is on screen. Measured against their own renders:

| Composition content       | Self-comparison SSIM                        | Why                                                                |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| Flat graphics and type    | 0.998–0.999                                 | Encodes near-losslessly; a real defect shows immediately           |
| Photographic video layers | ~0.93 at `--quality high`, ~0.89 at `draft` | Encode loss plus browser/FFmpeg colour conversion, visible as bias |

So a 0.93 on a video-backed composition can be a perfect rebuild, and a 0.98 on a typographic one is a real defect. Establish the floor before you read any number: compare the composition against its own render first, then treat that value as your zero.

Gate on it with `--fail-under <ssim>`, which exits non-zero when the worst sampled SSIM falls below the threshold:

```bash
npx hyperframes compare . --against reference.mp4 --at 0,4,10,21 --fail-under 0.95
```

There is no default threshold, deliberately: pick one just below the floor you measured above. A threshold guessed before measuring passes everything and gates nothing, and one copied from a graphics-only project will fail every video-backed build for no reason.

`--against` needs FFmpeg on PATH.

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
[{ "label": "warm", "grading": { "adjust": { "temperature": 0.2, "contrast": 0.1 } } }]
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
