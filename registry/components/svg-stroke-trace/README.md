# svg-stroke-trace

An authored SVG path draws from start to finish using its measured `getTotalLength()`. Paths ending in a close command (`Z`) receive a restrained fill after the stroke completes; open paths (signatures, waves) stay stroke-only. The finished mark then holds until the frame cuts.

3.5s authored, elastic HOLD, exit `none` by default.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `path` | string | a wave path | SVG path data in the 1024x520 viewBox. A trailing `Z` is the single owner of fill behavior. |
| `stroke_width` | number | `12` | Stroke width in viewBox units (2 to 32). |
| `accent` | enum | `green` | Trace and fill color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` departs opacity-only; `up` is the upward fade (the pre-Wave-J default ending). |

## Mount

```html
<div
  class="clip"
  data-composition-id="svg-stroke-trace"
  data-composition-src="./svg-stroke-trace.html"
  data-variable-values='{"path":"M 120 400 L 512 120 L 904 400 Z","stroke_width":10,"accent":"blue"}'
  data-start="0"
  data-duration="3.5"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `svg-stroke-trace` key.

## Notes

- Dash values come from the real measured path length (never the `pathLength` attribute, never `non-scaling-stroke`), so any authored geometry draws exactly once.
- The hold is one finite vertical drift cycle, never a repeating tween.
