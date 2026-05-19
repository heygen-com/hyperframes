---
name: split-tilt-cards
description: Two cards positioned side-by-side with opposing Y-rotation, creating a symmetric "book-open" 3D split-screen layout. Entry slides inward from both sides; floating motion runs in phase opposition between the two cards.
metadata:
  tags: 3d, cards, split, tilt, comparison, symmetric, layout, gsap
  adapter: gsap
---

# Split Tilt Cards

Two cards positioned side-by-side, each rotated in opposite Y directions. Creates a symmetric "book-open" 3D effect for comparisons, features, or before/after layouts. Each card slides in from its own side and then floats out of phase with the other so the pair feels alive.

## HyperFrames vs. Remotion

The Remotion source computed `rotateY(${baseRotateY + floatRotate}deg)` inline every frame and used `Math.sin(frame * speed + phaseOffset)` per render. HyperFrames consolidates the continuous floating into a single `onUpdate` reading `tl.time()`, while the entry slide + scale + opacity use standard GSAP `fromTo` tweens.

```
Remotion: per-frame transform string with baseRotateY + sin(frame * speed) * amp
HyperFrames: gsap.set(.tilt, { rotationY: baseRotateY })            // static base
             tl.fromTo(.pos, { x: ±100, scale: 0.8 }, { x: 0, scale: 1 })  // entry
             onUpdate: gsap.set(.pos, { y: sin(t)*amp })             // y float
                        gsap.set(.tilt, { rotationY: base + sin(t+phase)*1 })  // rot float
```

## Core Concept

Three concerns separated across two nested wrappers per card:

1. **`.card-pos`** — entry slide (`x`, `scale`, `opacity`) + continuous y float
2. **`.card-tilt`** — static `rotateY` base + small continuous rotation float

