# U3 Determinism Gate Result

Date: 2026-07-08
Branch: `animejs-u3`
Runtime under test: `animejs@4.5.0` UMD bundle via `hyperframesAnime.register()` (U1 contract)
Gate implementation: `packages/producer/src/animejs-determinism-gate.ts`, invoked via
`bun run --cwd packages/producer check:animejs-determinism` (or
`check:runtime-conformance`, which runs it after the manifest check).

Executed locally (outside any sandbox) with real network access and a real headless Chrome
(`puppeteer`-managed "Chrome for Testing" binary via `PUPPETEER_EXECUTABLE_PATH`), against
`packages/core/dist` + `packages/producer` built from this branch at commit
`7b1f82ed044d947b40aa7858e8b3a2985fe0e801`.

## Summary verdict

| Feature | same-frame repeat | random-seek [90,10,50,10]→42 vs direct | backward seek → 0 | bounds clamp | no leaked timers | Verdict |
|---|---|---|---|---|---|---|
| springs (`anime.createSpring`) | PASS | PASS | PASS | PASS | PASS | **PASS** |
| morph (`anime.svg.morphTo`) | PASS | PASS | PASS | PASS | PASS | **PASS** |
| drawable (`anime.svg.createDrawable`) | PASS | PASS | PASS | PASS | PASS | **PASS** |
| split-text (`anime.text.split`) | PASS | PASS | **FAIL** | PASS | PASS | **PARTIAL — see critical finding** |
| nested `.sync()` timelines | PASS | **FAIL** | **FAIL** | PASS | PASS | **FAIL — see critical finding** |
| seeded stagger (`anime.stagger`) | PASS | PASS | **FAIL** | PASS | PASS | **PARTIAL — see critical finding** |
| backward-seek (dedicated fixture) | PASS | PASS | **FAIL** | PASS | PASS | **FAIL — confirms critical finding** |
| animejs-adapter (regression fixture, 3 timelines) | PASS | **FAIL** | **FAIL** | PASS | PASS | **FAIL — see critical finding** |

Raw JSON summary and per-check expected/actual snapshots: `packages/producer/.debug/animejs-determinism-gate/`
(gitignored; regenerate with the command above).

## R6 checklist (the plan's named requirements)

- **Repeatability** (seek(f) twice ⇒ identical frame): **PASS**, all 8 fixtures, no exceptions.
- **Random seek order [90, 10, 50, 10] then direct seek equivalence**: PASS for springs, morph,
  drawable, split-text, seeded-stagger, backward-seek. **FAIL** for `animejs-adapter` and
  `nested-sync` — root cause below, not stagger/spring/morph specific.
- **Backward seek to 0 restores initial state**: PASS for springs, morph, drawable only.
  **FAIL** for the other 5 fixtures — same root cause as above.
- **Bounds clamping** (negative seek, seek past duration): **PASS**, all 8 fixtures, no exceptions.
- **Finite duration**: all 8 fixtures registered a finite duration and rendered; not separately
  itemized here since it's implicit in every check above succeeding at all.
- **Springs**: **PASS**. `anime.createSpring({ stiffness, damping, mass, velocity })` seeks
  deterministically; no scope-out needed for spring easing itself.
- **Morph** (`svg.morphTo`): **PASS**.
- **Split text** (`anime.text.split`): the character-split animation itself is deterministic
  under repeat-seek and random-forward-seek; only backward-seek-to-0 fails, and only because of
  the critical finding below (its first tween starts at timeline position 500ms, not 0).
- **Nested `.sync()` timelines**: **FAIL** on both non-repeat checks. The synced child starts at
  a non-zero parent position (`parent.sync(child, 1800)`), which is exactly the pattern the
  critical finding describes.
- **Seeded stagger**: the stagger jitter itself is confirmed deterministic (random-seek-then-direct
  passes cleanly) — this is NOT a stagger/randomness problem. Only backward-seek-to-0 fails, same
  root cause as above (its first stagger tween starts at timeline position 0 for one group but a
  later position for the second stagger group in this fixture).
- **No leaked timers**: **PASS**, all 8 fixtures — `anime.engine` reports no active work
  (no rAF loop, no pending timeline) after every check, and every throwaway page's `page.close()`
  resolved within the 3s budget. Documented limitation (see `packages/producer/tests/README.md`):
  this checks anime.js's own engine-liveness signal and page-close promptness, not raw OS timer
  handles directly.

## Critical finding: timeline children at a non-zero position are not rendered until the
## timeline has been sought to (or past) their start position at least once

This is the actual, singular root cause behind every failure above except the clean springs/
morph/drawable passes, confirmed by direct inspection of the failing snapshots and a standalone
reproduction outside the fixture harness.

**Mechanism**: in anime.js 4.5.0, a `createTimeline()` child added at a position greater than 0
(e.g. `tl.add(target, {...}, 1200)`) is not "pre-rendered" to its `from` value when the timeline
is created or registered. If a paused timeline instance's very first `seek()` call targets a time
*before* that child's start position, the child's target element is left completely untouched —
not at its tween's `from` value, but at whatever the page's raw, un-animated DOM/CSS state is.
Once the timeline has been sought to (or past) that child's start position even once, the child
becomes "engaged," and from then on, seeking back to any earlier time (including before its start
position) correctly renders its `from` value. In other words: **the rendered DOM at a given time
depends on seek history, not purely on the time value** — a direct violation of the determinism
contract R6 exists to enforce.

