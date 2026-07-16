# whip-pan-cut

The louder sibling of cut-the-curve: scene A whips off laterally with
directional motion blur while scene B enters in the same direction at matched
velocity, on a speed-ramp profile (accelerate, fast middle, decelerating
catch). Both scenes ride one strip, with B docked one frame-width beyond A
along the travel direction, so the pan crosses a single continuous surface and
the seam velocity is exact by construction. The blur is a capped directional
SVG feGaussianBlur on the mover only, peaking at mid-whip and resolving to 0
at both ends; a hairline accent seam rides the scene boundary and is visible
only while the whip runs.

## Files

- `whip-pan-cut.html`: the mountable sub-composition (install target:
  `compositions/components/whip-pan-cut.html`).
- `registry-item.json`: registry metadata and the variables block.
- `demo.html`: a 1920x1080 host that mounts the primitive with non-default
  variables (QA gallery input).

## Variables

| id          | type   | default | notes                                                                     |
| ----------- | ------ | ------- | ------------------------------------------------------------------------- |
| `direction` | enum   | `left`  | shared travel direction for both scenes (`left` or `right`)               |
| `whip_at`   | number | `0.25`  | seconds after mount start when the whip begins (0 to 8)                   |
| `accent`    | enum   | `green` | `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2` |
| `exit`      | enum   | `none`  | `none` rests on scene B until the frame cuts; `fade` and `up` depart it   |

Envelope (transition profile, no elastic HOLD law; cut-the-curve precedent):
LEAD = `whip_at` rest on scene A, WHIP = 0.55s power3.inOut, REST = elastic
remainder still on scene B, EXIT tail = min(0.35s, 25% of D) only when `exit`
is enabled. A short clip window may end while the catch is still decelerating.
The `whip-cut` sync point (`hf:sfx` id `whip-cut`) fires at peak velocity,
0.53s at defaults. Retime range 0.6s to 3s.

## The slot mechanism

The primitive ships two named slot panels inside its `<template>` (the
before-after-wipe convention):

```html
<div class="wpc-slot" data-slot="before"> ... </div>
<div class="wpc-slot" data-slot="after"> ... </div>
```

Each slot's default children are a token-styled wireframe card (muted on the
before layer, brand-tinted on the after layer), so an untouched mount still
reads as a real scene change. To show your own content, install the component
and **replace the children of each `[data-slot]` element in your installed
copy** (the runtime clones only the primitive's own template on mount, so slot
content lives in the component file, not on the host clip).

Rules:

- Both slots are full-bleed. Scene B is automatically positioned one
  frame-width beyond scene A along the travel direction; author both as
  normal full-frame scenes.
- Direct `img`/`video` children are automatically sized to cover the panel
  (`object-fit: cover`). Arbitrary HTML works too; size it in `cqw`/`cqh`.
- Keep the seam hairline and the blur filter alone; both are owned by the
  timeline, and the filter must stay on the strip (the mover) only.

## Worked example

Install, then fill the slots with two screenshots:

```bash
npx hyperframes add whip-pan-cut
```

In `compositions/components/whip-pan-cut.html`, replace each slot's default
block:

```html
<div class="wpc-slot" data-slot="before">
  <img src="../../assets/scene-dashboard.png" alt="" />
</div>
...
<div class="wpc-slot" data-slot="after">
  <img src="../../assets/scene-editor.png" alt="" />
</div>
```

Mount it from a host composition like any sub-composition:

```html
<div
  class="clip"
  data-composition-id="whip-pan-cut"
  data-composition-src="./components/whip-pan-cut.html"
  data-variable-values='{"direction":"right","whip_at":0.3,"accent":"blue"}'
  data-start="4"
  data-duration="1.2"
  data-track-index="0"
></div>
```

Scene A rests for 0.3s, the whip screams right over 0.55s with the blur
peaking at the midpoint, and scene B rests for the remainder of the clip
window (`exit` defaults to `none`; frame roots own scene transitions).
