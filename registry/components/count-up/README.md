# count-up

A stat counter that eases from start to end, lands on the exact final integer with one restrained scale pulse, and holds until the frame cuts. Tabular numerals keep the line from shifting while digits change.

3s authored, elastic HOLD, exit `none` by default.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `start` | number | `0` | First value shown. |
| `end` | number | `100` | Final value; the count always lands exactly here. |
| `prefix` | string | `` (empty) | Fixed text before the value. |
| `suffix` | string | `%` | Fixed text after the value. |
| `accent` | enum | `green` | Count color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `glow` | boolean | `false` | Opt-in soft accent glow under the count. The register ships flat (weight 600, no text-shadow). |
| `exit` | enum | `none` | `none` holds until the cut; `fade` departs opacity-only; `up` is the upward release and fade. |

## Mount

```html
<div
  class="clip"
  data-composition-id="count-up"
  data-composition-src="./count-up.html"
  data-variable-values='{"start":0,"end":250,"prefix":"$","suffix":"K","accent":"blue"}'
  data-start="0"
  data-duration="3"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `count-up` key.

## Notes

- Wave-J register change: the previous forced upward-fade exit is gone (opt back in with `exit:"up"`), and the hardcoded weight-800 + text-shadow glow register is now weight 600 with `glow` off by default.
- Deterministic: every displayed integer comes from an authored frame row; reverse and repeated seeks show the same value.
