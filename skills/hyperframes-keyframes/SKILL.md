---
name: hyperframes-keyframes
description: >
  Use when a HyperFrames composition needs seek-safe 2D/3D keyframes, GSAP
  timelines, CSS keyframes, Anime.js, WAAPI, FLIP, paths, masks, SVG morph/draw,
  text trails, cursor demos, 3D depth, or `hyperframes keyframes` diagnostics.
  Don't use for broad scene strategy, brand design, media sourcing, captions, or
  general video planning.
---

# HyperFrames Keyframes

Keyframes are a pose contract: visible states, continuous subject identity, seek-safe runtime, verified pixels.

Use `hyperframes-animation` for broad scene recipes.
Use `hyperframes-cli` for full command docs.
Use `references/keyframe-patterns.md` only when choosing implementation mechanisms, not visual style.

## Procedure

1. Identify the animated subject, visible states, final state, and runtime.
2. Choose the smallest mechanism that proves the prompt. Read `references/keyframe-patterns.md` only if the mechanism is unclear.
3. Author seek-safe keyframes in the declared runtime. Build synchronously and register the runtime instance.
4. Verify with lint, validate, `hyperframes keyframes`, one focused `--shot`, and snapshots at proof times.
5. If proof fails, fix the source keyframes and rerun the smallest failing diagnostic before rendering.

## Contract

- Name the moving subject.
- Name the poses needed to prove the intended motion, including the final state.
- Keyframe visible channels, not hidden helper state.
- Preserve object identity when continuity matters.
- Crossfade only when the intended motion is replacement or dissolve.
- Hold readable or semantic states long enough to see.
- Final frame is part of the animation, not cleanup.
- Do not reset to rest unless requested.
- Do not end on black unless requested.
- If editing a starter scene, preserve layout, copy, assets, colors, and final state unless asked to redesign.

## Runtime Rules

GSAP:

- build synchronously at page load
- use `gsap.timeline({ paused: true })`
- register as `window.__timelines[compositionId]`
- registry key must match `data-composition-id`
- do not call `tl.play()` for render-critical motion
- keep repeats finite

CSS keyframes:

- finite duration and iteration count
- deterministic delay
- `animation-fill-mode: both`
- use `data-start` when timing belongs to a clip

Anime.js:

- create synchronously
- `autoplay: false`
- finite duration and loops
- push every instance to `window.__hfAnime`

WAAPI:

- finite `duration`
- `fill: "both"`
- deterministic construction
- the text surface does not list WAAPI; verify with `--shot` (it seeks WAAPI) and snapshots

Never use for render-critical motion:

- `Date.now()`
- `performance.now()`
- unseeded `Math.random()`
- hover/scroll triggers
- timers
- async-created timelines
- unregistered `requestAnimationFrame`
- infinite loops

## GSAP Skeleton

```js
const root = document.querySelector("[data-composition-id]");
const compositionId = root.dataset.compositionId;
const tl = gsap.timeline({ paused: true });

tl.addLabel("state-a", 0);
tl.to(".subject", {
  keyframes: [
    { x: 0, opacity: 1, duration: 0.2 },
    { x: 120, opacity: 1, duration: 0.4, ease: "power2.out" },
    { x: 100, opacity: 1, duration: 0.2, ease: "power2.inOut" },
  ],
  ease: "none",
});

window.__timelines = window.__timelines || {};
window.__timelines[compositionId] = tl;
```

Use labels for semantic states.
Use position parameters instead of chained delays.
Use `immediateRender: false` for later `from()`/`fromTo()` tweens touching the same property.

## Keyframe Forms

- Array keyframes: pose ladder with per-step duration/ease.
- Percentage keyframes: exact timing inside one tween.
- Property arrays: compact multi-stop changes.
- `ease: "none"` on the parent when each stop carries its own easing.
- `easeEach` when every segment should share the same feel.

Do not copy numeric distances or timing from examples. Derive them from the actual composition geometry and duration.

For one subject moving between two boxes, prefer one continuous transform tween or FLIP. Split `x/y/scale` into multiple eased keyframes only when the viewer should feel distinct beats; every segment changes velocity and can read as a hitch.

## Channels

Prefer compositor/visual channels:
`x/y/z`, `xPercent/yPercent`, `scale`, `rotationX/Y/Z`, `skew`, `transformOrigin`, `svgOrigin`, `opacity`, `autoAlpha`, `clip-path`, masks, CSS vars, SVG path/dash values, camera transforms, shader uniforms.

Avoid layout/lifecycle channels:
`top/left/right/bottom`, `width/height`, `margin/padding`, `display`, `visibility`, late DOM creation, helper overlays doing subject motion.

## Mechanism Choice

Choose the smallest mechanism that proves the prompt:

