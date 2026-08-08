# kinetic-type-swap

A held sentence keeps its prefix and suffix fixed while one masked word slot rolls vertically through comma-separated options. The slot pre-sizes to the widest option, so the sentence never reflows during a swap. The final word locks with a soft pulse and holds until the frame cuts.

4s authored, elastic HOLD, exit `none` by default.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `prefix` | string | `Ship` | Fixed text before the rolling slot. |
| `options` | string | `faster,smarter,together` | Comma-separated words, shown in order; the last one is the sentence's final state. |
| `suffix` | string | `` (empty) | Fixed text after the rolling slot. |
| `cues` | string | `` (empty) | Comma-separated seconds (from mount start) for each swap, e.g. `0.8,1.6`. Sorted ascending; swaps beyond the list extrapolate at the list's own gap. Empty keeps the authored even spread. |
| `accent` | enum | `green` | Slot color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` is the opacity release (the pre-Wave-J default ending); `up` adds a small rise to the fade. |

## Mount

```html
<div
  class="clip"
  data-composition-id="kinetic-type-swap"
  data-composition-src="./kinetic-type-swap.html"
  data-variable-values='{"prefix":"Render","options":"anything,everywhere,tonight","cues":"1.0,2.2"}'
  data-start="0"
  data-duration="4"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `kinetic-type-swap` key.

## Notes

- Cue N fires the swap from option N to option N+1. Swaps clamp so the roll and settle finish before any exit; the roll shortens automatically when cues sit close together.
- Deterministic and seek-safe; the hold pulse uses a finite odd repeat, never an open loop.
