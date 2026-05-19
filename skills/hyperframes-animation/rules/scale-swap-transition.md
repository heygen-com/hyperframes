---
name: scale-swap-transition
description: Coordinated shrink-out and bouncy pop-in transition between two elements at the same screen center. Two GSAP tween clusters started at the same morph trigger — exit shrinks + fades the outgoing element, entrance scales the incoming element in from 0 with an overshoot ease.
metadata:
  tags: transition, morph, scale, swap, gsap
  adapter: gsap
---

# Coordinated Scale-Swap Transition

Simulates a "morph" between two DOM elements by overlapping exit and entrance motions started at the same trigger. The eye reads the swap as a single transformation, not two separate animations. No SVG path morphing needed.

## HyperFrames vs. Remotion

The Remotion source held two springs in scope and conditionally rendered each element based on opacity (`{exitOpacity > 0 && ...}`). Conditional unmount kept the DOM clean during the transition.

HyperFrames doesn't conditionally render in the same way — elements stay in the DOM permanently, and GSAP drives `opacity` / `scale` to zero. The visual result is identical; the rendering model is simpler.

```
Remotion: {exitOpacity > 0 && <Hero />}   +   {frame > trigger && <CTA />}
HyperFrames: <Hero /> permanently rendered, opacity tweened 1 → 0
             <CTA  /> permanently rendered, scale 0 → 1 + opacity 0 → 1
```

## Core Concept

Single timeline position `MORPH_AT` triggers two clusters of tweens in parallel:

1. **Exit cluster** (outgoing element): `scale` shrinks (e.g. 1 → 0.6); `opacity` fades fast (faster than scale)
2. **Entrance cluster** (incoming element): `scale` from 0 → 1 with overshoot ease; `opacity` from 0 → 1

The outgoing fade completes before the incoming reaches full scale — there's a brief moment where both are partially visible, which sells the "morph" illusion.

## Basic Pattern

```html
<div
  class="stage"
  style="position: absolute; inset: 0;
     display: flex; align-items: center; justify-content: center;"
>
  <!-- Outgoing element -->
  <div class="hero" id="hero">
    <!-- e.g. logo lockup -->
  </div>

  <!-- Incoming element. Initial scale: 0 so it's invisible pre-morph. -->
  <div class="cta" id="cta" style="position: absolute; z-index: 10;">
    <!-- e.g. CTA button -->
  </div>
</div>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const MORPH_AT = 2.17; // seconds
  const EXIT_SCALE = 0.6; // outgoing shrinks to this fraction

  // Set incoming initial state via GSAP so the timeline tweens can reach it.
  gsap.set("#cta", { scale: 0, opacity: 0 });

  /* EXIT CLUSTER — outgoing element shrinks + fades fast.
     Opacity tweens shorter than scale so the fade completes in the
     first ~30% of the morph and only the shrink residue lingers. */
  tl.to(
    "#hero",
    { scale: EXIT_SCALE, duration: 0.5, ease: "power3.out" }, // spring(stiffness:150, damping:18)
    MORPH_AT,
  );
  tl.to(
    "#hero",
    {
      opacity: 0,
      duration: 0.15, // 30% of exit duration
      ease: "power2.out",
    },
    MORPH_AT,
  );

  /* ENTRANCE CLUSTER — incoming pops in with overshoot.
     back.out(2) gives ~10% overshoot, matching low-mass spring (mass:0.6). */
  tl.to(
    "#cta",
    { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(2)" }, // spring(stiffness:200, damping:15, mass:0.6)
    MORPH_AT,
  );

  window.__timelines["main"] = tl;
</script>
```

### Why `back.out(2)` for the entrance

Remotion's `spring({ stiffness: 200, damping: 15, mass: 0.6 })` produces a bouncy overshoot — the value crosses 1.0 around 60–70 % of the duration, peaks near 1.10–1.15, then settles back to 1.0. `back.out(2)` has the same character. Use:

- `back.out(1.4)` for mild overshoot (~5 %)
- `back.out(1.7)` for moderate (~7 %)
- `back.out(2)` for the bouncy "pop" feel
- `elastic.out(1, 0.5)` for ringing settle (multiple bounces) — usually too much

## Delayed Inner Content Reveal

If the incoming element contains text or icons, fade them in after the container reaches recognizable scale. This avoids ant-sized text in the spring's early frames.

```js
const REVEAL_DELAY = 0.17; // seconds after morph — ~5 frames at 30fps

tl.fromTo(
  "#cta-text",
  { opacity: 0, y: 10 },
  { opacity: 1, y: 0, duration: 0.33, ease: "power2.out" },
  MORPH_AT + REVEAL_DELAY,
);
```

The container's `back.out(2)` overshoot completes around `MORPH_AT + 0.4 s`; revealing text at `MORPH_AT + 0.17 s` means it appears when the container is ~50 % scale — large enough to read.

## Layering: Z-Index for Clean Residue

Set `z-index: 10` (or higher than the outgoing) on the incoming element. As the outgoing element shrinks toward its `EXIT_SCALE`, any visual residue (1-pixel borders, stale text edges) is hidden behind the incoming element.

## Critical Constraints

- **Same timeline position for both clusters**: This is what creates the "single trigger" feel. Drift the start times and the swap feels like a relay race.
- **Opacity exit shorter than scale exit**: ~30% of scale duration. The fade has to land before the shrink, otherwise the shrinking-but-still-visible outgoing element fights the incoming for attention.
- **Z-index on incoming**: Covers exit residue. Default z-index makes the outgoing edge bleed through during the brief overlap window.
- **Same transform origin**: Both elements centered at the same screen position. Otherwise the "morph" reveals as "translate + scale-swap" which breaks the illusion.
- **GSAP `set()` for initial state**: `gsap.set("#cta", { scale: 0, opacity: 0 })` before the timeline runs. This makes the incoming invisible pre-morph without needing conditional rendering.
- **Entrance ease, not exit ease**: Both clusters need different feels — exit is a clean shrink (`power3.out`), entrance is bouncy (`back.out(2)`). Symmetric eases look dull.
- **GSAP transform aliases only**: `scale`, `x`, `y`. Never `width` / `height` / `left` / `top`.

## Combinations

- After the swap settles, add [physics-press-reaction](physics-press-reaction.md) for a click reaction on the incoming CTA.
- Layer [sine-wave-loop](sine-wave-loop.md) on the incoming element for breathing idle once it lands.
- Pair with [hacker-flip-3d](hacker-flip-3d.md) — incoming element contains hacker-flip text that decodes as it scales in.

## Examples

- [cta-morph-press.html](../examples/cta-morph-press.html) — "GWI Spark" logo lockup morphs into a pink "Find out more" CTA button.