**Evidence** (from `packages/producer/.debug/animejs-determinism-gate/animejs-determinism-backward-seek/backward-seek-zero-{expected,actual}.json`,
fixture: `#late-card` tween added at position `1200` with `rotate: [-8, 0]`, `translateY: [90, 0]`):

- `expected` (fresh page, single direct `seek(0)` call — this is exactly what real frame-0
  capture in the render pipeline does): `transform: "none"` (untouched).
- `actual` (fresh page, `seek(4.4)` then `seek(0)` — i.e. visit a time past the child's start,
  then return to 0): `transform: "matrix(0.990268, -0.139173, 0.139173, 0.990268, 0, 90)"`, which
  is exactly `rotate(-8deg) translateY(90px)` — the tween's authored `from` value.

A minimal standalone reproduction (single `createTimeline`, one child at position 0 with the same
`rotate`/`translateY` tween) confirms position-0 children do **not** have this problem: a cold
`seek(0)` on a never-touched instance correctly renders the `from` value immediately, and
backward seeks round-trip exactly. The bug is specific to non-zero timeline positions.

**Why this is not just a "backward seek" edge case — it can affect the real render pipeline
directly, not only Studio scrubbing.** The render engine's static-frame dedup pre-scan
(`armStaticDedup` / `computeStaticFrameSet` in `packages/engine/src/services/frameCapture.ts`)
is GSAP-only: it reads `window.__timelines` and marks the composition ineligible whenever
`tweenCount === 0` (`"no GSAP tweens (non-GSAP animation)"`), which is always true for a pure
anime.js composition. That means, for a pure anime.js render today, the pre-scan never runs and
never performs any exploratory seeks — so the very first seek the render pipeline ever issues
against a fresh page **is** `prepareFrameForCapture`'s call for frame 0, i.e. exactly the "cold,
single seek" scenario reproduced above. Concretely: any anime.js composition with a timeline
child that starts after position 0 will render every frame *before that child's start* with the
child in its untouched/raw-CSS state instead of its authored `from` value — a real, visible
first-render correctness bug, not only a scrubbing/editing concern. (Whether the untouched state
looks wrong depends on whether the author's base CSS happens to already match the tween's `from`
value — e.g. an element pre-hidden via `opacity: 0` in CSS masks this for opacity, but does not
mask it for transform-based reveals with no matching CSS default, which is the common case for
slide/rotate-in reveals.)

**Scope of impact**: any anime.js timeline with more than one child at different start positions
— i.e. essentially every non-trivial composition, including the extremely common staggered/
delayed-reveal authoring pattern this migration exists to support. This is *not* limited to
`.sync()`, split-text, or stagger specifically; those three fixtures caught it only because they
happen to use non-zero positions. `springs`/`morph`/`drawable` passed only because each fixture's
single tween starts at position 0.

## Recommendation (needs sign-off, not something this gate unit decides unilaterally)

Per this repo's root-cause convention, scoping "timeline children at a non-zero position" out of
the v1 authoring contract would be the bandaid, not the fix — it would eliminate the primary
reason to use timelines at all. The narrowly-scoped, likely-correct fix belongs in the U1 runtime
contract, not in content or skills: `hyperframesAnime.register()` (or the adapter's `discover()`
phase) should force one full priming pass — seek the instance to its total duration and back to
`0` — immediately upon registration, before the render engine's first real frame capture. That
would engage every child once, up front, making all subsequent seeks (forward, backward, random
order) consistent regardless of history, matching what the "warm" runs in this gate already prove
works correctly.

This gate deliberately does **not** implement that fix — it is a U1 runtime-contract change, out
of U3's file scope, and per this repo's process should get explicit sign-off before being shipped.
**U10/U11 content porting should not proceed for any composition using non-zero-position timeline
children until either (a) that runtime fix lands and this gate is re-run green, or (b) Miguel
explicitly accepts the current behavior and this file is updated to reflect a real scope-out
decision.**

## Features cleared for the v1 authoring contract today, unconditionally

- Spring easing (`anime.createSpring`)
- SVG morph (`anime.svg.morphTo`)
- SVG drawable/line-draw (`anime.svg.createDrawable`)
- `anime.stagger` jitter/ordering (the stagger mechanism itself, independent of the position-0
  finding above)
- Repeatability, bounds clamping, and timer/engine cleanup on seek, universally

## Features NOT cleared without the runtime fix above

- Any timeline with a child at a non-zero position (`.add(target, props, position)` with
  `position > 0`), including the common staggered-reveal pattern, `.sync()` at a non-zero
  position, and multi-tween timelines in general.
- `anime.text.split` per-character animation specifically when its first tween is added at a
  non-zero position (as authored in the fixture here); the split-and-animate mechanism itself is
  otherwise sound (same-frame repeat and random-seek both pass).

## Reproduction

```bash
bun install
bun run build
export PUPPETEER_EXECUTABLE_PATH="<path to a Chrome/Chrome-for-Testing binary>"
bun run --cwd packages/producer check:animejs-determinism
```

Golden MP4 baselines for the 8 fixtures under `packages/producer/tests/{animejs-adapter,
animejs-determinism-*}/` were intentionally left ungenerated by this unit (sandbox had no browser/
network); generate them with `bun run --cwd packages/producer docker:test:update <fixture-name>`
(Docker) or `bun run --cwd packages/producer test:update <fixture-name>` (host, non-hermetic) once
the runtime fix above is decided, so the baselines capture the agreed-upon behavior rather than
today's known-broken pre-start rendering.
