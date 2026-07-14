# lint, check, snapshot

The correctness pipeline: `lint` (static, fast) while iterating, then `check` (one browser session: runtime + layout + motion + contrast) as the gate. `snapshot` is the standalone utility for capturing still frames and zoomed crops. `validate`, `inspect`, and `layout` still run but are deprecated: `check` covers all of them in one invocation.

## Discipline (motion-heavy work)

When the composition is animation-driven, run the checks before you reach for `preview` or `render`:

- Run `lint` after the first HTML pass, earlier rather than later.
- Run `check --snapshots` at the first full pass: the overview frames and per-finding crops show you what the auditor saw.
- Look at the PNGs before tuning automated warnings: your eye catches what the auditor misses, and the auditor catches what your eye misses.
- Treat layout errors as defects unless a snapshot proves the layering is intentional, in which case mark it with `data-layout-allow-overflow` / `data-layout-allow-overlap` / `data-layout-allow-occlusion`.
- State motion intent in a `*.motion.json` sidecar so `check` verifies it automatically (entrances firing under seek, stagger order, in-frame, liveness). This is the closest automated proxy for "watch the MP4" and catches render-vs-preview bugs the eye misses (see **Motion verification** below).

## lint

```bash
npx hyperframes lint                  # current directory
npx hyperframes lint ./my-project     # specific project
npx hyperframes lint --verbose        # info-level findings
npx hyperframes lint --json           # machine-readable
```

Lints `index.html` and all files in `compositions/`. Reports errors (must fix), warnings (should fix), and info (with `--verbose`). Catches missing `data-composition-id`, overlapping tracks on the same `data-track-index`, unregistered timelines, and GSAP/CSS transform conflicts.

**Blind spot — media inside a sub-composition (not yet a lint rule).** A `<video>`/`<audio>` inside a `compositions/*.html` `<template>` (or nested in a wrapper `<div>` anywhere) is never seeked/decoded and renders blank/black; the automated checks all pass. Media must be a direct child of the host root (`index.html`) — see `hyperframes-core` → `variables-and-media.md`. Until a rule exists, check manually before render:

```bash
grep -nE '<(video|audio)\b' compositions/*.html   # expect NO matches; media belongs in index.html
```

A non-empty result is a defect. Then `snapshot` each scene that has a video and confirm the panel actually shows footage (a blank/black panel where a clip should play is a bug, not a placeholder — treat it as render-blocking).

## check

```bash
npx hyperframes check                    # current directory: the full browser gate
npx hyperframes check ./my-project       # specific project
npx hyperframes check --json             # agent-readable envelope {ok, lint, runtime, layout, motion, contrast, snapshots}
npx hyperframes check --snapshots        # also write overview frames (annotated) + per-finding crops
npx hyperframes check --samples 15       # denser timeline sweep (default 9)
npx hyperframes check --at 1.5,4,7.25    # explicit hero-frame timestamps
npx hyperframes check --at-transitions   # also sample every tween start/end boundary
npx hyperframes check --tolerance 4      # allowed overflow px before reporting (default 2)
npx hyperframes check --timeout 5000     # ms for the initial settle (default 3000)
npx hyperframes check --no-contrast      # skip the WCAG audit while iterating
npx hyperframes check --strict           # exit non-zero on warnings too (default: only errors)
```

One command, one Chrome boot. `check` runs the linter first and skips the browser entirely when lint reports errors. Then it loads the bundled composition once, wires runtime listeners before navigation, and sweeps one seek grid running every audit per sample:

- **Runtime**: JavaScript console errors, unhandled exceptions, failed network requests (media-file `ERR_ABORTED` filtered out), HTTP 4xx/5xx.
- **Layout**: text extending outside its container or the canvas, text clipped by its own box, held text overlaps and occlusion (with an approximate covered fraction), children escaping clipping containers.
- **Motion**: `*.motion.json` sidecar assertions against the same seeked timeline (see below).
- **Contrast**: WCAG AA on visible text, sampled at 5 grid points. Failures are **errors** and each finding carries the sampled fg/bg colors, measured vs required ratio, and a suggested compliant color in the same palette direction, so most contrast fixes need no screenshot at all.

Every finding carries a selector, the element's `data-*` identity, the composition source file, a bbox, and the sample time: jump straight from the JSON to the HTML you must edit and re-run.

**Severity is persistence-aware.** A dynamic issue observed at a single grid sample (an entrance/exit transient) demotes to info and never gates. Issues held across samples gate the exit code, a held `content_overlap` is an error, and a held, partially-visible `canvas_overflow` breaching ≥5% of the canvas promotes to warning. Coordinate-frame findings (`escaped_container`, `panel_out_of_canvas`, `connector_detached`) flag geometry computed in one frame but rendered in another — an element far outside its offset parent, a painted panel stuck across the canvas edge, a connector line detached from every node. If a 3s+ composition shows zero geometry change across every sample, `check` fails with `sweep_static`: a frozen timeline makes every green verdict unreliable, so it refuses to pass.

