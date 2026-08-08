# segmentation-flood

Product demo / AI experiment primitive: a machine-vision read of a slotted
subject. Translucent accent segmentation masks FLOOD onto 2-4 regions in
scanline steps (rows arrive in 2-3 frame quanta: flood progress is
quantized to frame steps before any row is drawn), each completed region
gets a thin corner bracket plus a mono label chip, and a subtle HUD
flicker (a deterministic 2-frame luminance toggle) rides the pass, then
stops the instant the flood completes. Settles to a clean labeled read.
4.5s authored, elastic HOLD (never time-scaled).

Reference feel: the gmunk segmentation sheets (red masks flooding under
HUD flicker), tokenized to the contract palette.

## Mounting

```html
<div
  class="clip"
  data-composition-id="segmentation-flood"
  data-composition-src="./components/segmentation-flood.html"
  data-variable-values='{"regions":"Chassis, Payload, Horizon, Beacon","accent":"blue"}'
  data-start="0"
  data-duration="4.5"
  data-track-index="0"
></div>
```

## Subject slot

The subject is a slot. Place an inert template anywhere in the HOST page:

```html
<template data-slot="segmentation-flood-subject"> ...subject... </template>
```

Direct `img` / `video` children are stretched to cover the stage;
arbitrary HTML fills it. A missing slot falls back to a token scene: a
surface field with muted shapes seated where the default regions land.

## Variables

| id       | type   | default                | notes                                                                     |
| -------- | ------ | ---------------------- | ------------------------------------------------------------------------- |
| regions  | string | Figure, Signal, Ground | Comma label list; 2 to 4 used. One mask + bracket + chip per label.        |
| flood_at | number | 0.8                    | Seconds when the pass starts. Clamped so the pass and any exit fit inside the clip. |
| flicker  | enum   | on                     | on or off: the 2-frame HUD luminance toggle riding the pass.               |
| accent   | enum   | green                  | green maps to --brand, blue to --accent, violet to --accent-2.             |
| exit     | enum   | none                   | none holds the labeled read (frame roots own transitions); fade or up add a 0.45s departure. |

## Choreography

- 0.00s: the subject settles up quietly; no overlay.
- flood_at: region 1's mask starts flooding top to bottom in quantized
  scanline rows (a brighter leading row, hairline gaps for texture);
  regions stagger 0.35s apart, 1.0s of flood each.
- Each region completes: its corner brackets snap in and its mono chip
  rises on the same beat.
- Flood end: the flicker window closes; brackets, chips, and masks hold as
  one clean labeled read.
- HOLD: dead still, elastic with the clip duration.

Sync point `flood` fires as the pass starts; align SFX to it.

## Determinism

Region geometry, per-region flood quanta (2 or 3 frames), and scanline row
counts come from one table computed once at build from fixed LCG seed
0x5e6f100d. One plain-object anchor tween feeds one painter that redraws
every mask row and the flicker wash from scratch as pure functions of the
timeline time; the flicker is on exactly when floor(frame / 2) is odd
inside the flood window. Eventful seeks land identical frames in any order
and either direction; the raster basis is the host box measured once at
mount.