The static rotateY lives on the inner wrapper so the card faces inward (left card rotates +Y to face the viewer's right; right card rotates -Y to face left). The outer wrapper handles entry translation without affecting the 3D orientation.

```
parent {perspective: 1200px}
  └─ .card-pos        x (entry), scale (entry), opacity (entry), y (float)
       └─ .card-tilt  rotationY = baseRotateY + tiny float rotation
            └─ content (image, label, subtitle)
```

## Basic Pattern

```html
<div class="cards-row" style="display: flex; gap: 60px; perspective: 1200px;">
  <div class="card card-left">
    <div class="card-pos">
      <div class="card-tilt" style="transform-style: preserve-3d;">
        <div class="card-image">...</div>
        <div class="card-label">Brand Templates</div>
      </div>
    </div>
  </div>

  <div class="card card-right">
    <div class="card-pos">
      <div class="card-tilt" style="transform-style: preserve-3d;">
        <div class="card-image">...</div>
        <div class="card-label">Team Workspace</div>
      </div>
    </div>
  </div>
</div>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // ============================================================
  // CONSTANTS
  // ============================================================
  const LEFT_DELAY = 0.5; // seconds
  const RIGHT_DELAY = 0.83; // stagger ~10 frames at 30 fps
  const ENTRY_DUR = 0.7;
  const SLIDE_DIST = 100; // px each side slides inward
  const BASE_TILT = 18; // degrees — left positive, right negative (10°–20° typical)

  // Float amplitudes / frequencies (continuous)
  const FLOAT_Y_SPEED = 0.02 * 30; // = 0.6 rad/sec (Remotion's frame*0.02)
  const FLOAT_Y_AMP = 6;
  const FLOAT_R_SPEED = 0.015 * 30; // = 0.45 rad/sec
  const FLOAT_R_AMP = 1;

  // ============================================================
  // STATIC INITIAL STATES
  // ============================================================
  gsap.set(".card-left  .card-pos", { x: -SLIDE_DIST, scale: 0.8, opacity: 0, y: 0 });
  gsap.set(".card-right .card-pos", { x: SLIDE_DIST, scale: 0.8, opacity: 0, y: 0 });
  gsap.set(".card-left  .card-tilt", { rotationY: BASE_TILT });
  gsap.set(".card-right .card-tilt", { rotationY: -BASE_TILT });

  // ============================================================
  // ENTRY TWEENS
  // ============================================================
  tl.to(
    ".card-left .card-pos",
    {
      x: 0,
      scale: 1,
      opacity: 1,
      duration: ENTRY_DUR,
      ease: "power3.out", // spring(stiffness:100, damping:16)
    },
    LEFT_DELAY,
  );

  tl.to(
    ".card-right .card-pos",
    {
      x: 0,
      scale: 1,
      opacity: 1,
      duration: ENTRY_DUR,
      ease: "power3.out",
    },
    RIGHT_DELAY,
  );

  // ============================================================
  // CONTINUOUS FLOATING — single shared onUpdate
  // ============================================================
  const TOTAL_DUR = 5.0;
  const leftPos = document.querySelector(".card-left  .card-pos");
  const rightPos = document.querySelector(".card-right .card-pos");
  const leftTilt = document.querySelector(".card-left  .card-tilt");
  const rightTilt = document.querySelector(".card-right .card-tilt");

  tl.to(
    { tick: 0 },
    {
      tick: 1,
      duration: TOTAL_DUR,
      ease: "none",
      onUpdate: function () {
        const t = tl.time();
        // Left card: phase 0
        const lY = Math.sin(t * FLOAT_Y_SPEED + 0) * FLOAT_Y_AMP;
        const lR = Math.sin(t * FLOAT_R_SPEED + 0) * FLOAT_R_AMP;
        // Right card: phase π → opposite-direction floating
        const rY = Math.sin(t * FLOAT_Y_SPEED + Math.PI) * FLOAT_Y_AMP;
        const rR = Math.sin(t * FLOAT_R_SPEED + Math.PI) * FLOAT_R_AMP;

        gsap.set(leftPos, { y: lY });
        gsap.set(rightPos, { y: rY });
        gsap.set(leftTilt, { rotationY: BASE_TILT + lR });
        gsap.set(rightTilt, { rotationY: -BASE_TILT + rR });
      },
    },
    0,
  );

  window.__timelines["main"] = tl;
</script>
```

### Why two `gsap.set()` per element, not combined into one?

`gsap.set` is cheap; what matters is that we only update the _changing_ property. Calling `gsap.set(leftPos, { y: lY })` doesn't touch `x`, `scale`, or `opacity` — those are left at whatever the entry tween set them to. If we wrote `gsap.set(leftPos, { x: 0, y: lY, scale: 1, opacity: 1 })` we'd fight the entry tween during its 0.7 s window.

Keep the float onUpdate to **only the float aliases**.

## Recommended Values

| Parameter              | Left Card                 | Right Card               |
| ---------------------- | ------------------------- | ------------------------ |
| `baseTilt` (rotationY) | +10° to +20°              | -10° to -20°             |
| `slideDistance`        | -80 to -150 px            | +80 to +150 px           |
| Float Y phase          | 0                         | `Math.PI` (opposed)      |
| Float rotation phase   | 0                         | `Math.PI` (opposed)      |
| Shadow direction       | Falls right (`-x offset`) | Falls left (`+x offset`) |

## Shadow Matching

Shadow direction must match the tilt to reinforce the 3D illusion. A left-leaning card facing right should drop its shadow to the right:

```css
.card-left .card-image {
  box-shadow:
    -30px 30px 60px rgba(0, 0, 0, 0.4),
    /* shadow falls RIGHT (negative x offset) */ 0 0 40px rgba(180, 80, 220, 0.3); /* ambient glow */
}
.card-right .card-image {
  box-shadow:
    30px 30px 60px rgba(0, 0, 0, 0.4),
    /* shadow falls LEFT (positive x offset) */ 0 0 40px rgba(80, 220, 150, 0.3);
}
```

Mismatched shadow reads as a flat layer with a wrong drop-shadow filter — the 3D illusion collapses.

## Why Phase Opposition (`Math.PI`)

If both cards float synchronized, the pair reads as "two cards moving up together, then down together" — a mechanical rhythm. With phase offset `π`, when the left card is at its highest point, the right card is at its lowest. The pair appears to **breathe in opposition**, producing organic motion that doesn't lock to a global beat.

The same applies to the rotation float — opposed phase keeps the cards from rocking like a synchronized pair of wipers.

## Tips

- **Equal card widths**: Use the same `width` for both cards. Different sizes break the symmetric balance.
- **Entry from outside, not center**: `slideDistance: -100 / +100` makes cards slide inward from their own side. This reinforces left/right identity. Cards sliding _outward_ from center looks like they're separating, not arriving.
- **Stagger entry**: Right card delays ~0.33 s (10 frames at 30 fps) after left. Both arriving simultaneously feels static; staggered feels deliberate.
- **Add floating badges or labels near cards** ([sine-wave-loop](sine-wave-loop.md)) for additional context — pin them at the cards' inner edges where they read as "attached" to each card.
- **Single perspective parent**: Both cards share `perspective: 1200 px` on the row container, not per-card. Independent perspectives produce inconsistent depth.

## Critical Constraints

- **Opposing `rotationY`**: Left positive, right negative. Same-direction tilt destroys balance and reads as "tilted carousel," not "split-screen."
- **`transform-style: preserve-3d`** on `.card-tilt`: Required for child elements (image, label) to render correctly in 3D space when the parent rotates.
- **Two cards only**: This pattern doesn't extend to 3+ cards. Three tilted cards in a row creates a confused perspective.
- **Floating aliases isolated to onUpdate**: The shared scene-ticker only sets `y` on `.card-pos` and `rotationY` on `.card-tilt`. Don't include `x` / `scale` / `opacity` — those are owned by the entry tween.
- **Phase offset `π` on right card**: For both `y` and rotation. Same phase makes the cards rock together and feel synthetic.
- **GSAP transform aliases only**: `x`, `y`, `scale`, `rotationY`. Never `width` / `height` / `left` / `top`.
- **No `Math.random` / `Date.now`**: Float values are pure functions of `tl.time()`.
- **No infinite repeats**: The floating onUpdate runs over a finite `duration: TOTAL_DUR`. No `repeat: -1`.

## Combinations

- Pair with [sine-wave-loop](sine-wave-loop.md) — the float math here is essentially a Form 2 sine wave; if you want richer dual-frequency motion, combine two sine terms inside the same onUpdate.
- Pair with [multi-phase-camera](multi-phase-camera.md) — a gentle overall push during the cards' settle adds cinematic weight.
- Floating pill badges next to each card use the same `onUpdate` pattern with a different phase offset / frequency.

## Examples

- [comparison-split-cards.html](../examples/comparison-split-cards.html) — "HTML Composition" (left, +18° tilt) and "Render Pipeline" (right, -18° tilt) cards with opposed-phase floating and pill badges anchored at the inner edges.
