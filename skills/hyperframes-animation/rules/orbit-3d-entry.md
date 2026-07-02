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

1. **Entry (per element)**: GSAP tween from hidden 3D orientation (`rotateX`, `rotateY`, negative `z`) to flat (`rotateX: 0, rotateY: 0, z: 0`). Spring-like ease (`back.out`) for the flip-in.
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
    <div class="orbit-item" data-angle="0">{glyph1}</div>
    <div class="orbit-item" data-angle="60">{glyph2}</div>
    <div class="orbit-item" data-angle="120">{glyph3}</div>
    <div class="orbit-item" data-angle="180">{glyph4}</div>
    <div class="orbit-item" data-angle="240">{glyph5}</div>
    <div class="orbit-item" data-angle="300">{glyph6}</div>
    <div class="orbit-center">{centerLabel}</div>
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
  background: {sceneBackground};
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
  background: {accentColor};
  border-radius: 50%;
  font-family: {font};
  font-weight: 900;
  font-size: 64px;
  color: {itemTextColor};
  transform-style: preserve-3d;
  will-change: transform;
  box-shadow: 0 12px 36px {accentShadowColor};
}
.orbit-center {
  position: relative;
  z-index: 5;
  font-family: {font};
  font-weight: 900;
  font-size: 96px;
  letter-spacing: 8px;
  color: {centerTextColor};
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
  // RADIUS_X, RADIUS_Y, ORBIT_DURATION, ENTRY_DUR, STAGGER, FLIP_BACK, CENTER_BACK
  // — all named constants; values per "How to Choose Values" below.
  const RADIUS_Y = RADIUS_X * Y_TO_X_RATIO; // perspective-flattened ellipse

  items.forEach((el, i) => {
    const initialAngleDeg = Number(el.dataset.angle);
    const initialAngleRad = (initialAngleDeg / 360) * Math.PI * 2;
    const startX = Math.cos(initialAngleRad) * RADIUS_X;
    const startY = Math.sin(initialAngleRad) * RADIUS_Y;

    // 1) Place at orbital position with opacity 0 — BEFORE any tween fires
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

    // 2) Phase 1 — flip in IN PLACE at orbital position
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

    // 3) Phase 2 — continuous orbit driven via a 0→1 progress tween
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
          // z-index by orbit Y — see "Center label clearance" in Key Principles
          // for the capped-range form when a center label is present.
          el.style.zIndex = String(Math.round(y + RADIUS_Y));
          el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
        },
      },
      i * STAGGER + ENTRY_DUR,
    );
  });

  // Center label fades in once a few orbit items have landed
  tl.from(
    ".orbit-center",
    { opacity: 0, scale: 0.6, duration: ENTRY_DUR, ease: `back.out(${CENTER_BACK})` },
    CENTER_FADE_AT,
  );

  window.__timelines["orbit-scene"] = tl;