**Escape hatches** (mark intent in the HTML, then re-run):

- `data-layout-allow-overflow` — overflow is intentional (entrance/exit travel).
- `data-layout-allow-overlap` — deliberate text layering (e.g. a demo cursor label over a heading).
- `data-layout-allow-occlusion` — an element is meant to cover text.
- `data-layout-ignore` — decorative element that should never be audited.

**Opt-in pipeline gates** (used by orchestrators; off by default):

```bash
npx hyperframes check --caption-zone "x0=0;y0=.82;x1=1;y1=1;severity=error;seek=.25,1"
npx hyperframes check --frame-check     # media (img/svg/video/canvas) out-of-frame detection
```

`--caption-zone` takes fractional band geometry (`x0/y0/x1/y1` required, 0-1 fractions of the composition's own canvas, portrait included) with optional `severity` and comma-separated `seek` fractions; it flags content whose center sits inside the band. `--frame-check` reports media elements breaching the canvas beyond `max(120px, 6% of the min canvas dimension)`.

**Fixing contrast errors** — thresholds are 4.5:1 for normal text, 3:1 for large text (24px+, or 19px+ bold). The finding's `suggestedColor` already picks the nearest compliant color in the right direction (brighten on dark backgrounds, darken on light); apply it or adjust within the palette family, then re-run `check`.

## Motion verification (`*.motion.json` sidecar)

`check` verifies **motion intent** against the same seeked timeline the renderer uses — the closest automated proxy for "render the MP4 and watch it". It catches render-vs-preview bugs layout sampling can't: an entrance reveal the seek lands past, a broken stagger order, an element drifting off-frame mid-tween, a frozen shot.

Drop a `*.motion.json` sidecar next to the composition (matching the html basename when several compositions share a dir). `check` discovers it automatically — no flag, no authoring-framework changes. With no sidecar, `check` behaves exactly as before.

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

`duration`, `withinSelector`, and `maxStaticSec` are optional. Findings are **errors by default** and appear in the same human and `--json` output as layout findings. A selector that matches nothing is reported as `motion_selector_missing` rather than silently passing — a typo'd selector fails loudly. Use this in the feedback loop instead of eyeballing the render: assert what the motion is supposed to do, and let `check` tell you when the seek diverges from intent.

## snapshot

```bash
npx hyperframes snapshot                       # 5 key frames as PNG
npx hyperframes snapshot ./my-project          # specific project
npx hyperframes snapshot --frames 10           # evenly-spaced N frames
```

Captures still PNGs from the composition for visual diffing, thumbnails, or attaching to a PR. Faster than rendering a video when you only need a few hero frames. Output lands in the project's snapshots directory. Not deprecated: it remains the standalone capture utility, while `check --snapshots` covers the gate's needs (overview frames annotated with labeled finding boxes, plus `finding-NN-<code>.png` crops for every error finding with a bbox).

### Zooming into a reported finding

`hyperframes check --snapshots` already writes a `finding-NN-<code>.png` crop for every error finding that carries a bbox, but the same zoom is available standalone once you know what to look at:

```bash
npx hyperframes check --snapshots               # reports a finding, e.g. content_overlap on "#cta"
npx hyperframes snapshot --zoom "#cta"           # crop the element to verify the defect, at 3x density
npx hyperframes snapshot --zoom "100,50,400,300" --zoom-scale 2   # or an exact pixel region
# fix the composition HTML, then re-check:
npx hyperframes check
```

`--zoom` takes a CSS selector or an exact `x,y,w,h` pixel region and always produces a real high-density crop (a raised `deviceScaleFactor`, never CSS zoom or a viewport resize), so the composition's layout — and its render determinism — is untouched. A selector matching nothing is a loud error, not a silent full-frame fallback, and a frame where the target has no visible box (collapsed or animated off-canvas) is skipped with a note instead of written as a sliver.

## Deprecated: validate, inspect, layout

All three keep working, print a deprecation notice on stderr, and mark `_meta.deprecated: true` in `--json`. Their functionality lives in `check`:

- `validate` (runtime errors + contrast) → `check` (contrast failures are now gating errors with fix payloads, not warnings).
- `inspect` / `layout` (layout sweep + motion sidecar) → `check` (same flags: `--samples`, `--at`, `--at-transitions`, `--tolerance`, `--strict`).

Migrate scripts by replacing the sequence with the single `check` invocation; scaffolded projects' `npm run check` already points there.
