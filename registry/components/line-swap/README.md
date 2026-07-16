# line-swap

A masked full-line beat replacement. `line_a` rises into an overflow-hidden mask and holds center; on the swap beat it exits up through the mask as `line_b` enters bottom-up on the same beat (single restrained slam, smooth ease, no overshoot). Optionally an accent underline draws left to right beneath `underline_word` of `line_b` after it lands. Generalizes flagship frame 01.

3.5s authored, elastic HOLD, exit `none` by default.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `line_a` | string | `Everyone promised you AI.` | Holds center, exits up on the beat. |
| `line_b` | string | `Almost nobody promised you control.` | Enters bottom-up on the beat, then holds. Font size auto-fits to the longer line. |
| `swap_at` | number | `1.5` | Beat second from mount start. Clamped so line A fully arrives first and the swap plus underline complete before any exit. |
| `underline_word` | string | `control` | First case-insensitive substring match in `line_b` gets the underline. Empty or unmatched disables it. |
| `accent` | enum | `green` | Underline color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` departs opacity-only; `up` fades while rising. |

## Mount

```html
<div
  class="clip"
  data-composition-id="line-swap"
  data-composition-src="./line-swap.html"
  data-variable-values='{"line_a":"Everyone ships demos.","line_b":"Almost nobody ships proof.","underline_word":"proof","swap_at":1.3,"accent":"blue"}'
  data-start="0"
  data-duration="3.5"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `line-swap` key.

## Notes

- Both lines are nowrap and share one deterministic character-count font fit, so the swap never reflows.
- The underline is the flagship scaleX bar draw (left transform-origin, explicit 0 to 1 endpoints), hidden until the cue and seek-safe in both directions.
- The hold after the underline lands is completely still; frame roots own transitions.
