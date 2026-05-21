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

## Determinism Rules

Rendered frames must be reproducible from the requested time. Do **not** use any of the following for visual state:

- `Date.now()`, `performance.now()`, or any render-time clock.
- Unseeded `Math.random()`. Use a seeded PRNG if random-looking placement is needed.
- Render-time network fetches for required assets. Inline or pre-bundle them.
- Hover, scroll, pointer, or focus state. The renderer has no input events.
- Infinite loops such as `repeat: -1`. Compute a finite repeat count from the visible duration: `repeat: Math.ceil(duration / cycleDuration) - 1`.

Also avoid:

- Animating anything outside the visual-property allowlist: `opacity`, `x`, `y`, `scale`, `rotation`, `color`, `backgroundColor`, `borderRadius`, transforms. Never animate `display` or `visibility` — use opacity/transforms and timed clip visibility instead.
- Animating the same property on the same element from multiple timelines at the same time — GSAP's overwrite behavior is order-dependent and can flip between renders.

## Layout Contract

Build the visible end-state in static HTML and CSS first, then animate from/to that state.

- The composition root has fixed pixel frame dimensions.
- Scene containers should fill the scene with `width: 100%; height: 100%; box-sizing: border-box`.
- Use padding, flex, grid, and `max-width` for layout. Avoid positioning main content with hardcoded `top`/`left` offsets when a layout container can do it.
- Use `position: absolute` for layers and decorative elements, not as the default content-layout strategy.
- Prefer transforms and opacity for animation.
- Keep text inside its intended container. For dynamic text, use `max-width`, wrapping, or `window.__hyperframes.fitTextFontSize(text, { maxWidth, fontFamily, fontWeight })`.
- **Do not** use `<br>` in body text. Forced breaks ignore the actual rendered font width and produce an extra break when the line already wraps naturally, causing overlap. Let text wrap via `max-width`. Exception: short display titles where each word is deliberately on its own line.

## Why This Matters

The renderer takes a time value and produces a pixel buffer. There is no notion of "playback" — every frame is a fresh seek. Any state that depends on having reached this frame _through_ a prior frame (timers, accumulated state, event-driven animations) will desync when the renderer samples out of order or in parallel.

If you find yourself reaching for `setTimeout`, `requestAnimationFrame`, or `addEventListener` to drive a visual, rebuild it as a tween on the timeline instead.
