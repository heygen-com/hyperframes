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
      <div class="card-eyebrow">{leftEyebrow}</div>
      <div class="card-headline">{leftHeadline}</div>
      <div class="card-body">{leftBody}</div>
    </div>
    <div class="card card-right">
      <div class="card-eyebrow">{rightEyebrow}</div>
      <div class="card-headline">{rightHeadline}</div>
      <div class="card-body">{rightBody}</div>
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
  background: {bgGradient};
  perspective: SCENE_PERSPECTIVE; /* REQUIRED — without perspective rotateY flattens */
}
.split-stage {
  display: flex;
  gap: STAGE_GAP;
  transform-style: preserve-3d;
}
.card {
  width: CARD_WIDTH;
  min-height: CARD_MIN_HEIGHT;
  padding: CARD_PADDING;
  display: flex;
  flex-direction: column;
  gap: CARD_INNER_GAP;
  border-radius: CARD_RADIUS;
  background: {cardSurface};
  border: 1px solid {cardBorder};
  color: {textColor};
  font-family: {font};
  transform-style: preserve-3d;
  will-change: transform;
}
.card-left {
  /* Faces right → shadow falls right */
  box-shadow:
    -CARD_SHADOW_OFFSET CARD_SHADOW_DROP CARD_SHADOW_BLUR {shadowColor},
    0 0 CARD_GLOW_BLUR {accentGlowColor};
}
.card-right {
  /* Faces left → shadow falls left */
  box-shadow:
    CARD_SHADOW_OFFSET CARD_SHADOW_DROP CARD_SHADOW_BLUR {shadowColor},
    0 0 CARD_GLOW_BLUR {accentGlowColor};
}
.card-eyebrow {
  font-size: EYEBROW_FONT_SIZE;
  font-weight: 800;
  letter-spacing: EYEBROW_LETTER_SPACING;
  text-transform: uppercase;
  color: {accentColor};
}
.card-headline {
  font-size: HEADLINE_FONT_SIZE;
  font-weight: 900;
  line-height: 1;
  letter-spacing: HEADLINE_LETTER_SPACING;
}
.card-body {
  font-size: BODY_FONT_SIZE;
  font-weight: 500;
  line-height: 1.3;
  color: {bodyColor};
  opacity: BODY_OPACITY;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Phase 1 — entry from outside
  tl.fromTo(
    ".card-left",
    { x: -ENTRY_SLIDE_DIST, rotateY: TILT + TILT_OVERSHOOT, opacity: 0 },
    { x: 0, rotateY: TILT, opacity: 1, duration: ENTRY_DUR, ease: "power3.out" },
    LEFT_AT,
  );
  tl.fromTo(
    ".card-right",
    { x: ENTRY_SLIDE_DIST, rotateY: -TILT - TILT_OVERSHOOT, opacity: 0 },
    { x: 0, rotateY: -TILT, opacity: 1, duration: ENTRY_DUR, ease: "power3.out" },
    RIGHT_AT,
  );

  // Phase 2 — counter-phase idle bob (cards move in opposition for dynamism)
  tl.to(
    ".card-left",
    { y: -FLOAT_AMP, duration: FLOAT_DURATION / 2, ease: "sine.inOut", yoyo: true, repeat: 1 },
    IDLE_START,
  );
  tl.to(
    ".card-right",
    { y: FLOAT_AMP, duration: FLOAT_DURATION / 2, ease: "sine.inOut", yoyo: true, repeat: 1 },
    IDLE_START,
  );

  // Phase 3 — gentle copy reveal (body slides up + fades after cards arrive)
  tl.from(
    ".card-eyebrow, .card-headline, .card-body",
    { opacity: 0, y: COPY_RISE, stagger: COPY_STAGGER, duration: COPY_DUR, ease: "power2.out" },
    COPY_REVEAL_AT,
  );

  window.__timelines["split-scene"] = tl;
</script>
```

## How to Choose Values

### Layout / typography

- **SCENE_PERSPECTIVE** — perspective on the scene root.
  - Range: 1000-2400 px
  - Effects: lower exaggerates the tilt (more cone-like); higher reads as a near-isometric, flatter rotation
- **STAGE_GAP** — horizontal gap between the two cards.
  - Range: 40-120 px (≈0.06-0.15× `CARD_WIDTH`)
  - Effects: small gap reads "fused pair"; large gap reads "compared but separate"
- **CARD_WIDTH** — width of each card.
  - Range: 480-820 px at 1920×1080
  - Constraints: `2 * CARD_WIDTH + STAGE_GAP ≤ 0.95 * stageWidth` so both cards stay on-screen at full tilt
- **CARD_MIN_HEIGHT** — minimum card height.
  - Range: ≈0.75-1.05× `CARD_WIDTH` (square-ish reads as balanced; very tall reads as poster)
- **CARD_PADDING / CARD_INNER_GAP / CARD_RADIUS** — interior chrome.
  - Range: padding 40-72 px; inner gap 24-48 px; radius 24-40 px
- **CARD_SHADOW_OFFSET / CARD_SHADOW_DROP / CARD_SHADOW_BLUR** — drop-shadow geometry.
  - Constraints: offset's sign matches tilt direction (see Key Principles); drop > 0 grounds the card on the scene
  - Range: offset 16-28 px; drop 20-32 px; blur 40-80 px
- **CARD_GLOW_BLUR** — secondary inner glow blur radius (`box-shadow` 0 0 blur).
  - Range: 16-32 px (subtle accent rim; larger competes with the card content)
- **EYEBROW_FONT_SIZE / EYEBROW_LETTER_SPACING** — small uppercase label.
  - Range: 22-32 px; spacing 6-12 px (uppercase reads cleaner with positive letter-spacing)
- **HEADLINE_FONT_SIZE / HEADLINE_LETTER_SPACING** — the main one-line punch.
  - Range: 72-104 px at 1920×1080; spacing -1 to -3 px (tight tracking for display weight)
- **BODY_FONT_SIZE / BODY_OPACITY** — supporting copy.
  - Range: 28-40 px; opacity 0.8-0.92
  - Constraints: body limited to ≤2 lines (see Critical Constraints — tilted long paragraphs blur)

### Entry / tilt

- **TILT** — static `rotateY` magnitude in degrees (left `+`, right `−`).
  - Range: 10-18° (under 10 reads almost flat; over 18 the cards fold shut and body copy becomes hard to read)
- **TILT_OVERSHOOT** — extra degrees added to the starting `rotateY` before settling to `TILT`.
  - Range: 4-12°
  - Effects: gives the entry a slight pivot-into-place feel
- **ENTRY_SLIDE_DIST** — pixels each card slides from off-axis.
  - Range: 200-500 px (≈0.3-0.6× `CARD_WIDTH`)
- **ENTRY_DUR** — per-card slide-in duration.
  - Range: 0.6-1.2 s
- **LEFT_AT** — left card entry start.
  - Range: 0.0-0.4 s
- **RIGHT_AT** — right card entry start.
  - Range: `LEFT_AT + 0.0` to `LEFT_AT + 0.3` s (zero stagger feels mechanical; large stagger fragments the pair)

### Idle bob

- **FLOAT_AMP** — sine amplitude on idle y bob (px).
  - Range: 3-8 px (see sine-wave-loop rule — subtle is the point)
- **FLOAT_DURATION** — full yoyo round-trip duration (one breath).
  - Range: 1.6-3.2 s (≈breathing cadence)
- **IDLE_START** — when idle bob begins.
  - Constraints: `≥ max(LEFT_AT, RIGHT_AT) + ENTRY_DUR` so idle doesn't fight the entry tail

### Copy reveal

- **COPY_REVEAL_AT** — when eyebrow/headline/body fade in.
  - Constraints: usually starts during the cards' settle (overlaps the entry tail) — content shouldn't pop in after the cards are already idle
- **COPY_DUR / COPY_STAGGER / COPY_RISE** — fade-up shape.
  - Range: duration 0.4-0.7 s; stagger 0.04-0.10 s; rise 12-24 px

### Color / typography tokens

- **{bgGradient}** — radial or linear gradient behind the cards; darker than `{cardSurface}` so cards lift
- **{cardSurface}** — card background (typically a low-saturation gradient layered over the scene)
- **{cardBorder}** — 1 px border color, usually `{accentColor}` at low alpha
- **{shadowColor}** — drop-shadow color, typically near-black at 0.5-0.7 alpha
- **{accentGlowColor}** — inner glow color, typically `{accentColor}` at low alpha
- **{accentColor}** — eyebrow + accent rim color (single hue per scene)
- **{textColor}** — primary headline color, high contrast against `{cardSurface}`
- **{bodyColor}** — body copy color, slightly desaturated vs `{textColor}`
- **{font}** — display font stack for all card copy

## Variations

### Mid-tilt zoom-through (combined with camera move)

If a separate camera tween scales `.split-stage`, the cards' tilt reads as the viewer crossing through the gap between them.

### Asymmetric content density (badge / label / icon)

Add a floating badge near each card for additional context. Position absolutely on the parent — not inside the card, so the badge doesn't inherit the 3D rotation:

```html
<div class="badge badge-left">{leftBadge}</div>
<div class="badge badge-right">{rightBadge}</div>
```

### Stacked variants (3+ cards)

For 3 cards, the center card stays flat (`rotateY 0`) and the outer two tilt inward — useful for "your old way / nothing in between / our way" comparisons.

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

- `/hyperframes-animation` — timeline + `yoyo` for the idle bob
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
