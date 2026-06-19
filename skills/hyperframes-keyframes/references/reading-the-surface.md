# Reading the keyframes surface

`npx hyperframes keyframes` prints one block per tween (and one per **trace** when an element draws in multiple strokes — see `multi-stroke.md`). Use `--json` when you need exact numbers or you're an agent computing edits.

## A single tween block

```
#puck-b position  to/keyframes  @1s→4.4s (3.4s)
  0% {x:0 y:0}  33% {x:-180 y:-60}  67% {x:-320 y:40}  100% {x:-460 y:-20}
  ┌──────────────────────┐
  │              1·       │
  │            ··  ··     │
  │ 3·       ··      ·0   │
  │    ·· ·2·             │
  └──────────────────────┘
  x -460..0   y -60..40 (gsap px; marks 0..n = keyframe order)
```

- **`#puck-b position`** — target selector + property group (`position` / `scale` / `rotation` / …).
- **`to/keyframes`** — method (`to` / `from` / `fromTo` / `set`) + shape: `keyframes` (multi-stop), `flat` (2-point to/from), or `motionPath` (arc).
- **`@1s→4.4s (3.4s)`** — absolute timeline window. Each `%` on the keyframe line is **tween-relative** (0% = tween start, 100% = tween end).
- **keyframe line** — every stop with its properties.
- **grid** — the position path in GSAP **x/y offset pixels** (translate from the element's CSS home; +x right, +y down on screen). Marks `0,1,2,…0-9 then a-z` are keyframes in order; light `·` traces the path between them.
- **axis line** — the real `x`/`y` value ranges (trust these — see scale caveat below).

## Scale caveat — the grid autoscales each axis independently

The grid stretches x and y **separately** to fill its ~48×11 cells, so the visual **aspect ratio is not faithful**: a tall-narrow glyph can render wide-flat, a small wiggle can look huge. The _shape topology_ (order, crossings, which way it bends) is reliable; the _proportions_ are not.

- Read the printed `x …` / `y …` ranges, not the visual width/height.
- When proportion matters, work from the numbers (or `--json`), not the picture.
- Don't "fix" a shape that only looks distorted because of the grid — re-check the actual coords first.

Vertical resolution (~11 rows) is the tighter limit; very fine detail (a small loop, closely-spaced stops) can sit below what the grid can show. If edits stop changing the picture but the numbers still differ, you've hit the resolution floor — trust `--json`.

## Dense paths

A gesture path with many points (> ~36 for a single tween, > 62 across a trace) can't label every keyframe in 1-char cells, so it marks only **`S`** (start) and **`E`** (end) and traces the rest with `·`. The exact per-point values still live in the keyframe line and in `--json`.

## When the grid is omitted

Simple 2-point single-axis slides (a plain `to({x})`, an entrance) print only the keyframe line — there's no shape to draw. Multi-keyframe or both-axes paths always plot.

## `--json` shape (for agents / exact edits)

```jsonc
{
  "project": "my-project",
  "compositions": [
    {
      "composition": "index.html",
      "source": "index.html",
      "tweens": [
        {
          "id": "#dot-to-0-position",
          "target": "#dot",
          "method": "to",
          "group": "position",
          "start": 0, "duration": 3, "end": 3,
          "shape": "keyframes",
          "keyframes": [
            { "pct": 0,   "time": 0,   "properties": { "x": 0,   "y": 0 } },
            { "pct": 50,  "time": 1.5, "properties": { "x": 200, "y": -100 } },
            { "pct": 100, "time": 3,   "properties": { "x": 0,   "y": 0 } }
          ],
          "path": [ { "x": 0, "y": 0 }, { "x": 200, "y": -100 }, { "x": 0, "y": 0 } ]
        }
      ],
      "traces": [
        // present when an element has ≥2 drawn position strokes; see multi-stroke.md
        { "target": "#dot", "strokes": [ { "id": "...", "start": 0, "end": 1, "keyframes": [ ... ], "points": [ ... ] }, ... ] }
      ]
    }
  ]
}
```

- `tweens` always lists every tween (back-compatible). `traces` is **additive** — the same strokes also appear as individual entries in `tweens`.
- `path` carries x/y forward across keyframes that set only one axis (GSAP holds the last value), so it's continuous.
- `time` is absolute seconds = `start + pct/100 * duration`.
