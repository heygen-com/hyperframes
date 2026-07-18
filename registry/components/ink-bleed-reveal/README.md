# ink-bleed-reveal

Liquid ink blooms through paper to reveal a mark: several ink blobs bleed outward from the drop point, merge like liquid under the gooey filter (feGaussianBlur + a hard feColorMatrix alpha threshold), then the puddle contracts and dies as the crisp mark resolves beneath it. A seeded, static paper-grain overlay (feTurbulence, fixed seed) rides the whole piece.

4s authored, elastic HOLD, exit `none` by default. Wave M experiment (watch page only, not on the hero shelf).

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `blobs` | number | `5` | How many ink blobs bleed and merge, clamped 4 to 6. |
| `accent` | enum | `green` | Ink tint: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. The ink body is the accent mixed toward `--fg` so it reads as pigment. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` departs opacity-only; `up` rises out. |

## Mark slot

The mark is a slot. Place an inert template anywhere in the HOST page (templates never render, and the runtime wipes the host clip's own children on mount, so the slot lives at document level):

```html
<template data-slot="ink-bleed-reveal-mark">
  <img src="./assets/logo.svg" alt="" style="width: 40cqmin" />
</template>
```

With no slot, the primitive renders a token monogram: one display glyph in an ink-colored ring, contract tokens only. Light paper is the home register, but every color rides a token so themes restate it.

## Mount

```html
<div
  class="clip"
  data-composition-id="ink-bleed-reveal"
  data-composition-src="./ink-bleed-reveal.html"
  data-variable-values='{"blobs":6,"accent":"blue"}'
  data-start="0"
  data-duration="4"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `ink-bleed-reveal` key.

## Notes

- The gooey read comes from the blur-to-threshold ratio, not the blur alone: a Gaussian blur (radius scaled from the host box at mount) softens the blob silhouettes together, then the colormatrix threshold (alpha slope 22, intercept -9) snaps the merged alpha back to a crisp liquid edge. Skipping the threshold step yields smudge, not goo. The chain is the classic SVG `feGaussianBlur` + `feColorMatrix` recipe, computed in a low-resolution canvas work buffer each repaint: Chrome's live SVG/CSS filter raster patches damaged tiles with seek-history-dependent seam antialiasing, while a cleared, fully redrawn canvas lands byte-identical frames.
- Closed-form field, no physics: one per-blob parameter table is built once from fixed LCG seed `0x1b1eedca`; every painted frame positions each blob as a pure function of (table row, timeline time) inside the anchor tween's `onUpdate`. Zero per-blob tweens, no velocities, no integration, so eventful seeks (`suppressEvents=false`) land identical frames in any order and either direction.
- By the end of IN every blob is dead and the goo canvas is one clear rect; the paper grain is painted by a fixed-seed `feTurbulence` and never animated. The HOLD is therefore byte-still: the crisp mark on quiet paper.
- Cost note: each repaint blurs and thresholds a third-resolution buffer (one `getImageData` readback per frame); fine at watch-page sizes, but avoid mounting several instances of this primitive on one frame.
