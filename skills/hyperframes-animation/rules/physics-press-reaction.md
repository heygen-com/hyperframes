---
name: physics-press-reaction
description: Cursor + element synchronized press via subtractive spring forces — cursor lands on element, both compress together, then release. Distinct from press-release-spring (which has no cursor).
metadata:
  tags: spring, click, physics, cursor, subtractive, interaction, synchronized
---

# Physics Press Reaction (Cursor + Element Synced)

Models a real click: a cursor approaches a button, lands, and both compress IN SYNC, then release together. Two distinct timing events (down-frame and up-frame) bound by spring forces. Distinct from [press-release-spring](press-release-spring.md) (which has no cursor — just a press happening); this rule is the COMBINED cursor + element behavior.

## How It Works

A single `pressIntensity` value (0 → 1 → 0) is shared between cursor and button:

- **0 → 1** (press down): both compress to `pressedScale` (~0.92)
- **1 → 0** (release): both spring back to 1.0 with overshoot

The cursor ALSO translates to the button's center during the approach phase BEFORE press starts. After release, the cursor may move on (next interaction) or hold.

## HTML

```html
<div
  class="scene"
  id="press-react-scene"
  data-composition-id="press-react-scene"
  data-start="0"
  data-duration="3"
  data-track-index="0"
>
  <div class="stack">
    <button class="btn" id="btn">
      <span class="btn-icon">🚀</span>
      <span class="btn-label">SHIP NOW</span>
    </button>
    <div class="brand">— HEYGENVERSE.COM</div>
  </div>
  <!-- Cursor lives at scene-root level so it can translate freely -->
  <svg class="cursor" id="cursor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M3 2 L21 12 L12 13 L7 22 Z" fill="#f5f6fb" stroke="#0b0d1f" stroke-width="1.5" />
  </svg>
</div>
```

## CSS

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: radial-gradient(ellipse at center, #161a3a 0%, #0b0d1f 70%);
  font-family: "Inter", sans-serif;
  overflow: hidden;
}
.stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 64px;
}
.btn {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 32px 80px;
  background: linear-gradient(135deg, #a78bfa 0%, #6366f1 100%);
  border: none;
  border-radius: 28px;
  color: #fff;
  font-family: "Inter", sans-serif;
  font-weight: 900;
  font-size: 80px;
  letter-spacing: 8px;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 0 20px 64px rgba(108, 99, 255, 0.5);
  transform-origin: 50% 50%;
  will-change: transform;
}
.btn-icon {
  font-size: 88px;
  line-height: 1;
}
.brand {
  font-size: 48px;
  font-weight: 800;
  letter-spacing: 12px;
  color: #cdb8ff;
  text-transform: uppercase;
}
/* Cursor — absolute, positioned by GSAP */
.cursor {
  position: absolute;
  width: 64px;
  height: 64px;
  pointer-events: none;
  z-index: 100;
  /* initial position is set by gsap.set() */
  transform-origin: 0 0; /* arrow point is the click point */
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.5));
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Position cursor initially at top-right offscreen-ish
  gsap.set("#cursor", { x: 1700, y: 200 });

  // The button's screen center (1920x1080 grid place-center).
  // For SHIP NOW button approx at viewport center: x=960, y=540
  const BUTTON_CENTER = { x: 960, y: 540 };

  // Phase 1 — cursor approaches button (0.0 → 0.9s)
  tl.to(
    "#cursor",
    { x: BUTTON_CENTER.x, y: BUTTON_CENTER.y, duration: 0.9, ease: "power2.inOut" },
    0,
  );

  // Phase 2 — coordinated press down (button + cursor both scale to 0.9)
  const PRESS_SCALE = 0.9;
  tl.to(
    ["#btn", "#cursor"],
    {
      scale: PRESS_SCALE,
      duration: 0.18,
      ease: "power1.in",
    },
    1.0,
  );

  // Phase 3 — release (both spring back to 1.0 with overshoot)
  tl.to(
    ["#btn", "#cursor"],
    {
      scale: 1,
      duration: 0.55,
      ease: "back.out(2.0)",
    },
    1.18,
  );

  // Phase 4 — inner glow during press (boxShadow change synced to press scale)
  tl.to(
    "#btn",
    {
      boxShadow: "0 4px 16px rgba(108, 99, 255, 0.25), inset 0 0 32px rgba(255, 255, 255, 0.2)",
      duration: 0.18,
      ease: "power1.in",
    },
    1.0,
  );
  tl.to(
    "#btn",
    {
      boxShadow: "0 20px 64px rgba(108, 99, 255, 0.5)",
      duration: 0.55,
      ease: "power2.out",
    },
    1.18,
  );

  // Brand fades in early (context)
  tl.from(".brand", { opacity: 0, y: 12, duration: 0.6, ease: "power3.out" }, 0.3);

  // Cursor optionally moves off after press (or holds for dwell)
  tl.to("#cursor", { x: 1500, y: 800, duration: 0.6, ease: "power2.out" }, 2.0);

  window.__timelines["press-react-scene"] = tl;
