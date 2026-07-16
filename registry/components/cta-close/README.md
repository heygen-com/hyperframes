# cta-close

The action-only close: one oversized action line rises into place, one capsule pops beneath it with a single overshoot, and the finished lockup stays completely still until the frame cuts.

3.5s authored, elastic HOLD, exit `none` by default (this primitive closes films).

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `action_line` | string | `Make it happen` | Two to four word closing action; auto-fits to width. |
| `button_label` | string | `Start now` | Text inside the single CTA capsule. |
| `accent` | enum | `green` | Capsule color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` and `up` depart the lockup over the final 0.45s. |

## Mount

```html
<div
  class="clip"
  data-composition-id="cta-close"
  data-composition-src="./cta-close.html"
  data-variable-values='{"action_line":"Ship your first film","button_label":"Get started","accent":"blue"}'
  data-start="0"
  data-duration="3.5"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `cta-close` key.

## Notes

- For an identity close (wordmark + tagline + URL) use `logo-brand-close`; this unit is action-only.
- The hold is deliberately dead still: no drift, no pulse.
