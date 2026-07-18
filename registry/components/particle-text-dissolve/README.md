# particle-text-dissolve

Text assembles FROM a seeded particle cloud, or dissolves TO it: per-particle target positions are sampled ONCE at mount from the rendered text bitmap (the token-styled line is rastered to an offscreen canvas and read back with getImageData), then the field runs table-driven with zero per-particle tweens and one `onUpdate` painter. Direct donor: particle-image-reveal.

4s authored, elastic HOLD, exit `none` by default. Wave M experiment (watch page only, not on the hero shelf).

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `text` | string | `Dissolve` | The line that assembles or dissolves. Sized to fit at mount (up to 86% of the stage width). |
| `direction` | enum | `in` | `in` assembles the line from the cloud and holds it crisp; `out` erases the line left to right into the cloud and holds empty. |
| `density` | enum | `med` | Particle count cap: `low` (900), `med` (1700), `high` (2800). |
| `accent` | enum | `green` | Text and particle color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` departs opacity-only; `up` rises out. |

## Mount

```html
<div
  class="clip"
  data-composition-id="particle-text-dissolve"
  data-composition-src="./particle-text-dissolve.html"
  data-variable-values='{"text":"Particles","direction":"in","density":"high","accent":"violet"}'
  data-start="0"
  data-duration="4"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `particle-text-dissolve` key.

## Notes

- Bitmap sampling happens exactly once, synchronously at mount: the line is drawn to an offscreen canvas with the DOM line's computed font stack and a fitted pixel size, lit cells on a deterministic grid become targets, and the set is thinned to the density cap with fixed LCG seed `0x9d1550f7` (one draw per cell, grid order). The crisp DOM line locks to the same family and device-pixel size, so targets sit on the glyphs it draws.
- Every painted frame is a pure function of (table, timeline time): the anchor tween's `onUpdate` clears and repaints the whole field. No Math.random, no wall clock, no incremental state, so eventful seeks (`suppressEvents=false`, the engine's render path) land byte-identical frames in any order and either direction.
- The reveal (or erase) front sweeps left to right for both directions; the DOM line's clip-path wipe rides the same front. By the end of IN every particle's alpha is exactly zero: the HOLD canvas is one clear rect, holding either the crisp themable DOM line (`in`) or an empty stage (`out`).
- The canvas raster is sized once at mount from the host box and devicePixelRatio (capped at 2); the same host always yields the same raster and the same particle table.
