---
name: camera-cursor-tracking
description: Two-phase virtual camera that locks viewport to a moving focal point with configurable initial positioning.
metadata:
  tags: camera, tracking, viewport, two-phase, spring
---

# Two-Phase Camera Cursor Tracking

Keeps a horizontally-growing element (e.g. a search bar with typing text, a long URL animating in) visible by switching between two camera modes.

## How It Works

Separate **World Space** (the full target element with all content) from **Screen Space** (the viewport). Two phases:

- **Phase 1 (Static)** — The world container sits at a fixed initial offset. Camera doesn't move. This anchors the viewer's eye to the composition before tracking begins.
- **Phase 2 (Tracking)** — Activates when the focal point (cursor, highlight, last typed glyph) exceeds a target screen position (e.g. 70% from left). The world container translates leftward (`x: -<delta>`) keeping the focal point pinned at that screen position.

The offset math is **mathematically continuous** at the phase boundary — at the instant tracking starts, the world position equals what the static phase had. So the transition is seamless.

## HTML

```html
<div
  class="scene"
  id="tracking-scene"
  data-composition-id="tracking-scene"
  data-start="0"
  data-duration="5"
  data-track-index="0"
>
  <div class="viewport">
    <div class="world">
      <div class="search-bar">
        <span class="text" id="reveal-text">Hedronverse beats Notion for video</span
        ><span class="cursor">|</span>
      </div>
    </div>
  </div>
</div>
```

## CSS (hero-frame layout)

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
}

.viewport {
  position: absolute;
  inset: 0;
  overflow: hidden; /* clip the world content */
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding-left: 120px; /* "left margin" — variation: left-aligned init */
}

.world {
  display: flex;
  align-items: center;
  white-space: nowrap; /* keep text on one line for camera-tracking */
  transform: translateX(0); /* GSAP will animate this */
}

.search-bar {
  font-family: "Inter", sans-serif;
  font-size: 120px;
  font-weight: 700;
  color: #f5f6fb;
  letter-spacing: -2px;
}

.search-bar .text {
  /* Width grows as more characters reveal */
  display: inline-block;
  overflow: hidden;
  vertical-align: bottom;
}

