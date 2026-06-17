# lint, validate, inspect, snapshot

The correctness pipeline. Run in this order: `lint` (static, fast) → `validate` (runtime, headless Chrome) → `inspect` (layout sweep). `snapshot` is a separate utility for capturing still frames.

## Discipline (motion-heavy work)

When the composition is animation-driven, run the checks before you reach for `preview` or `render`:

- Run `lint` after the first HTML pass — earlier, not later.
- Capture `snapshot` at meaningful timeline states; look at the PNGs.
- Inspect snapshots _before_ tuning automated warnings — your eye catches what the auditor misses.
- Treat layout warnings as defects unless a snapshot proves the overflow is intentional, in which case mark it with `data-layout-allow-overflow`.
- State motion intent in a `*.motion.json` sidecar so `inspect` checks it automatically — entrances firing under seek, stagger order, in-frame, liveness. This is the closest automated proxy for "watch the MP4" and catches render-≠-preview bugs the eye misses (see **Motion verification** below).

## lint

```bash
npx hyperframes lint                  # current directory
npx hyperframes lint ./my-project     # specific project
npx hyperframes lint --verbose        # info-level findings
npx hyperframes lint --json           # machine-readable
```

Lints `index.html` and all files in `compositions/`. Reports errors (must fix), warnings (should fix), and info (with `--verbose`). Catches missing `data-composition-id`, overlapping tracks on the same `data-track-index`, and unregistered timelines.

**Blind spot — media inside a sub-composition (not yet a lint rule).** A `<video>`/`<audio>` inside a `compositions/*.html` `<template>` (or nested in a wrapper `<div>` anywhere) is never seeked/decoded and renders blank/black; `lint`/`validate`/`inspect` all pass. Media must be a direct child of the host root (`index.html`) — see `hyperframes-core` → `variables-and-media.md`. Until a rule exists, check manually before render:

```bash
grep -nE '<(video|audio)\b' compositions/*.html   # expect NO matches; media belongs in index.html
```

A non-empty result is a defect. Then `snapshot` each scene that has a video and confirm the panel actually shows footage (a blank/black panel where a clip should play is a bug, not a placeholder — treat it as render-blocking).

## validate

```bash
npx hyperframes validate              # current directory
npx hyperframes validate ./my-project # specific project
npx hyperframes validate --json       # agent-readable findings
npx hyperframes validate --timeout 5000  # ms to wait for scripts (default 3000)
npx hyperframes validate --no-contrast   # skip WCAG contrast audit while iterating
```

Static lint is fast but blind to runtime failures. `validate` loads the composition in headless Chrome, plays through it, and reports:

- JavaScript console errors and unhandled exceptions
- Failed network requests (media-file `ERR_ABORTED` filtered out)
- WCAG AA contrast violations on visible text — sampled at 5 timestamps across the timeline. Disable with `--no-contrast`.

**Fixing contrast warnings** — thresholds are 4.5:1 for normal text, 3:1 for large text (24px+, or 19px+ bold):

- On dark backgrounds, brighten the failing color until it clears the threshold; on light backgrounds, darken it.
- Stay within the palette family — don't invent a new color, adjust the existing one.
- Re-run `validate` until clean.

Run `validate` before `inspect` when an animation has scripts, fetched data, or theming. Combine with `render --strict` in CI.

## inspect

```bash
npx hyperframes inspect                 # inspect rendered layout over the timeline
npx hyperframes inspect ./my-project    # specific project
npx hyperframes inspect --json          # agent-readable findings (schemaVersion, samples, issues, bboxes)
npx hyperframes inspect --samples 15    # denser timeline sweep (default 9)
npx hyperframes inspect --at 1.5,4,7.25 # explicit hero-frame timestamps
npx hyperframes inspect --tolerance 4   # allowed overflow in px before reporting (default 2)
npx hyperframes inspect --strict        # exit non-zero on warnings too (default: only errors)
```

Use this after `lint` and `validate`, especially for compositions with speech bubbles, cards, captions, or tight typography. It reports:

- Text extending outside the nearest visual container or bubble
- Text clipped by its own fixed-width/fixed-height box
- Text extending outside the composition canvas
- Children escaping clipping containers

Errors should be fixed before rendering. Warnings are surfaced for agent review; add `--strict` to fail on warnings too. Repeated static issues are collapsed by default so JSON output stays compact for LLM context windows.

**Escape hatches:**

- `data-layout-allow-overflow` — mark an element or ancestor when overflow is intentional for an entrance/exit animation.
- `data-layout-ignore` — mark a decorative element that should never be audited.

`npx hyperframes layout` remains available as a compatibility alias for the same visual inspection pass.

### Motion verification (`*.motion.json` sidecar)

`inspect` also checks **motion intent** against the same seeked timeline the renderer uses — the closest automated proxy for "render the MP4 and watch it". It catches render-≠-preview bugs layout sampling can't: an entrance reveal the seek lands past, a broken stagger order, an element drifting off-frame mid-tween, a frozen shot.

Drop a `*.motion.json` sidecar next to the composition (matching the html basename when several compositions share a dir). `inspect` discovers it automatically — no flag, no authoring-framework changes. With no sidecar, `inspect` behaves exactly as before.

```json
{
  "duration": 6,
  "assertions": [
    { "kind": "appearsBy", "selector": "#headline", "bySec": 0.5 },
    { "kind": "before", "a": "#headline", "b": "#cta" },
    { "kind": "staysInFrame", "selector": ".card" },
    { "kind": "keepsMoving", "withinSelector": ".scene" }
  ]
}
```

| Assertion                      | Fails (code) when                                                           |
| ------------------------------ | --------------------------------------------------------------------------- |
| `appearsBy(selector, bySec)`   | not visible (opacity ≥ 0.5) by `bySec` — `motion_appears_late`              |
| `before(a, b)`                 | `a` does not first appear strictly before `b` — `motion_out_of_order`       |
| `staysInFrame(selector)`       | once visible, its box leaves the canvas — `motion_off_frame`                |
| `keepsMoving(withinSelector?)` | a fully-static window exceeds `maxStaticSec` (default 2s) — `motion_frozen` |

`duration`, `withinSelector`, and `maxStaticSec` are optional. Findings are **errors by default** (a failed assertion fails the run, like a layout error — `--strict` still gates warnings) and appear in the same human and `--json` output as layout findings. A selector that matches nothing is reported as `motion_selector_missing` rather than silently passing — so a typo'd selector fails loudly. Use this in the feedback loop instead of eyeballing the render: assert what the motion is supposed to do, and let `inspect` tell you when the seek diverges from intent.

## snapshot

```bash
npx hyperframes snapshot                       # 5 key frames as PNG
npx hyperframes snapshot ./my-project          # specific project
npx hyperframes snapshot --frames 10           # evenly-spaced N frames
```

Captures still PNGs from the composition for visual diffing, thumbnails, or attaching to a PR. Faster than rendering a video when you only need a few hero frames. Output lands in the project's snapshots directory.
