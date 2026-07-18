# stop-motion-cadence

The stepped-time law as a demo primitive (Wave M10 experiment). ONE driver quantizes timeline time FIRST, `ts = floor(t * fps) / fps`, and `ts` feeds ALL motion: four token paper-cut shapes throw-and-land in sequence at the quantized cadence, each squashing on its landing hit and recovering over the next steps, with a 2-frame boil jitter on edges (seeded per boil window, stable within it) and sparkle accents living exactly 2 or 3 steps on each hit, frame-alternating big / small-rotated like a drawn twinkle. Reference: the MotionMarkus stop-motion sheets.

4s authored, elastic HOLD (the boil keeps breathing through the hold; `boil: off` holds dead still), exit `none` by default.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `fps` | enum | `10` | Stepped-time cadence: `8`, `10`, or `12` frames per second. |
| `boil` | enum | `on` | 2-frame edge jitter hashed from `floor(step / 2)`. `off` gives a dead-still settle. |
| `accent` | enum | `green` | Lead shape color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`; the other shapes take the remaining two tokens in rotation. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` departs opacity-only; `up` rises out. |

## Mount

```html
<div
  class="clip"
  data-composition-id="stop-motion-cadence"
  data-composition-src="./stop-motion-cadence.html"
  data-variable-values='{"fps":"8","accent":"blue"}'
  data-start="0"
  data-duration="4"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `stop-motion-cadence` key.

## Notes

- The law: quantize before evaluating. Every hit is an integer step index (`landStep = round(t_land * fps)`), squash is a per-step envelope over `step - landStep`, boil seeds hash `floor(step / 2)`, sparkles are visible iff `0 <= step - landStep < life`. Because all state derives from the quantized driver, eventful seeks land identical frames forward, reverse, or shuffled.
- Squash uses `transform-origin: 50% 100%` so shapes compress into the floor contact; contact shadows grow and darken as each shape nears the ground.
- Deterministic: the jitter hash is a sin-fold over integer indices; no Math.random, no wall clock, no incremental state. Stage size is measured once at mount; per-update writes are transforms and opacity only.
- If the mount duration is shorter than the 3s choreography, the throw times compress together, but the fps grid itself never scales; the cadence is absolute.
