---
name: orbit-3d-entry
description: Elements flip in from 3D space then settle into continuous elliptical orbit around a focal point.
metadata:
  tags: orbit, 3d, flip, ellipse, circular, icon, entry, continuous
---

# Orbit with 3D Entry

Elements flip in from 3D space (rotateX + rotateY + translateZ) then transition into a continuous elliptical orbit around a focal point. Distinct from one-shot reveals — the orbit keeps running.

## How It Works

Two phases per element:

1. **Entry (0 → ~0.6s per element)**: GSAP tween from hidden 3D orientation (`rotateX: -90deg, rotateY: 90deg, z: -300`) to flat (`rotateX: 0, rotateY: 0, z: 0`). Spring-like ease for the flip-in.
2. **Orbit (after entry)**: Continuous trigonometric position around a center point. The element's `x` and `y` translate are driven by `cos(t)` and `sin(t)` at a slow angular speed.

The orbit runs **inside the timeline** — not via `requestAnimationFrame` — so HF seek-by-frame stays deterministic.

## HTML

```html
<div
  class="scene"
  id="orbit-scene"
  data-composition-id="orbit-scene"
  data-start="0"
  data-duration="5"
  data-track-index="0"
>
  <div class="orbit-stage">
    <div class="orbit-item" data-angle="0">★</div>
    <div class="orbit-item" data-angle="60">●</div>
    <div class="orbit-item" data-angle="120">◆</div>
    <div class="orbit-item" data-angle="180">▲</div>
    <div class="orbit-item" data-angle="240">■</div>
    <div class="orbit-item" data-angle="300">✦</div>
    <div class="orbit-center">HEYGEN</div>
  </div>
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
  perspective: 1800px; /* REQUIRED — without perspective, rotateX/Y flatten */
}
.orbit-stage {
  position: relative;
  width: 1000px;
  height: 700px;
  display: grid;
  place-items: center;
  transform-style: preserve-3d;
}
.orbit-item {
  position: absolute;
  /* Items live at stage center; GSAP translates them along the orbit. */
  top: 50%;
  left: 50%;
  width: 140px;
  height: 140px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #a78bfa 0%, #6366f1 100%);
  border-radius: 50%;
  font-family: "Inter", sans-serif;
  font-weight: 900;
  font-size: 64px;
  color: #fff;
  transform-style: preserve-3d;
  will-change: transform;
  box-shadow: 0 12px 36px rgba(108, 99, 255, 0.4);
}
.orbit-center {
  position: relative;
  z-index: 5;
  font-family: "Inter", sans-serif;
  font-weight: 900;
  font-size: 96px;
  letter-spacing: 8px;
  color: #f5f6fb;
  text-transform: uppercase;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const items = document.querySelectorAll(".orbit-item");
  const RADIUS_X = 380;
  const RADIUS_Y = RADIUS_X * 0.5; // perspective-flattened
  const ORBIT_DURATION = 5; // seconds for one full orbit revolution

  items.forEach((el, i) => {
    const initialAngleDeg = Number(el.dataset.angle);
    const initialAngleRad = (initialAngleDeg / 360) * Math.PI * 2;

    // Phase 1 — flip in from 3D
    tl.fromTo(
      el,
      {
        xPercent: -50,
        yPercent: -50,
        rotateX: -90,
        rotateY: 90,
        z: -300,
        opacity: 0,
        scale: 0.4,
      },
      {
        rotateX: 0,
        rotateY: 0,
        z: 0,
        opacity: 1,
        scale: 1,
        duration: 0.6,
        ease: "back.out(1.6)",
      },
      i * 0.08, // cascade entry
    );

    // Phase 2 — continuous orbit driven via a 0→1 progress tween
    const orbitState = { p: 0 };
    tl.to(
      orbitState,
      {
        p: 1,
        duration: ORBIT_DURATION,
        ease: "none",
        onUpdate: () => {
          const angle = initialAngleRad + orbitState.p * Math.PI * 2;
          const x = Math.cos(angle) * RADIUS_X;
          const y = Math.sin(angle) * RADIUS_Y;
          // z-index by orbit Y so bottom-of-orbit items render above center
          el.style.zIndex = String(Math.round(y + RADIUS_Y));
          el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
        },
      },
      i * 0.08 + 0.6,
    ); // after this element's flip-in
  });

  // Center label fades in once a few orbit items have landed
  tl.from(".orbit-center", { opacity: 0, scale: 0.6, duration: 0.6, ease: "back.out(1.4)" }, 0.4);

  window.__timelines["orbit-scene"] = tl;
</script>
```

## Variations

### Collapse to center

To reverse — orbit then collapse inward — interpolate `RADIUS_X` and `RADIUS_Y` to 0 in a final phase:

