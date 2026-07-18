# modal-morph

The shared-element grow (Wave M9 experiment): a small card expands into a full panel with its children re-flowing continuously. FLIP-style: both layouts are real DOM measured exactly once at mount; the morph interpolates the container rect and applies it as transform only (translate + scaleX/scaleY, never width/height tweens) while keyed children counter-scale against the container and travel onto the lerp of their own two measured rects, all as pure functions of timeline time.

4s authored, elastic HOLD, exit `none` by default.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `from_scale` | number | `1` | Multiplies the authored card footprint before the one-time measurement, clamped 0.5 to 1.5. |
| `expand_at` | number | `1.2` | Seconds after mount when the grow begins. |
| `register` | enum | `calm` | `calm` is a smooth inOut cubic; `snappy` is faster with a settle that never overshoots the target rect beyond 1.02. |
| `accent` | enum | `green` | green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` departs opacity-only; `up` rises out. |

## Card content slot

Place an inert template anywhere in the HOST page:

```html
<template data-slot="modal-morph-card">
  <div data-morph-key="icon" class="my-icon"></div>
  <div data-morph-key="name">Invoice #204</div>
</template>
```

The slot content is cloned into BOTH the card body and the panel head, so every `data-morph-key` has a measured rect in each layout and re-flows between them during the morph. Slot content without any keys is wrapped and morphs as one block. With no slot, the primitive renders token defaults (accent dot, display title line, mono meta line) that re-flow from a stacked card to an inline panel header row.

Panel furniture (skeleton tile grid, footer chips) is panel-only and fades up over the back half of the morph.

## Mount

```html
<div
  class="clip"
  data-composition-id="modal-morph"
  data-composition-src="./modal-morph.html"
  data-variable-values='{"register":"snappy","from_scale":0.8,"accent":"blue","expand_at":0.9}'
  data-start="0"
  data-duration="4"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `modal-morph` key.

## Notes

- The FLIP law: measure once, then transform-only. Container scale is `lerpRect(card, panel, ease(p))` against the panel's natural size; each matched child sets `scale = want / (home * containerScale)` and a translate expressed in the scaled container space, so content re-flows instead of stretching.
- The card and panel are separate authored layers that crossfade in the first 30% of the morph (both run the same rect math, mirrored), so each endpoint is pixel-crisp in its own styling.
- `snappy` uses a back-out ease with c1 = 0.7 (analytic peak 1.0176 of the rect delta), under the 1.02 cap.
- Deterministic: no Math.random, no wall clock, no incremental state; measurement happens synchronously at mount and every later frame is recomputed from `tl.time()` alone, so eventful seeks land identical frames in any order and either direction.
