# per-word-rise

Words or characters rise into place in a controlled blur-to-sharp cascade, drift gently during the hold, and stay put until the frame cuts.

3.5s authored, elastic HOLD, exit `none` by default.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `text` | string | `WORDS IN MOTION` | The displayed line. Font size auto-fits to character count. |
| `split` | enum | `word` | `word` or `char`: the unit that rises. |
| `cues` | string | `` (empty) | Comma-separated seconds (from mount start) for each unit's landing, e.g. `0.4,0.8,1.6`. Units beyond the list extrapolate at the list's own gap. Empty keeps the authored cascade. |
| `accent` | enum | `green` | Text color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` departs opacity-only; `up` is the staggered upward fade (the pre-Wave-J default ending). |

## Mount

```html
<div
  class="clip"
  data-composition-id="per-word-rise"
  data-composition-src="./per-word-rise.html"
  data-variable-values='{"text":"SHIP IT TODAY","split":"word","cues":"0.5,1.0,1.5"}'
  data-start="0"
  data-duration="3.5"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `per-word-rise` key.

## Notes

- Cues are landing times: each unit's rise ends on its cue (start compresses toward 0 for early cues). Landings clamp ahead of any exit.
- Deterministic and seek-safe; the hold drift is one finite yoyo cycle, never a repeating tween.
