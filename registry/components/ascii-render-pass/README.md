# ascii-render-pass

Wave M experiment (texture). A slotted scene renders as live ASCII: the
source is rasterized once at mount to an offscreen canvas, a luminance
summed-area table is built from it, and every frame draws one glyph per
cell from a density ramp charset. Resolution animates coarse to fine on a
stepped pitch ladder (5 steps, powers of sqrt(2)) at `resolve_at`, then
holds legible-fine. 4s authored, elastic HOLD (never time-scaled).

## Mounting

```html
<div
  class="clip"
  data-composition-id="ascii-render-pass"
  data-composition-src="./components/ascii-render-pass.html"
  data-variable-values='{"grid":"fine","resolve_at":1.2,"accent":"blue"}'
  data-start="0"
  data-duration="4"
  data-track-index="0"
></div>
```

## Scene slot

The source scene is a slot. Place an inert template anywhere in the HOST
page:

```html
<template data-slot="ascii-render-pass-scene"> ...scene... </template>
```

The slot is rasterized through an SVG foreignObject snapshot, so content
must be self-contained: inline styles or rules carried by host `<style>`
tags (both are copied into the snapshot), data-URI images only, system or
already-active fonts. External resources do not load inside a snapshot.
The DOM itself never displays; only its ASCII render does. A missing slot
falls back to a token monogram tile rasterized synchronously from
contract tokens.

## Variables

| id         | type   | default      | notes                                                             |
| ---------- | ------ | ------------ | ----------------------------------------------------------------- |
| charset    | string | " .:-=+*#%@" | Density ramp, dark to light. A leading space keeps dark cells empty. |
| grid       | enum   | med          | Final cell pitch: coarse (22 rows), med (36), fine (54).          |
| resolve_at | number | 1.4          | Seconds from mount start when the coarse-to-fine resolve begins. Clamped so the 1.2s resolve and any exit stay inside the clip. |
| accent     | enum   | green        | Glyph ink: green maps to --brand, blue to --accent, violet to --accent-2. |
| exit       | enum   | none         | none holds the fine render (frame roots own transitions); fade or up add a 0.45s departure. |

## Choreography

- 0.00s: the ASCII field fades up over 0.5s at the coarsest pitch (4x the
  final cell), a blocky glyph read of the scene.
- resolve_at: the pitch ladder steps coarse to fine over 1.2s. A stateless
  per-cell hash shimmer rides the steps so each re-sample feels live.
- resolve_at + 1.2s: the final pitch lands; shimmer amplitude is exactly
  zero from here on.
- HOLD: legible-fine, truly still, elastic with the clip duration.

Sync point `resolve` fires as the ladder starts; align SFX to it.

## Determinism

The raster, its summed-area table, and every resolved color are fixed
once at mount. One anchor tween spans the full duration and the
timeline's onUpdate repaints the canvas from scratch, a pure function of
(raster tables, timeline time). Cell shimmer is a stateless integer hash
of (column, row, ladder step). No Math.random, no wall clock, no
incremental state, so eventful seeks (suppressEvents false) land
identical frames in any order and either direction. The no-slot monogram
raster is drawn synchronously before the timeline registers; a slotted
raster arrives from the snapshot decode (page-load scale, before capture
begins) and repaints the current frame, after which all frames are pure
f(t).
