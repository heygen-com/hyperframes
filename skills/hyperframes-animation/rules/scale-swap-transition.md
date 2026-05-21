---
name: scale-swap-transition
description: Coordinated shrink-out + spring pop-in morph-like transition between two elements — no SVG path interpolation needed.
metadata:
  tags: transition, morph, scale, swap, spring, pop
---

# Scale-Swap Transition

Simulates a "morph" between two DOM elements by overlapping exit and entrance scale animations. Lighter weight than [card-morph-anchor](card-morph-anchor.md) (which morphs container dimensions) and easier than SVG path interpolation.

## How It Works

At a single trigger time, two coordinated tweens fire:

1. **Outgoing element**: scale `1.0 → EXIT_SCALE` + opacity `1 → 0` (fast `power2.in`)
2. **Incoming element**: scale `EXIT_SCALE → 1.0` + opacity `0 → 1` (bouncy `back.out(${BOUNCE_FACTOR})` with overshoot)

A small `OVERLAP` window during which both are mid-tween creates the "morph" illusion. Incoming sits on top via z-index so the outgoing's fade-tail doesn't bleed through.

## HTML

```html
<div
  class="scene"
  id="swap-scene"
  data-composition-id="swap-scene"
  data-start="0"
  data-duration="3"
  data-track-index="0"
>
  <div class="stack">
    <div class="swap-wrap">
      <div class="card outgoing" id="outgoing">
        <div class="icon">{outgoingIcon}</div>
        <div class="title">{outgoingLabel}</div>
      </div>
      <div class="card incoming" id="incoming">
        <div class="icon">{incomingIcon}</div>
        <div class="title">{incomingLabel}</div>
        <div class="sub" id="sub">{incomingSubline}</div>
      </div>
    </div>
    <div class="brand">{Brand}</div>
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
  background: {sceneBg};
  font-family: {font};
}
.stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: STACK_GAP;
}
.swap-wrap {
  position: relative;
  width: SWAP_WRAP_W;
  height: SWAP_WRAP_H;
}
.card {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: CARD_INNER_GAP;
  border-radius: CARD_RADIUS;
  padding: CARD_PADDING;
  /* Both elements share transform-origin so they "morph" around the same anchor */
  transform-origin: 50% 50%;
  will-change: transform, opacity;
}
.card .icon {
  font-size: ICON_SIZE;
}
.card .title {
  font-size: TITLE_SIZE;
  font-weight: 900;
  letter-spacing: TITLE_TRACKING;
  text-transform: uppercase;
}
.card .sub {
  font-size: SUB_SIZE;
  font-weight: 700;
  color: {accentColor};
  opacity: 0;
}
.outgoing {
  z-index: 1;
  background: {outgoingBg};
  border: 1px solid {outgoingBorder};
  color: {textColor};
}
.incoming {
  /* Incoming starts hidden + smaller, will pop in */
  z-index: 2;
  background: {incomingBg};
  border: 1px solid {incomingBorder};
  color: {textColor};
  opacity: 0;
  transform: scale(EXIT_SCALE);
}
.brand {
  font-size: BRAND_SIZE;
  font-weight: 900;
  letter-spacing: BRAND_TRACKING;
  text-transform: uppercase;
  color: {brandColor};
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Outgoing: shrink + fade fast
  tl.to(
    "#outgoing",
    {
      scale: EXIT_SCALE,
      opacity: 0,
      duration: EXIT_DUR,
      ease: "power2.in",
    },
    TRIGGER,
  );

  // Incoming: scale up + fade in with overshoot, starts slightly BEFORE outgoing
  // finishes (OVERLAP creates the morph illusion).
  tl.to(
    "#incoming",
    {
      scale: 1.0,
      opacity: 1,
      duration: ENTER_DUR,
      ease: `back.out(${BOUNCE_FACTOR})`,
    },
    TRIGGER + EXIT_DUR - OVERLAP,
  );

  // Subline reveals AFTER the incoming card settles
  tl.fromTo(
    "#sub",
    { opacity: 0, y: SUB_REVEAL_Y_PX },
    { opacity: 1, y: 0, duration: SUB_REVEAL_DUR, ease: "power3.out" },
    TRIGGER + EXIT_DUR + SUB_REVEAL_DELAY,
  );

  // Brand fades in early for context
  tl.from(
    ".brand",
    { opacity: 0, y: BRAND_REVEAL_Y_PX, duration: BRAND_REVEAL_DUR, ease: "power3.out" },
    BRAND_REVEAL_AT,
  );

  window.__timelines["swap-scene"] = tl;
</script>
```

## Variations

### Delayed inner content reveal

The classic pattern: morph the container, then reveal inner text once the container has settled (as in the example above with `.sub`). The 0.2-0.4s gap between morph end and content reveal lets the viewer's eye land on the new container shape before reading the content.

### Triple swap (3-state cycle)

Chain: A→B→C with two triggers `TRIGGER_AB` and `TRIGGER_BC`. Each transition needs its own pair of tweens, and the previous incoming becomes the next outgoing. Useful for state evolution narratives (e.g. early-state → mid-state → final-state labels).

```js
tl.to("#stateA", { scale: EXIT_SCALE, opacity: 0, duration: EXIT_DUR }, TRIGGER_AB);
tl.to(
  "#stateB",
  { scale: 1.0, opacity: 1, duration: ENTER_DUR, ease: `back.out(${BOUNCE_FACTOR})` },
  TRIGGER_AB + EXIT_DUR - OVERLAP,
);
tl.to("#stateB", { scale: EXIT_SCALE, opacity: 0, duration: EXIT_DUR }, TRIGGER_BC);
tl.to(
  "#stateC",
  { scale: 1.0, opacity: 1, duration: ENTER_DUR, ease: `back.out(${BOUNCE_FACTOR})` },
  TRIGGER_BC + EXIT_DUR - OVERLAP,
);
```

