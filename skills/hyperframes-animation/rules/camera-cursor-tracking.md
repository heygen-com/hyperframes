---
name: camera-cursor-tracking
description: Two-phase virtual camera that locks the viewport to a moving focal point (typing cursor, growing highlight) — static initial framing then focal-point-locked tracking, GSAP-driven and seek-safe in HyperFrames.
metadata:
  tags: camera, tracking, viewport, two-phase, gsap, typing
  adapter: gsap
---

# Two-Phase Camera Cursor Tracking

Keeps a horizontally growing focal point (typing cursor, scrolling highlight, expanding element) visible by switching between two camera modes:

1. **Phase 1 (Static)**: Container at a fixed initial offset, camera doesn't move.
2. **Phase 2 (Tracking)**: Activates once the focal point crosses a screen threshold; camera offset follows it.

## HyperFrames vs. Remotion

The Remotion version used `measureText` from `@remotion/layout-utils` — a module that runs synchronously inside the React component body. HyperFrames is a regular browser environment, so we use the browser's native text-measurement APIs **once at composition setup time**, before the timeline is registered. The measured width is baked into a constant and the entire camera path is expressed as GSAP tweens with synchronous-time onUpdate callbacks.

```
Remotion: measureText() inside component → per-frame interpolate(camera_x) from spring()
HyperFrames: ctx.measureText() in setup → GSAP tween on .world's x property with an
             onUpdate that recomputes the camera target from tl.time()
```

## Core Concept

Separate **World Space** (the full-width content) from **Screen Space** (the viewport). The world transforms; the viewport doesn't. The phase switch is a piecewise function: while the focal point's projected screen position is still inside the threshold, hold the initial offset; once it crosses, drive the offset so the focal point stays locked at the threshold.

Why two phases:

- Tracking from t=0 would force the camera to "look ahead" before any content is visible, then snap left when content appears — disorienting.
- A static intro lets the viewer anchor, then the smooth transition reads as the camera "noticing" the focal point growing past the comfort zone.
- The offset is continuous at the switch boundary (by construction), so the phase change is invisible.

## Browser-Native Text Measurement

Use a one-shot offscreen 2D canvas at setup time. This avoids `@remotion/layout-utils` (Node-only) and avoids the brittle `charWidthRatio` constant.

```js
function measureTextPx({ text, fontFamily, fontSize, fontWeight = 400, letterSpacing = 0 }) {
  const canvas = (measureTextPx._canvas ??= document.createElement("canvas"));
  const ctx = canvas.getContext("2d");
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
  // Canvas measureText does not respect CSS letter-spacing — add it manually if non-zero.
  const baseWidth = ctx.measureText(text).width;
  return baseWidth + letterSpacing * Math.max(0, text.length - 1);
}
```

For pixel-perfect alignment with the rendered DOM (which obeys CSS letter-spacing, kerning, font features), measure against a real DOM node instead:

```js
function measureNodeWidth(html, classNames) {
  const probe = document.createElement("span");
  probe.className = classNames;
  probe.style.cssText = "position:absolute; visibility:hidden; white-space:pre;";
  probe.innerHTML = html;
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width;
}
```

Both approaches must run **after** the document's fonts are ready. HyperFrames waits for fonts before rendering, but if you're using a CDN font you should still gate measurements behind `document.fonts.ready`:

```js
await document.fonts.ready;
const fullTextWidth = measureNodeWidth(fullText, "search-text");
```

## Basic Pattern

