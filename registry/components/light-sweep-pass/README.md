# light-sweep-pass

A traveling key light re-shades a slotted scene: a soft diagonal gradient
band crosses the frame once while every per-element highlight and shadow
shifts in lockstep, then the light settles into a resting key from the upper
third. Quiet, expensive-feeling; the scene itself never moves.

One custom property owns the whole pass: the timeline writes `--light-x`
(a unitless frame-percent scalar on `#root`) and nothing else. The band's
translate, every highlight bloom, every shadow offset, and the ambient lift
read it through `calc()`/`clamp()`/`max()` in static CSS, so seeks in any
order resolve identical frames.

Reference: the ordinaryfolk traveling light band (motion-reference
`ordinaryfolkco/2001090228958752945`).

## Files

- `light-sweep-pass.html`: the mountable sub-composition (install target:
  `compositions/components/light-sweep-pass.html`).
- `registry-item.json`: registry metadata and the variables block.
- `demo.html`: a full-bleed 1920x1080 LIGHT host that mounts the primitive
  with non-default variables (QA gallery input).

## Variables

| id         | type   | default    | notes                                                                     |
| ---------- | ------ | ---------- | ------------------------------------------------------------------------- |
| `angle`    | number | `115`      | band and highlight gradient angle in degrees (60 to 160)                  |
| `sweep_at` | number | `0.9`      | seconds after mount start when the band starts crossing (0 to 8)          |
| `strength` | enum   | `standard` | `subtle` halves the band opacity and highlight bloom                      |
| `accent`   | enum   | `green`    | `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2` |
| `exit`     | enum   | `none`     | `none` holds the settled key; `fade` and `up` release the stage           |

Envelope: IN = `sweep_at` + 1.60s crossing + 0.55s settle, OUT = 0.5s only
when `exit` is `fade` or `up`, HOLD is the sole elastic phase. The
`sweep-land` sync point (`hf:sfx` id `light-settle-soft`) fires when the
light reaches its resting key, 3.05s at defaults.

## The slot mechanism

The primitive ships one named full-bleed slot inside its `<template>`:

```html
<div class="lsp-scene" data-slot="scene"> ... </div>
```

The default children are a token hero card and three feature cards, so an
untouched mount still reads as a tasteful pass. To light your own scene,
install the component and **replace the children of the `[data-slot="scene"]`
element in your installed copy** (the runtime clones only the primitive's own
template on mount, so slot content lives in the component file, not on the
host clip).

Opting elements into the light:

- Add `data-lit` to any element that should catch highlights and cast a
  moving shadow, and give it an inline `style="--lsp-x: NN"` where NN is the
  element's center along the sweep axis (percent of frame width, roughly its
  horizontal center for the default angles).
- Elements without `data-lit` only receive the band wash and the ambient
  lift; nothing else touches them.
- Highlights inherit the element's `border-radius`; give lit elements a
  solid background so the bloom and shadow read.
- Keep the `.lsp-ambient` and `.lsp-band` layers alone; they render above
  slot content and are owned by the timeline.

## Worked example

```bash
npx hyperframes add light-sweep-pass
```

In `compositions/components/light-sweep-pass.html`, replace the slot's
default block:

```html
<div class="lsp-scene" data-slot="scene">
  <img src="../../assets/dashboard.png" alt="" style="width:100%;height:100%;object-fit:cover" />
  <div
    data-lit
    style="--lsp-x: 64; position:absolute; left:52%; top:30%; width:24%; height:40%"
  ></div>
</div>
```

Mount it from a host composition like any sub-composition:

```html
<div
  class="clip"
  data-composition-id="light-sweep-pass"
  data-composition-src="./components/light-sweep-pass.html"
  data-variable-values='{"angle":128,"sweep_at":0.6,"accent":"blue"}'
  data-start="2"
  data-duration="4"
  data-track-index="0"
></div>
```

The scene settles, the band crosses 0.6s after mount over 1.6s, the key
glides back to its resting position, and the lit scene holds for the rest of
the clip window (`exit` defaults to `none`; frame roots own transitions).
