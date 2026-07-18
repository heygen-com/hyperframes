# variable-font-flex

Wave M experiment (M5). A word lands while its variable-font axes flex: each character rises from hairline-condensed to black-wide with a per-character stagger and a small carve-in overshoot, then settles. The word's font-size eases inversely to the mean axis progress (optical compensation), so the letterforms gain mass while the word's box barely grows.

3.5s authored, elastic HOLD, exit `none` by default.

## Font source (pinned)

Roboto Flex Variable via the Fontsource CDN build: `@fontsource-variable/roboto-flex@5.2.8`, latin `standard` subset, one woff2 carrying `wght` 100..1000 and `wdth` 25%..151%:

```
https://cdn.jsdelivr.net/npm/@fontsource-variable/roboto-flex@5.2.8/files/roboto-flex-latin-standard-normal.woff2
```

Inter var was considered per the spec but Inter has no `wdth` axis; the width mode needs a real one, so Roboto Flex carries both. The pinned font IS the mechanic: this unit deliberately does not ride `--font-display`, because a theme font without matching axes would kill the effect. The landing weight (840) is the animated mechanic, not static register styling.

## Variables

| id | type | default | notes |
| --- | --- | --- | --- |
| `text` | string | `FLEX` | The word whose axes flex. |
| `axis` | enum | `both` | `weight` (wght 120 to 840, wdth held 100), `width` (wdth 40 to 128, wght held 620), or `both`. |
| `stagger` | number | `0.06` | Seconds between per-character flex starts, clamped 0 to 0.25. |
| `accent` | enum | `green` | Word color: green rides `--brand`, blue rides `--accent`, violet rides `--accent-2`. |
| `exit` | enum | `none` | `none` holds until the cut; `fade` departs opacity-only; `up` rises out. |

## Mount

```html
<div
  class="clip"
  data-composition-id="variable-font-flex"
  data-composition-src="./variable-font-flex.html"
  data-variable-values='{"text":"ELASTIC","axis":"width","accent":"blue"}'
  data-start="0"
  data-duration="3.5"
  data-track-index="0"
></div>
```

Elastic root: no `data-width`/`data-height`; it fills whatever box the host clip gives it. Timeline registers under the literal `variable-font-flex` key.

## Notes

- Number proxy, never the string: no tween ever touches `font-variation-settings`. One inert anchor tween spans the authored duration; on every update a painter recomputes each character's axis NUMBERS as a pure function of `tl.time()` and composes the `"wght" W, "wdth" D` string from them, clamped to the font's real ranges (the carve ease overshoots ~6% past target before settling).
- Optical compensation: word-level `font-size = base * (1 - COMP * meanProgress)` where COMP is 0.16 for `both`, 0.12 for `width`, 0.08 for `weight`. Mass grows, the box holds.
- Seek-safe: painter writes are idempotent and depend on timeline time alone; eventful seeks (`suppressEvents=false`, the engine's render path) land identical frames in any order and either direction. No `Math.random`, no wall clock.
- The base size fits the FINAL wide-black state (capped by `cqh` for short words on wide hosts); compensation only ever shrinks below it, so nothing clips mid-flex.