### Color-shift transition (no scale)

For a flat morph between two same-shape states, drop the scale and keep only opacity + a brief background hue tween. Less dramatic but matches a more product-UI tone.

## How to Choose Values

### Timing (seconds)

- **TRIGGER** — when the swap fires.
  - Constraints: must be ≥ the outgoing element's settled time + a presence-dwell so the outgoing "lands" before transforming
- **EXIT_DUR** — outgoing shrink + fade duration.
  - Range: 0.3-0.5 s
- **ENTER_DUR** — incoming pop-in duration.
  - Range: 0.45-0.7 s (longer than `EXIT_DUR` to let the overshoot settle)
- **OVERLAP** — how much the entrance starts before the exit finishes.
  - Range: 0.1-0.2 s
  - Constraints: too much (>0.3 s) makes both clearly visible together (no morph); too little (<0.05 s) leaves a visible empty gap
- **SUB_REVEAL_DELAY** — gap between incoming settle and subline reveal.
  - Range: 0.2-0.4 s; reveals during the morph compete with the swap for attention
- **SUB_REVEAL_DUR** — subline fade-in.
  - Range: 0.3-0.5 s
- **BRAND_REVEAL_AT** — when the brand/context line fades in.
  - Constraints: must be < `TRIGGER` (brand is context for the swap, not synchronous with it)
- **BRAND_REVEAL_DUR** — brand fade-in duration.
  - Range: 0.4-0.8 s

### Physics

- **EXIT_SCALE** — target scale for outgoing (and starting scale for incoming).
  - Range: 0.6-0.8; smaller exits feel more dramatic but risk reading as "vanish" instead of "morph"
- **BOUNCE_FACTOR** — `back.out(${BOUNCE_FACTOR})` overshoot on the incoming.
  - Range: 1.4 (soft) - 1.8 (firm) - 2.2 (cartoony)

### Positioning offsets

- **SUB_REVEAL_Y_PX** — subline initial y offset (positive = below resting).
  - Range: 8-20 px
- **BRAND_REVEAL_Y_PX** — brand initial y offset.
  - Range: 10-24 px

### Layout

- **STACK_GAP** — gap between swap container and brand line.
  - Range: 40-96 px
- **SWAP_WRAP_W / SWAP_WRAP_H** — fixed swap container dimensions; both cards `inset: 0` inside.
  - Constraints: pick dimensions that fit both states' content; the wrap does not resize during the swap
- **CARD_INNER_GAP** — gap between icon and title inside a card.
  - Range: 16-32 px
- **CARD_RADIUS / CARD_PADDING** — card corner radius and inner padding.
  - Range: radius 24-40 px; padding 32-64 px
- **ICON_SIZE / TITLE_SIZE / SUB_SIZE / BRAND_SIZE** — typographic sizes.
  - Constraints: titles dominate (~80-120 px at 1080p); sub and brand are accent-sized
- **TITLE_TRACKING / BRAND_TRACKING** — letter-spacing on uppercase labels.
  - Range: 4-16 px (uppercase reads better with positive tracking)

### Tokens

- **{sceneBg}** — background gradient/color
- **{font}** — typographic stack
- **{textColor}** / **{accentColor}** / **{brandColor}** — semantic color tokens
- **{outgoingBg}** / **{outgoingBorder}** — outgoing card surface + border (typically warm or pre-action hue)
- **{incomingBg}** / **{incomingBorder}** — incoming card surface + border (typically cool or post-action hue)
- **{outgoingIcon}** / **{incomingIcon}** — single glyph/emoji per state
- **{outgoingLabel}** / **{incomingLabel}** — state labels
- **{incomingSubline}** — supporting copy that fades in after the incoming settles
- **{Brand}** — brand line shown beneath the swap

## Key Principles

- **Incoming z-index ABOVE outgoing** — without this, the outgoing's fade-tail (opacity 0.3-0.5) bleeds through the incoming's lower opacity and creates a "double-exposed" muddy frame
- **Both elements share `transform-origin: 50% 50%`** — different origins make the morph feel like one thing teleporting somewhere else
- **`OVERLAP` in the 0.1-0.2 s window** — too much overlap and both are clearly visible together (no morph); too little and there's a visible empty gap
- **Bouncy ease ONLY for the incoming** — outgoing uses `power2.in` (rushing away), incoming uses `back.out(${BOUNCE_FACTOR})` (arriving with weight). Reverse it and the swap feels mechanical
- **Inner content reveals AFTER container settles** — see `SUB_REVEAL_DELAY`. Reveals during the morph compete for attention and lose
- **Climax dwell ≥1 s after final state lands** — see SKILL universal constraints. After incoming + subline both settle, hold for ≥1 s
- **Brand reveal early, not at the swap** — context (brand, eyebrow) sets the stage; the swap is the headline. If brand reveals AT the swap, it competes

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS `transition`** on either swap element — competes with GSAP
- **`will-change: transform, opacity`** on both swap elements
- **Both elements use `position: absolute; inset: 0`** in the same wrapper — they occupy the same footprint, swap fades one out and pops one in
- **Don't `display: none` the outgoing** after fade — leave it at `opacity: 0` so layout doesn't reflow

## Combinations

- [press-release-spring.md](press-release-spring.md) — button press TRIGGERS the swap (cause and effect)
- [sine-wave-loop.md](sine-wave-loop.md) — idle breathing on the final state
- [card-morph-anchor.md](card-morph-anchor.md) — alternative for SHAPE-changing transitions (this rule is for SAME-shape state swaps)

## Pairs with HF skills

- `/hyperframes-animation` — two coordinated tweens with overlap
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