```html
<div class="viewport" style="position: absolute; inset: 0; overflow: hidden;">
  <div class="world" style="display: flex; height: 100%;">
    <!-- The growable content lives inside .world. Its width can exceed viewport. -->
    <div class="search-bar">
      <span class="search-text">Type here…</span>
      <span class="search-cursor">_</span>
    </div>
  </div>
</div>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  /* ============================================================
     CONSTANTS — baked at setup time, never per-frame.
     ============================================================ */
  const W = 1920; // composition width
  const FULL_TEXT = "Tell me how to target parents";
  const FONT_SIZE = 120;
  const FONT_FAMILY = "Inter, system-ui, sans-serif";

  const PADDING_LEFT = 120;
  const PADDING_RIGHT = 180;
  const CURSOR_TARGET = W * 0.7; // screen X where the cursor locks in Phase 2
  const LEFT_MARGIN = 80; // initial container left margin in Phase 1

  document.fonts.ready.then(() => {
    /* Measure once. After this point, all camera math is deterministic. */
    const fullTextWidth = measureNodeWidth(FULL_TEXT, "search-text");
    const cursorWidth = FONT_SIZE * 0.6; // visual cursor glyph width
    const barWidth = PADDING_LEFT + fullTextWidth + cursorWidth + PADDING_RIGHT;

    /* Pre-allocate the bar to its FINAL width so the cursor doesn't jitter
       as more characters appear. */
    document.querySelector(".search-bar").style.width = barWidth + "px";

    /* ============================================================
       PIECEWISE CAMERA — single onUpdate-driven tween.
       The driver tween is just a clock from typingStart to typingEnd;
       its onUpdate computes the camera x from current typing progress.
       ============================================================ */
    const TYPING_START = 3.7; // seconds
    const CHAR_RATE = 0.083; // seconds per character (~2.5 frames @30fps)
    const TYPING_DUR = FULL_TEXT.length * CHAR_RATE;

    const worldEl = document.querySelector(".world");
    const searchText = document.querySelector(".search-text");

    // Phase 1 fixed offset — bar sits left-aligned with LEFT_MARGIN gap.
    const initialOffset = LEFT_MARGIN;

    tl.fromTo(
      { progress: 0 },
      { progress: 0 },
      {
        progress: FULL_TEXT.length,
        duration: TYPING_DUR,
        ease: "none", // linear typing
        onUpdate: function () {
          const charsTyped = Math.min(FULL_TEXT.length, Math.floor(this.targets()[0].progress));
          const visibleText = FULL_TEXT.slice(0, charsTyped);
          searchText.textContent = visibleText;

          // Cursor's current X inside the bar
          const visibleWidth = measureNodeWidth(visibleText || " ", "search-text");
          const cursorInBar = PADDING_LEFT + visibleWidth + cursorWidth / 2;

          // World-space tracking offset: position bar so cursor lands at CURSOR_TARGET
          const trackingOffset = CURSOR_TARGET - cursorInBar;

          // Piecewise: hold initialOffset until the cursor would exceed CURSOR_TARGET,
          // then follow with the tracking offset. Both are equal at the crossover by
          // construction (we choose initialOffset so the cursor reaches CURSOR_TARGET
          // exactly when trackingOffset < initialOffset).
          const cameraX = Math.min(initialOffset, trackingOffset);

          gsap.set(worldEl, { x: cameraX });
        },
      },
      TYPING_START,
    );

    window.__timelines["main"] = tl;
  });
</script>
```

## Why `Math.min(initialOffset, trackingOffset)`?

- At t = TYPING_START: cursor is at `PADDING_LEFT + cursorWidth/2`, near the bar's left edge. `trackingOffset` is large positive → `min(initial, large)` = `initial`. Static phase.
- As typing proceeds, `visibleWidth` grows → `cursorInBar` grows → `trackingOffset` shrinks → eventually `trackingOffset < initialOffset`, and the camera starts following.
- The transition is **C0-continuous** at the crossover: same value on both sides. No spring-in needed for the phase switch itself.
- For a softer feel through the transition zone, run a small `gsap.to(worldEl, { x: cameraX, duration: 0.05 })` instead of `gsap.set(...)`. But this is rarely needed — at typical typing rates the offset changes one character-width per frame, which already reads smoothly.

## Variations

### Centered Initial → Center-Tracked

`LEFT_MARGIN = (W - barWidth) / 2` and `CURSOR_TARGET = W / 2`. Bar starts centered; camera tracks once the cursor crosses the midline. Best when the empty bar fits comfortably on screen.

### Left-Aligned → Right-Tracked (default in example above)

`LEFT_MARGIN` small (60–100 px), `CURSOR_TARGET = W * 0.7`. Strong reading-direction feel: content starts at the left, camera pans right as the cursor approaches a "look-ahead" zone.

### Spring-Settled Tracking

