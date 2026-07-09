---
name: hyperframes-keyframes
description: >
  Use when a HyperFrames composition needs seek-safe 2D/3D keyframes, anime.js
  timelines or animations, GSAP adapter timelines, CSS keyframes, WAAPI, FLIP,
  paths, masks, SVG morph/draw, text trails, 3D depth, or `hyperframes
  keyframes` diagnostics. Don't use for broad scene strategy, brand design,
  media sourcing, captions, or general video planning.
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

Anime.js is the default runtime for new HyperFrames authoring.

Anime.js:

- Load anime.js v4.5.0 with the canonical CDN script:
  `<script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>`
- Create timelines or animations synchronously at page load.
- Use `anime.createTimeline({ autoplay: false })` for timelines, or `anime.animate(..., { autoplay: false, ... })` for standalone animations.
- Register every render-critical instance with `hyperframesAnime.register(id, instance, { labels })`.
- `hyperframesAnime` is injected by the HyperFrames runtime at discovery time. Do not import it, define it, or push new authoring examples to `window.__hfAnime`.
- Use the composition's `data-composition-id` as the registration id by convention. Lint recommends this but does not enforce id equality for anime.js the way the GSAP adapter does.
- Keep durations and loops finite. If an anime call uses `loop: true` or `loop: -1`, the root composition must declare `data-duration="<seconds>"`.
- Critical unit rule: anime.js API values are milliseconds. `duration`, `delay`, `loopDelay`, and the `timeline.add(target, params, position)` position are all milliseconds. HyperFrames labels are seconds. `hyperframesAnime.register(id, tl, { labels: { intro: 0, outro: 2 } })` uses seconds because labels match `data-start` and `data-duration`.
- When porting GSAP to anime.js, multiply every GSAP duration, delay, stagger, and position by 1000. Do not multiply label values.
- One property owner per element across registered instances: two independently registered anime.js timelines or animations must not animate the same property on the same element. Independent seeks make that order-dependent. The rule is true across engines, but it is easy to violate when anime.js work is split into many small registered timelines.

> **Non-default GSAP adapter path.** GSAP remains fully supported for existing or ported compositions, but it is no longer the default authoring path.

GSAP:

- build synchronously at page load
- use `gsap.timeline({ paused: true })`
- register as `window.__timelines[compositionId]`
- registry key must match `data-composition-id`
- do not call `tl.play()` for render-critical motion
- keep repeats finite
- keep one property owner per element across registered timelines

CSS keyframes:

- CSS keyframes are supported, but they are not the default runtime contract.
- finite duration and iteration count
- deterministic delay
- `animation-fill-mode: both`
- use `data-start` when timing belongs to a clip

WAAPI:

- WAAPI is supported, but it is not the default runtime contract.
- finite `duration`
- `fill: "both"`
- deterministic construction
- the text surface does not list WAAPI; verify with `--shot` because it seeks WAAPI, and snapshots

Never use for render-critical motion:

- `Date.now()`
- `performance.now()`
- unseeded `Math.random()`
- hover or scroll triggers
- timers
- async-created timelines
- unregistered `requestAnimationFrame`
- open-ended loops without explicit composition duration
- multiple registered instances writing the same property on the same element

## Anime.js Skeleton

```html
<script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
<script>
  const root = document.querySelector("[data-composition-id]");
  const compositionId = root.dataset.compositionId;
  const tl = anime.createTimeline({ autoplay: false });

  tl.add(
    ".subject",
    {
      translateX: [
        { to: 0, duration: 0, ease: "linear" },
        { to: 260, duration: 900, ease: "outCubic" },
        { to: 220, duration: 500, ease: "inOutQuad" },
      ],
      translateY: [
        { to: 0, duration: 0, ease: "linear" },
        { to: -70, duration: 900, ease: "outCubic" },
        { to: 0, duration: 500, ease: "inOutQuad" },
      ],
      scale: [
        { to: 1, duration: 0, ease: "linear" },
        { to: 1.08, duration: 900, ease: "outBack(1.7)" },
        { to: 1, duration: 500, ease: "inOutQuad" },
      ],
      opacity: [
        { to: 0, duration: 0, ease: "linear" },
        { to: 1, duration: 250, ease: "outQuad" },
        { to: 1, duration: 1150, ease: "linear" },
      ],
    },
    200,
  );

  hyperframesAnime.register(compositionId, tl, {
    labels: { entrance: 0.2, peak: 1.1, settle: 1.6 },
  });
</script>
```

