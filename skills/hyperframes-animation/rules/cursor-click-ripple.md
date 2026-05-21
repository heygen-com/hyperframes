---
name: cursor-click-ripple
description: Animated mouse cursor moves to target, clicks with scale depression and expanding ripple rings.
metadata:
  tags: cursor, click, ripple, interaction, mouse, button
---

# Cursor Click Ripple

An animated cursor moves to a target element, performs a click with visual depression, and emits expanding ripple rings from the click point.

## How It Works

Three sequential phases driven by a single GSAP timeline:

1. **Move**: eased cursor translation from entry point to the target element's center
2. **Click**: scale depression on both cursor and target (yoyo: shrink then return)
3. **Ripple**: expanding circles radiate outward from the click point with fade-out. 1–3 staggered rings amplify the click feedback

Use a GSAP timeline because the phase ordering (move → settle → click → ripples) is exactly what timelines express cleanly.

## HTML

```html
<div
  class="scene"
  id="cursor-click-scene"
  data-composition-id="cursor-click-scene"
  data-start="0"
  data-duration="2"
  data-track-index="0"
>
  <button class="target-button">{ctaLabel}</button>

  <div class="cursor">
    <svg width="24" height="24" viewBox="0 0 24 24">
      <path
        d="M5 3L19 12L12 13L9 20L5 3Z"
        fill="{cursorFill}"
        stroke="{cursorStroke}"
        stroke-width="1.5"
      />
    </svg>
  </div>

  <!-- Ripple rings — centered on click target, hidden until trigger -->
  <div class="ripple ripple-1"></div>
  <div class="ripple ripple-2"></div>
  <div class="ripple ripple-3"></div>
</div>
```

## CSS

Position cursor at the entry point. Button sits at its final position. Ripples are at the click-target center with `scale: 0` and `opacity: 0` so they hold invisible until the timeline trigger:

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
}

.target-button {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  /* ...button styling (background, color, font from project tokens) */
}

.cursor {
  position: absolute;
  left: 10%;
  top: 80%; /* entry corner */
  pointer-events: none;
  z-index: 999;
}

.ripple {
  position: absolute;
  left: 50%;
  top: 50%; /* click target center */
  width: 100px;
  height: 100px;
  border-radius: 50%;
  border: 2px solid {rippleColor};
  transform: translate(-50%, -50%) scale(0);
  opacity: 0;
  pointer-events: none;
}
```

## GSAP Timeline

Build a paused timeline. Register it on `window.__timelines` with the same key as `data-composition-id` on the scene root. All tuning values are named constants — see How to Choose Values below.

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // MOVE_DUR, MOVE_EASE, CLICK_AT, PRESS_DUR, CURSOR_PRESS_SCALE, TARGET_PRESS_SCALE,
  // RIPPLE_AT, RIPPLE_DUR, RIPPLE_SCALE, RIPPLE_STAGGER, RIPPLE_EASE
  // — all named; values per How to Choose Values.

  // Phase 1 — Move cursor to target center (eased, not linear)
  tl.to(
    ".cursor",
    {
      x: TARGET_X,
      y: TARGET_Y,
      duration: MOVE_DUR,
      ease: MOVE_EASE,
    },
    0,
  );

  // Phase 2 — Click: cursor + target depress together, then return
  tl.to(
    ".cursor",
    {
      scale: CURSOR_PRESS_SCALE,
      duration: PRESS_DUR,
      ease: "power2.in",
      yoyo: true,
      repeat: 1,
    },
    CLICK_AT,
  );
  tl.to(
    ".target-button",
    {
      scale: TARGET_PRESS_SCALE,
      duration: PRESS_DUR,
      ease: "power2.in",
      yoyo: true,
      repeat: 1,
    },
    CLICK_AT,
  );

  // Phase 3 — Ripple burst, N rings staggered from the click point
  tl.set([".ripple-1", ".ripple-2", ".ripple-3"], { opacity: 1 }, RIPPLE_AT);
  tl.to(
    [".ripple-1", ".ripple-2", ".ripple-3"],
    {
      scale: RIPPLE_SCALE,
      opacity: 0,
      duration: RIPPLE_DUR,
      ease: RIPPLE_EASE,
      stagger: RIPPLE_STAGGER,
      immediateRender: false,
    },
    RIPPLE_AT,
  );

  window.__timelines["cursor-click-scene"] = tl;
</script>
```

## How to Choose Values

- **MOVE_DUR** — cursor travel time from entry to target, in seconds
  - Range: 0.4–1.0 s
  - Effects: short feels darting; long feels deliberate / "considered click"
  - Constraints: must end before `CLICK_AT` — otherwise the click fires while the cursor is still moving and reads as a misclick
  - Reference: examples/cta-orbit-collapse.html uses 0.5 s

- **MOVE_EASE** — easing family for the move tween
  - Discrete choice. Options:
    - `power2.inOut` — symmetric, calm; good for "the user thoughtfully moves the cursor"
    - `back.out(<n>)` — overshoot landing; good when the click target is a button you want the cursor to "settle onto" with a tiny visible recoil. Pair with a low overshoot coefficient (~1.2–1.4) — higher reads as cartoonish
    - `power3.out` — fast start, soft landing; good for a "decisive" move
  - Reference: examples/cta-orbit-collapse.html uses `back.out(1.3)`

- **CLICK_AT** — time the click fires, in seconds
  - Range: must be ≥ `MOVE_DUR` (cursor has settled); typically `MOVE_DUR + 0.0–0.3 s` of "decision pause"
  - Effects: zero pause reads as autopilot; >0.3 s of pause reads as hesitation
  - Reference: examples/cta-orbit-collapse.html clicks 0.2 s after the cursor settles

