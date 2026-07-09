---
name: hyperframes-animejs
description: Anime.js first-party default adapter reference for HyperFrames. Use when writing seekable anime.js timelines or one-off tweens, registering them with hyperframesAnime.register, defining labels, handling duration inference, translating GSAP ease vocabulary, or making anime.js motion deterministic in HyperFrames compositions.
---

# Anime.js For HyperFrames

Anime.js is the first-party default animation runtime for HyperFrames. The composition owns the anime.js instances; HyperFrames owns the clock and seeks each registered instance during preview and render.

## Pinned CDN

Use the pinned UMD bundle from the core scaffold:

```html
<script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
```

Do not use older anime.js CDN paths or unpinned package URLs in authored compositions.

## Contract

- Create animations or timelines synchronously during composition initialization.
- Use `autoplay: false` on every `anime.createTimeline(...)` or `anime.animate(...)` call.
- Register with `hyperframesAnime.register("<composition-id>", instance, { labels })`.
- The registration id must equal the composition root's `data-composition-id`.
- Labels in the registration options are in seconds.
- Anime.js `.add(..., position)` placement values and tween `duration` values are in milliseconds.
- Use finite durations and finite `loop` counts unless the root has explicit `data-duration`.
- Avoid callbacks that mutate DOM based on wall-clock time, network state, input events, or unseeded randomness.

`window.__hfAnime` is an implementation detail maintained by `hyperframesAnime.register`. Do not push instances onto it directly.

The adapter seeks registered instances from HyperFrames time. Authors should never call `play()` for render-critical motion.

## Basic Single-Tween Pattern

Use `anime.animate(...)` for a one-off tween that does not need sequencing:

```html
<script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
<script>
  const anim = anime.animate(".mark", {
    translateX: [-120, 0],
    opacity: [0, 1],
    duration: 900,
    ease: "outQuart",
    autoplay: false,
  });

  hyperframesAnime.register("main", anim, { labels: { intro: 0 } });
</script>
```

## Timeline Pattern

Use `anime.createTimeline({ autoplay: false })` for normal composition work:

```html
<script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
<script>
  const tl = anime.createTimeline({ autoplay: false });

  tl.add(".title", { translateY: [48, 0], opacity: [0, 1], duration: 650, ease: "outQuart" }, 0);
  tl.add(".accent", { scaleX: [0, 1], duration: 450, ease: "outCubic" }, 250);
  tl.add(".caption", { opacity: [0, 1], duration: 500, ease: "outQuad" }, 900);

  hyperframesAnime.register("main", tl, {
    labels: {
      intro: 0,
      accent: 0.25,
      caption: 0.9,
    },
  });
</script>
```

Position arguments in `.add()` are milliseconds (`250` means 0.25 seconds). Labels passed to `hyperframesAnime.register` are seconds (`accent: 0.25`). Keep that unit boundary explicit.

## Duration Inference

Prefer an explicit `data-duration` on the composition root:

```html
<div
  id="root"
  data-composition-id="main"
  data-start="0"
  data-duration="6"
  data-width="1920"
  data-height="1080"
>
  ...
</div>
```

If the root omits `data-duration`, HyperFrames infers render duration from the longest finite registered anime.js instance. An anime.js instance with an infinite or unbounded loop and no root `data-duration` is an error state because the render engine cannot infer a finite capture length.

## Determinism Rules

- Always set `autoplay: false`.
- Build and register synchronously before any `await`, timer, event handler, or asset callback.
- Use finite durations and finite `loop` counts.
- If an infinite loop is required, add explicit root `data-duration`.
- `anime.stagger(...)` is deterministic when its configuration is fixed or seeded.
- Do not derive stagger amounts, target order, random-looking offsets, or jitter from unseeded `Math.random()` or wall-clock reads.
- Do not mutate render-critical state from `onUpdate` using clocks, network, input state, or accumulated previous-frame state.

### One Property Owner

Two independently registered anime.js instances must never animate the same CSS property on the same element at overlapping times. HyperFrames seeks registered instances independently, and the last property writer can become order-dependent. Anime.js does not provide an automatic overwrite manager for separate registered instances.

Wrong:

```js
const fade = anime.createTimeline({ autoplay: false });
fade.add("#card", { opacity: [0, 1], duration: 800 }, 0);
hyperframesAnime.register("main", fade, { labels: { intro: 0 } });

const pulse = anime.createTimeline({ autoplay: false });
pulse.add("#card", { opacity: [1, 0.7], duration: 600 }, 300);
hyperframesAnime.register("main", pulse, { labels: { pulse: 0.3 } });
```

Right:

```js
const tl = anime.createTimeline({ autoplay: false });
tl.add("#card", { opacity: [0, 1], duration: 800 }, 0);
tl.add("#card", { opacity: [1, 0.7], duration: 600 }, 800);
hyperframesAnime.register("main", tl, { labels: { intro: 0, pulse: 0.8 } });
```

If two effects need to touch the same property, put both tweens inside the same registered instance or timeline.

## Supported Anime.js Features

The U3 determinism gate cleared these features as seek-safe after the runtime priming fix:

- Springs with `anime.createSpring`
- SVG morph with `anime.svg.morphTo`
- SVG drawable / line-draw with `anime.svg.createDrawable`
- Split text with `anime.text.split`
- Nested `.sync()` timelines
- Seeded stagger with `anime.stagger`

No anime.js features are scoped out of the v1 authoring contract. The authoring rule surfaced by the gate is the one-property-owner rule above.

## Ease Vocabulary

Use anime.js native ease names in new compositions. The house entrance default is `outQuart`, equivalent to the old GSAP `power3.out` house default.

| GSAP family | Anime.js family | Example out ease     | Notes                                                       |
| ----------- | --------------- | -------------------- | ----------------------------------------------------------- |
| `power1`    | `Quad`          | `outQuad`            | Gentle secondary motion                                     |
| `power2`    | `Cubic`         | `outCubic`           | Standard secondary ease                                     |
| `power3`    | `Quart`         | `outQuart`           | House default entrance ease                                 |
| `power4`    | `Quint`         | `outQuint`           | Stronger snap                                               |
| `back`      | `Back`          | `outBack(1.70158)`   | Overshoot parameter                                         |
| `elastic`   | `Elastic`       | `outElastic(1, 0.3)` | Amplitude, period parameters                                |
| `bounce`    | `Bounce`        | `outBounce`          | Explicitly playful only                                     |
| `expo`      | `Expo`          | `outExpo`            | Shimmed curve, slight divergence at extreme t is acceptable |
| `sine`      | `Sine`          | `outSine`            | Smooth ambient motion                                       |
| `circ`      | `Circ`          | `outCirc`            | Circular acceleration                                       |
| `none`      | n/a             | `linear`             | Linear motion                                               |
| `steps(n)`  | n/a             | `steps(n)`           | Slight boundary-handling divergence from GSAP is acceptable |

Direction prefixes are `in`, `out`, and `inOut`, followed by the family name: `inBack`, `outQuad`, `inOutElastic`, `outSine`. The GSAP power family is offset by one in anime.js naming: `power1` -> `Quad`, `power2` -> `Cubic`, `power3` -> `Quart`, `power4` -> `Quint`.

## Validation

After editing a composition that uses anime.js:

```bash
npx hyperframes lint
npx hyperframes validate
```

## Credits And References

- HyperFrames adapter source: `packages/core/src/runtime/adapters/animejs.ts`.
- Pinned CDN source: `packages/core/src/templates/constants.ts`.
- GSAP to anime.js ease mapping source: `packages/core/src/animation/easeMap.ts`.
- Anime.js documentation: https://animejs.com/documentation/