Use anime's native ease strings when authoring directly, such as `outQuad`, `inOutCubic`, `outBack(1.7)`, and `linear`.
Use position parameters instead of chained delays.
Use a zero-duration `.add()` for immediate state when an element must be hidden, shown, or reset at an exact seek time.

## GSAP Skeleton

> **Non-default GSAP adapter path.** Use this only for existing GSAP compositions or deliberate GSAP adapter work.

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
Use `immediateRender: false` for later `from()` or `fromTo()` tweens touching the same property.

## Keyframe Forms

- Anime.js per-property keyframe arrays: pose ladder with per-step duration/ease in milliseconds.
- Anime.js property arrays: compact two-stop or multi-stop changes when equal spacing is acceptable.
- Non-default GSAP adapter array keyframes: pose ladder with per-step duration/ease in seconds.
- CSS percentage keyframes: exact timing inside one named CSS animation.
- `ease: "linear"` on the parent when each anime stop carries its own easing.

Do not copy numeric distances or timing from examples. Derive them from the actual composition geometry and duration.

For one subject moving between two boxes, prefer one continuous transform tween or FLIP. Split `x/y/scale` into multiple eased keyframes only when the viewer should feel distinct beats; every segment changes velocity and can read as a hitch.

## Channels

Prefer compositor/visual channels:
`translateX/translateY/translateZ`, `x/y/z`, `xPercent/yPercent`, `scale`, `rotate`, `rotationX/Y/Z`, `skew`, `transformOrigin`, `svgOrigin`, `opacity`, `autoAlpha`, `clip-path`, masks, CSS vars, SVG path/dash values, camera transforms, shader uniforms.

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
- Constant-speed path travel usually needs `ease: "linear"`.
- Discrete UI states usually need a sharp ease-out.
- Repeated elements need ordered offsets, not identical timing.
- Final lockups need longer holds than transition poses.
- Smoothness means continuous velocity on the same subject.
- Do not overlap tweens that write the same transform property unless the overlap is intentional and verified.
- Avoid animating large `clip-path` or mask changes while the same hero surface is also scaling or traveling; use nested reveals after the main move settles.

## Text

Preserve line boxes, word spacing, readability, and final fit. If text moves internally, move the glyphs or masked bands, not only decorations around the text. Snapshot readable frames.

## SVG

For stroke growth prefer native anime.js SVG helpers or explicit `stroke-dasharray`/`stroke-dashoffset`.
For shape interpolation, use a deterministic path interpolation helper and convert primitives to paths when needed.

> **Non-default GSAP adapter path.** Existing GSAP compositions may use DrawSVGPlugin and MorphSVGPlugin when those plugins are available.

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

| Tool             | Proves                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `keyframes`      | targets, explicit stops, paths, traces, composed parent/child motion, CSS stops, anime.js registration |
| `--shot`         | ghosts, route shape, time spacing, DOM 3D projection, focused selector proof                           |
| `--layout strip` | in-place motion, overlaps, contact, subtle scale/opacity, text waves                                   |
| `--ghost`        | canvas, WebGL, shader motion, rendered 3D                                                              |
| `snapshot --at`  | masks, text readability, full state, final lockup, black/reset tails                                   |

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
| unseekable runtime | disable autoplay, register the runtime instance, remove timers, build sync         |
| unreadable text    | preserve line boxes, reduce displacement, add final hold, snapshot text frames     |

## Done

Run lint, validate, keyframes, one focused `--shot`, and snapshots. Confirm first frame, proof poses, final-minus-hold, exact final, subject-owned motion, and no debug overlays.
