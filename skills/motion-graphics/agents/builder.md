# Motion-Graphics Builder

Turn `shot-plan.json` into one renderable HyperFrames composition at the
project root (`index.html`). The pinned HyperFrames CLI loads this root entry;
do not leave the composition only under `compositions/`. Everything stays in
the HF ecosystem — HTML is the source of truth; a single **paused** GSAP
timeline carries all motion; the engine seeks it. Category-specific build rules
live in `categories/<id>/module.md`; this file is the shared contract.

## Reuse-first (the default)

Default = **compose existing catalog capabilities, not hand-author**:

- **Search first, for every named effect** — `npx hyperframes catalog --query "<the move, in plain English>" --json`, including an effect the user names after the plan is written. It needs nothing installed and no project. Author by hand only after a search came back with nothing that does the job, and report that miss with `npx hyperframes feedback --search-miss`.
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

Build the **hero-frame end-state** in CSS first (flex + padding; never absolute offsets on content containers; the root must be sized). Use `fromTo()` for elements inside `.clip` and for any delayed entrance; `from()` is safe only for non-clip elements active from `t=0`. Exits belong to transitions or the final scene. Full rules: `references/builder-contract.md`.

## IR → composition

- `content.block` → `hyperframes add` it (or inline) + apply `content.customize`.
- per-category `content` (text scenes / chart data / fusion positions / news-tweet content) → realize per `categories/<id>/module.md`.
- resolved `asset_needs` → reference **frozen project-local paths** (never a remote URL or a prompt).
- A Quiver need is consumed only after Source records a completed local SVG and
  matching preview. Provider prompts and remote URLs never enter the
  composition.
- `palette[-1]` / bg + `font` from the envelope.
- `export: alpha-overlay` → transparent bg; render `--format webm` (or `mov`).

The current Quiver animation evidence is **INDETERMINATE / BLOCKED** for
HyperFrames compatibility. Do not claim a Quiver-native animated asset or
silently substitute local SVG editing or prompt regeneration. If the user did
not request Quiver-native animation, ordinary whole-asset GSAP motion over the
frozen local SVG remains valid and must still use this paused root timeline.

## Intent-bound motion proof

Every motion-graphics handoff includes `index.motion.json` beside the root
`index.html`. Derive its non-empty `assertions` from the final shot plan's
planned visibility and framing timings, using selectors for IDs that actually
exist in the authored HTML. Use the supported HyperFrames shape, for example:

```json
{
  "duration": 5,
  "assertions": [
    { "kind": "appearsBy", "selector": "#logo-reveal", "bySec": 1.6 },
    { "kind": "staysInFrame", "selector": "#logo-reveal" }
  ]
}
```

Use `appearsBy` for a planned reveal and `staysInFrame` for a planned framing
constraint. Do not add a generic whole-shot `keepsMoving` assertion to make an
intentional final hold pass. Use `keepsMoving` only when continuous motion is
explicitly part of the shot plan and scope it to an actual element or group.

Before handoff, run a fresh `hyperframes check --json` and the relevant fresh
proof snapshots. Confirm the report has `motion.enabled: true`, a nonzero
`motion.samples` count, the authored sidecar path, and no motion findings. A
disabled or zero-sample motion audit is an incomplete handoff and cannot be
reported as passed.

## Critical correctness (GSAP / seek)

Opacity-gate delayed elements (set hidden until their entrance). Clamp at tween bounds (no overshoot past a held value). Allowed eases: `power1–4`, `back`, `bounce`, `circ`, `elastic`, `expo`, `sine` (`.in/.out/.inOut`). One motif per scene. Run `hyperframes check` for overflow / collisions.

## Hand off for verification

Self-check the authored root `index.html`, then return it to the orchestrator.
Step 5 runs `hyperframes lint`, `hyperframes check`, and proof snapshots on the
assembled project. Do not render. When redispatched with a finding, fix the
offending element in root `index.html` and never change a fixed
`data-duration` during repair. Remotion-source migrations use
`/remotion-to-hyperframes` and its SSIM harness instead.
