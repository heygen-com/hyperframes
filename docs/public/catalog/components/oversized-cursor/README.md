# oversized-cursor

An actor primitive: a deliberately oversized macOS-style pointer enters from off-screen, glides in one continuous vector to a caller-positioned target, taps it (the click visibly ignites the target), drifts aside during the dwell, then accelerates off-screen. One mechanic: a pointer-driven click that visibly causes something.

4.2s authored, elastic HOLD; the cursor's own physical off-screen exit always plays (it is the mechanic).

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `cursor_variant` | enum | `light` | `light` (white body) or `dark` (near-black body); pick per scene contrast. |
| `target_x` | number (%) | `55` | Tip landing point, percent of the host box (15 to 85). |
| `target_y` | number (%) | `55` | Tip landing point, percent of the host box (15 to 85). |
| `click_label` | string | `Generate` | Label on the clicked target pill. |
| `exit` | enum | `none` | `none` leaves the ignited target on screen until the cut; `fade`/`up` also depart the whole stage (target included) during the OUT window. |

## Mount

```html
<div
  class="clip"
  data-composition-id="oversized-cursor"
  data-composition-src="./oversized-cursor.html"
  data-variable-values='{"target_x":62,"target_y":48,"click_label":"Render"}'
  data-start="0"
  data-duration="4.2"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `oversized-cursor` key.

## Notes

- Invariants: cursor size floor 7cqw; motion on transforms only (never left/top); ripple and click pivot anchor to the arrow tip at (21%, 14%) of the cursor box.
- Sync point: the click lands at the end of the entry glide (a fixed offset into IN, never inside the elastic HOLD); route a soft UI click SFX there in the mix stage.
