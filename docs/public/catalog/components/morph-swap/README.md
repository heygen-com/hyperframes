# morph-swap

Two slotted siblings sit absolutely stacked at one shared center. A holds
alone, then at `swap_at` it morphs into B through one of two registers, both
on a shared 50% 50% transform origin:

- **condense**: A shrink-fades toward center exactly as B scales up through
  the same silhouette (outgoing `power2.in`, incoming `back.out` with a
  0.15s overlap).
- **reshape**: A morphs its silhouette on `scaleX`/`scaleY` while fading, and
  B picks up from that mid-morph silhouette and relaxes to its natural shape.
  The reshape rides transforms only, never `width`/`height` tweens, so it
  stays layout-free and seek-safe.

You supply the two visuals through slots; the primitive supplies the morph.

## Files

- `morph-swap.html`: the mountable sub-composition (install target:
  `compositions/components/morph-swap.html`).
- `registry-item.json`: registry metadata and the variables block.
- `demo.html`: a 1920x1080 host that mounts the primitive with non-default
  variables (reshape register, violet accent).

## Variables

| id         | type   | default    | notes                                                                     |
| ---------- | ------ | ---------- | ------------------------------------------------------------------------- |
| `swap_at`  | number | `1.4`      | seconds after mount start when the morph begins (0.1 to 8)                |
| `register` | enum   | `condense` | `condense` shrink-fades at center; `reshape` morphs on scaleX/scaleY      |
| `accent`   | enum   | `green`    | `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2` |
| `exit`     | enum   | `none`     | `none` holds the final frame; `fade` and `up` release the stage           |

Envelope: IN = `swap_at` + the swap span (0.75s condense, 1.05s reshape),
OUT = 0.5s only when `exit` is `fade` or `up`, HOLD is the sole elastic
phase. The `morph-land` sync point (`hf:sfx` id `morph-land-soft`) fires when
the morph lands, 2.15s at defaults.

## The slot mechanism

The primitive ships two named slot panels inside its `<template>`:

```html
<div class="msw-slot" data-slot="a"> ... </div>
<div class="msw-slot" data-slot="b"> ... </div>
```

Each slot's default children are a token-styled card (a muted wireframe on
the outgoing side, a taller accent-tinted card on the incoming side), so an
untouched mount still reads as a deliberate morph. To show your own content,
install the component and **replace the children of each `[data-slot]`
element in your installed copy** (the runtime clones only the primitive's own
template on mount, so slot content lives in the component file, not on the
host clip).

Rules:

- Both slots center their content in one shared coordinate space; the morph
  reads best when A and B have visibly different silhouettes.
- Direct `img`/`video` children are capped at 84cqw by 84cqh and rounded with
  `--radius`. Arbitrary HTML works too; size it in `cqw`/`cqh`.
- The morph transforms the panel around the slot, so slot content needs no
  animation of its own; keep it static.

## Worked example

Install, then fill the slots with two visuals:

```bash
npx hyperframes add morph-swap
```

In `compositions/components/morph-swap.html`, replace each slot's default
block:

```html
<div class="msw-slot" data-slot="a">
  <img src="../../assets/logo-mark.png" alt="" />
</div>
...
<div class="msw-slot" data-slot="b">
  <img src="../../assets/cta-pill.png" alt="" />
</div>
```

Mount it from a host composition like any sub-composition:

```html
<div
  class="clip"
  data-composition-id="morph-swap"
  data-composition-src="./components/morph-swap.html"
  data-variable-values='{"register":"reshape","swap_at":1.0,"accent":"blue"}'
  data-start="2"
  data-duration="4"
  data-track-index="0"
></div>
```

A holds for the first second, reshapes into B, and B holds still for the
rest of the clip window (`exit` defaults to `none`; frame roots own scene
transitions).
