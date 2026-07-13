# Motion-Graphics Builder

Turn `shot-plan.json` into one renderable HyperFrames composition (`compositions/index.html`). Everything stays in the HF ecosystem — HTML is the source of truth; a single **paused** GSAP timeline carries all motion; the engine seeks it. Category-specific build rules live in `categories/<id>/module.md`; this file is the shared contract.

## Reuse-first (the default)

Default = **compose existing catalog capabilities, not hand-author**:

- `npx hyperframes add <block>` (registry) → customize in place. Most blocks bake content/data into their own script (only a few expose CSS-var params), so reuse = **add + edit**.
- `hyperframes-animation` rules / blueprints / transitions for motion; runtime adapters (GSAP default).

Hand-author only (a) gaps no block/rule covers, (b) the `asset-fusion` affordance binding. The Director named the block(s) + customizations in `shot-plan.json` (`content.block` + `content.customize`); see `catalog-map.md`.

## The HF contract (non-negotiable)

- Root `#stage` carries `data-composition-id`, `data-start="0"`, `data-duration=<s>`, `data-fps`, `data-width`, `data-height`.
- Exactly ONE `gsap.timeline({ paused:true })`; register `window.__timelines["<id>"] = tl;`; end with `tl.seek(0)`. **Never `tl.play()`** for render-critical motion. No timers / async / event-driven timeline build. Finite repeats only.
- **Timed clips** need `class="clip"` + a stable `id`. Timeline-driven groups inside one full-duration clip don't each need timing attrs.
- **Fonts**: prefer local `@font-face` (.woff2) for deterministic / offline render; CDN Google Fonts do render (compiler caches + injects `@font-face`) but warn + need network.
- **Deterministic only** — no `Date.now()` / `Math.random()` / network.

## Layout before animation

Build the **hero-frame end-state** in CSS first (flex + padding; never absolute offsets on content containers; the root must be sized). Then `gsap.from()` entrances INTO it; exits via transitions or the final scene. Full rules: `references/builder-contract.md`.

## IR → composition

- `content.block` → `hyperframes add` it (or inline) + apply `content.customize`.
- per-category `content` (text scenes / chart data / fusion positions / news-tweet content) → realize per `categories/<id>/module.md`.
- resolved `asset_needs` → reference **frozen project-local paths** (never a remote URL or a prompt).
- `palette[-1]` / bg + `font` from the envelope.
- `export: alpha-overlay` → transparent bg; render `--format webm` (or `mov`).

## Critical correctness (GSAP / seek)

Opacity-gate delayed elements (set hidden until their entrance). Clamp at tween bounds (no overshoot past a held value). Allowed eases: `power1–4`, `back`, `bounce`, `circ`, `elastic`, `expo`, `sine` (`.in/.out/.inOut`). One motif per scene. Run `hyperframes check` for overflow / collisions.

## Verify-fix

`hyperframes lint` → `inspect` → `render -q draft`. On failure, fix the offending element + re-run. (Remotion-sourced prior art is graded by the `/remotion-to-hyperframes` SSIM harness.) **Never change a fixed `data-duration` during repair.**
