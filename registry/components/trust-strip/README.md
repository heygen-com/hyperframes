# trust-strip

Monochrome trust/logo strip (proof & stats, 3.5s authored, elastic HOLD).

N text wordmarks set in wide-tracked uppercase mono, one centered row with wide
gaps, no boxes, no borders. Marks fade in with an opacity-only stagger from
left to right (default 0.15s gap), then the strip holds dead still. Above five
marks the row wraps gracefully to a second centered row when width demands;
reading order and reveal order are preserved.

## Variables

| Variable | Type | Default | Notes |
| --- | --- | --- | --- |
| `marks` | string | `Northwind, Acme Corp, Globex, Initech, Umbra` | Comma list of wordmark texts. 3 to 7 recommended. |
| `tone` | `muted` \| `ink` | `muted` | Mark color: `var(--muted)` or `var(--fg)`. |
| `cues` | string | `""` | Comma seconds from mount start, one per mark. Missing tail entries extend from the last cue by 0.15s. Empty = authored rhythm (first mark at 0.2s). |
| `accent` | `green` \| `blue` \| `violet` | `green` | Faint 10% tint mixed into the mark color (green `--brand`, blue `--accent`, violet `--accent-2`). The strip still reads monochrome. |
| `exit` | `none` \| `fade` \| `up` | `none` | `none` holds to the last frame (frame roots own transitions). `fade` dissolves the strip over 0.45s; `up` adds a small rise. |

## Envelope

Fixed IN and OUT with elastic HOLD only (never timeScale):

- IN = last reveal start + 0.5s fade (about 1.3s for 5 marks on the default rhythm)
- HOLD = max(0, D - IN - OUT), dead still by design
- OUT = 0 when `exit` is `none`, else 0.45s
- If the host duration is shorter than IN + OUT, both compress together (cues included).

## Mounting

Mount-contract sub-composition: load via `data-composition-src`, give the clip
a wide, short box (a strip band), and the primitive sizes off that box with
container queries. Consumes contract tokens (`--muted`, `--fg`, `--brand`,
`--accent`, `--accent-2`, `--bg`, `--font-mono`, `--space-2`, `--space-3`)
with exact-value fallbacks.

```html
<div
  class="clip"
  data-composition-id="trust-strip"
  data-composition-src="./components/trust-strip.html"
  data-variable-values='{"marks":"Northwind, Globex, Umbra","tone":"ink"}'
  data-start="0"
  data-duration="3.5"
  data-track-index="0"
></div>
```
