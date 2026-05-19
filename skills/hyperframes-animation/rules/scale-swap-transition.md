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

1. **Outgoing element**: scale 1.0 → 0.7 + opacity 1 → 0 (fast `power2.in`)
2. **Incoming element**: scale 0.7 → 1.0 + opacity 0 → 1 (bouncy `back.out(1.8)` with overshoot)

The 0.1-0.2s overlap during which both are mid-tween creates the "morph" illusion. Incoming sits on top via z-index so the outgoing's fade-tail doesn't bleed through.

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
        <div class="icon">📝</div>
        <div class="title">DRAFT</div>
      </div>
      <div class="card incoming" id="incoming">
        <div class="icon">🚀</div>
        <div class="title">SHIPPED</div>
        <div class="sub" id="sub">to heygenverse.com</div>
      </div>
    </div>
    <div class="brand">HEYGENVERSE</div>
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
  font-family: "Inter", sans-serif;
}
.stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 64px;
}
.swap-wrap {
  position: relative;
  width: 640px;
  height: 360px;
}
.card {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  border-radius: 32px;
  padding: 48px;
  /* Both elements share transform-origin so they "morph" around the same anchor */
  transform-origin: 50% 50%;
  will-change: transform, opacity;
}
.card .icon {
  font-size: 120px;
}
.card .title {
  font-size: 80px;
  font-weight: 900;
  letter-spacing: 8px;
  text-transform: uppercase;
}
.card .sub {
  font-size: 32px;
  font-weight: 700;
  color: #a78bfa;
  opacity: 0;
}
.outgoing {
  z-index: 1;
  background: linear-gradient(160deg, rgba(245, 196, 81, 0.4) 0%, rgba(20, 24, 56, 0.85) 70%);
  border: 1px solid rgba(245, 196, 81, 0.4);
  color: #f5f6fb;
}
.incoming {
  /* Incoming starts hidden + smaller, will pop in */
  z-index: 2;
  background: linear-gradient(160deg, rgba(167, 139, 250, 0.4) 0%, rgba(20, 24, 56, 0.85) 70%);
  border: 1px solid rgba(167, 139, 250, 0.6);
  color: #f5f6fb;
  opacity: 0;
  transform: scale(0.7);
}
.brand {
  font-size: 56px;
  font-weight: 900;
  letter-spacing: 14px;
  text-transform: uppercase;
  color: #cdb8ff;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const TRIGGER = 0.8; // when the swap happens
  const OVERLAP = 0.15; // how much exit and entrance overlap (s)

  // Outgoing: shrink + fade fast
  tl.to(
    "#outgoing",
    {
      scale: 0.7,
      opacity: 0,
      duration: 0.4,
      ease: "power2.in",
    },
    TRIGGER,
  );

  // Incoming: scale up + fade in with overshoot, starts slightly BEFORE outgoing
  // finishes (overlap creates the morph illusion).
  tl.to(
    "#incoming",
    {
      scale: 1.0,
      opacity: 1,
      duration: 0.6,
      ease: "back.out(1.8)",
    },
    TRIGGER + 0.4 - OVERLAP,
  );

  // Subline reveals AFTER the incoming card settles
  tl.fromTo(
    "#sub",
    { opacity: 0, y: 12 },
    { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" },
    TRIGGER + 1.1,
  );

  // Brand fades in early for context
  tl.from(".brand", { opacity: 0, y: 16, duration: 0.6, ease: "power3.out" }, 0.2);

  window.__timelines["swap-scene"] = tl;
</script>
```

## Variations

### Delayed inner content reveal

The classic pattern: morph the container, then reveal inner text once the container has settled (as in the example above with `.sub`). The 0.2-0.4s gap between morph end and content reveal lets the viewer's eye land on the new container shape before reading the content.

### Triple swap (3-state cycle)

Chain: A→B→C with two triggers. Each transition needs its own pair of tweens, and the previous incoming becomes the next outgoing. Useful for state evolution narratives ("DRAFT → REVIEW → SHIPPED").

```js
tl.to("#stateA", { scale: 0.7, opacity: 0, duration: 0.4 }, 0.5);
tl.to("#stateB", { scale: 1.0, opacity: 1, duration: 0.6, ease: "back.out(1.8)" }, 0.65);
tl.to("#stateB", { scale: 0.7, opacity: 0, duration: 0.4 }, 1.8);
tl.to("#stateC", { scale: 1.0, opacity: 1, duration: 0.6, ease: "back.out(1.8)" }, 1.95);
```

### Color-shift transition (no scale)

For a flat morph between two same-shape states, drop the scale and keep only opacity + a brief background hue tween. Less dramatic but matches a more product-UI tone.

## Key Principles

- **Incoming z-index ABOVE outgoing** — without this, the outgoing's fade-tail (opacity 0.3-0.5) bleeds through the incoming's lower opacity and creates a "double-exposed" muddy frame
- **Both elements share `transform-origin: 50% 50%`** — different origins make the morph feel like one thing teleporting somewhere else
- **Overlap 0.1-0.2s** — too much overlap (>0.3s) and both are clearly visible together (no morph); too little (<0.05s) and there's a visible empty gap
- **Bouncy ease ONLY for the incoming** — outgoing uses `power2.in` (rushing away), incoming uses `back.out(1.6-2.0)` (arriving with weight). Reverse it and the swap feels mechanical
- **Inner content reveals AFTER container settles** — 0.2-0.4s gap. Reveals during the morph compete for attention and lose
- **❗ Climax dwell ≥1s after final state lands** — see SKILL universal constraints. After incoming + subline both settle, hold for ≥1s
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

- `/hyperframes-gsap` — two coordinated tweens with overlap
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
