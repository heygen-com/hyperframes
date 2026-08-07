# scramble-reveal

A target string begins as deterministic wrong glyphs and resolves one character at a time, left to right. Every visible frame comes from one fixed-seed LCG table built before the timeline registers, so seeks in either direction always show the same string. The locked string then holds until the frame cuts.

3s authored, elastic HOLD, exit `none` by default.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `text` | string | `HYPERFRAMES` | Target string. Font size auto-fits to character count. |
| `accent` | enum | `green` | Text, prefix, and frame color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `style` | enum | `terminal` | `terminal` (framed shell with `>_` prefix) or `clean` (text only). |
| `exit` | enum | `none` | `none` holds until the cut; `fade` departs opacity-only; `up` is the curved arc departure (the pre-Wave-J default ending). |

## Mount

```html
<div
  class="clip"
  data-composition-id="scramble-reveal"
  data-composition-src="./scramble-reveal.html"
  data-variable-values='{"text":"DETERMINISM","style":"clean","accent":"violet"}'
  data-start="0"
  data-duration="3"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `scramble-reveal` key.

## Notes

- Deterministic: fixed LCG seed `0x27c0ffee`, authored 30fps frame rows, monotonic left-to-right lock frames.
- The hold is a finite drift cycle followed by authored stillness, never a repeating tween.
