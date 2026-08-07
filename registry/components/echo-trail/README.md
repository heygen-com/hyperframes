# echo-trail

The generalized onion skin: a moving element renders with N ghosted copies of itself, each ghost showing the element where it was at t minus i * delta, opacity stepped down per ghost. One traversal along an authored path; as the element decelerates into rest the echoes collapse into it and vanish, leaving a clean settled hold.

3.5s authored, elastic HOLD, exit `none` by default.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `echoes` | number | `4` | Ghost copy count, clamped 2 to 6. |
| `delta` | number | `0.09` | Lag between successive ghosts in seconds, clamped 0.03 to 0.3. |
| `path` | enum | `sweep` | `sweep` is a shallow S left to right; `rise` climbs bottom-center to upper-center; `arc` rises over the top left to right. |
| `accent` | enum | `green` | Subject accent color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` departs opacity-only; `up` rises out. |

## Subject slot

The subject is a slot. Place an inert template anywhere in the HOST page (templates never render, and the runtime wipes the host clip's own children on mount, so the slot lives at document level):

```html
<template data-slot="echo-trail-subject">
  <div class="my-badge">Shipped</div>
</template>
```

Ghosts are deep clones of the subject content. With no slot, the primitive renders a token card (surface, hairline border, accent dot, two skeleton lines, contract tokens only).

## Mount

```html
<div
  class="clip"
  data-composition-id="echo-trail"
  data-composition-src="./echo-trail.html"
  data-variable-values='{"path":"arc","echoes":5,"delta":0.12,"accent":"violet"}'
  data-start="0"
  data-duration="3.5"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `echo-trail` key.

## Notes

- Deterministic: ghost i's position at time t is `path(ease(clamp01((t - i * delta) / travel)))` and its opacity is its stepped base times a separation ramp (distance to the lead); both are recomputed from `tl.time()` on every update. No Math.random, no wall clock, no incremental state; eventful seeks (`suppressEvents=false`, the engine's render path) land identical frames in any order and either direction.
- The separation ramp is what makes the echoes collapse: before motion starts and after the lead rests, every ghost is coincident with the lead and its opacity is exactly zero, so the HOLD is truly still.
- Ghosts render beneath the lead (inserted before it) with a slight per-ghost scale step for depth; transforms are set once at mount, per-update writes touch only left/top/opacity.
- The envelope accounts for the tail: `IN = travel + echoes * delta + settle`, so the last ghost has converged inside IN even at the largest lag.
