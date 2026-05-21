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
- **Phase 2 (Tracking)** — Activates when the focal point (cursor, highlight, last typed glyph) exceeds a target screen position (e.g. a configurable fraction `CURSOR_TARGET_FRACTION` of viewport width from the left). The world container translates leftward (`x: -<delta>`) keeping the focal point pinned at that screen position.

The offset math is **mathematically continuous** at the phase boundary — at the instant tracking starts, the world position equals what the static phase had. So the transition is seamless.

The piecewise form used in code is:

```
finalWorldX = Math.min(INITIAL_OFFSET, trackingOffset)
```

`INITIAL_OFFSET` is the static-phase value; `trackingOffset` is whatever shift keeps the focal point at `CURSOR_TARGET_FRACTION × viewportWidth`. While the focal point hasn't grown past the target screen X, `trackingOffset` exceeds `INITIAL_OFFSET` (it's a less-negative number) and `Math.min` returns the static value. Once the focal point would cross the target, `trackingOffset` overtakes `INITIAL_OFFSET` and tracking takes over.

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
        <span class="text" id="reveal-text">{phrase}</span><span class="cursor">|</span>
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
  padding-left: VIEWPORT_PAD_LEFT; /* "left margin" — variation: left-aligned init */
}

.world {
  display: flex;
  align-items: center;
  white-space: nowrap; /* keep text on one line for camera-tracking */
  transform: translateX(0); /* GSAP will animate this */
}

.search-bar {
  font-family: {font};
  font-size: BAR_FONT_SIZE;
  font-weight: BAR_FONT_WEIGHT;
  color: {textColor};
  letter-spacing: BAR_LETTER_SPACING;
}

.search-bar .text {
  /* Width grows as more characters reveal */
  display: inline-block;
  overflow: hidden;
  vertical-align: bottom;
}

