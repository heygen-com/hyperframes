# Reading the keyframes surface

`npx hyperframes keyframes` prints one block per tween (and one per **trace** when an element draws in multiple strokes — see `multi-stroke.md`). It's data, not a picture — to _see_ the motion, use `--shot` (the onion-skin render). Use `--json` for exact numbers or when you're an agent computing edits.

## A single tween block

```
#hero position  to/keyframes  @1s→4.4s (3.4s)
  0% {x:0 y:0}  33% {x:-180 y:-60}  67% {x:-320 y:40}  100% {x:-460 y:-20}
```

- **`#hero position`** — target selector + property group (`position` / `scale` / `rotation` / …).
- **`to/keyframes`** — method (`to` / `from` / `fromTo` / `set`) + shape: `keyframes` (multi-stop), `flat` (2-point to/from), or `motionPath` (arc).
- **`@1s→4.4s (3.4s)`** — absolute timeline window. Each `%` on the keyframe line is **tween-relative** (0% = tween start, 100% = tween end).
- **keyframe line** — every stop with its properties. x/y are GSAP **offset** pixels (translate from the element's CSS home; +x right, +y down); rotation / scale / opacity / colour appear when animated.

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

- `tweens` always lists every tween. `traces` is **additive** — the same strokes also appear as individual entries in `tweens`.
- `path` carries x/y forward across keyframes that set only one axis (GSAP holds the last value), so it's continuous.
- `time` is absolute seconds = `start + pct/100 * duration`.
