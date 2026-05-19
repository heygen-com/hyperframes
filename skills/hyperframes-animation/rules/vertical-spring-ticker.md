---
name: vertical-spring-ticker
description: Slot-machine style vertical scrolling using a GSAP timeline of stepped tweens within a masked container, seek-safe in HyperFrames.
metadata:
  tags: text, ticker, scroll, vertical, gsap
  adapter: gsap
---

# Vertical Spring Ticker

A fixed-height window with `overflow: hidden`. Inside it, a stack of items (in a `flex-direction: column` wrapper) translates upward in discrete steps. Each step is a single GSAP tween with a snappy ease so each transition feels distinct, not interpolated.

## HyperFrames vs. Remotion

The Remotion version sums multiple `spring()` instances together — one spring per transition — and reads the sum as `translateY`. That works because Remotion's spring is a pure function of frame, so independently-summed springs are also pure.

HyperFrames uses **a sequence of tweens on a paused timeline**. Each tween moves `translateY` by exactly one `itemHeight`. This produces the same visual effect (snappy distinct steps) and is the idiomatic GSAP form for a seekable scrub.

```
Remotion:   translateY = sum(spring1, spring2, …) * -itemHeight
HyperFrames: tl.to(inner, { y: "-=itemHeight", ease: "back.out(1.4)" }, t)
             tl.to(inner, { y: "-=itemHeight", ease: "back.out(1.4)" }, t + gap)
             …
```

For N items you need N−1 tweens (one per transition). Both forms scrub the same way.

## Core Concept

- **Fixed window height** = `itemHeight` — only one item visible at a time.
- **Inner wrapper** = column flex stack — height equals `itemHeight × N`.
- **Snappy ease** — `back.out(1.4)` or `power3.out`. Avoid `power1.out` (mushy) and `none` (mechanical).

## Basic Pattern

```html
<div class="ticker-window">
  <div class="ticker-stack">
    <div class="ticker-item">clipping</div>
    <div class="ticker-item">editing</div>
    <div class="ticker-item">rendering</div>
  </div>
</div>

<style>
  :root {
    --item-height: 96px; /* must match the JS constant below */
    --accent: #00ff88;
  }
  .ticker-window {
    height: var(--item-height);
    overflow: hidden;
    display: inline-block;
    vertical-align: bottom;
  }
  .ticker-stack {
    display: flex;
    flex-direction: column;
    will-change: transform;
  }
  .ticker-item {
    height: var(--item-height);
    display: flex;
    align-items: center;
    color: var(--accent);
    font-weight: 700;
    font-size: 96px;
    line-height: 1;
  }
</style>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const ITEM_HEIGHT = 96; // px — must equal --item-height
  const TRIGGER = 1.4; // seconds — first transition start
  const STEP_GAP = 0.55; // seconds between successive transitions
  const STEP_DUR = 0.45; // per-transition duration

  // For N items, do N-1 transitions
  const stack = document.querySelector(".ticker-stack");
  const count = stack.children.length;

  for (let i = 0; i < count - 1; i++) {
    tl.to(
      stack,
      {
        y: `-=${ITEM_HEIGHT}`,
        duration: STEP_DUR,
        ease: "back.out(1.4)", // approximates spring(stiffness:120, damping:14)
      },
      TRIGGER + i * STEP_GAP,
    );
  }

  window.__timelines["main"] = tl;
</script>
```

## Critical Constraints

- **Height triangle must match**: `--item-height` CSS variable, `.ticker-item` height, and `ITEM_HEIGHT` constant in JS must all be the same number. Mismatch = items half-visible at rest.
- **`flex-direction: column`**: Required on `.ticker-stack`. Inline-flex or row will collapse items horizontally.
- **`overflow: hidden`**: On the window. Without it the entire stack stays visible during scroll.
- **Use `y`, not `top` / `margin-top`**: `y` is a GSAP transform alias — compositor-cheap, no layout reflow. Layout properties are forbidden by the HyperFrames animated-property allowlist.
- **`will-change: transform`** on the stack helps when there are many items (>10). Optional otherwise.
- **No infinite repeat**: HyperFrames renders a finite duration. If you want the ticker to loop visually, compute repeats from `data-duration`.

## Why `back.out`, not `power1.out`?

The Remotion source used `spring({ stiffness: 120, damping: 14 })` — a snappy spring that slightly overshoots. `back.out(1.4)` has the same character: it pushes past target then settles. `power1.out` is monotonic and looks limp by comparison. If you want zero overshoot, prefer `power3.out` over `power1.out`.

## Combinations

- Pair with [hacker-flip-3d](hacker-flip-3d.md) for "decode the word, then swap it" — the ticker continues swapping subsequent words after the decode reveal lands.
- Combine with a logo entry: tween logo opacity 0→1 on the same timeline, anchored at `TRIGGER - 0.2` so the logo lands just before the first word rolls.
- Anchor inside a [coordinate-target-zoom](coordinate-target-zoom.md) wrapper for a "push into the ticker word" effect.

## Examples

- [proof-logo-chain.html](../examples/proof-logo-chain.html) — used for the `clipping → editing` word swap inside the `#1 AI video ___` claim.