.search-bar .cursor {
  display: inline-block;
  width: CURSOR_WIDTH;
  margin-left: CURSOR_GAP;
  background: {accentColor};
  height: CURSOR_HEIGHT_EM;
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
  // Build the timeline SYNCHRONOUSLY — see Critical Constraints for why
  // a fonts.ready gate causes worker-race flicker.
  const textEl = document.getElementById("reveal-text");
  const fullText = textEl.textContent;
  const targetCursorScreenX = CURSOR_TARGET_FRACTION * VIEWPORT_WIDTH;
  const fullWidth = textEl.scrollWidth; // total text width after full reveal
  const trackingDelta = Math.max(0, VIEWPORT_PAD_LEFT + fullWidth - targetCursorScreenX);

  // Phase 1 — text reveals progressively; camera holds.
  // Reveal via max-width tween (no layout-property tweens on width/left/top).
  tl.fromTo(
    ".search-bar .text",
    { maxWidth: 0 },
    {
      maxWidth: fullWidth,
      duration: REVEAL_DUR,
      ease: "none", // linear typing rate
    },
    REVEAL_START,
  );

  // Phase 2 — camera tracks. Begin BEFORE full reveal so the boundary feels
  // continuous (text is still revealing as camera starts moving). The
  // Math.min(INITIAL_OFFSET, trackingOffset) formulation makes the handoff
  // mathematically continuous; see How It Works.
  tl.to(
    ".world",
    {
      x: -trackingDelta,
      duration: TRACK_DUR,
      ease: "power2.inOut",
    },
    TRACK_START,
  );

  // Cursor blink — GSAP-driven (NEVER CSS @keyframes infinite, which doesn't
  // sync with HF's seek-by-frame). Finite yoyo, repeats computed from scene
  // length so blinks land deterministically across frames.
  const blinkRepeats = Math.ceil(SCENE_DURATION / BLINK_HALF_PERIOD) - 1;
  tl.to(
    ".search-bar .cursor",
    {
      opacity: 0,
      duration: BLINK_HALF_PERIOD,
      ease: "steps(1)", // hard on/off, no fade
      yoyo: true,
      repeat: blinkRepeats,
    },
    0,
  );

  window.__timelines["tracking-scene"] = tl;
</script>
```

### Variations

- **Centered → Center-Tracked**: set `.viewport { justify-content: center; padding: 0; }`. Camera tracks once the focal point crosses the midline (`CURSOR_TARGET_FRACTION = 0.5`).
- **Left-Aligned → Right-Tracked**: as written above. Best when content exceeds viewport width from the start.
- **Continuous typing driver**: replace the `maxWidth` tween with an `onUpdate` typing clock (`charsTyped = Math.floor(progress)`) plus per-frame `measureNodeWidth` to drive the cursor screen X. Required when the typed text is consumed elsewhere in the scene (e.g. by a parent strip's camera offset).

## How to Choose Values

- **VIEWPORT_PAD_LEFT** — left-edge padding of the world inside the viewport (Phase 1 anchor X).
  - Range: 0 → ~10% of viewport width
  - Effects: 0 hugs the left edge; larger inset feels more like a centered hero frame
  - Constraints: must match the CSS `padding-left` on `.viewport` or the camera math drifts
- **VIEWPORT_WIDTH** — the composition's `data-width` in CSS pixels.
  - Constraints: must equal the scene root's `data-width`; never tweened
- **CURSOR_TARGET_FRACTION** — fraction of viewport width where the focal point locks during Phase 2.
  - Range: 0.5 (center-tracked) → 0.75 (right-leaning, more text visible behind cursor)
  - Effects: lower values leave less revealed text in frame; higher values delay tracking
- **BAR_FONT_SIZE** — hero element font size.
  - Range: ~8-12% of viewport height; below ~6% reads as a UI widget rather than a cinematic element
- **BAR_FONT_WEIGHT** — weight of the search-bar text.
  - Range: discrete; 400 for neutral demo text, 700 for hero / headline framing
- **BAR_LETTER_SPACING** — `letter-spacing` for the bar text.
  - Range: slight negative (tighter, more cinematic) → 0 (default)
- **CURSOR_WIDTH** — visual cursor stroke width in CSS pixels.
  - Range: ~4-10 px at 1080p; thinner reads as typed text, thicker reads as a block caret
- **CURSOR_GAP** — `margin-left` between text and cursor.
  - Range: a few px of breathing room; do not exceed the cursor width or it visually detaches
- **CURSOR_HEIGHT_EM** — cursor height as an em multiple of the font.
  - Range: 0.85-1.0; matches the visual height of the typed glyphs
- **REVEAL_START** — when Phase 1 typing begins.
  - Constraints: typically 0; if preceded by another phase, ≥ that phase's end + small buffer
- **REVEAL_DUR** — duration of the Phase 1 reveal tween.
  - Range: scale with character count (target an average per-character cadence in the 0.05-0.15s range)
  - Constraints: must end before `SCENE_DURATION` and ideally overlap slightly with the tracking phase
- **TRACK_START** — when Phase 2 camera motion begins.
  - Range: usually before reveal completes so the handoff feels continuous; can equal `REVEAL_START` if the focal point is already past the target at t=0
  - Constraints: `TRACK_START < REVEAL_START + REVEAL_DUR` for a smooth crossfade
- **TRACK_DUR** — duration of the camera pan.
  - Range: 0.8-2.0s; under 0.5s reads as a snap, over 2.5s drags
- **SCENE_DURATION** — must match the scene root's `data-duration`.
  - Constraints: feeds the blink repeat count; mismatch causes blinks to truncate or run past the end
- **BLINK_HALF_PERIOD** — half-period of the cursor blink (one on-state OR one off-state).
  - Range: 0.2-0.4s; 0.3s reads as a natural caret blink
  - Constraints: derived value `Math.ceil(SCENE_DURATION / BLINK_HALF_PERIOD) - 1` must be ≥ 0
- **Ease choices** — discrete:
  - Camera pan: `power2.inOut` or `power3.inOut` for cinematic settle; avoid `back.out` (overshoot reads as UI bounce, not camera)
  - Reveal: `"none"` for linear typing; any easing distorts the per-keystroke cadence
  - Blink: `"steps(1)"` for hard on/off; any easing fades the cursor and breaks the caret feel

## Key Principles

- **Measure with `getBoundingClientRect()` / probe nodes**, not by character count × font-size. Proportional fonts have variable glyph widths.
- **`white-space: nowrap`** on the world — text must stay on one line for camera math to work
- **Pre-allocate the world width** by setting `maxWidth` at full target width — prevents layout shift mid-tween
- **Eased camera** (`power2.inOut` / `power3.inOut`), not linear — natural pan feel
- **Spring-like via easing**, not via stiffness/damping params — GSAP doesn't have a built-in spring, but `back.out(${BOUNCE_FACTOR})` or `power4.out` approximate the settling feel

## Critical Constraints

- **Build the timeline SYNCHRONOUSLY, no fonts.ready gate** — HF renders frames in parallel workers, each a fresh browser. If you wrap the timeline build in `document.fonts.ready.then(...)`, some workers will seek frames BEFORE the Promise resolves and find no timeline registered → those frames render at CSS initial state (e.g. `max-width: 0` ⇒ empty text), other workers render correctly → visible flicker between empty and filled. Register `window.__timelines[id] = tl` at script-parse time, even if fonts haven't loaded yet — the camera math can tolerate a few percent width error from fallback-font measurement, but worker-race flicker is unacceptable.
- **If precise post-font measurement matters**, re-measure inside the tween's `onUpdate` (still deterministic per-frame seek), not via a Promise gate. Or set `font-display: block` on the @font-face to force the browser to wait for the font before painting any text.
- **Timeline must be paused**: `gsap.timeline({ paused: true })`. Never `tl.play()`
- **Registry key = `data-composition-id`**: `window.__timelines["tracking-scene"]` must match scene root
- **Continuous math at phase boundary**: the world's `x` at the moment tracking starts must equal the static-phase offset. The `Math.min(INITIAL_OFFSET, trackingOffset)` formulation guarantees this; do NOT switch to a hard `if (typingProgress > threshold)` branch or the camera will visibly jump.
- **Inline cursor, not absolutely positioned**: cursor should be a sibling of the text (inline-block) so it follows text flow naturally — absolute positioning misaligns with the camera math
- **`overflow: hidden` on `.viewport`**: clip the world's left edge as it pans off-screen
- **Cursor blink via GSAP, NOT CSS `@keyframes ... infinite`** — HF renders by seeking the paused timeline; CSS animation clocks are NOT synchronized with that seek, so any CSS-driven blink will flicker non-deterministically across frames. Always drive blink as a finite yoyo tween on the paused GSAP timeline (repeat count computed from scene length).

## Combinations

- [context-sensitive-cursor.md](context-sensitive-cursor.md) — change cursor color/style per text segment during typing
- [discrete-text-sequence.md](discrete-text-sequence.md) — non-linear text reveals that pair with this camera

## Pairs with HF skills

- `/hyperframes-animation` — timeline + tween API
- `/hyperframes-core` — composition wiring + `data-*` attributes
- `/hyperframes-cli` — `hyperframes lint` to validate the registry key + duration
