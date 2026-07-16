# scroll-feed

A self-scrolling column of skeleton post cards with two low-opacity trail copies suggesting motion blur. Card dimensions vary through deterministic index math only. By default the column covers exactly one card cycle over the mount, so the first and final frames are loop-compatible.

4s authored; HOLD owns the whole scroll and is the only elastic phase.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `speed` | enum | `doom` | `doom` or `frantic`: card pitch, so frantic covers more distance in the same time. |
| `card_count` | number | `6` | Cards per repeated cycle (4 to 10). |
| `cues` | string | `` (empty) | Comma-separated seconds (from mount start); each cue advances the feed by exactly one card pitch (stepped doom-scroll rhythm). Sorted ascending, capped at two full cycles of steps. Empty keeps the continuous scroll. |
| `exit` | enum | `none` | `none` scrolls until the cut; `fade`/`up` depart over a reserved tail (min(0.4s, 15% of D)). |

## Mount

```html
<div
  class="clip"
  data-composition-id="scroll-feed"
  data-composition-src="./scroll-feed.html"
  data-variable-values='{"speed":"frantic","card_count":8,"cues":"0.5,1.0,1.5,2.0"}'
  data-start="0"
  data-duration="4"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `scroll-feed` key.

## Notes

- The loop guarantee (first frame == final frame position) only holds with empty `cues` and `exit:"none"`; either option trades the loop for its rhythm or departure.
- Deterministic: no clocks, no randomness, no CSS animations; card variety is pure index arithmetic.