- **PRESS_DUR** — half-duration of the depression (the yoyo runs twice this)
  - Range: 0.06–0.12 s
  - Effects: short feels crisp; long feels mushy
  - Constraints: total press = `2 * PRESS_DUR`; must finish before the next scene phase needs the cursor / target back at normal scale
  - Reference: examples/cta-orbit-collapse.html uses 0.08 s

- **CURSOR_PRESS_SCALE / TARGET_PRESS_SCALE** — how far each compresses during the click
  - Range: cursor 0.80–0.90; target 0.92–0.97
  - Effects: smaller numbers = stronger "this click counts" feel; values close to 1 read as a gentle tap
  - Constraints: cursor compresses MORE than the target — the cursor is the actor, the target is the recipient
  - Reference: examples/cta-orbit-collapse.html uses cursor 0.85 / target 0.95

- **RIPPLE_AT** — when the rings start expanding, in seconds
  - Range: `CLICK_AT + 0.0–0.08 s`
  - Effects: simultaneous with the press feels causal; slight delay feels acoustic ("the click happens, then the wave radiates")
  - Reference: examples/cta-orbit-collapse.html starts the ripple at `CLICK_AT` exactly

- **RIPPLE_DUR** — how long each ring takes to fully expand and fade
  - Range: 0.5–1.0 s
  - Effects: short rings feel sharp; long rings feel like a soft sonar
  - Constraints: must complete before any phase that depends on the ring being gone (e.g. a screen wipe)
  - Reference: examples/cta-orbit-collapse.html uses 0.7 s

- **RIPPLE_SCALE** — final scale of each ring before it fades
  - Range: 3–6
  - Effects: 3 keeps the ring near the click site; 6 lets it sweep the surrounding area
  - Constraints: if the ring would exit the visible frame before opacity reaches 0, lower the scale or shorten the duration
  - Reference: examples/cta-orbit-collapse.html uses 5

- **RIPPLE_STAGGER** — delay between consecutive rings
  - Range: 0.06–0.12 s (or 0 for a single ring; see Variations)
  - Effects: below ~0.06 s reads as one thick ring; above ~0.12 s reads as separate events
  - Reference: examples/cta-orbit-collapse.html uses a single ring (no stagger)

- **RIPPLE_EASE** — easing family for the expansion
  - Discrete choice. Options:
    - `power2.out` — fast start, soft tail; the standard "ping" feel
    - `power3.out` — even sharper attack, longer tail
    - `expo.out` — almost-instant expansion with a long quiet fade; reads as a strong, distant pulse
  - Reference: examples/cta-orbit-collapse.html uses `power2.out`

- **TARGET_X / TARGET_Y** — pixel offset of the click target from the cursor's CSS-laid origin
  - These are layout-derived, not creative knobs — they must match the visual centroid of the actual click target. A 4 px miss reads as missing the button
  - Reference: examples/cta-orbit-collapse.html targets the white button at `CENTER_X + 130, CENTER_Y + 15`

## Variations

- **Single ring** — keep one `.ripple` element, drop the stagger; reads as more elegant when the rest of the scene is busy
- **Keyframed attack-decay** — replace the simple expand-and-fade with a `keyframes` block that ramps opacity 0 → peak → 0 across the duration; gives a clearer "energy radiates and dissipates" envelope (used in examples/cta-orbit-collapse.html)
- **Multi-ring expanding pulse** — 3 rings with 0.08 s stagger feels richer when the click is the climactic moment of the scene

## Key Principles

- **Move before click**: trigger the click only after the move tween has settled — clicking mid-motion reads as unintentional
- **Synchronized depression**: cursor + target depress at the same `position` time with the same duration (and both yoyo back)
- **Ripple from click point**: ripples expand from the exact click location (the button's visual center), not from any element's bounding-box origin
- **Subtle scale**: cursor compresses more than the target — see `CURSOR_PRESS_SCALE` / `TARGET_PRESS_SCALE`
- **High z-index cursor**: cursor renders above all content for the entire sequence

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`. Never call `tl.play()` — HyperFrames seeks the timeline frame-by-frame deterministically
- **Registry key = `data-composition-id`**: `window.__timelines["<id>"]` must match the `data-composition-id` on the scene root exactly
- **`immediateRender: false` on the ripple expand**: holds the initial state (`scale: 0`, `opacity: 0`) until the click moment, otherwise the tween pre-renders and the rings appear at the wrong size at t=0
- **Finite duration**: verify `tl.duration()` matches the scene's `data-duration`
- **`pointer-events: none` on cursor + ripples**: they're purely visual; never block underlying interactivity (matters for hover-able exports)
- **No CSS transitions / animations**: all motion lives in the GSAP timeline so seek stays deterministic

## Combinations

- [orbit-3d-entry.md](orbit-3d-entry.md) — when the click is the pivot that collapses orbiting elements toward the cursor's target
- [center-outward-expansion.md](center-outward-expansion.md) — the click can be the trigger for an outward burst from the click point
- [press-release-spring.md](press-release-spring.md) for stronger physical feel on the target button
- [scale-swap-transition.md](scale-swap-transition.md) for the button's state change after click (button morphs into success state, next view, etc.)

## Pairs with HF skills

- `/hyperframes-animation` — timeline + tween API reference (eases, stagger, `immediateRender`, etc.)
- `/hyperframes-core` — composition wiring (`data-*` attributes, scene structure, registration contract)
- `/hyperframes-cli` — `hyperframes lint` to verify the registry key + duration match
