# halftone-dissolve

Transition texture primitive: scene A dissolves into scene B through a
growing halftone dot field. Accent ink dots pop onto a fixed staggered grid
smallest-first, each dot then opens into a circular window onto B (the ink
leads the window by a beat, so every site flashes accent before B fills it),
until the windows merge and B fully replaces A. Radius per dot is a pure
function of (grid position, progress) via a seeded threshold map; the
direction enum orders the thresholds. 3.5s authored, elastic HOLD on B
(never time-scaled).

## Mounting

```html
<div
  class="clip"
  data-composition-id="halftone-dissolve"
  data-composition-src="./components/halftone-dissolve.html"
  data-variable-values='{"direction":"center","dot_size":"large","accent":"blue"}'
  data-start="0"
  data-duration="3.5"
  data-track-index="0"
></div>
```

## Scene slots

Both scenes are slots. Place inert templates anywhere in the HOST page:

```html
<template data-slot="halftone-dissolve-a"> ...outgoing scene... </template>
<template data-slot="halftone-dissolve-b"> ...incoming scene... </template>
```

Direct `img` / `video` children are stretched to cover the stage; arbitrary
HTML is centered. A missing slot falls back to a token monogram tile
(A neutral on `--muted`, B tinted by the accent).

## Variables

| id          | type   | default | notes                                                                |
| ----------- | ------ | ------- | -------------------------------------------------------------------- |
| dot_size    | enum   | medium  | small, medium, or large grid pitch (host width / 44, 30, 20).         |
| direction   | enum   | ltr     | ltr sweeps left to right, center grows from the middle, noise is a pure seeded scatter. |
| dissolve_at | number | 1.1     | Seconds from mount start when the dissolve begins. Clamped so the 1.3s dissolve and any exit stay inside the clip. |
| accent      | enum   | green   | green maps to --brand, blue to --accent, violet to --accent-2. Colors the ink dots. |
| exit        | enum   | none    | none holds scene B (frame roots own transitions); fade or up add a 0.45s departure. |

## Choreography

- 0.00s: scene A holds clean; no dots.
- dissolve_at: the field starts. Dots appear smallest-first in threshold
  order (with a seeded jitter so the front stays granular, never ruled),
  each as accent ink, then opening into a window onto B.
- dissolve_at + 1.3s: the windows merge past full coverage; the clip path
  releases and B holds clean.
- HOLD: dead still on B, elastic with the clip duration.

Sync point `dissolve` fires as the field starts; align SFX to it.

## Determinism

The grid and its threshold map are computed once at build from a fixed LCG
seed. One plain-object progress tween feeds one painter that redraws the
ink canvas from scratch and rebuilds B's clip-path string, all pure
functions of progress, so eventful seeks land identical frames in any order
and either direction. The raster and clip-path basis is the host box
measured once at mount.
