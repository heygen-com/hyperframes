---
name: orbit-3d-entry
description: Elements flip in from 3D space then settle into continuous elliptical orbit around a focal point.
metadata:
  tags: orbit, 3d, flip, ellipse, circular, icon, entry, continuous
---

# Orbit with 3D Entry

Elements flip in from 3D space (`rotateX` + `rotateY` + negative `z`) then settle into a continuous elliptical orbit around a center label. Distinct from one-shot reveals — the orbit keeps running, driven by a 0→1 progress tween INSIDE the timeline (never rAF).

## How It Works

Per element, two phases: (1) a `back.out` flip from a hidden 3D orientation to flat — **in place at its orbital starting position** (see Critical Constraints); (2) a continuous orbit where `onUpdate` computes `x/y` from `cos/sin(initialAngle + p·2π)` on the ellipse. The stage needs `perspective` on the scene root and `preserve-3d` on stage + items, or the flip flattens to a 2D scale.

## Recipe

```html
<!-- inside a standard scene clip (hyperframes-core) -->
<div class="orbit-stage">
  <div class="orbit-item" data-angle="0">{glyph1}</div>
  <div class="orbit-item" data-angle="60">{glyph2}</div>
  <!-- … evenly-spaced angles … -->
  <div class="orbit-center">{centerLabel}</div>
</div>
```

```css
.scene-root {
  display: grid;
  place-items: center;
  perspective: 1800px; /* REQUIRED */
}
.orbit-stage {
  position: relative;
  display: grid;
  place-items: center;
  transform-style: preserve-3d;
}
.orbit-item {
  position: absolute;
  top: 50%;
  left: 50%;
  transform-style: preserve-3d;
  will-change: transform;
}
.orbit-center {
  position: relative;
  transform: translateZ(220px); /* wins paint order inside preserve-3d */
  z-index: 9999;
}
```

```js
const items = document.querySelectorAll(".orbit-item");
const RADIUS_Y = RADIUS_X * Y_TO_X_RATIO; // perspective-flattened ellipse

items.forEach((el, i) => {
  const a0 = (Number(el.dataset.angle) / 360) * Math.PI * 2;
  const startX = Math.cos(a0) * RADIUS_X;
  const startY = Math.sin(a0) * RADIUS_Y;

  // 1) Park at the orbital position, hidden — BEFORE any tween fires
  gsap.set(el, {
    xPercent: -50,
    yPercent: -50,
    x: startX,
    y: startY,
    rotateX: ROTATE_X_FROM,
    rotateY: ROTATE_Y_FROM,
    z: Z_FROM,
    opacity: 0,
    scale: SCALE_FROM,
  });

  // 2) Flip in IN PLACE — rotation/opacity/scale only, never translate
  tl.to(
    el,
    {
      rotateX: 0,
      rotateY: 0,
      z: 0,
      opacity: 1,
      scale: 1,
      duration: ENTRY_DUR,
      ease: `back.out(${FLIP_BACK})`,
    },
    i * STAGGER,
  );

  // 3) Continuous orbit — each item gets its OWN progress tween (own initialAngle)
  const orbit = { p: 0 };
  tl.to(
    orbit,
    {
      p: 1,
      duration: ORBIT_DURATION,
      ease: "none",
      onUpdate: () => {
        const a = a0 + orbit.p * Math.PI * 2;
        const x = Math.cos(a) * RADIUS_X;
        const y = Math.sin(a) * RADIUS_Y;
        // capped z-index band [1, 50] — see center-label clearance below
        el.style.zIndex = String(1 + Math.round(((y + RADIUS_Y) / (2 * RADIUS_Y)) * 49));
        el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
      },
    },
    i * STAGGER + ENTRY_DUR,
  );
});

tl.from(
  ".orbit-center",
  { opacity: 0, scale: 0.6, duration: ENTRY_DUR, ease: `back.out(${CENTER_BACK})` },
  CENTER_FADE_AT,
);
```

## Variations

- **Collapse to center**: a final 1→0 driver multiplies both radii (and item scale) in `onUpdate` — the ring condenses into the center element; pairs with a CTA "click" igniting the collapse.
- **Tilted orbit plane**: `rotateX(25deg)` on `.orbit-stage` — items visibly arc through the plane.

## Values

| token                   | range                         | notes                                                               |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------- |
| RADIUS_X                | 300–900px                     | must also clear the center label horizontally (see below)           |
| Y_TO_X_RATIO            | 0.4–0.7                       | keep < 1 — a tilted ring, not a frontal halo                        |
| ORBIT_DURATION          | 4–25s per revolution          | ≥ time on screen, or the tween ends and items freeze                |
| ENTRY_DUR               | 0.4–0.8s                      |                                                                     |
| STAGGER                 | 0.06–0.12s                    | below reads "popcorn", above reads plodding                         |
| FLIP_BACK / CENTER_BACK | 1.2–2.0 / 1.2–1.8             | calm the center pop if both fire close together                     |
| CENTER_FADE_AT          | after 2–4 items land          | too early competes; too late leaves a hole                          |
| ROTATE_X/Y_FROM, Z_FROM | ±60–120°, ±45–120°, −200…−400 | one consistent rotation direction across items; mixed signs = noise |
| SCALE_FROM              | 0.2–0.6                       |                                                                     |
| item count              | 4–12                          | fewer feels empty, more crowds the center                           |

## Critical Constraints

- **❗ Entry must flip IN PLACE at the orbital position, NOT at center** — `gsap.set` each item at `(cos(a0)·RADIUS_X, sin(a0)·RADIUS_Y)` with `opacity: 0` BEFORE adding tweens, then phase 1 animates only rotation/opacity/scale. A fromTo that keeps `x/y: 0` flips at the stage center, collides with the center label, then teleports to the orbit when phase 2 starts.
- **❗ Center-label clearance** — `z-index` alone is unreliable inside `preserve-3d` (paint order follows actual Z): push the label forward with `translateZ(220px)` + `z-index: 9999`, cap item z-index to `[1, 50]`, AND size the ring so items clear the label horizontally at every angle: `RADIUS_X × min|cos(θ)| ≥ L_w + I_w + breathing_room` (label/item half-widths; for 6 items the worst case is `cos(30°) ≈ 0.866`). A heavier wordmark needs a wider ring.
- **Each item gets its OWN orbit tween** — a shared `targets: ".orbit-item"` tween can't carry per-item `initialAngle`.
- **The center element is the headline** — the orbit is ornament; if it dominates, grow the center or fade the items down.

## See also

`center-outward-expansion` (burst entry; reversed driver = the collapse finish) · `cursor-click-ripple` (the click that triggers a collapse) · `depth-scatter-assemble` (3D entrance that resolves flat instead of orbiting).
