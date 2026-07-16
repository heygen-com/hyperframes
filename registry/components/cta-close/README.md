# cta-close

The action-only close: a display-scale action line lands per word, filling 70 to 85 percent of the frame width with real air above and below, one generous button capsule pops beneath it with a single restrained overshoot, and the finished lockup stays completely still until the frame cuts. Monotone: ink on ground, accent only on the capsule.

3.5s authored, elastic HOLD, exit `none` by default (this primitive closes films).

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `action_line` | string | `Make it happen` | Two to four word closing action; character-aware fit targets 70 to 85 percent of the frame width, short lines cap on height. |
| `button_label` | string | `Start now` | Text inside the single CTA capsule; label auto-fits, set in the body face. |
| `accent` | enum | `green` | Capsule color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` and `up` depart the lockup over the final 0.45s. |

## Choreography

1. The action line lands per word (rise + fade, power3.out, 0.10s stagger) at display scale.
2. The capsule pops beneath with ONE restrained overshoot (back.out from 0.85 scale) at 0.72s; the close is settled by 1.32s.
3. Dead-still confident hold to the end of the mount. No drift, no pulse.

## Mount

```html
<div
  class="clip"
  data-composition-id="cta-close"
  data-composition-src="./cta-close.html"
  data-variable-values='{"action_line":"Ship your first film","button_label":"Get started","accent":"violet"}'
  data-start="0"
  data-duration="3.5"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `cta-close` key.

## Notes

- For an identity close (wordmark + tagline + URL) use `logo-brand-close`; this unit is action-only.
- The hold is deliberately dead still: no drift, no pulse.