.search-bar .cursor {
  display: inline-block;
  width: 6px;
  margin-left: 8px;
  background: #a78bfa;
  height: 0.9em;
  vertical-align: bottom;
  /* No `animation: blink` CSS keyframe here — HF renders by seeking a paused
     timeline, and CSS animation clocks are NOT synced to that seek. A CSS
     blink will flicker non-deterministically. Drive cursor blink as a finite
     yoyo tween on the GSAP timeline instead — see GSAP Timeline section. */
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Pre-measure target text width to compute tracking distance.
  // In HF runtime, do this synchronously after fonts have loaded
  // (use a guard if fonts may not be ready — see Constraints below).
  const textEl = document.getElementById("reveal-text");
  const fullText = textEl.textContent;
  const targetCursorScreenX = 0.7 * 1920; // 70% from left
  const initialCursorScreenX = 120 + textEl.getBoundingClientRect().width * 0;
  // Phase 2 needs the cursor to land at targetCursorScreenX, so total world X shift =
  // initial - target if the cursor is at the END of fully-revealed text.
  const fullWidth = textEl.scrollWidth; // total text width after full reveal
  const trackingDelta = Math.max(0, 120 + fullWidth - targetCursorScreenX);

  // Phase 1 (0 -> 1.5s) — text reveals progressively; camera holds.
  // Reveal via clip-path or max-width tween:
  tl.fromTo(
    ".search-bar .text",
    { maxWidth: 0 },
    {
      maxWidth: fullWidth,
      duration: 1.5,
      ease: "none", // linear typing rate
    },
    0,
  );

  // Phase 2 (1.0 -> 2.5s) — camera tracks. Begin BEFORE full reveal so the
  // boundary feels continuous (text is still revealing as camera starts moving).
  tl.to(
    ".world",
    {
      x: -trackingDelta,
      duration: 1.5,
      ease: "power2.inOut",
    },
    1.0,
  );

  // Cursor blink — GSAP-driven (NEVER CSS @keyframes infinite, which doesn't
  // sync with HF's seek-by-frame). Finite yoyo, repeats computed from scene
  // length so blinks land deterministically across frames.
  const sceneDurationSec = 5; // match data-duration on the scene root
  const blinkHalfPeriod = 0.3; // 0.6s full cycle → on 0.3s, off 0.3s
  tl.to(
    ".search-bar .cursor",
    {
      opacity: 0,
      duration: blinkHalfPeriod,
      ease: "steps(1)", // hard on/off, no fade
      yoyo: true,
      repeat: Math.ceil(sceneDurationSec / blinkHalfPeriod) - 1,
    },
    0,
  );

  window.__timelines["tracking-scene"] = tl;
</script>
```

### Variations

- **Centered → Center-Tracked**: set `.viewport { justify-content: center; padding: 0; }`. Camera tracks once the focal point crosses the midline (target screen X = 0.5 \* 1920).
- **Left-Aligned → Right-Tracked**: as written above. Best when content exceeds viewport width from the start.

## Key Principles

- **Measure with `getBoundingClientRect()` after fonts load**, not by character count × font-size. Proportional fonts have variable glyph widths.
- **`white-space: nowrap`** on the world — text must stay on one line for camera math to work
- **Pre-allocate the world width** by setting `maxWidth` at full target width — prevents layout shift mid-tween
- **Eased camera** (`power2.inOut` / `power3.inOut`), not linear — natural pan feel
- **Spring-like via easing**, not via stiffness/damping params — GSAP doesn't have a built-in spring, but `back.out(1.2)` or `power4.out` approximate the settling feel

## Critical Constraints

- **Build the timeline SYNCHRONOUSLY, no fonts.ready gate** — HF renders frames in parallel workers, each a fresh browser. If you wrap the timeline build in `document.fonts.ready.then(...)`, some workers will seek frames BEFORE the Promise resolves and find no timeline registered → those frames render at CSS initial state (e.g. `max-width: 0` ⇒ empty text), other workers render correctly → visible flicker between empty and filled. Register `window.__timelines[id] = tl` at script-parse time, even if fonts haven't loaded yet — the camera math can tolerate ±5% width error from fallback-font measurement, but worker-race flicker is unacceptable.
- **If precise post-font measurement matters**, re-measure inside the tween's `onUpdate` (still deterministic per-frame seek), not via a Promise gate. Or set `font-display: block` on the @font-face to force the browser to wait for the font before painting any text.
- **Timeline must be paused**: `gsap.timeline({ paused: true })`. Never `tl.play()`
- **Registry key = `data-composition-id`**: `window.__timelines["tracking-scene"]` must match scene root
- **Continuous math at phase boundary**: the world's `x` at the moment tracking starts must equal the static-phase offset. If you tween from arbitrary values, the camera will visibly jump at the phase boundary.
- **Inline cursor, not absolutely positioned**: cursor should be a sibling of the text (inline-block) so it follows text flow naturally — absolute positioning misaligns with the camera math
- **`overflow: hidden` on `.viewport`**: clip the world's left edge as it pans off-screen
- **❗ Cursor blink via GSAP, NOT CSS `@keyframes ... infinite`** — HF renders by seeking the paused timeline; CSS animation clocks are NOT synchronized with that seek, so any CSS-driven blink will flicker non-deterministically across frames. Always drive blink as a finite yoyo tween on the paused GSAP timeline (repeat count computed from scene length).

## Combinations

- [context-sensitive-cursor.md](context-sensitive-cursor.md) — change cursor color/style per text segment during typing
- [discrete-text-sequence.md](discrete-text-sequence.md) — non-linear text reveals that pair with this camera

## Pairs with HF skills

- `/hyperframes-gsap` — timeline + tween API
- `/hyperframes-core` — composition wiring + `data-*` attributes
- `/hyperframes-cli` — `hyperframes lint` to validate the registry key + duration
