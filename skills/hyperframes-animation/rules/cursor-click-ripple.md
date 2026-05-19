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
3. **Ripple**: expanding circles radiate outward from the click point with fade-out. 2–3 staggered rings amplify the click feedback

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
  <button class="target-button">Click me</button>

  <div class="cursor">
    <svg width="24" height="24" viewBox="0 0 24 24">
      <path d="M5 3L19 12L12 13L9 20L5 3Z" fill="white" stroke="#000" stroke-width="1.5" />
    </svg>
  </div>

  <!-- Ripple rings — centered on click target, hidden until trigger -->
  <div class="ripple ripple-1"></div>
  <div class="ripple ripple-2"></div>
  <div class="ripple ripple-3"></div>
</div>
```

## CSS (hero-frame layout)

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
  /* ...button styling */
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
  border: 2px solid var(--accent, #fff);
  transform: translate(-50%, -50%) scale(0);
  opacity: 0;
  pointer-events: none;
}
```

## GSAP Timeline

Build a paused timeline. Register it on `window.__timelines` with the same key as `data-composition-id` on the scene root:

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Phase 1 — Move cursor to target center (eased, not linear)
  tl.to(
    ".cursor",
    {
      left: "50%",
      top: "50%",
      duration: 0.7,
      ease: "power2.inOut",
    },
    0,
  );

  // Phase 2 — Click: cursor + target depress together, then return
  tl.to(
    ".cursor",
    {
      scale: 0.85,
      duration: 0.08,
      ease: "power2.in",
      yoyo: true,
      repeat: 1,
    },
    0.7,
  );
  tl.to(
    ".target-button",
    {
      scale: 0.95,
      duration: 0.08,
      ease: "power2.in",
      yoyo: true,
      repeat: 1,
    },
    0.7,
  );

  // Phase 3 — Ripple burst, 3 rings staggered
  tl.set([".ripple-1", ".ripple-2", ".ripple-3"], { opacity: 1 }, 0.76);
  tl.to(
    [".ripple-1", ".ripple-2", ".ripple-3"],
    {
      scale: 3,
      opacity: 0,
      duration: 0.9,
      ease: "power2.out",
      stagger: 0.08,
      immediateRender: false,
    },
    0.76,
  );

  window.__timelines["cursor-click-scene"] = tl;
</script>
```

## Key Principles

- **Move before click**: trigger the click only after the move tween has settled — clicking mid-motion reads as unintentional
- **Synchronized depression**: cursor + target depress at the same `position` time with the same duration (and both yoyo back)
- **Ripple from click point**: ripples expand from the exact click location (the button center), not from any element's bounding-box origin
- **Staggered rings**: 2–3 rings at 0.08s stagger feel richer than a single ring
- **Subtle scale**: target at `scale: 0.95`, cursor at `scale: 0.85` — visible without looking cartoonish
- **High z-index cursor**: cursor renders above all content for the entire sequence

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`. Never call `tl.play()` — HyperFrames seeks the timeline frame-by-frame deterministically
- **Registry key = `data-composition-id`**: `window.__timelines["<id>"]` must match the `data-composition-id` on the scene root exactly
- **`immediateRender: false` on the ripple expand**: holds the initial state (`scale: 0`, `opacity: 0`) until the click moment, otherwise the tween pre-renders and the rings appear at the wrong size at t=0
- **Finite duration**: total timeline ≈ 1.7s — verify `tl.duration()` matches the scene's `data-duration`
- **`pointer-events: none` on cursor + ripples**: they're purely visual; never block underlying interactivity (matters for hover-able exports)

## Combinations

- [press-release-spring.md](press-release-spring.md) for stronger physical feel on the target button
- [scale-swap-transition.md](scale-swap-transition.md) for the button's state change after click (button morphs into success state, next view, etc.)

## Pairs with HF skills

- `/hyperframes-gsap` — timeline + tween API reference (eases, stagger, `immediateRender`, etc.)
- `/hyperframes-core` — composition wiring (`data-*` attributes, scene structure, registration contract)
- `/hyperframes-cli` — `hyperframes lint` to verify the registry key + duration match
