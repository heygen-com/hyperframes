# Determinism, Animation Runtime, and Layout

HyperFrames seeks compositions frame-by-frame. Every frame must be reproducible from its time value alone — same input time → same pixels. Three contracts enforce this: the **animation runtime contract**, the **determinism rules**, and the **layout contract**.

## Animation Runtime Contract

GSAP is the primary runtime. The core requirement is generic: animation state must be seekable from HyperFrames time.

For GSAP:

- Use `gsap.timeline({ paused: true })`.
- Register it on `window.__timelines["<composition-id>"]`, keyed by the composition root's `data-composition-id`. You do **not** need to write `window.__timelines = window.__timelines || {}` first: the runtime creates the registry before your inline scripts evaluate.
- **Building inside an async callback is supported.** `document.fonts.ready(...)` and friends are the documented setup path. What you must not do is **register the key before the build finishes**. An empty timeline registered early is treated as ready and nested empty, so the animation renders blank (`lint`: `gsap_timeline_registered_before_async_build`, error). Assign `window.__timelines[id] = tl` at the **end** of the callback, after the tweens are added, and optionally call `window.__hfForceTimelineRebind()` right after.
- If the key does not match the root's `data-composition-id`, the runtime still binds it **when it is the only registered timeline**. With two or more registered, a mismatched key leaves the render frozen at t=0.
- **Do not** call `tl.play()` for render-critical motion.
- **Do not** create empty tweens only to set duration; use `data-duration` on the clip instead.

Use the `hyperframes-animation` skill for tween syntax, position parameters, eases, and performance rules.

### Duration Contract For Non-GSAP Runtimes

The render engine needs a positive total duration before it will capture a single frame — without one, capture fails outright with "Composition has zero duration." A GSAP timeline supplies this automatically. CSS, WAAPI, and Lottie compositions have no timeline object, so the runtime infers duration itself:

- **CSS**: longest `animation-delay` + `animation-duration` × finite `animation-iteration-count` across animated elements (offset by each element's `data-start`). `animation-iteration-count: infinite` cannot be inferred.
- **WAAPI**: longest `element.animate()` effect's `getComputedTiming().endTime`. Infinite `iterations` cannot be inferred.
- **Lottie**: the registered animation's native length (`totalFrames / frameRate`, or the dotLottie player's own `duration`) — always finite regardless of `loop`.
- **Three.js**: **not inferable**. The `three` adapter only forwards time via `hf-seek` — it has no `AnimationClip`/`AnimationMixer` inspection.

`data-duration` on the root `[data-composition-id]` element is therefore optional whenever every non-GSAP animation on the page is finite (CSS/WAAPI with finite iteration counts, or Lottie). It is **required** when: the composition has an infinite/unbounded CSS or WAAPI animation, the composition uses Three.js, or there is no GSAP timeline and no animation signal at all for any adapter to discover. `npx hyperframes lint` enforces exactly this (`root_composition_missing_duration_source`) — see the runtime/adapter-specific docs under `hyperframes-animation/adapters/` for the full contract per runtime.

## Determinism Rules

Rendered frames must be reproducible from the requested time. Do **not** use any of the following for visual state:

- `Date.now()`, `performance.now()`, or any render-time clock.
- Unseeded `Math.random()`. Use a seeded PRNG if random-looking placement is needed.
- Render-time network fetches for required assets. Inline or pre-bundle them.
- Hover, scroll, pointer, or focus state. The renderer has no input events.
- Infinite loops such as `repeat: -1`. Compute a finite count: `repeat: Math.max(0, Math.floor(duration / cycleDuration) - 1)` — **`floor`, not `ceil`** (`ceil` overshoots `data-duration` and trips the `gsap_repeat_ceil_overshoot` lint; `max(0, …)` avoids a negative repeat = infinite).

Also avoid:

