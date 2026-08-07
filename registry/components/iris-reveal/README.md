# iris-reveal

A circle clip-path opens from an authored origin (`iris_x`/`iris_y` percent)
revealing state B over state A in one confident pass, then holds still on B.
The classic register dims and desaturates the before state so the after state
lands in full color; `register: plain` leaves both states untouched. A thin
accent rim rides the exact iris edge while the pass runs and dissolves just
before the circle clears the frame corners. Clip-path only, seek-safe in both
directions.

## Files

- `iris-reveal.html`: the mountable sub-composition (install target:
  `compositions/components/iris-reveal.html`).
- `registry-item.json`: registry metadata and the variables block.
- `demo.html`: a 1920x1080 host that mounts the primitive with non-default
  variables (QA gallery input).

## Variables

| id         | type   | default | notes                                                                     |
| ---------- | ------ | ------- | ------------------------------------------------------------------------- |
| `iris_x`   | number | `50`    | iris origin, percent of frame width (0 to 100)                            |
| `iris_y`   | number | `50`    | iris origin, percent of frame height (0 to 100)                           |
| `open_at`  | number | `0.35`  | seconds after mount start when the iris begins opening (0 to 8)           |
| `register` | enum   | `color` | `color` dims and desaturates state A; `plain` leaves both states alone    |
| `accent`   | enum   | `green` | `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2` |
| `exit`     | enum   | `none`  | `none` holds the final frame; `fade` and `up` release the stage           |

Envelope: IN = `open_at` + 1.10s iris pass, OUT = 0.5s only when `exit` is
`fade` or `up`, HOLD is the sole elastic phase. The `iris-open` sync point
(`hf:sfx` id `iris-land-soft`) fires when the iris clears the frame, 1.45s at
defaults.

## The slot mechanism

The primitive ships two named slot panels inside its `<template>` (the
before-after-wipe convention):

```html
<div class="ir-slot" data-slot="before"> ... </div>
<div class="ir-slot" data-slot="after"> ... </div>
```

Each slot's default children are a token-styled wireframe card (muted on the
before layer, brand-tinted on the after layer), so an untouched mount still
reads as a tasteful reveal. To show your own content, install the component
and **replace the children of each `[data-slot]` element in your installed
copy** (the runtime clones only the primitive's own template on mount, so slot
content lives in the component file, not on the host clip).

Rules:

- Both slots are full-bleed and share one coordinate space; align the two
  states so the iris reads as one surface changing, not two images stacked.
- Direct `img`/`video` children are automatically sized to cover the panel
  (`object-fit: cover`). Arbitrary HTML works too; size it in `cqw`/`cqh`.
- With `register: color` the grayscale/dim treatment applies to whatever you
  put in the before slot; switch to `plain` if your before content must stay
  full color.
- Keep the rim SVG alone; it renders above slot content and is owned by the
  timeline.

## Worked example

Install, then fill the slots with two screenshots:

```bash
npx hyperframes add iris-reveal
```

In `compositions/components/iris-reveal.html`, replace each slot's default
block:

```html
<div class="ir-slot" data-slot="before">
  <img src="../../assets/scene-night.png" alt="" />
</div>
...
<div class="ir-slot" data-slot="after">
  <img src="../../assets/scene-day.png" alt="" />
</div>
```

Mount it from a host composition like any sub-composition:

```html
<div
  class="clip"
  data-composition-id="iris-reveal"
  data-composition-src="./components/iris-reveal.html"
  data-variable-values='{"iris_x":30,"iris_y":40,"open_at":0.6,"accent":"blue"}'
  data-start="2"
  data-duration="3.5"
  data-track-index="0"
></div>
```

The iris opens 0.6s after the clip mounts from a point in the upper-left
third, clears the frame 1.1s later, and the revealed state holds for the rest
of the clip window (`exit` defaults to `none`; frame roots own scene
transitions).
