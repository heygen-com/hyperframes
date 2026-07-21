---
name: camera-cursor-tracking
description: Two-phase virtual camera that locks viewport to a moving focal point with configurable initial positioning.
metadata:
  tags: camera, tracking, viewport, two-phase, spring
---

# Two-Phase Camera Cursor Tracking

Keeps a horizontally-growing element (a search bar with typing text, a long URL animating in) visible by switching between two camera modes.

## How It Works

Separate **World Space** (the full target element with all content) from **Screen Space** (the viewport). Two phases:

- **Phase 1 (Static)** — the world container sits at a fixed initial offset; the camera doesn't move. Anchors the viewer's eye before tracking begins.
- **Phase 2 (Tracking)** — activates when the focal point (cursor, highlight, last typed glyph) exceeds a target screen position (`CURSOR_TARGET_FRACTION × viewportWidth` from the left). The world translates leftward (`x: -delta`) keeping the focal point pinned at that screen position.

The offset math is **mathematically continuous** at the phase boundary — at the instant tracking starts, the world position equals what the static phase had, so the transition is seamless. The piecewise form:

```
finalWorldX = Math.min(INITIAL_OFFSET, trackingOffset)
```

`INITIAL_OFFSET` is the static-phase value; `trackingOffset` is whatever shift keeps the focal point at the target screen X. While the focal point hasn't grown past the target, `trackingOffset` is a less-negative number and `Math.min` returns the static value; once the focal point would cross the target, `trackingOffset` overtakes and tracking takes over. Do NOT replace this with a hard `if (typingProgress > threshold)` branch — the camera will visibly jump.

## Recipe

```html
<div class="viewport">
  <div class="world">
    <div class="search-bar">
      <span class="text" id="reveal-text">{phrase}</span><span class="cursor">|</span>
    </div>
  </div>
</div>
```

```css
.viewport {
  position: absolute;
  inset: 0;
  overflow: hidden; /* clip the world's left edge as it pans off-screen */
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding-left: VIEWPORT_PAD_LEFT; /* Phase-1 anchor X — must match the JS constant */
}
.world {
  display: flex;
  align-items: center;
  white-space: nowrap; /* text must stay on one line for the camera math */
}
.search-bar .text {
  display: inline-block;
  overflow: hidden;
  vertical-align: bottom;
}
.search-bar .cursor {
  display: inline-block; /* inline sibling of the text, NOT absolutely positioned —
     absolute positioning misaligns with the camera math */
  width: CURSOR_WIDTH;
  margin-left: CURSOR_GAP;
  background: {accentColor};
  height: CURSOR_HEIGHT_EM;
  vertical-align: bottom;
  /* no CSS blink animation — CSS clocks don't sync to seek; blink is a GSAP tween below */
}
```

```js
// Pre-measure the target text width to compute tracking distance.
// Measure SYNCHRONOUSLY — no fonts.ready gate (see Critical Constraints).
const textEl = document.getElementById("reveal-text");
const targetCursorScreenX = CURSOR_TARGET_FRACTION * VIEWPORT_WIDTH;
const fullWidth = textEl.scrollWidth; // total text width after full reveal
const trackingDelta = Math.max(0, VIEWPORT_PAD_LEFT + fullWidth - targetCursorScreenX);

// Phase 1 — text reveals progressively; camera holds. maxWidth tween
// (width/left/top tweens are forbidden); ease "none" = linear typing rate.
tl.fromTo(
  ".search-bar .text",
  { maxWidth: 0 },
  { maxWidth: fullWidth, duration: REVEAL_DUR, ease: "none" },
  REVEAL_START,
);

// Phase 2 — camera tracks. Start BEFORE full reveal so the handoff feels
// continuous (Math.min form above makes it mathematically continuous).
tl.to(".world", { x: -trackingDelta, duration: TRACK_DUR, ease: "power2.inOut" }, TRACK_START);

// Cursor blink — finite GSAP yoyo (never CSS @keyframes; CSS animation clocks
// aren't synced to HF's seek and flicker non-deterministically).
const blinkRepeats = Math.ceil(SCENE_DURATION / BLINK_HALF_PERIOD) - 1;
tl.to(
  ".search-bar .cursor",
  { opacity: 0, duration: BLINK_HALF_PERIOD, ease: "steps(1)", yoyo: true, repeat: blinkRepeats },
  0,
);
```

## Variations

- **Centered → center-tracked**: `.viewport { justify-content: center; padding: 0; }`, `CURSOR_TARGET_FRACTION = 0.5` — tracks once the focal point crosses the midline.
- **Left-aligned → right-tracked**: as written; best when content exceeds viewport width from the start.
- **Continuous typing driver**: replace the `maxWidth` tween with an `onUpdate` typing clock (`charsTyped = Math.floor(progress)`) plus per-frame `measureNodeWidth` driving the cursor screen X — required when the typed text is consumed elsewhere in the scene (e.g. by a parent strip's camera offset).

## Values

| token                  | range                       | notes                                                                           |
| ---------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| VIEWPORT_PAD_LEFT      | 0 → ~10% of viewport width  | must match the CSS `padding-left` or the camera math drifts                     |
| VIEWPORT_WIDTH         | = the root's `data-width`   | never tweened                                                                   |
| CURSOR_TARGET_FRACTION | 0.5–0.75                    | lower = less revealed text in frame; higher delays tracking                     |
| CURSOR_WIDTH / GAP     | 4–10 px / a few px          | gap ≤ cursor width or it visually detaches                                      |
| CURSOR_HEIGHT_EM       | 0.85–1.0 em                 | matches the typed glyph height                                                  |
| REVEAL_DUR             | chars × 0.05–0.15s          | ease `"none"` — any easing distorts the per-keystroke cadence                   |
| TRACK_START            | < REVEAL_START + REVEAL_DUR | overlap the reveal so the handoff feels continuous                              |
| TRACK_DUR              | 0.8–2.0s                    | `power2.inOut`/`power3.inOut`; `back.out` reads as UI bounce, not camera        |
| BLINK_HALF_PERIOD      | 0.2–0.4s                    | `steps(1)` hard on/off; repeats derived from SCENE_DURATION (= `data-duration`) |

## Critical Constraints

- **Build the timeline SYNCHRONOUSLY — no `fonts.ready` gate.** HF renders frames in parallel workers, each a fresh browser. A `document.fonts.ready.then(...)` wrapper means some workers seek frames BEFORE the Promise resolves and find no timeline → those frames render at CSS initial state (`max-width: 0` ⇒ empty text) while others render correctly → visible flicker. Register the timeline at script-parse time: the camera math tolerates a few percent width error from fallback-font measurement; worker-race flicker is unacceptable. If precise post-font measurement matters, re-measure inside the tween's `onUpdate` (still deterministic per-frame), or set `font-display: block` on the @font-face.
- **Measure with `getBoundingClientRect()` / `scrollWidth` / probe nodes**, never character count × font-size — proportional fonts have variable glyph widths.
- **Continuous math at the phase boundary** — the `Math.min(INITIAL_OFFSET, trackingOffset)` form, never a hard threshold branch.
- **`white-space: nowrap` on the world** and pre-allocated width (tween `maxWidth` to the full target width) — prevents layout shift mid-tween.
- **Cursor is an inline sibling of the text**, and blinks via a finite GSAP yoyo — never CSS `@keyframes … infinite`.
- **`overflow: hidden` on `.viewport`** — clips the world as it pans.

## See also

[context-sensitive-cursor.md](context-sensitive-cursor.md) (cursor color per text segment) · [discrete-text-sequence.md](discrete-text-sequence.md) (non-linear text reveals under this camera).
