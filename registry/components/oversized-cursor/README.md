# oversized-cursor

The look-here pointer for a video: the family macOS arrow at 3.5x its normal size (224px box at 1920 wide) enters from off-screen, lands its tip on a caller-positioned control, clicks it (the control switches on in the accent blue with a check), settles just below it so the result stays in view, then accelerates off-screen.

2.6s authored, elastic HOLD; the cursor's own physical off-screen exit always plays (it is the mechanic).

## Variables

| id               | type       | default    | notes                                                                                                                                      |
| ---------------- | ---------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `cursor_variant` | enum       | `light`    | `light` (white body) or `dark` (near-black body); pick per scene contrast.                                                                 |
| `target_x`       | number (%) | `55`       | Tip landing point, percent of the host box (15 to 85).                                                                                     |
| `target_y`       | number (%) | `55`       | Tip landing point, percent of the host box (15 to 85).                                                                                     |
| `click_label`    | string     | `Generate` | Label on the clicked control. It gains a check when switched on, so a noun or state reads best.                                            |
| `exit`           | enum       | `none`     | `none` leaves the ignited target on screen until the cut; `fade`/`up` also depart the whole stage (target included) during the OUT window. |

## Mount

```html
<div
  class="clip"
  data-composition-id="oversized-cursor"
  data-composition-src="./oversized-cursor.html"
  data-variable-values='{"target_x":62,"target_y":48,"click_label":"Render"}'
  data-start="0"
  data-duration="2.6"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `oversized-cursor` key.

## Notes

- Invariants: cursor box 11.67cqw (3.5x the family's 64u arrow); motion on transforms only (never left/top); the click pivots on the arrow tip at (5/24, 3/24) of the cursor box.
- Sync point: the click lands at 0.7s (0.5s glide plus 0.2s aim, a fixed offset into IN, never inside the elastic HOLD); route a soft UI click SFX there in the mix stage.