| Need                                  | Mechanism                                          |
| ------------------------------------- | -------------------------------------------------- |
| Same subject changes box or hierarchy | shared element / FLIP                              |
| Subject travels a visible route       | path travel                                        |
| Stroke grows or traces                | stroke draw                                        |
| Shape becomes another shape           | shape interpolation                                |
| Reveal boundary is visible            | clip, mask, or shader uniform                      |
| Many items move with order            | stagger / indexed delay                            |
| Text itself moves                     | line, word, character, or band subdivision         |
| Surface bends, stretches, or crops    | parent/child counter-transform                     |
| UI has states                         | explicit state machine                             |
| Scene has depth                       | DOM 3D, Three.js, or WebGL camera/object keyframes |

Mechanisms can combine, but each one must clarify the idea. Decoration is not proof.

## Timing

- Anticipation only when it clarifies cause or direction.
- Acceleration leaves rest.
- Peak proof shows the mechanism unmistakably.
- Follow-through sells energy and direction.
- Overshoot only when the subject should feel elastic or tactile.
- Constant-speed path travel usually needs `ease: "none"`.
- Discrete UI states usually need a sharp ease-out.
- Repeated elements need ordered offsets, not identical timing.
- Final lockups need longer holds than transition poses.
- Smoothness means continuous velocity on the same subject.
- Do not overlap tweens that write the same transform property unless the overlap is intentional and verified.
- Avoid animating large `clip-path`/mask changes while the same hero surface is also scaling or traveling; use nested reveals after the main move settles.

## Text

Preserve line boxes, word spacing, readability, and final fit. If text moves internally, move the glyphs or masked bands, not only decorations around the text. Snapshot readable frames.

## SVG

For stroke growth prefer `DrawSVGPlugin`, then `stroke-dasharray`/`stroke-dashoffset`.
For shape interpolation prefer `MorphSVGPlugin`; convert primitives to paths when needed and split complex silhouettes into simpler parts.

## 3D

Scale alone is fake depth.
Use perspective on a stable parent, `transform-style: preserve-3d`, z travel, rotation, camera/world motion, occlusion, and layer order when objects cross.

Use one or two diagnostic angles that expose the depth relationship. If angled proof shows no depth crossing, improve z/camera/occlusion.

## Canvas / WebGL

Keyframe camera position, camera target, object transform, material opacity, shader uniforms, and postprocess intensity through deterministic state. Render from HyperFrames time. Use `--ghost` because marker boxes cannot see internal canvas motion.

## CLI Proof

```bash
npx hyperframes lint
npx hyperframes validate
npx hyperframes keyframes .
npx hyperframes keyframes . --json
npx hyperframes keyframes . --runtime all
npx hyperframes keyframes . --selector "<selector>" --shot "<file>" --samples <n>
npx hyperframes keyframes . --selector "<selector>" --shot "<file>" --layout strip --from <t0> --to <t1>
npx hyperframes keyframes . --shot "<file>" --ghost --angle <angle>
npx hyperframes snapshot . --at <times>
```

Choose `<selector>` for the real animated subject.
Choose `<times>` for first frame, proof poses, final-minus-hold, and exact final.
Choose `<angle>` only when depth must be proven.

| Tool             | Proves                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `keyframes`      | targets, explicit stops, paths, traces, composed parent/child motion, CSS stops, Anime registration |
| `--shot`         | ghosts, route shape, time spacing, DOM 3D projection, focused selector proof                        |
| `--layout strip` | in-place motion, overlaps, contact, subtle scale/opacity, text waves                                |
| `--ghost`        | canvas, WebGL, shader motion, rendered 3D                                                           |
| `snapshot --at`  | masks, text readability, full state, final lockup, black/reset tails                                |

If selector proof looks wrong:

1. rerun `--json`
2. find the actual animated target
3. shoot that target
4. snapshot full frames
5. trust painted pixels over logs

## Diagnostic Reading

`flat` means no explicit middle poses. `keyframes` means explicit stops exist. `motionPath` means a route exists. `trace` means multi-stroke drawing. `composed with` means child motion inherits parent motion.

Even ghost spacing means constant speed. Clustered ghosts mean slow-in or settle. Large gaps mean fast travel.

A helper-selector shot is not proof. An onion shot over a broken full frame is not proof.

## Error Handling

| Failure            | Fix                                                                                |
| ------------------ | ---------------------------------------------------------------------------------- |
| endpoint-only      | add middle poses, hold peak proof, rerun `--shot`                                  |
| identity break     | keep one element alive, use shared source/final boxes, remove substitute crossfade |
| fake 3D            | add z/camera travel, occlusion, angled proof                                       |
| wrong final        | add final hold, snapshot final-minus-hold and exact final                          |
| unseekable runtime | pause autoplay, register instance, remove timers, build synchronously              |
| unreadable text    | preserve line boxes, reduce displacement, add final hold, snapshot text frames     |

## Done

Run lint, validate, keyframes, one focused `--shot`, and snapshots. Confirm first frame, proof poses, final-minus-hold, exact final, subject-owned motion, and no debug overlays.