If you want the camera to "spring" into the tracking offset rather than tracking exactly, replace `gsap.set(worldEl, { x: cameraX })` with a one-time `quickTo`:

```js
const quickPanX = gsap.quickTo(worldEl, "x", { duration: 0.25, ease: "power2.out" });
// inside onUpdate:
quickPanX(cameraX);
```

`quickTo` reuses a single tween instance — efficient and seek-safe.

## Critical Constraints

- **Measure with browser APIs, not constants**: `ctx.measureText()` or `getBoundingClientRect()`. The `charWidthRatio` shortcut (`fontSize * 0.58`) is wrong for proportional fonts — Inter, Roboto, etc. have wildly different per-glyph widths. The misalignment compounds over a 30-character string into 20+ px error, which throws the cursor lock off-center.
- **Measure after `document.fonts.ready`**: Web fonts load asynchronously. Measuring before the font is parsed falls back to the system font and gives the wrong width. Use `await document.fonts.ready` or `.then(...)` before measurement.
- **Pre-allocate bar width**: Compute final width from full text once; freeze the bar's `width` style. Don't tween width — that's a layout property and HyperFrames forbids it, plus the cursor would jitter as the bar grows.
- **`overflow: hidden` on the viewport**: Without it, the world's left/right edges spill into adjacent elements during the pan.
- **`x` (transform alias), never `left`**: GSAP's `x` is a transform — compositor-cheap, no reflow. `left` would trigger layout on every frame and break the HF allowlist.
- **Single onUpdate-driven tween**: Don't create one tween per character. One driver tween over the typing range, with onUpdate deriving everything from progress, is the seek-safe form.
- **Hold through the composition end**: If the typing driver ends before the root `data-duration`, add a real visual hold (such as a finite cursor blink) through the remaining time. Studio scrubbing reads the live GSAP duration, so the registered timeline should reach the same end time as the composition.
- **No `Math.random()`, no `Date.now()`**: All state must be a pure function of `tl.time()`.

## Anti-Patterns

| Avoid                                                     | Why                                                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `charWidthRatio = fontSize * 0.58`                        | Proportional fonts have variable widths per char; the assumption is off by tens of pixels over 30 characters.                |
| Measuring text at module top-level (before `fonts.ready`) | Fallback metrics → bar too narrow → text overflows the bar visually.                                                         |
| `interpolate` + `Easing` for camera tracking              | Discrete frame steps + variable offset = jerky motion. Use one onUpdate that derives the camera per real time.               |
| Always tracking from t=0                                  | Camera looks ahead before content exists; user sees the camera "wait" with empty space, then snap back when content arrives. |
| Absolutely positioned cursor                              | Breaks inline flow with the typed text; cursor X math drifts from the actual rendered position.                              |
| Tweening `width` to grow the bar with text                | Layout reflow every frame; banned by the HyperFrames allowlist. Pre-allocate.                                                |

## Spring → GSAP Ease Mapping

The original used `spring({ stiffness: 60, damping: 12, mass: 1.2 })` — a cinematic, slow-settling camera. In HyperFrames the camera tracks exactly (not through a spring), so the ease only matters for the _initial_ arrival into Phase 2. If you want a spring-like phase-in:

| Remotion spring                                          | GSAP equivalent               |
| -------------------------------------------------------- | ----------------------------- |
| stiffness 40-60, damping 15-20, mass 1.0 (cinematic pan) | `power2.out` over 0.5–0.8s    |
| stiffness 80-100, damping 18-22, mass 0.8 (responsive)   | `power3.out` over 0.3–0.5s    |
| stiffness 150+, damping 12-15, mass 0.5 (snappy UI)      | `back.out(1.4)` over 0.2–0.3s |

## Combinations

- Pair with [discrete-text-sequence](discrete-text-sequence.md) for non-linear typing (typos, holds, bulk additions).
- Pair with [hacker-flip-3d](hacker-flip-3d.md) inside Phase 1 of [concept-demo-decode-pan](../blueprints/concept-demo-decode-pan.md) — the camera-tracked typing comes _after_ the pan.

## Examples

- [concept-demo-decode-pan.html](../examples/concept-demo-decode-pan.html) — Phase 4 search-bar typing with cursor-locked tracking.
