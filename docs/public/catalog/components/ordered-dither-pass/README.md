# ordered-dither-pass

Wave M experiment (texture / transitions). Bayer-matrix ordered dithering
quantizes a slotted scene: the source is rasterized once at mount to a
reduced-resolution buffer (one dither pixel is about 3 display px, blitted
with image smoothing off), and every frame re-derives each output pixel
from (source pixel, Bayer threshold, the animated dither amount). With
direction `in` the image emerges from pure 2-tone noise (theme bg vs
accent) into posterized color and finally clean; `out` runs the ramp in
reverse and holds the noise. Ordered, parallel, frame-independent; never
error diffusion. 3.5s authored, elastic HOLD (never time-scaled).

## Mounting

```html
<div
  class="clip"
  data-composition-id="ordered-dither-pass"
  data-composition-src="./components/ordered-dither-pass.html"
  data-variable-values='{"matrix":"8","levels":3,"accent":"blue"}'
  data-start="0"
  data-duration="3.5"
  data-track-index="0"
></div>
```

## Scene slot

The source scene is a slot. Place an inert template anywhere in the HOST
page:

```html
<template data-slot="ordered-dither-pass-scene"> ...scene... </template>
```

The slot is rasterized through an SVG foreignObject snapshot, so content
must be self-contained: inline styles or rules carried by host `<style>`
tags (both are copied into the snapshot), data-URI images only, system or
already-active fonts. External resources do not load inside a snapshot.
A missing slot falls back to a token monogram tile rasterized
synchronously from contract tokens.

## Variables

| id        | type   | default | notes                                                              |
| --------- | ------ | ------- | ------------------------------------------------------------------ |
| matrix    | enum   | 4       | Bayer matrix size: 2 coarsest crosshatch, 4 classic, 8 smoothest grain. |
| direction | enum   | in      | in resolves noise to clean; out dissolves clean to noise and holds it. |
| levels    | number | 2       | Quantization levels per color channel during the dithered phase (2-6). |
| accent    | enum   | green   | Light tone of the 2-tone noise phase: green maps to --brand, blue to --accent, violet to --accent-2. |
| exit      | enum   | none    | none holds the final state (frame roots own transitions); fade or up add a 0.45s departure. |

## Choreography

- 0.00s: the field fades up over 0.25s in its start state (pure Bayer
  noise for `in`, the clean source for `out`).
- 0.40s: one scalar dither amount ramps across 1.6s (power1.inOut). For
  `in`: contrast emerges under the dither first, then the dither releases
  into the clean source over the last stretch of the ramp; the noise
  phase reads as a bg/accent duotone, the middle as posterized color.
- 2.00s: the ramp lands.
- HOLD: truly still (clean for `in`, pure noise for `out`), elastic with
  the clip duration.

Sync point `ramp` fires as the amount starts moving; align SFX to it.

## Determinism

The source buffer (a detached ImageData copy), the Bayer threshold table,
and every resolved color are fixed once at mount. One anchor tween spans
the full duration and the timeline's onUpdate rewrites one reused
ImageData end to end from those tables and the current time, then blits
it scaled with smoothing off. Stateless per frame: no Math.random, no
wall clock, no incremental state, so eventful seeks (suppressEvents
false) land identical frames in any order and either direction. The
no-slot monogram raster is drawn synchronously before the timeline
registers; a slotted raster arrives from the snapshot decode (page-load
scale, before capture begins) and repaints the current frame, after
which all frames are pure f(t).
