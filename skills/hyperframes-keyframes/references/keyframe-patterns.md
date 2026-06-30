# Keyframe Mechanism Reference

Use this after `SKILL.md` when choosing a concrete implementation mechanism. It is a parts shelf, not a style guide. Start with one primary mechanism; add supporting motion only when it clarifies the idea.

## Runtime Skeletons

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

Anime.js:

```js
const animation = anime.timeline({ autoplay: false });
animation.add({ targets: "<selector>" /* derived channels */ });
window.__hfAnime = window.__hfAnime || [];
window.__hfAnime.push(animation);
```

Three/WebGL:

```js
const state = { progress: 0 };
tl.to(state, {
  progress: 1,
  duration: <duration>,
  onUpdate: () => {
    // derive camera/object/material values from state.progress
    renderer.render(scene, camera);
  },
});
```

## Mechanisms

| Mechanism           | Solves                                         | Keyframe                                                           | Runtime                                    | Verify                                         |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------ | ---------------------------------------------- |
| Path travel         | Subject must visibly follow a route            | path progress, tangent rotation, follower offset, trail opacity    | GSAP MotionPath or sampled x/y/z           | strip shot at bends; final snapshot            |
| Stroke draw         | A line, ring, or outline appears over time     | dash/draw range, stroke opacity, endpoint state                    | DrawSVG or SVG dash fallback               | partial mid snapshot; complete final           |
| Shape interpolation | One silhouette becomes another                 | source path, middle path, target path, fill/stroke                 | MorphSVG or path tween                     | first/mid/final snapshots                      |
| Shared element      | Same subject changes box or hierarchy          | source box, target box, x/y, scale, radius, context opacity        | GSAP Flip or manual FLIP                   | one identity moves; no substitute crossfade    |
| Clip/mask reveal    | Animated boundary exposes content              | clip path, mask position/size, edge softness, inner counter-motion | CSS, SVG, GSAP, or shader                  | snapshot edge frames and final unclipped state |
| Ordered repetition  | Many items enter, leave, or transform in order | indexed delay, x/y, scale, opacity, final alignment                | GSAP stagger, Anime stagger, CSS vars      | check first/middle/last item timing            |
| Text subdivision    | Text motion needs readable internal timing     | line/word/char/band wrappers, y/x, opacity, final fit              | SplitText, authored spans, Anime splitText | strip shot plus final readability snapshot     |
| Surface transform   | Image/card stretches, crops, or changes shape  | parent scale/skew/clip, child counter-scale, transform origin      | GSAP/CSS keyframes                         | no accidental warped final                     |
| UI state machine    | Interface passes through semantic states       | closed, active, loading, success/error, final                      | GSAP/CSS/Anime                             | snapshots hit states in order                  |
| DOM depth           | HTML elements need 3D separation               | perspective, z, rotationX/Y, opacity, crossing layer order         | CSS 3D + GSAP/CSS/Anime                    | angled `--shot`; overlap snapshot              |
| Camera/object 3D    | Canvas/WebGL scene moves in depth              | camera, target, object transform, material opacity                 | Three.js/WebGL + GSAP proxy                | `--ghost`; snapshots at proof poses            |
| Shader uniform      | Pixel effect is driven by scalar progress      | progress, edge width, noise, color mix, opacity                    | ShaderMaterial/WebGL uniforms              | `--ghost`; snapshot 0/edge/mid/final           |
| Instanced system    | Many 3D objects move as one system             | instance transforms, scale, color/opacity, camera                  | Three InstancedMesh                        | snapshots, because DOM boxes miss internals    |
| Imported model      | Model animation must scrub deterministically   | `AnimationMixer.setTime`, camera, material, lights                 | Three AnimationMixer                       | drive from HyperFrames time; `--ghost`         |

## Source Links

- GSAP keyframes: https://gsap.com/resources/keyframes/
- GSAP timeline: https://gsap.com/docs/v3/GSAP/Timeline/
- GSAP MotionPathPlugin: https://gsap.com/docs/v3/Plugins/MotionPathPlugin/
- GSAP Flip: https://gsap.com/docs/v3/Plugins/Flip/
- GSAP DrawSVGPlugin: https://gsap.com/docs/v3/Plugins/DrawSVGPlugin/
- GSAP MorphSVGPlugin: https://gsap.com/docs/v3/Plugins/MorphSVGPlugin/
- GSAP SplitText: https://gsap.com/docs/v3/Plugins/SplitText/
- GSAP CSSPlugin: https://gsap.com/docs/v3/GSAP/CorePlugins/CSS/
- Anime.js documentation: https://animejs.com/documentation/
- Anime.js stagger grid: https://animejs.com/documentation/utilities/stagger/stagger-parameters/stagger-grid/
- Anime.js timeline: https://animejs.com/documentation/timeline/
- Anime.js SVG helpers: https://animejs.com/documentation/svg/createmotionpath/
- MDN CSS animations: https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_animations/Using_CSS_animations
- MDN `@keyframes`: https://developer.mozilla.org/en-US/docs/Web/CSS/@keyframes
- MDN `clip-path`: https://developer.mozilla.org/en-US/docs/Web/CSS/clip-path
- MDN CSS masking: https://developer.mozilla.org/en-US/docs/Web/CSS/mask
- MDN perspective: https://developer.mozilla.org/en-US/docs/Web/CSS/perspective
- MDN transform-style: https://developer.mozilla.org/en-US/docs/Web/CSS/transform-style
- Three.js AnimationMixer: https://threejs.org/docs/#api/en/animation/AnimationMixer
- Three.js ShaderMaterial: https://threejs.org/docs/#api/en/materials/ShaderMaterial
- Three.js InstancedMesh: https://threejs.org/docs/#api/en/objects/InstancedMesh
