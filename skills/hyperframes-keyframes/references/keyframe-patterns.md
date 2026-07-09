# Keyframe Mechanism Reference

Use this after `SKILL.md` when choosing a concrete implementation mechanism. It is a parts shelf, not a style guide. Start with one primary mechanism; add supporting motion only when it clarifies the idea.

## Runtime Skeletons

Anime.js, default:

```html
<script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
<script>
  const root = document.querySelector("[data-composition-id]");
  const id = root.dataset.compositionId;
  const tl = anime.createTimeline({ autoplay: false });

  tl.add(
    "<selector>",
    {
      translateX: [
        { to: 0, duration: 0, ease: "linear" },
        { to: 220, duration: 800, ease: "outCubic" },
        { to: 180, duration: 400, ease: "inOutQuad" },
      ],
      opacity: [
        { to: 0, duration: 0, ease: "linear" },
        { to: 1, duration: 250, ease: "outQuad" },
        { to: 1, duration: 950, ease: "linear" },
      ],
    },
    0,
  );

  hyperframesAnime.register(id, tl, {
    labels: { intro: 0, peak: 0.8, settle: 1.2 },
  });
</script>
```

Remember the unit split: anime.js arguments are milliseconds, HyperFrames labels and `data-*` timing are seconds.

CSS:

```css
.<subject > {
  animation: <name> <duration> <ease> both;
  animation-iteration-count: 1;
}
@keyframes <name> {
  0% {
    transform: <pose-a>;
    opacity: <a>;
  }
  100% {
    transform: <pose-b>;
    opacity: <b>;
  }
}
```

Three/WebGL with anime.js state proxy:

```js
const state = { progress: 0 };
const tl = anime.createTimeline({ autoplay: false, onUpdate: renderScene });

tl.add(state, { progress: 1, duration: <durationMs>, ease: "linear" }, 0);

function renderScene() {
  // derive camera/object/material values from state.progress
  renderer.render(scene, camera);
}

renderScene();
hyperframesAnime.register("<composition-id>", tl, { labels: {} });
```

> **Non-default GSAP adapter path.** Use this only for existing GSAP compositions or deliberate GSAP adapter work.

GSAP:

```js
const root = document.querySelector("[data-composition-id]");
const id = root.dataset.compositionId;
const tl = gsap.timeline({ paused: true });
tl.to("<selector>", {
  keyframes: [
    /* derive poses from the scene */
  ],
  ease: "none",
});
window.__timelines = window.__timelines || {};
window.__timelines[id] = tl;
```

## Mechanisms

| Mechanism           | Solves                                         | Keyframe                                                           | Runtime                                                                                  | Verify                                         |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Path travel         | Subject must visibly follow a route            | path progress, tangent rotation, follower offset, trail opacity    | sampled x/y/z via anime keyframes; GSAP MotionPath (non-default)                         | strip shot at bends; final snapshot            |
| Stroke draw         | A line, ring, or outline appears over time     | dash/draw range, stroke opacity, endpoint state                    | anime SVG helpers or SVG dash fallback; GSAP DrawSVG (non-default)                       | partial mid snapshot; complete final           |
| Shape interpolation | One silhouette becomes another                 | source path, middle path, target path, fill/stroke                 | anime value/keyframes with deterministic path interpolation; GSAP MorphSVG (non-default) | first/mid/final snapshots                      |
| Shared element      | Same subject changes box or hierarchy          | source box, target box, x/y, scale, radius, context opacity        | manual FLIP with anime transforms; GSAP Flip (non-default)                               | one identity moves; no substitute crossfade    |
| Clip/mask reveal    | Animated boundary exposes content              | clip path, mask position/size, edge softness, inner counter-motion | anime/CSS/SVG or shader uniform; GSAP adapter when porting (non-default)                 | snapshot edge frames and final unclipped state |
| Ordered repetition  | Many items enter, leave, or transform in order | indexed delay, x/y, scale, opacity, final alignment                | Anime stagger with grid/index delay, GSAP stagger (non-default), CSS vars                | check first/middle/last item timing            |
| Text subdivision    | Text motion needs readable internal timing     | line/word/char/band wrappers, y/x, opacity, final fit              | Anime text split, authored spans, GSAP SplitText (non-default)                           | strip shot plus final readability snapshot     |
| Surface transform   | Image/card stretches, crops, or changes shape  | parent scale/skew/clip, child counter-scale, transform origin      | anime keyframes, CSS keyframes, GSAP adapter (non-default)                               | no accidental warped final                     |
| UI state machine    | Interface passes through semantic states       | closed, active, loading, success/error, final                      | anime.js timeline by default, CSS keyframes, GSAP adapter (non-default)                  | snapshots hit states in order                  |
| DOM depth           | HTML elements need 3D separation               | perspective, z, rotationX/Y, opacity, crossing layer order         | CSS 3D plus anime transforms, CSS keyframes, or GSAP adapter (non-default)               | angled `--shot`; overlap snapshot              |
| Camera/object 3D    | Canvas/WebGL scene moves in depth              | camera, target, object transform, material opacity                 | Three.js/WebGL plus anime state proxy; GSAP proxy (non-default)                          | `--ghost`; snapshots at proof poses            |
| Shader uniform      | Pixel effect is driven by scalar progress      | progress, edge width, noise, color mix, opacity                    | ShaderMaterial/WebGL uniforms driven by anime object state                               | `--ghost`; snapshot 0/edge/mid/final           |
| Instanced system    | Many 3D objects move as one system             | instance transforms, scale, color/opacity, camera                  | Three InstancedMesh driven by anime object state                                         | snapshots, because DOM boxes miss internals    |
| Imported model      | Model animation must scrub deterministically   | `AnimationMixer.setTime`, camera, material, lights                 | Three AnimationMixer driven from HyperFrames time                                        | drive from HyperFrames time; `--ghost`         |

