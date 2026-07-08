# logo-reveal — category module

A **logo sting / brand lockup**. The logo is user-supplied, or resolved for a known brand (`resolve --type logo --entity <brand>`); `asset_needs` = one logo `source`. ~3–5s. Often `export: alpha-overlay` (sting to drop on other footage).

## Plan (Director)

`content`: `{ logo: <asset path>, tagline, url }`. Envelope: brand palette (or eyedropper from the logo), elegant pacing.

## Vocabulary / leans on

- Block: **`logo-outro`** (piece-by-piece assembly + glow bloom + tagline fade + URL pill).
- Rules: `rules/svg-path-draw` (draw-on for vector logos) · `rules/scale-swap-transition` · `rules/3d-text-depth-layers`.
- Primitives: draw-on / mask-reveal / particle-assemble · `glow` bloom · `underline_sweep` · hold.

## Build (reuse-first)

Reuse `logo-outro` + swap logo / tagline / url / palette; **or** hand-author: place the logo at its hero frame (CSS), reveal via draw-on (SVG `stroke-dashoffset`) or mask/scale, add a glow bloom + accent underline sweep, hold. For an SVG logo, prefer draw-on; for a raster logo, mask/scale + glow. Transparent bg when exporting as an overlay.
