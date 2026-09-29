# cursor-glyph-trail

A tutorial cursor path. On a Settings screen the arrow clicks through three steps: turn on the email digest, pick Weekly, save. Each move leaves a dotted trail spaced evenly by distance (not by time), each click leaves a numbered step marker, and a step's trail fades as the next move begins, so a viewer can follow the path without the screen filling with noise. The markers stay, so the last frame reads as the recap.

3.5s authored, elastic HOLD, exit `none` by default.

## Variables

| id        | type   | default | notes                                                                                            |
| --------- | ------ | ------- | ------------------------------------------------------------------------------------------------ |
| `glyphs`  | string | `""`    | Deprecated and ignored; still accepted so existing mounts keep working.                          |
| `density` | enum   | `med`   | Spacing between trail dots: `low` (30), `med` (21), `high` (15) px at 1920 wide.                 |
| `path`    | enum   | `sweep` | How each move bends: `sweep` a gentle curve, `arc` a deeper one, `zigzag` a straight line.       |
| `fade`    | number | `0.5`   | Seconds a step trail takes to fade once the next move begins, clamped 0.3 to 1.5.                |
| `accent`  | enum   | `green` | Trail and marker color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit`    | enum   | `none`  | `none` holds until the cut; `fade` departs opacity-only; `up` rises out.                         |

## Actor slot

The arrow can be replaced. Place an inert template anywhere in the HOST page (templates never render, and the runtime wipes the host clip's own children on mount, so the slot lives at document level); its content is centred on the click point:

```html
<template data-slot="cursor-glyph-trail-actor">
  <img src="./assets/cursor.svg" alt="" style="width: 4cqmin" />
</template>
```

With no slot, the component draws the family arrow (64 px at 1920 wide).

## Mount

```html
<div
  class="clip"
  data-composition-id="cursor-glyph-trail"
  data-composition-src="./cursor-glyph-trail.html"
  data-variable-values='{"path":"sweep","density":"med","accent":"green"}'
  data-start="0"
  data-duration="3.5"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `cursor-glyph-trail` key.

## Notes

- Seek-safe: every frame is `render(t)`. The trail at time t is the part of each move's curve the cursor has covered by t, so seeking in any order lands the same frame.
- Dots are a round-capped zero-length dash pattern along the covered part of the curve, which is what spaces them by distance.
- Shorter durations compress every beat evenly.
