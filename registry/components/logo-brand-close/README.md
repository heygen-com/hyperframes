# logo-brand-close

The brand close that ends films. Wordmark letters cascade left to right into a centered lockup (per-letter fade plus a short rise with a smooth long-tail settle, no overshoot), an optional tagline settles beneath, an optional URL line fades in below in mono, then the finished identity holds dead still to the end.

Distinct job from `cta-close`: identity, not action. No button, no cursor, no ask. If the film should end on an action, use `cta-close`; if it should end on who made it, use this.

## Variables

| Variable   | Type   | Default                     | Notes                                                              |
| ---------- | ------ | --------------------------- | ------------------------------------------------------------------ |
| `wordmark` | string | `HYPERFRAMES`               | Letters cascade individually; a brand period is appended in accent (an existing trailing `.` takes the accent instead). |
| `tagline`  | string | `Write HTML. Render video.` | Settles beneath the wordmark. Empty string hides the line.         |
| `url`      | string | `hyperframes.heygen.com`    | Mono, wide-tracked. Empty string hides the line.                   |
| `accent`   | enum   | `green`                     | `green` maps to `--brand`, `blue` to `--accent`, `violet` to `--accent-2`. Colors the brand period. |
| `exit`     | enum   | `none`                      | `none`, `fade`, or `up`. This is a film ender; the default hold runs to the last frame. |

## Envelope

Authored at 4s. Fixed IN with elastic HOLD; OUT exists only when `exit` is not `none`.

- IN_BASE = 1.9s: letter cascade (0.9s rise per letter, 0.55s stagger spread, `expo.out`), tagline settle at 0.85s, URL fade at 1.2s.
- HOLD = `max(0, D - IN - OUT)`: completely still, no drift, no breath.
- OUT_BASE = 0.5s only for `exit: fade` (opacity) or `exit: up` (opacity plus rise); otherwise 0.
- Shorter durations compress IN and OUT proportionally. The timeline is never time-scaled.

Sync point: `lockup-settled` at 1.9s (end of IN at authored duration).

## Mount contract

Template-wrapped sub-composition. `#root` fills the host box, establishes the container query basis (`container-type: size`, `cqw`/`cqh` units), carries no `data-width`/`data-height`, and registers one paused GSAP timeline under the literal `logo-brand-close` key on `window.__timelines`. Consumes the contract tokens (`--bg`, `--fg`, `--muted`, `--brand`, `--accent`, `--accent-2`, `--font-display`, `--font-body`, `--font-mono`, `--space-2`) at point of use with exact-value fallbacks. Deterministic and seek-safe.
