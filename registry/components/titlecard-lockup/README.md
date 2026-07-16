# titlecard-lockup

The calm breather titlecard (intros and reveals). An optional mono kicker fades up, the wordmark settles dead-center with ONE restrained move (scale 0.96 to 1, smooth ease-out), a hairline rule draws left to right beneath it, a mono label fades in under the rule, then the finished lockup holds truly still. Low motion is the payload: no second development phase, no spring chains. During the hold the rule carries at most a barely-there luminance breath that starts and ends at zero.

## Install

```bash
npx hyperframes add titlecard-lockup
```

## Mount

```html
<div
  class="clip"
  data-composition-id="titlecard-lockup"
  data-composition-src="./components/titlecard-lockup.html"
  data-variable-values='{"wordmark":"NORTHWIND","label":"SECURE AGENTS PLATFORM","kicker":"MEET","accent":"blue"}'
  data-start="0"
  data-duration="4"
  data-track-index="0"
></div>
```

## Variables

| Variable   | Type   | Default                     | Notes                                                            |
| ---------- | ------ | --------------------------- | ---------------------------------------------------------------- |
| `wordmark` | string | `HYPERFRAMES`               | Display wordmark, auto-fitted to one line by character count.    |
| `label`    | string | `WRITE HTML. RENDER VIDEO.` | Mono caption under the rule. Empty string hides it.              |
| `kicker`   | string | `INTRODUCING`               | Small mono label above the wordmark. Empty string hides it (the schedule keeps its beat of quiet). |
| `rule`     | enum   | `show`                      | `show` or `hide` for the hairline rule and its draw.             |
| `accent`   | enum   | `green`                     | `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2`. Carried by the rule. |
| `exit`     | enum   | `none`                      | `none`, `fade`, or `up`. Frame roots own transitions; holds end films. |

## Envelope

- `IN_BASE = 1.80s`: kicker (0 to 0.45s), wordmark settle (0.25 to 1.10s), rule draw (0.90 to 1.45s), label (1.30 to 1.80s).
- `HOLD = max(0, D - IN - OUT)`: elastic, truly still except one sine luminance breath on the rule that begins and ends at the settled value.
- `OUT_BASE = 0.50s` when `exit` is `fade` or `up`, otherwise `0`.
- If `D < IN_BASE + OUT_BASE` the phases compress together. The timeline is never time-scaled.

## Contract notes

- Consumes the theme contract tokens at point of use with exact-value fallbacks (`--bg`, `--fg`, `--muted`, `--brand`, `--accent`, `--accent-2`, `--font-display`, `--font-mono`, `--space-2`).
- The rule draw measures `getTotalLength()` and dashes in user units (no `pathLength` attribute, no `non-scaling-stroke`).
- One paused GSAP timeline registered at `window.__timelines["titlecard-lockup"]`; deterministic and seek-safe.
- Elastic root: no `data-width`/`data-height`, `container-type: size`, `cqmin`-based sizing.
