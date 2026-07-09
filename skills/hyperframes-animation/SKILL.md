---
name: hyperframes-animation
description: "All animation knowledge for HyperFrames: atomic motion rules, multi-phase scene blueprints, scene transitions, broader motion-design techniques, and runtime adapters (anime.js first-party default, plus GSAP, Lottie, Three.js, CSS keyframes, Web Animations API, TypeGPU). Use for any motion or animation task: pick 2-4 rules and compose, or load a blueprint, or look up runtime-specific API (e.g. anime.js timelines / GSAP eases / Lottie player / Three.js mixer). Also covers auditing an existing composition's choreography (animation map) and 24 named text-animation effects. HyperFrames-native: paused seekable runtime, deterministic."
---

# HyperFrames Animation

All motion knowledge in one skill: **rules** (atomic recipes), **blueprints** (multi-phase scene templates), **transitions** (scene-to-scene), **techniques** (broader motion-design patterns), and **adapters** (per-runtime APIs).

For the composition contract (data attributes, sub-compositions, determinism) see `hyperframes-core`.

## Default: compose atomic rules

Pick 2-4 rules from `rules-index.md`, glue them together with a single paused anime.js timeline (or GSAP, still supported), done. This is faster and produces less code than starting from a blueprint.

## Load a blueprint when

- The scene matches an existing pre-designed multi-phase template (brand-reveal, social-proof, etc.) and reusing its phase pipeline saves real authoring time
- You want runnable ground-truth code for a complex 4-5 phase choreography

Blueprints live in `blueprints-index.md`. Each entry points to `blueprints/<id>.md` (recipe). Do not read it speculatively; load it when you've already decided you need scene-level orchestration.

## Routing

| Want to…                                                                       | Read                                                |
| ------------------------------------------------------------------------------ | --------------------------------------------------- |
| Pick an atomic motion pattern by trigger / tag                                 | `rules-index.md`                                    |
| Read one rule's full HTML / CSS / motion recipe                                | `rules/<name>.md`                                   |
| Pick a multi-phase scene template                                              | `blueprints-index.md`                               |
| Read one blueprint's full recipe                                               | `blueprints/<id>.md`                                |
| Author a scene transition (CSS-driven, between two clips)                      | `transitions/overview.md`, `transitions/catalog.md` |
| Look up a broader motion-design technique                                      | `techniques.md`                                     |
| Analyze an existing composition's animation map                                | `scripts/animation-map.mjs`                         |
| Anime.js API (first-party default)                                             | `adapters/animejs.md`                               |
| GSAP API, supported non-default timeline / tweens / position parameters        | `adapters/gsap.md`                                  |
| GSAP drop-in effect recipes                                                    | `rules/gsap-effects.md`                             |
| GSAP transforms / perf                                                         | `adapters/gsap-transforms-and-perf.md`              |
| GSAP eases / stagger                                                           | `adapters/gsap-easing-and-stagger.md`               |
| GSAP timeline / labels                                                         | `adapters/gsap-timeline-and-labels.md`              |
| Lottie / dotLottie (After Effects exports, `window.__hfLottie`)                | `adapters/lottie.md`                                |
| Three.js / WebGL (3D scenes, `AnimationMixer`, `hf-seek`)                      | `adapters/three.md`                                 |
| CSS keyframes (`animation-delay` / `play-state` / `fill-mode`)                 | `adapters/css-animations.md`                        |
| Web Animations API (`element.animate()`, `currentTime` seek)                   | `adapters/waapi.md`                                 |
| TypeGPU / WebGPU (`navigator.gpu`, WGSL, compute pipelines)                    | `adapters/typegpu.md`                               |
| HTML-as-texture + WebGL/GLSL post-fx (capture live DOM via `drawElementImage`) | `adapters/html-in-canvas-patterns.md`               |
| Named text-animation effects (24 IDs via external `animate-text` skill)        | `adapters/animate-text.md`                          |

## Picking a runtime

- **Anime.js** is the first-party default for general motion work: timeline orchestration, transforms, easing, stagger, text effects, and SVG motion.
- **GSAP** is a supported alternative for existing GSAP compositions or when the GSAP-specific API is the right fit for complex orchestration.
- **Lottie** when an asset has its own pre-baked timeline (typically After Effects exports).
- **Three.js** for 3D scenes, camera motion, shader-driven visuals.
- **CSS** for simple repeated motifs, decoration, shimmer, with no JavaScript animation cost.
- **WAAPI** for native browser keyframes without an external runtime dependency.
- **TypeGPU / WebGPU** for GPU-rendered canvases (particles, liquid glass, custom shaders).

Multiple runtimes can coexist in one composition. Each uses its runtime-specific registration or discovery contract so HyperFrames can seek all of them in one pass.

## Critical Constraints

**Prerequisite: `hyperframes-core` -> Non-Negotiable Rules** (paused seekable runtime registered synchronously, `data-duration` governs length when explicit, no `Math.random` / `Date.now` / `performance.now`, finite loops unless root `data-duration` is explicit, no immediate setters on later-scene clips, no `display` / `visibility` animation, no timeline construction inside `async` / `setTimeout` / `Promise`). Don't restate those here.

Animation-craft additions on top of core's contract:

- **Pre-calculated layout constants**: never derive positions from `getBoundingClientRect()` at tween time. Tween-time DOM measurements desync because the renderer samples in parallel; compute coordinates once at composition setup and reuse.
- **Spatial motion uses transform properties only** (`translateX`, `translateY`, `scale`, `rotate`, or adapter aliases). Core's allowlist also permits `opacity` / `color` / `backgroundColor` / `borderRadius` for non-spatial property tweens, but never `width` / `height` / `top` / `left` for layout changes.

## Scripts

```bash
node skills/hyperframes-animation/scripts/animation-map.mjs <composition-dir> \
  --out <composition-dir>/.hyperframes/anim-map
```

Reads registered GSAP timelines, enumerates tweens, samples bboxes, computes flags, outputs `animation-map.json`. Use it to audit choreography (dead zones, stagger consistency, lifecycle warnings) after authoring.

`animation-map.mjs` resolves helper packages from the current project first, then can bootstrap the bundled HyperFrames package version. Set `HYPERFRAMES_SKILL_PKG_VERSION=<version>` only when running the skill outside the bundled CLI/skill install and you need to pin that bootstrap version explicitly.

## See Also

- `hyperframes-core`: composition structure, data attributes, sub-compositions, deterministic render contract
- `hyperframes-creative`: palettes, typography, narration, beat planning (non-animation creative direction)
- `hyperframes-cli`: `npx hyperframes lint / validate / inspect / preview / render`
