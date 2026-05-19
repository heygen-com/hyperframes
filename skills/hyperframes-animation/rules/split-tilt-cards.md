---
name: split-tilt-cards
description: Two cards side-by-side with opposing Y-rotation creating a symmetric 3D split-screen layout for comparisons or feature pairs.
metadata:
  tags: 3d, cards, split, tilt, comparison, symmetric, layout
---

# Split Tilt Cards

Two cards positioned side-by-side, each rotated in opposite Y directions. Creates a symmetric "book-open" 3D effect — natural fit for comparisons, before/after, or feature pairs.

## How It Works

- Left card rotates `+Y` (faces toward the right viewer angle)
- Right card rotates `-Y` (faces toward the left viewer angle)
- Both share the same `perspective` parent → opposing rotations balance visually
- Each card enters from outside (left card slides in from the left, right card from the right) to reinforce its identity
- Idle phase: gentle counter-phase float (`Math.PI` offset on sine) — cards bob in opposition

## HTML

```html
<div
  class="scene"
  id="split-scene"
  data-composition-id="split-scene"
  data-start="0"
  data-duration="4"
  data-track-index="0"
>
  <div class="split-stage">
    <div class="card card-left">
      <div class="card-eyebrow">BEFORE</div>
      <div class="card-headline">Manual edits</div>
      <div class="card-body">3 hours per video. Frame-by-frame tweaks. Burn the night.</div>
    </div>
    <div class="card card-right">
      <div class="card-eyebrow">WITH HEYGENVERSE</div>
      <div class="card-headline">One prompt</div>
      <div class="card-body">Composition rendered, captioned, and shipped in 90 seconds.</div>
    </div>
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
  perspective: 1800px; /* REQUIRED — without perspective rotateY flattens */
}
.split-stage {
  display: flex;
  gap: 80px;
  transform-style: preserve-3d;
}
.card {
  width: 640px;
  min-height: 560px;
  padding: 64px 56px;
  display: flex;
  flex-direction: column;
  gap: 32px;
  border-radius: 32px;
  background: linear-gradient(160deg, rgba(167, 139, 250, 0.18) 0%, rgba(20, 24, 56, 0.85) 70%);
  border: 1px solid rgba(167, 139, 250, 0.22);
  color: #f5f6fb;
  font-family: "Inter", sans-serif;
  transform-style: preserve-3d;
  will-change: transform;
}
.card-left {
  /* Faces right → shadow falls right */
  box-shadow:
    -22px 28px 60px rgba(0, 0, 0, 0.6),
    0 0 24px rgba(167, 139, 250, 0.2);
}
.card-right {
  /* Faces left → shadow falls left */
  box-shadow:
    22px 28px 60px rgba(0, 0, 0, 0.6),
    0 0 24px rgba(167, 139, 250, 0.2);
}
.card-eyebrow {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 10px;
  text-transform: uppercase;
  color: #cdb8ff;
}
.card-headline {
  font-size: 92px;
  font-weight: 900;
  line-height: 1;
  letter-spacing: -2px;
}
.card-body {
  font-size: 36px;
  font-weight: 500;
  line-height: 1.3;
  color: #cfd2ff;
  opacity: 0.85;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const TILT = 14; // degrees — Y rotation magnitude
  const FLOAT_AMP = 6; // pixels — idle vertical bob amplitude
  const FLOAT_DURATION = 2.4;

  // Phase 1 — entry from outside
  tl.fromTo(
    ".card-left",
    { x: -300, rotateY: TILT + 8, opacity: 0 },
    { x: 0, rotateY: TILT, opacity: 1, duration: 0.9, ease: "power3.out" },
    0.2,
  );
  tl.fromTo(
    ".card-right",
    { x: 300, rotateY: -TILT - 8, opacity: 0 },
    { x: 0, rotateY: -TILT, opacity: 1, duration: 0.9, ease: "power3.out" },
    0.3,
  );

  // Phase 2 — counter-phase idle bob (cards move in opposition for dynamism)
  tl.to(
    ".card-left",
    { y: -FLOAT_AMP, duration: FLOAT_DURATION / 2, ease: "sine.inOut", yoyo: true, repeat: 1 },
    1.2,
  );
  tl.to(
    ".card-right",
    { y: FLOAT_AMP, duration: FLOAT_DURATION / 2, ease: "sine.inOut", yoyo: true, repeat: 1 },
    1.2,
  );

  // Phase 3 — gentle copy reveal (body slides up + fades after cards arrive)
  tl.from(
    ".card-eyebrow, .card-headline, .card-body",
    { opacity: 0, y: 16, stagger: 0.05, duration: 0.5, ease: "power2.out" },
    0.8,
  );

  window.__timelines["split-scene"] = tl;
</script>
```

## Variations

### Mid-tilt zoom-through (combined with camera move)

If a separate camera tween scales `.split-stage`, the cards' tilt reads as the viewer crossing through the gap between them.

### Asymmetric content density (badge / label / icon)

Add a floating badge near each card for additional context. Position absolutely on the parent — not inside the card, so the badge doesn't inherit the 3D rotation:

```html
<div class="badge badge-left">2026</div>
<div class="badge badge-right">2027</div>
```

### Stacked variants (3+ cards)

For 3 cards, the center card stays flat (rotateY 0) and the outer two tilt inward — useful for "your old way / nothing in between / our way" comparisons.

## Key Principles

- **`perspective` on scene root REQUIRED** — without it rotateY flattens and the split-tilt collapses to a flat side-by-side layout
- **`transform-style: preserve-3d`** on both the stage and each card — preserves the 3D plane as cards have their own transforms
- **Shadow direction must match tilt** — left card faces right, shadow falls right (positive X), and vice versa. Wrong shadow direction reads as "broken 3D"
- **Symmetric content weight** — both cards same width, same vertical center, similar line counts. Asymmetric content breaks the comparison metaphor
- **Counter-phase float (`Math.PI` offset)** — left bobs up while right bobs down. Synchronized bob looks like both cards are on the same conveyor belt; counter-phase looks alive
- **Slide-in from the outside** — left card from left, right card from right — reinforces "they came from their own worlds and met here"
- **❗ Tilt magnitude 10-15°** — under 10° looks like a slight perspective offset (almost flat), over 18° looks like the cards are folding shut and copy becomes hard to read

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No `requestAnimationFrame`** for the idle float — drive it inside the timeline so seek is deterministic
- **Don't put badges inside the card divs** — they'd inherit the rotateY and tilt off-axis with the card. Float them on the parent
- **Body copy ≤ 2 lines per card** — tilted text becomes hard to read; long paragraphs collapse into a perspective blur

## Combinations

- [card-morph-anchor.md](card-morph-anchor.md) — both cards could morph into a single unified shape afterward
- [counting-dynamic-scale.md](counting-dynamic-scale.md) — numbers as the headline content for each side

## Pairs with HF skills

- `/hyperframes-gsap` — timeline + `yoyo` for the idle bob
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