- Tweening `display` or raw `visibility` **on a clip element**: HyperFrames timing owns a clip's visibility, and `lint` rejects it. Use GSAP `autoAlpha` (it interpolates opacity and flips visibility only at the hidden endpoint) or a zero-duration `tl.set(..., { visibility: "hidden" | "visible" })` at an explicit beat boundary for a deterministic hard kill. Animating a clip element's ordinary visual properties (`opacity`, transforms, `filter`, …) is fine and the shipped catalog does it constantly; what is forbidden is taking over its visibility.
- There is no fixed allowlist of animatable properties. `lint` enforces a **denylist**, so `filter`, `clipPath`, `strokeDashoffset`, `width`, `height` and similar are all legitimate targets. Prefer transforms and opacity where you have the choice, for performance rather than correctness. The per-runtime detail lives in `hyperframes-animation/adapters/`.
- Animating the same property on the same element from multiple timelines at the same time — GSAP's overwrite behavior is order-dependent and can flip between renders.

## Layout Contract

Build the visible end-state in static HTML and CSS first, then animate from/to that state.

- The composition root has fixed pixel frame dimensions.
- **The root composition's total duration (render length / frame count) is fixed at compile time**, read once from the static root `data-duration` before scripts run, like `data-width` / `data-height`. A script or `--variables` value that rewrites the root `data-duration` afterward is ignored. To vary render length per output, author the root `data-duration` directly. (A _clip's_ own `data-duration` is re-read from the live DOM, so scripts/variables can still drive clip lengths. Only when the root omits `data-duration` does the renderer probe the live DOM / timeline for total length.)
- Scene containers should fill the scene with `width: 100%; height: 100%; box-sizing: border-box`.
- Use padding, flex, grid, and `max-width` for layout. Avoid positioning main content with hardcoded `top`/`left` offsets when a layout container can do it.
- Use `position: absolute` for layers and decorative elements, not as the default content-layout strategy.
- Prefer transforms and opacity for animation.
- Keep text inside its intended container. For dynamic text, use `max-width`, wrapping, or `window.__hyperframes.fitTextFontSize(text, { maxWidth, fontFamily, fontWeight })`.
- For text measurement without DOM reflow, use `window.__hyperframes.pretext`. Measure off a canvas instead of writing into the page and reading it back, so nothing reflows: `pretext.prepare(text, font)` then `pretext.layout(prepared, maxWidth, lineHeight)` → `{ lineCount, height }`. `prepare` does the font measurement; everything downstream of a prepared string is arithmetic and cheap enough to run per frame. `fitTextFontSize` is built on it.
  - `layout` gives you height, not width. To size a container to its text (shrinkwrap), use `pretext.prepareWithSegments(text, font)` and then `pretext.measureNaturalWidth(prepared)` for the single-line width, or `pretext.measureLineStats(prepared, maxWidth)` for `{ lineCount, maxLineWidth }`.
  - `font` is a CSS font shorthand string, e.g. `"700 90px Inter"`.
  - `clearCache` and `setLocale` are deliberately not exposed: they mutate state shared across compositions, which would make a render depend on what ran before it.
- **Do not** use `<br>` in body text. Forced breaks ignore the actual rendered font width and produce an extra break when the line already wraps naturally, causing overlap. Let text wrap via `max-width`. Exception: short display titles where each word is deliberately on its own line.
- **Transformed elements must be block-level + sized.** `transform`/`scaleX`/`scaleY` is a no-op on an inline `<span>`, and scaling an auto-width (0px) element shows nothing → invisible bars/fills. Give them `display: block`/`inline-block`/flex-item **and** a real `width`/`height` (e.g. `width: 100%` inside a sized parent). _(Silent — automated gates may miss it.)_
- **Absolutely-positioned decoratives that pulse or overshoot** (`yoyo` scale, `back.out`) need clearance at their **peak** size and must not straddle an `overflow: hidden` edge — else they overlap a neighbor or get clipped. Position for the largest frame, not the resting one. _(silent.)_

## Why This Matters

The renderer takes a time value and produces a pixel buffer. There is no notion of "playback" — every frame is a fresh seek. Any state that depends on having reached this frame _through_ a prior frame (timers, accumulated state, event-driven animations) will desync when the renderer samples out of order or in parallel.

If you find yourself reaching for `setTimeout`, `requestAnimationFrame`, or `addEventListener` to drive a visual, rebuild it as a tween on the timeline instead.