</script>
```

## How to Choose Values

- **RADIUS_X** — horizontal radius of the orbit ellipse, in px
  - Range: 300–900 px
  - Effects: small radius reads as a tight cluster; large radius spreads the ring across the frame and lets a large center element breathe
  - Constraints: must clear the center element horizontally at every angle — see Key Principles for the `RADIUS_X * min(|cos(θ)|) ≥ L_w + I_w + breathing_room` rule
  - Reference: ../../examples/cta-orbit-collapse.html uses 480

- **Y_TO_X_RATIO** — `RADIUS_Y / RADIUS_X`, the orbit's perspective flattening
  - Range: 0.4–0.7
  - Effects: low values read as a near-horizontal disc seen from above; values approaching 1 read as a flat plane facing the camera
  - Constraints: keep < 1 — the orbit should look like a tilted ring, not a frontal halo
  - Reference: ../../examples/cta-orbit-collapse.html uses ≈ 0.58

- **ORBIT_DURATION** — seconds for one full revolution
  - Range: 4–25 s (longer for ambient backdrop, shorter for active feature motion)
  - Effects: short durations look frenetic; long durations read as drifting / calm
  - Constraints: must be ≥ the time the orbit is on screen, otherwise the tween ends and items stop
  - Reference: ../../examples/cta-orbit-collapse.html uses ~25 s effective (orbit speed 0.25 rad/s)

- **ENTRY_DUR** — per-element flip-in duration
  - Range: 0.4–0.8 s
  - Effects: short feels punchy; long feels stately
  - Constraints: must be ≤ the gap between the first and last element's start so the cascade doesn't overlap to incoherence
  - Reference: ../../examples/cta-orbit-collapse.html uses 0.55 s

- **STAGGER** — delay between consecutive element entries
  - Range: 0.06–0.12 s
  - Effects: below ~0.06 s reads as "popcorn"; above ~0.12 s reads as plodding
  - Constraints: total cascade `(n - 1) * STAGGER` should still complete before the next scene phase begins
  - Reference: ../../examples/cta-orbit-collapse.html uses 0.10 s

- **FLIP_BACK** — `back.out(<n>)` overshoot for the flip-in
  - Range: 1.2–2.0
  - Effects: low end is a soft arrive; high end snaps with visible overshoot
  - Constraints: pair with a calmer `CENTER_BACK` if both fire close together — competing overshoots cancel each other
  - Reference: ../../examples/cta-orbit-collapse.html uses 1.4

- **CENTER_BACK** — `back.out(<n>)` overshoot for the center label fade-in
  - Range: 1.2–1.8
  - Effects: low end keeps the label calm under the busy orbit; high end gives it a small "pop" of arrival
  - Reference: ../../examples/cta-orbit-collapse.html uses 1.4

- **CENTER_FADE_AT** — when the center label fades in, in seconds
  - Range: just after the first 2–4 elements have landed
  - Effects: too early competes with the cascade; too late leaves a hole at the center of the orbit
  - Reference: ../../examples/cta-orbit-collapse.html starts the center brand near the front of the scene

- **ROTATE_X_FROM / ROTATE_Y_FROM / Z_FROM / SCALE_FROM** — initial 3D orientation
  - Range: rotateX ±60° to ±120°; rotateY ±45° to ±120°; z −200 to −400; scale 0.2–0.6
  - Effects: higher absolute rotation + deeper negative z = more dramatic "card flipping out of depth"; lower = subtle reorientation
  - Constraints: pick a direction consistent with the scene's perspective; mixing positive and negative rotateY across items reads as noise
  - Reference: ../../examples/cta-orbit-collapse.html uses rotateX 90, rotateY −45, z −100, scale 0

## Variations

### Collapse to center

To reverse — orbit then collapse inward — interpolate `RADIUS_X` and `RADIUS_Y` to 0 in a final phase by multiplying both radii by a 1→0 driver:

```js
const collapse = { r: 1 };
tl.to(
  collapse,
  {
    r: 0,
    duration: COLLAPSE_DUR,
    ease: "power3.inOut",
    onUpdate: () =>
      items.forEach((el) => {
        const a = (Number(el.dataset.angle) / 360) * Math.PI * 2;
        const x = Math.cos(a) * RADIUS_X * collapse.r;
        const y = Math.sin(a) * RADIUS_Y * collapse.r;
        el.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px) scale(${collapse.r})`;
      }),
  },
  COLLAPSE_AT,
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
- **Stagger entries** — cascade reads as "swarm forming," simultaneous reads as "popcorn." See `STAGGER` in How to Choose Values
- **Element count 4-12** — fewer feels empty, more crowds the center
- **❗ Center label clearance — translateZ + capped item z-index** — `z-index` ALONE is unreliable inside a `transform-style: preserve-3d` stage (paint order follows Z position, not stacking-context z-index). For the orbit to NEVER occlude the headline:
  1. Push the center label forward: `transform: translateZ(220px); z-index: 9999;`
  2. Cap orbit-item dynamic z-index in `[1, 50]` so bottom-of-orbit items still read as "in front of" top-of-orbit items, but **never above the center label**. e.g.: `el.style.zIndex = String(1 + Math.round((y + RADIUS_Y) / (2 * RADIUS_Y) * 49));`
  3. **Choose `RADIUS_X` so items also clear the center label HORIZONTALLY at all angles.** If the label's half-width is `L_w` and the item's half-width is `I_w`, then `RADIUS_X` must satisfy `RADIUS_X * min(|cos(θ_minimum)|) ≥ L_w + I_w + breathing_room`. For a 6-item orbit with 60° angular spacing, the worst case is `cos(30°) ≈ 0.866` between items. Scale `RADIUS_X` with the center label's width — a heavier wordmark needs a wider ring.
- **❗ Center element is the headline** — the orbit is ornamental motion around it. If the orbit dominates the eye, increase center element size or fade orbit items down

## Critical Constraints

- **No `requestAnimationFrame`** — orbit must run inside the timeline so HF seeks frame-by-frame deterministically
- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **Each item gets its OWN orbit tween** — don't share one tween with `targets: '.orbit-item'` because each starts at a different `initialAngle`
- **`will-change: transform`** — many simultaneous orbital transforms benefit from compositor hints
- **Don't animate `left`/`top`** — use `translate()` (composes with `translate(-50%, -50%)` centering)
- **❗ Entry must flip IN PLACE at orbital position, NOT at center** — a fromTo whose "from" and "to" both have `x: 0, y: 0` keeps the item at the stage center during phase 1, so it collides with the center label during flip-in (and then snaps to orbit on phase 2 start — a visible teleport).

  The correct pattern (see GSAP Timeline above) is to `gsap.set()` each item at `(cos(initialAngle)*RADIUS_X, sin(initialAngle)*RADIUS_Y)` with `opacity: 0` BEFORE adding tweens, then have phase 1 animate only rotation/opacity/scale — NOT translate. The item fades in IN PLACE at its orbital starting point, and phase 2 picks up the orbit smoothly from there.

## Combinations

- [center-outward-expansion.md](center-outward-expansion.md) — alternative entry pattern (burst, not orbit); also the reversed driver for an orbit-collapse finish
- [cursor-click-ripple.md](cursor-click-ripple.md) — pairs naturally when the center element is a CTA the user "clicks" to trigger the collapse
- [sine-wave-loop.md](sine-wave-loop.md) — per-item idle wobble layered on top of the orbit

## Pairs with HF skills

- `/hyperframes-animation` — timeline + `onUpdate` API
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
