---
name: hyperframes-render-fn
description: Render-function adapter patterns for HyperFrames. Use when a composition has no animation library and draws each frame as a pure function of time — a hand-rolled clock, a React state timeline, or a canvas/demoscene loop — by registering render(timeSeconds) callbacks on window.__hfRender.
---

# Render function for HyperFrames

When a composition's visual state is a pure function of time and there is no animation library to seek, HyperFrames drives it through the `render-fn` adapter. You register a `render(timeSeconds)` callback; the runtime calls it with the exact composition time for every captured frame. This is the seek-driven replacement for the `requestAnimationFrame` loop you would use during live playback.

Reach for this adapter for hand-rolled clocks, `<canvas>` / demoscene draw loops, and React (or other framework) state timelines that compute the frame from a single time value — including the time-driven render functions emitted by design tools that do not produce a GSAP timeline.

## Contract

- Register every draw callback on `window.__hfRender` (an array of `(timeSeconds: number) => void`).
- Do **not** drive the scene with your own `requestAnimationFrame` loop — the adapter supplies the clock.
- Render purely from the `timeSeconds` argument. No `Date.now()`, no `performance.now()`, no unseeded randomness. The runtime seeks forward, backward, out of order, and may seek the same frame twice; identical time must produce identical pixels.
- Keep canvas dimensions stable with CSS.
- The current seek position is also mirrored onto `window.__hfTime` (seconds) for draw helpers that prefer to read it directly.

## Canvas Pattern

```html
<canvas id="scene" width="1920" height="1080" class="scene-canvas"></canvas>
<script>
  const ctx = document.getElementById("scene").getContext("2d");

  function renderAt(timeSeconds) {
    ctx.clearRect(0, 0, 1920, 1080);
    // Draw the frame as a pure function of timeSeconds.
    const x = 960 + Math.sin(timeSeconds * 2) * 400;
    ctx.fillStyle = "#6FC8D6";
    ctx.beginPath();
    ctx.arc(x, 540, 80, 0, Math.PI * 2);
    ctx.fill();
  }

  window.__hfRender = window.__hfRender || [];
  window.__hfRender.push(renderAt);
</script>
```

```css
.scene-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
```

## Framework State Pattern

For a React (or similar) timeline that renders from a single `time` value, advance the state from the callback instead of from `requestAnimationFrame`, then flush a synchronous render:

```js
window.__hfRender = window.__hfRender || [];
window.__hfRender.push((timeSeconds) => {
  setCompositionTime(timeSeconds); // drives every time-derived value in the tree
});
```

Keep the render synchronous and deterministic: the runtime captures the frame after the callback returns.

## Seeded Randomness

When a deterministic effect needs pseudo-randomness, seed it (e.g. mulberry32) so the sequence is identical on every seek:

```js
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

Re-create the generator from the same seed inside each `render` call (or derive it from `timeSeconds`) so the frame never depends on call history.

## Multiple Callbacks

Push each draw routine into the same registry:

```js
window.__hfRender = window.__hfRender || [];
window.__hfRender.push(drawBackground);
window.__hfRender.push(drawForeground);
```

HyperFrames invokes them all at the same composition time, in registration order.

## Good Uses

- Canvas / demoscene effects (starfields, plasma, particles) driven by a time value.
- Framework state timelines that render the frame from a single clock.
- Time-driven render functions that have no GSAP timeline to seek.

## Avoid

- A self-driven `requestAnimationFrame` loop — it does not advance under capture and yields blank or frozen frames.
- Reading `Date.now()` / `performance.now()` inside the callback.
- Unseeded `Math.random()`.
- Asynchronous rendering inside the callback — finish synchronously before returning.

## Validation

After editing the composition:

```bash
npx hyperframes lint
npx hyperframes validate
```

## Credits And References

- HyperFrames adapter source: `packages/core/src/runtime/adapters/render-fn.ts`.
- Frame Adapter concept: `docs/concepts/frame-adapters.mdx`.
- Determinism contract: `docs/concepts/determinism.mdx`.
