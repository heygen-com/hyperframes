# stitched-text-draw

Wave M experiment (M6). Text drawn as thread stitches: letters draw thread-first with a needle dot leading each stroke's reveal front, needle-hole dots appearing at every stitch boundary behind it, and a tiny thread-tail overshoot as each letter finishes (the thread sticks out past the stroke end along its exit tangent, then is pulled snug).

4s authored, elastic HOLD, exit `none` by default.

## Letter path approach

A single-stroke display alphabet (A-Z 0-9, plus space) authored as a compact stroke table inside the primitive: each glyph is a list of strokes, each stroke built from line points and flattened elliptical arcs in a 70x100 glyph box. At mount every stroke is resampled to even stitch-scale steps and displaced by seeded perpendicular jitter (fixed LCG seed `0x57174c3d`), so every stitch sits at a slightly different angle: the hand-sewn wobble. Letter x-offsets are baked into the points so all paths share one flat SVG coordinate space and a single global needle can read `getPointAtLength` coordinates directly.

## Draw mechanic (attribute dashoffset, no mask)

The reveal is ATTRIBUTE-driven `stroke-dashoffset` on the stitched path itself (gotcha 8: the CSS property leaves stale paint under reverse seeks; and SVG masks do not reliably repaint under seeks, so no `<mask>`/`<clipPath>`). Each path's dasharray is its stitch pattern (dash, gap, dash, ...) built to sum exactly to the measured path length `L` (via `getTotalLength`, never the `pathLength` attribute, never `non-scaling-stroke` on dashed paths), followed by one closing gap of `L` (total `2L`). Animating the dashoffset attribute from `L` to `0` sweeps the reveal front from start to end; the visible stitches slide the last few units into their final positions as the offset reaches zero, which reads as the thread being pulled through.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `text` | string | `STITCH` | Uppercased; A-Z 0-9 and space, other characters render as spaces; clamped to 12 characters. |
| `stitch` | enum | `fine` | `fine` (dash 6.5 / gap 4.5 / width 2.6) or `coarse` (dash 10 / gap 7 / width 4.2) in glyph units, with matching jitter amplitude. |
| `accent` | enum | `green` | Thread color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` departs opacity-only; `up` rises out. |

## Mount

```html
<div
  class="clip"
  data-composition-id="stitched-text-draw"
  data-composition-src="./stitched-text-draw.html"
  data-variable-values='{"text":"SEWN 24","stitch":"coarse","accent":"violet"}'
  data-start="0"
  data-duration="4"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `stitched-text-draw` key.

## Notes

- Zero per-element tweens (gotcha 9): one inert anchor tween spans the authored duration; a painter recomputes every stroke's dashoffset attribute, every hole's visibility, and the needle/tail pose as pure functions of `tl.time()` on each update. Idempotent writes; eventful seeks (`suppressEvents=false`) land identical frames in any order and either direction.
- Letters draw strictly in sequence (windows proportional to stitch length, fixed needle-jump pause between letters), so one global needle serves the whole word.
- The per-stroke ease is a backOut: the ~10% overshoot region past the stroke end is what drives the thread-tail (up to 16 glyph units), which retracts to zero as the ease settles.
- The hold is truly still: every stroke sits at dashoffset 0, all holes visible, needle and tail at opacity 0.
