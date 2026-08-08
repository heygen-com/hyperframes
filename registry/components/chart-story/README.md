# chart-story

The proof-and-stats chart unit: one chart builds from data in reading order and lands on the exact supplied values, never a re-rounded approximation. Bars grow staggered from the baseline (scaleY, origin at the baseline), a line draws left to right by getTotalLength dash with a translucent area fill fading in after, a donut ring sweeps segment by segment, or horizontal progress bars fill top to bottom (scaleX, origin left). Axis and data labels fade in reading order. The emphasized datum takes the accent color plus a value callout that pops with a smooth settle while its number rolls to the exact value and unit; on the donut the callout is the ring center.

Inline SVG built synchronously from the variables, no chart library, fully deterministic and seek-safe.

## Variables

| Variable    | Type   | Default          | Notes                                                                                             |
| ----------- | ------ | ---------------- | ------------------------------------------------------------------------------------------------- |
| `type`      | enum   | `bars`           | `bars`, `line`, `donut`, or `progress`.                                                            |
| `data`      | string | `12, 28, 45, 64` | Comma-separated numbers. The displayed finals are the raw tokens (decimals preserved, e.g. `45.5`). |
| `labels`    | string | `Q1, Q2, Q3, Q4` | Comma-separated, one per datum. Missing entries render empty.                                       |
| `emphasize` | number | `3`              | Index of the accented datum with the callout. Clamped to the data range; out-of-range falls to the last datum. |
| `unit`      | string | `%`              | Suffix on every displayed value. For `progress`, a `%` unit fills against 100; otherwise the largest value owns the full track. |
| `accent`    | enum   | `green`          | `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2`.                          |
| `exit`      | enum   | `none`           | `none`, `fade`, or `up`. Proof stats end on the still hold, so the default is none.                 |

Bars and lines scale against the largest value; donut segments are proportional shares of the total.

## Envelope

Authored at 5s. Fixed IN with elastic HOLD; OUT exists only when `exit` is not `none`.

- IN_BASE = 3.3s: stage arrival (0.5s), axis or track reveal at 0.15s, data build from 0.55s over 1.6s in reading order, labels fading from 0.85s, callout pop at 2.35s with a 0.7s number roll landing the exact value at 3.05s.
- HOLD = `max(0, D - IN - OUT)`: one finite drift (two explicit tweens), then 0.3s stillness.
- OUT_BASE = 0.5s only for `exit: fade` (opacity) or `exit: up` (opacity plus rise); otherwise 0.
- Shorter durations compress IN and OUT proportionally. The timeline is never time-scaled.

Sync point: `callout-landed` at 3.05s (exact value landed, at authored duration).

## Mount contract

Template-wrapped sub-composition. `#root` fills the host box, establishes the container query basis (`container-type: size`, `cqw`/`cqh` units), carries no `data-width`/`data-height`, and registers one paused GSAP timeline under the literal `chart-story` key on `window.__timelines`. Consumes the contract tokens (`--bg`, `--fg`, `--muted`, `--surface`, `--border`, `--brand`, `--accent`, `--accent-2`, `--font-display`, `--font-body`, `--font-mono`, `--space-2`) at point of use with exact-value fallbacks. All dash draws measure `getTotalLength` (never the `pathLength` attribute, no `vector-effect: non-scaling-stroke` on dashed paths). Deterministic: no `Date.now`, no randomness, no network reads at seek time.
