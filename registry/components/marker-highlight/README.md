# marker-highlight

The corpus emphasis unit: a line of display text settles in, then ONE hand-drawn marker stroke draws over the emphasized word on cue. Four styles, one mechanic: an SVG path revealed by a `getTotalLength` dash tween.

3.5s authored, elastic HOLD (the lockup sits completely still until the frame cuts), exit `none` by default.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `text` | string | `Ship it with confidence` | Full line; wraps and centers. |
| `emphasis_word` | string | `confidence` | First case-insensitive substring match in `text` gets the marker. Empty or unmatched renders the line with no marker. Keep it a word or short phrase; it never wraps internally. |
| `style` | enum | `highlight` | `highlight` (thick swipe behind the word), `circle` (loop around it), `underline` (wavy rule beneath), `scribble` (zigzag across). |
| `draw_at` | number (s) | `0.9` | Cue for the draw, relative to mount start. Clamped so the stroke and its settle pop finish before any exit. |
| `accent` | enum | `green` | Ink color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` and `up` depart over the final 0.45s. |

## Mount

```html
<div
  class="clip"
  data-composition-id="marker-highlight"
  data-composition-src="./marker-highlight.html"
  data-variable-values='{"text":"Zero render surprises","emphasis_word":"Zero","style":"circle","accent":"violet"}'
  data-start="0"
  data-duration="3.5"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `marker-highlight` key.

## Notes

- Marker paths are authored wobble in a fixed viewBox stretched with `preserveAspectRatio="none"`; the anisotropic stroke distortion is the hand-swiped nib feel, deliberately kept (no `non-scaling-stroke`, no `pathLength`).
- Deterministic: no randomness, both dash endpoints explicit, seek-safe in either direction.
