# Determinism, Animation Runtime, and Layout

HyperFrames seeks compositions frame-by-frame. Every frame must be reproducible from its time value alone: same input time, same pixels. Three contracts enforce this: the **animation runtime contract**, the **determinism rules**, and the **layout contract**.

## Animation Runtime Contract

Animation state must be seekable from HyperFrames time. Build runtime state synchronously during page initialization, register it before render validation can sample the page, and never use a free-running clock for render-critical motion.

Generic requirements:

- Create timelines, animations, and seek handlers synchronously during page initialization.
- Do not build render-critical timelines inside `async`, `Promise`, `setTimeout`, request callbacks, or event handlers. The renderer can sample before they finish.
- Keep durations and loop counts finite unless the root has an explicit `data-duration`.
- Do not create empty tweens only to set duration. Use `data-duration` on the composition root or clip.
- Do not call playback methods such as `play()` for render-critical motion. HyperFrames owns the clock.

### Anime.js Default Contract

Anime.js is the first-party default authoring path.

```html
<script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
<script>
  const tl = anime.createTimeline({ autoplay: false });
  tl.add(".hero", { opacity: [0, 1], duration: 600 }, 0);
  // helper registers id, labels, finite duration; seconds-based seek for the runtime
  hyperframesAnime.register("main", tl, { labels: { intro: 0 } });
</script>
```

Rules:

- Use `anime.createTimeline({ autoplay: false })` or `anime.animate(..., { autoplay: false })`. Always write `autoplay: false` explicitly.
- Register only through `hyperframesAnime.register("<composition-id>", instance, { labels })`.
- The registration id must equal the composition root's `data-composition-id`.
- Labels passed to `hyperframesAnime.register` are in seconds, matching `data-duration` and clip timing. Anime.js `.add(..., position)` values are milliseconds.
- Prefer explicit root `data-duration`. If it is omitted, the anime.js adapter infers render duration from the longest finite registered anime.js instance.
- Infinite or unbounded anime.js loops require explicit root `data-duration`.
- `anime.stagger(...)` is deterministic when its configuration is fixed or seeded. Do not derive stagger amounts, order, or jitter from unseeded `Math.random()` or wall-clock reads.

**ONE-PROPERTY-OWNER rule:** two independently registered anime.js instances must never animate the same CSS property on the same element at overlapping times. HyperFrames seeks registered instances independently, and the final owner of a property can become order-dependent. Anime.js has no automatic overwrite manager for this case. If two effects need to touch the same property, put both tweens inside the same registered instance or timeline.

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

The U3 determinism gate cleared anime.js springs (`anime.createSpring`), SVG morph (`anime.svg.morphTo`), SVG drawable/line-draw (`anime.svg.createDrawable`), split text (`anime.text.split`), nested `.sync()` timelines, and seeded stagger. No anime.js features are scoped out of the v1 authoring contract.

### GSAP Supported Non-Default Contract

GSAP remains a supported adapter. Use it when a project is already GSAP-authored or when the GSAP-specific API is the right fit.

For GSAP:

- Create the timeline synchronously during page initialization.
- Use `gsap.timeline({ paused: true })`.
- Register it using the GSAP adapter contract documented in `hyperframes-animation/adapters/gsap.md`.
- The registry key must match `data-composition-id` on the composition root.
- Do not call `tl.play()` for render-critical motion.
- Do not build timelines inside `async`, `Promise`, `setTimeout`, or event handlers.
- Do not create empty tweens only to set duration. Use `data-duration` instead.
- Do not `gsap.set()` clip elements from later scenes. They are not in the DOM at page load. Use `tl.set(selector, vars, time)` inside the timeline at or after the clip's `data-start`.
- Infinite loops such as `repeat: -1` are forbidden. Compute a finite count: `repeat: Math.max(0, Math.floor(duration / cycleDuration) - 1)`. Use **`floor`, not `ceil`** because `ceil` overshoots `data-duration` and trips the `gsap_repeat_ceil_overshoot` lint; `max(0, ...)` avoids a negative repeat becoming infinite.
- Animating the same property on the same element from multiple timelines at the same time is order-dependent and can flip between renders. Keep a single owner for each render-critical property.

Use the `hyperframes-animation` skill for tween syntax, position parameters, eases, and performance rules.

### Duration Contract

The render engine needs a positive total duration before it will capture a single frame. Without one, capture fails outright with "Composition has zero duration."

Runtime inference:

- **Anime.js**: longest finite registered anime.js instance. Infinite or unbounded loops cannot be inferred.
- **GSAP**: registered finite GSAP timeline duration.
- **CSS**: longest `animation-delay` + `animation-duration` x finite `animation-iteration-count` across animated elements (offset by each element's `data-start`). `animation-iteration-count: infinite` cannot be inferred.
- **WAAPI**: longest `element.animate()` effect's `getComputedTiming().endTime`. Infinite `iterations` cannot be inferred.
- **Lottie**: the registered animation's native length (`totalFrames / frameRate`, or the dotLottie player's own `duration`), always finite regardless of `loop`.
- **Three.js**: **not inferable**. The `three` adapter only forwards time via `hf-seek`; it has no `AnimationClip`/`AnimationMixer` inspection.

`data-duration` on the root `[data-composition-id]` element is optional whenever every animation on the page has a finite duration source. It is **required** when the composition has an infinite/unbounded anime.js, CSS, or WAAPI animation, uses Three.js without another finite duration source, or has no duration-bearing animation signal at all. `npx hyperframes lint` enforces this (`root_composition_missing_duration_source`). See the runtime/adapter-specific docs under `hyperframes-animation/adapters/` for the full contract per runtime.

## Determinism Rules

Rendered frames must be reproducible from the requested time. Do **not** use any of the following for visual state:

- `Date.now()`, `performance.now()`, or any render-time clock.
- Unseeded `Math.random()`. Use a seeded PRNG if random-looking placement is needed.
- Render-time network fetches for required assets. Inline or pre-bundle them.
- Hover, scroll, pointer, or focus state. The renderer has no input events.
- Infinite loops without explicit root `data-duration`.

Also avoid:

- Animating anything outside the visual-property allowlist: `opacity`, transform components (`translateX`, `translateY`, `scale`, `rotate`, `rotateX`, `rotateY`, skew), `color`, `backgroundColor`, `borderColor`, `borderRadius`, CSS variables, media `volume`, and deterministic text counters. Never animate `display` or `visibility`; use opacity/transforms and timed clip visibility instead.
- Multiple registered runtime instances owning the same CSS property on the same element at overlapping times.

## Layout Contract

Build the visible end-state in static HTML and CSS first, then animate from/to that state.

- The composition root has fixed pixel frame dimensions.
- **The root composition's total duration (render length / frame count) is fixed at compile time**, read once from the static root `data-duration` before scripts run, like `data-width` / `data-height`. A script or `--variables` value that rewrites the root `data-duration` afterward is ignored. To vary render length per output, author the root `data-duration` directly. A _clip's_ own `data-duration` is re-read from the live DOM, so scripts/variables can still drive clip lengths. Only when the root omits `data-duration` does the renderer probe the live DOM / runtime instances for total length.
- Scene containers should fill the scene with `width: 100%; height: 100%; box-sizing: border-box`.
- Use padding, flex, grid, and `max-width` for layout. Avoid positioning main content with hardcoded `top`/`left` offsets when a layout container can do it.
- Use `position: absolute` for layers and decorative elements, not as the default content-layout strategy.
- Prefer transforms and opacity for animation.
- Keep text inside its intended container. For dynamic text, use `max-width`, wrapping, or `window.__hyperframes.fitTextFontSize(text, { maxWidth, fontFamily, fontWeight })`.
- For text measurement without DOM reflow, use `window.__hyperframes.pretext`: `pretext.prepare(text, font)` then `pretext.layout(prepared, maxWidth, lineHeight)`. Pure arithmetic, ~0.0002 ms per call, safe for per-frame text reflow, shrinkwrap containers, and computing layout before render. `fitTextFontSize` is built on it.
- **Do not** use `<br>` in body text. Forced breaks ignore the actual rendered font width and produce an extra break when the line already wraps naturally, causing overlap. Let text wrap via `max-width`. Exception: short display titles where each word is deliberately on its own line.
- **Transformed elements must be block-level + sized.** `transform`/`scaleX`/`scaleY` is a no-op on an inline `<span>`, and scaling an auto-width (0px) element shows nothing, resulting in invisible bars/fills. Give them `display: block`/`inline-block`/flex-item **and** a real `width`/`height` (e.g. `width: 100%` inside a sized parent). This is silent; lint/inspect miss it.
- **Absolutely-positioned decoratives that pulse or overshoot** (`yoyo` scale, `back.out`) need clearance at their **peak** size and must not straddle an `overflow: hidden` edge. Otherwise they overlap a neighbor or get clipped. Position for the largest frame, not the resting one. This is silent.

## Why This Matters

The renderer takes a time value and produces a pixel buffer. There is no notion of "playback"; every frame is a fresh seek. Any state that depends on having reached this frame _through_ a prior frame (timers, accumulated state, event-driven animations) will desync when the renderer samples out of order or in parallel.

If you find yourself reaching for `setTimeout`, `requestAnimationFrame`, or `addEventListener` to drive a visual, rebuild it as a tween on the registered timeline instead.
