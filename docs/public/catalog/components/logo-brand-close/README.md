# logo-brand-close

The brand close that ends films. The wordmark lands at display scale (a chars-aware fit sizes it to roughly three quarters of the frame width), letters cascade left to right (per-letter fade plus rise with a long expo tail) while the whole wordmark settles from a slightly larger scale, the accent brand period arrives last with a decisive pop, a readable tagline settles beneath, a wide-tracked mono URL breathes in below, then the finished identity holds dead still to the end.

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

- IN_BASE = 2.6s: letter cascade (1.15s rise per letter, 0.7s stagger spread, `expo.out`) under a 2.4s whole-wordmark scale settle (1.04 to 1), accent period pop at 0.95s (`back.out(1.8)`), tagline settle at 1.35s, URL fade plus tracking settle at 1.7s.
- HOLD = `max(0, D - IN - OUT)`: completely still, no drift, no breath.
- OUT_BASE = 0.5s only for `exit: fade` (opacity) or `exit: up` (opacity plus rise); otherwise 0.
- Shorter durations compress IN and OUT proportionally. The timeline is never time-scaled.

Sync point: `lockup-settled` at 2.6s (end of IN at authored duration).

## Scale

- Wordmark: chars-aware fit targeting ~76cqw of set width (a one-shot 100px probe measures the real font's em ratio; a per-glyph advance table is the fallback), capped at 40cqh for short, wide mounts.
- Tagline: `min(3.4cqw, 5.4cqmin)`, a clearly readable secondary scale.
- URL: `min(2.4cqw, 3.2cqmin)` mono at 0.28em tracking, legible at 1080p even inside a mounted card.

## Mount contract

Template-wrapped sub-composition. `#root` fills the host box, establishes the container query basis (`container-type: size`, `cqw`/`cqh` units), carries no `data-width`/`data-height`, and registers one paused GSAP timeline under the literal `logo-brand-close` key on `window.__timelines`. Consumes the contract tokens (`--bg`, `--fg`, `--muted`, `--brand`, `--accent`, `--accent-2`, `--font-display`, `--font-body`, `--font-mono`, `--space-2`) at point of use with exact-value fallbacks. Deterministic and seek-safe.
