# Determinism, Animation Runtime, and Layout

HyperFrames seeks compositions frame-by-frame. Every frame must be reproducible from its time value alone — same input time → same pixels. Three contracts enforce this: the **animation runtime contract**, the **determinism rules**, and the **layout contract**.

## Animation Runtime Contract

GSAP is the primary runtime. The core requirement is generic: animation state must be seekable from HyperFrames time.

For GSAP:

- Create the timeline **synchronously** during page initialization.
- Use `gsap.timeline({ paused: true })`.
- Register it on `window.__timelines["<composition-id>"]`.
- The key must match `data-composition-id` on the composition root.
- **Do not** call `tl.play()` for render-critical motion.
- **Do not** build timelines inside `async`, `Promise`, `setTimeout`, or event handlers — the renderer can sample before they finish.
- **Do not** create empty tweens only to set duration; use `data-duration` on the clip instead.
- **Do not** `gsap.set()` clip elements from later scenes — they are not in the DOM at page load. Use `tl.set(selector, vars, time)` inside the timeline at or after the clip's `data-start`.

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

- Animating anything outside the visual-property allowlist: `opacity`, `x`, `y`, `scale`, `rotation`, `color`, `backgroundColor`, `borderRadius`, and transforms. Never tween `display` or raw `visibility`. GSAP `autoAlpha` is allowed on a registered seekable timeline because it interpolates opacity and changes visibility only at the hidden endpoint. A zero-duration `tl.set(..., { visibility: "hidden" | "visible" })` is also allowed at an explicit beat boundary for a deterministic hard kill. Both exceptions apply only to non-clip elements or wrappers inside a clip. Never target a `.clip` element: HyperFrames timing owns its lifecycle and visibility.
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
- For text measurement without DOM reflow, use `window.__hyperframes.pretext`: `pretext.prepare(text, font)` then `pretext.layout(prepared, maxWidth, lineHeight)`. Pure arithmetic, ~0.0002 ms per call — safe for per-frame text reflow, shrinkwrap containers, and computing layout before render. `fitTextFontSize` is built on it.
- **Do not** use `<br>` in body text. Forced breaks ignore the actual rendered font width and produce an extra break when the line already wraps naturally, causing overlap. Let text wrap via `max-width`. Exception: short display titles where each word is deliberately on its own line.
- **Transformed elements must be block-level + sized.** `transform`/`scaleX`/`scaleY` is a no-op on an inline `<span>`, and scaling an auto-width (0px) element shows nothing → invisible bars/fills. Give them `display: block`/`inline-block`/flex-item **and** a real `width`/`height` (e.g. `width: 100%` inside a sized parent). _(Silent — automated gates may miss it.)_
- **Absolutely-positioned decoratives that pulse or overshoot** (`yoyo` scale, `back.out`) need clearance at their **peak** size and must not straddle an `overflow: hidden` edge — else they overlap a neighbor or get clipped. Position for the largest frame, not the resting one. _(silent.)_

## Why This Matters

The renderer takes a time value and produces a pixel buffer. There is no notion of "playback" — every frame is a fresh seek. Any state that depends on having reached this frame _through_ a prior frame (timers, accumulated state, event-driven animations) will desync when the renderer samples out of order or in parallel.

If you find yourself reaching for `setTimeout`, `requestAnimationFrame`, or `addEventListener` to drive a visual, rebuild it as a tween on the timeline instead.
