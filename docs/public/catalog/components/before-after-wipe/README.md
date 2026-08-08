# before-after-wipe

Two full-bleed content panels compare a before and an after state. The before
panel stays fully visible as the base layer; the after panel wipes over it from
the left edge in one pass and the divider rests at `rest_split` percent for the
whole hold. The divider (and its knob) stays hidden until the wipe starts, then
fades in as it departs the left edge, so the lead-in never shows a half-clipped
handle. Label chips mark each side. This ports comparison-split's divider-wipe mechanic onto real
content slots: you supply the two visuals, the primitive supplies the wipe.

## Files

- `before-after-wipe.html`: the mountable sub-composition (install target:
  `compositions/components/before-after-wipe.html`).
- `registry-item.json`: registry metadata and the variables block.

## Variables

| id           | type   | default  | notes                                                          |
| ------------ | ------ | -------- | -------------------------------------------------------------- |
| `label_a`    | string | `Before` | chip on the base panel; empty string hides it                  |
| `label_b`    | string | `After`  | chip on the revealed panel; empty string hides it              |
| `rest_split` | number | `50`     | divider resting position, 0 to 100 percent                     |
| `wipe_at`    | number | `0.25`   | seconds after mount start when the wipe begins (0 to 8)        |
| `accent`     | enum   | `green`  | `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2` |
| `exit`       | enum   | `none`   | `none` holds the final frame; `fade` and `up` release the stage |

Envelope: IN = `wipe_at` + 1.05s wipe travel, OUT = 0.5s only when `exit` is
`fade` or `up`, HOLD is the sole elastic phase. The `wipe-land` sync point
(`hf:sfx` id `wipe-land-soft`) fires when the divider lands, 1.30s at defaults.

## The slot mechanism

The primitive ships two named slot panels inside its `<template>`:

```html
<div class="baw-slot" data-slot="before"> ... </div>
<div class="baw-slot" data-slot="after"> ... </div>
```

Each slot's default children are a token-styled wireframe card (muted on the
before layer, brand-tinted on the after layer), so an untouched mount still
reads as a tasteful comparison. To show your own content, install the
component and **replace the children of each `[data-slot]` element in your
installed copy** (the runtime clones only the primitive's own template on
mount, so slot content lives in the component file, not on the host clip).

Rules:

- Both slots are full-bleed and share one coordinate space; align the two
  states so the wipe reads as one surface changing, not two images sliding.
- Direct `img`/`video` children are automatically sized to cover the panel
  (`object-fit: cover`). Arbitrary HTML works too; size it in `cqw`/`cqh`.
- Keep the label chips and divider alone; they render above slot content.

## Worked example

Install, then fill the slots with two screenshots:

```bash
npx hyperframes add before-after-wipe
```

In `compositions/components/before-after-wipe.html`, replace each slot's
default block:

```html
<div class="baw-slot" data-slot="before">
  <img src="../../assets/dashboard-old.png" alt="" />
</div>
...
<div class="baw-slot" data-slot="after">
  <img src="../../assets/dashboard-new.png" alt="" />
</div>
```

Mount it from a host composition like any sub-composition:

```html
<div
  class="clip"
  data-composition-id="before-after-wipe"
  data-composition-src="./components/before-after-wipe.html"
  data-variable-values='{"label_a":"v1","label_b":"v2","rest_split":62,"accent":"blue"}'
  data-start="2"
  data-duration="5"
  data-track-index="0"
></div>
```

The wipe starts 0.25s after the clip mounts, lands at 62 percent, and the
comparison holds still for the rest of the clip window (`exit` defaults to
`none`; frame roots own scene transitions).
