# particle-image-reveal

A seeded deterministic particle field materializes a supplied image: accent particles converge and settle across the frame while the image reveals beneath them (left-to-right wipe or center iris, matching the particle sweep), the trail thinning until the last particle lands and the image holds clean.

4s authored, elastic HOLD, exit `none` by default.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `density` | enum | `med` | Particle count: `low` (320), `med` (640), `high` (1100). |
| `direction` | enum | `ltr` | `ltr` sweeps the reveal left to right; `center` opens an iris from the middle outward with particles converging inward. |
| `accent` | enum | `green` | Particle and monogram color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` departs opacity-only; `up` rises out. |

## Image slot

The image is a slot. Place an inert template anywhere in the HOST page (templates never render, and the runtime wipes the host clip's own children on mount, so the slot lives at document level):

```html
<template data-slot="particle-image-reveal-image">
  <img src="./assets/hero.png" alt="" />
</template>
```

Slot content may be an `<img>`, a muted `<video>`, or arbitrary HTML; direct img/video children are stretched to cover the stage. With no slot, the primitive renders a token monogram (surface tile, one display glyph, contract tokens only).

Particle targets are distributed across the whole stage, not sampled from the image's pixels; the synced wipe/iris is what binds field and image.

## Mount

```html
<div
  class="clip"
  data-composition-id="particle-image-reveal"
  data-composition-src="./particle-image-reveal.html"
  data-variable-values='{"direction":"center","accent":"violet","density":"high"}'
  data-start="0"
  data-duration="4"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `particle-image-reveal` key.

## Notes

- Deterministic canvas: one per-particle attribute table is built once from fixed LCG seed `0x50a71c1e`; every painted frame is a pure function of (table, timeline time). The timeline's `onUpdate` clears and repaints from scratch, so eventful seeks (`suppressEvents=false`, the engine's render path) land byte-identical frames in any order and either direction.
- By the end of IN every particle's alpha is exactly zero: the HOLD canvas is a single clear rect, so the hold is truly still.
- The canvas raster is sized once at mount from the host box and devicePixelRatio (capped at 2); the same host always yields the same raster.
- The hold is truly still by design: a fractional transform drift would re-raster the slot/canvas layer at seek-history-dependent subpixel offsets and break byte-identical frames, so the reveal supplies the life and the hold supplies calm.