```js
const collapse = { r: 1 };
tl.to(
  collapse,
  {
    r: 0,
    duration: 0.8,
    ease: "power3.inOut",
    onUpdate: () =>
      items.forEach((el, i) => {
        const a = (Number(el.dataset.angle) / 360) * Math.PI * 2;
        el.style.transform = `translate(-50%,-50%) translate(${Math.cos(a) * RADIUS_X * collapse.r}px,${Math.sin(a) * RADIUS_Y * collapse.r}px) scale(${collapse.r})`;
      }),
  },
  ORBIT_DURATION + 0.6,
);
```

### Tilted orbit plane

For a more dramatic 3D orbit, rotate the entire `.orbit-stage` on the X axis:

```css
.orbit-stage {
  transform: rotateX(25deg);
}
```

Items rendered above/below the equator visually arc through the plane.

## Key Principles

- **`perspective` on scene root REQUIRED** — without it, rotateX/Y read as 2D scale and the flip-in looks flat
- **`transform-style: preserve-3d`** on both the stage and each item — preserves the 3D context as items have their own transforms
- **Stagger entries by 0.06-0.10s** — cascade reads as "swarm forming," simultaneous reads as "popcorn"
- **Orbit duration 4-6s for one revolution** — too fast looks frenetic, too slow looks frozen; gentle ambient motion is the goal
- **Element count 4-12** — fewer feels empty, more crowds the center
- **❗ Center label clearance — translateZ + capped item z-index** — `z-index` ALONE is unreliable inside a `transform-style: preserve-3d` stage (paint order follows Z position, not stacking-context z-index). For the orbit to NEVER occlude the headline:
  1. Push the center label forward: `transform: translateZ(220px); z-index: 9999;`
  2. Cap orbit-item dynamic z-index in `[1, 50]` so bottom-of-orbit items still read as "in front of" top-of-orbit items, but **never above the center label**. e.g.: `el.style.zIndex = String(1 + Math.round((y + RADIUS_Y) / (2 * RADIUS_Y) * 49));`
  3. **Choose `RADIUS_X` so items also clear the center label HORIZONTALLY at all angles.** If the label's half-width is `L_w` and the item's half-width is `I_w`, then `RADIUS_X` must satisfy `RADIUS_X * min(|cos(θ_minimum)|) ≥ L_w + I_w + breathing_room`. For a 6-item orbit with 60° angular spacing, the worst case is `cos(30°) ≈ 0.866` between items. Empirically, **`RADIUS_X = 700+ for HEYGEN (120px font), 800+ for $5,000-class counter (160px font)`**.
- **❗ Center element is the headline** — the orbit is ornamental motion around it. If the orbit dominates the eye, increase center element size or fade orbit items down

## Critical Constraints

- **No `requestAnimationFrame`** — orbit must run inside the timeline so HF seeks frame-by-frame deterministically
- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **Each item gets its OWN orbit tween** — don't share one tween with `targets: '.orbit-item'` because each starts at a different `initialAngle`
- **`will-change: transform`** — many simultaneous orbital transforms benefit from compositor hints
- **Don't animate `left`/`top`** — use `translate()` (composes with `translate(-50%, -50%)` centering)
- **❗ Entry must flip IN PLACE at orbital position, NOT at center** — a fromTo whose "from" and "to" both have `x: 0, y: 0` keeps the item at the stage center during phase 1, so it collides with the center label during flip-in (and then snaps to orbit on phase 2 start — a visible teleport).

  The correct pattern is to `gsap.set()` each item at `(cos(initialAngle)*RADIUS_X, sin(initialAngle)*RADIUS_Y)` with `opacity: 0` BEFORE adding tweens, then have phase 1 animate only rotation/opacity/scale — NOT translate. The item fades in IN PLACE at its orbital starting point, and phase 2 picks up the orbit smoothly from there.

  ```js
  items.forEach((el, i) => {
    const angle = (Number(el.dataset.angle) / 360) * Math.PI * 2;
    const startX = Math.cos(angle) * RADIUS_X;
    const startY = Math.sin(angle) * RADIUS_Y;

    // 1) Place at orbital position with opacity 0 — BEFORE any tween fires
    gsap.set(el, {
      xPercent: -50,
      yPercent: -50,
      x: startX,
      y: startY,
      rotateX: -90,
      rotateY: 90,
      z: -300,
      opacity: 0,
      scale: 0.4,
    });

    // 2) Phase 1 — flip in IN PLACE (no x/y in the tween)
    tl.to(
      el,
      {
        rotateX: 0,
        rotateY: 0,
        z: 0,
        opacity: 1,
        scale: 1,
        duration: 0.6,
        ease: "back.out(1.6)",
      },
      i * 0.08,
    );

    // 3) Phase 2 — orbit (onUpdate writes transform with new x/y)
    // ...
  });
  ```

## Combinations

- [center-outward-expansion.md](center-outward-expansion.md) — alternative entry pattern (burst, not orbit)
- [counting-dynamic-scale.md](counting-dynamic-scale.md) — center counter with orbiting decorations

## Pairs with HF skills

- `/hyperframes-gsap` — timeline + `onUpdate` API
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