## Anime.js Ease Reference

When authoring anime.js directly, use anime's native ease strings. Use GSAP dot-notation only inside a non-default GSAP adapter section or when documenting a port.

| Familiar GSAP ease   | Anime.js ease        |
| -------------------- | -------------------- |
| `none`               | `linear`             |
| `power1.in`          | `inQuad`             |
| `power1.out`         | `outQuad`            |
| `power1.inOut`       | `inOutQuad`          |
| `power2.in`          | `inCubic`            |
| `power2.out`         | `outCubic`           |
| `power2.inOut`       | `inOutCubic`         |
| `power3.*`           | `*Quart`             |
| `power4.*`           | `*Quint`             |
| `back.out(1.7)`      | `outBack(1.7)`       |
| `elastic.out(1,0.3)` | `outElastic(1, 0.3)` |
| `steps(4)`           | `steps(4)`           |
| `expo.inOut`         | `inOutExpo`          |
| `sine.out`           | `outSine`            |
| `circ.in`            | `inCirc`             |
| `bounce.out`         | `outBounce`          |

The `*` prefix pattern applies to `in`, `out`, and `inOut` for Quad, Cubic, Quart, Quint, Bounce, Expo, Sine, and Circ.

## Anime.js Stagger Pattern

`anime.stagger(value, { grid, from, axis })` is deterministic and index-based. It does not use randomness.

```js
const tl = anime.createTimeline({ autoplay: false });

tl.add(
  ".cell",
  {
    translateY: [0, -120],
    scale: [1, 1.24],
    backgroundColor: "#0ea5e9",
    duration: 1400,
    delay: anime.stagger(65, { grid: [5, 4], from: "center" }),
    ease: "inOut(2)",
  },
  400,
);

hyperframesAnime.register("stagger-grid", tl, {
  labels: { firstWave: 0.4, end: 1.8 },
});
```

This assumes the root composition uses `data-composition-id="stagger-grid"`.
If you layer jitter or randomness on top of a stagger, use a seeded PRNG such as `mulberry32`. Never use `Math.random()` in render-critical motion.

## One Property Owner Rule

One property owner per element across registered instances. Two independently registered anime.js timelines or animations writing the same property on the same element are order-dependent under independent seeks and are forbidden for render-critical motion. This applies across engines too, so an anime.js timeline and a GSAP timeline must not both own `opacity`, `translateX`, `scale`, or any other render-critical property on the same element.

## Source Links

- Anime.js timeline and `createTimeline`: https://animejs.com/documentation/timeline/
- Anime.js `animate`: https://animejs.com/documentation/animation/
- Anime.js CSS variables: https://animejs.com/documentation/animation/animatable-properties/css-variables/
- Anime.js keyframes: https://animejs.com/documentation/animation/keyframes/
- Anime.js easings: https://animejs.com/documentation/easings/
- Anime.js stagger: https://animejs.com/documentation/utilities/stagger/
- Anime.js stagger grid: https://animejs.com/documentation/utilities/stagger/stagger-parameters/stagger-grid/
- GSAP keyframes: https://gsap.com/resources/keyframes/
- GSAP timeline: https://gsap.com/docs/v3/GSAP/Timeline/
- GSAP MotionPathPlugin: https://gsap.com/docs/v3/Plugins/MotionPathPlugin/
- GSAP Flip: https://gsap.com/docs/v3/Plugins/Flip/
- GSAP DrawSVGPlugin: https://gsap.com/docs/v3/Plugins/DrawSVGPlugin/
- GSAP MorphSVGPlugin: https://gsap.com/docs/v3/Plugins/MorphSVGPlugin/
- GSAP SplitText: https://gsap.com/docs/v3/Plugins/SplitText/
- GSAP CSSPlugin: https://gsap.com/docs/v3/GSAP/CorePlugins/CSS/
- MDN CSS animations: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_animations/Using_CSS_animations
- MDN `@keyframes`: https://developer.mozilla.org/en-US/docs/Web/CSS/@keyframes
- MDN `clip-path`: https://developer.mozilla.org/en-US/docs/Web/CSS/clip-path
- MDN CSS masking: https://developer.mozilla.org/en-US/docs/Web/CSS/mask
- MDN perspective: https://developer.mozilla.org/en-US/docs/Web/CSS/perspective
- MDN transform-style: https://developer.mozilla.org/en-US/docs/Web/CSS/transform-style
- Three.js AnimationMixer: https://threejs.org/docs/#api/en/animation/AnimationMixer
- Three.js ShaderMaterial: https://threejs.org/docs/#api/en/materials/ShaderMaterial
- Three.js InstancedMesh: https://threejs.org/docs/#api/en/objects/InstancedMesh