</script>
```

## Variations

### Multiple-element chain press

Cursor presses button A → button A triggers swap → cursor moves to button B → presses again. Each press is a 0.7s sub-routine.

### Hold press (continuous pressure)

Insert a 0.4-0.6s hold between press-down and release. Cursor scale stays at 0.9, button scale stays at 0.9, inner glow stays on. Suggests "thinking" or "loading."

### Synchronized inner-glow pulse

During the hold phase, the inner glow pulses (sin-driven). Suggests "processing":

```js
const holdGlow = { p: 0 };
tl.to(
  holdGlow,
  {
    p: Math.PI * 4,
    duration: 0.5,
    ease: "none",
    onUpdate: () => {
      const alpha = 0.2 + Math.sin(holdGlow.p) * 0.15;
      document.getElementById("btn").style.boxShadow =
        `inset 0 0 32px rgba(255, 255, 255, ${alpha})`;
    },
  },
  1.2,
);
```

## Key Principles

- **Same `pressScale` on cursor AND button** — physical synchronicity. If only the button scales, the cursor appears to "tap on air"; if only the cursor scales, the button feels disconnected.
- **Cursor arrives BEFORE press starts** — there must be a clear moment of "cursor over target" before scale change. Otherwise the press is unattributed.
- **`back.out(1.8-2.2)` for release** — both elements need spring overshoot together. Linear release loses the tactile feel.
- **Inner glow appears DURING press, fades on release** — visual confirmation of contact. Outer shadow shrinks (pushed-in), inner glow appears (energy concentrated).
- **Cursor `pointer-events: none`** — the cursor is decorative; if it captures events, hover/click behaviors on button below break.
- **Cursor `transform-origin: 0 0`** — the arrow's tip is the click point, not its center. Scale around the tip keeps the click point stable.
- **❗ Climax dwell ≥1s** — after release, the comp must continue ≥1s. The press is a beat; viewer needs time to see the result.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS `transition`** on either cursor or button — competes with GSAP
- **Cursor SVG with `pointer-events: none`**
- **`will-change: transform`** on button (and cursor if desired)
- **`up-frame > down-frame`** — release MUST come after press; otherwise the comp shows release without press
- **Don't use real `mouseenter` / `click` events** — HF is a render context, not a UI; everything must run via the timeline

## Combinations

- [press-release-spring.md](press-release-spring.md) — the BUTTON-only press variant; this rule layers cursor on top
- [cursor-click-ripple.md](cursor-click-ripple.md) — adds a ripple effect at the click point
- [scale-swap-transition.md](scale-swap-transition.md) — the press TRIGGERS the swap

## Pairs with HF skills

- `/hyperframes-gsap` — coordinated multi-target tweens via array
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
