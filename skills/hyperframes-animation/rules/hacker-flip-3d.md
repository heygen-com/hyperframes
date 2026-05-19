---
name: hacker-flip-3d
description: Character-level 3D rotation with deterministic glyph substitution for a decryption reveal effect, GSAP-driven and seek-safe in HyperFrames.
metadata:
  tags: text, 3d, reveal, randomization, perspective, gsap
  adapter: gsap
---

# Hacker Flip 3D Reveal

Characters hinge down from 90° while cycling through pseudo-random glyphs, then settle on the target character. Creates a "decryption" or "airport flap display" effect.

In HyperFrames this is implemented as a GSAP timeline that tweens `rotationX` + `opacity` per character, plus a per-character `onUpdate` callback that writes a deterministic glyph into `textContent` until the reveal threshold is crossed. The runtime drives the timeline by seeking — every glyph state must be a pure function of `tl.time()`, never `Math.random()`.

## Core Concept

A per-character spring-ish ease (`back.out`) controls the flip progress 0→1. A **reveal threshold** (e.g. `0.6`) on that progress flips the displayed text from a pseudo-random glyph to the real target character.

- **Below threshold** → glyph derived from `(charIndex, floor(time * fps / flickerRate))` via integer hash
- **At/above threshold** → real target character

Because the glyph derives only from index and time, scrubbing the timeline backwards is reproducible.

## Basic Pattern

The parent must have `perspective` set; otherwise `rotateX` looks like a Y-scale compression. `transformOrigin: bottom` makes characters hinge like a flap display.

```html
<!-- Composition root sets perspective for all glyphs -->
<div class="flip-row" style="display: inline-flex; perspective: 800px;">
  <!-- One span per character. Each glyph has a ghost copy for stable width. -->
  <span class="flip-glyph" data-char="O" data-index="0">
    <span class="ghost">O</span>
    <span class="anim">O</span>
  </span>
  <span class="flip-glyph" data-char="p" data-index="1">
    <span class="ghost">p</span>
    <span class="anim">p</span>
  </span>
  <!-- … one span per target character -->
</div>

<style>
  .flip-glyph {
    position: relative;
    display: inline-block;
  }
  .flip-glyph .ghost {
    opacity: 0;
  }
  .flip-glyph .anim {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    color: var(--accent, #fff);
    opacity: 0;
    transform-origin: bottom;
    backface-visibility: hidden;
    transform: perspective(600px) rotateX(90deg);
  }
</style>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Tuning knobs — keep in seconds, not frames
  const DELAY = 0.1; // wall time before first glyph starts
  const STAGGER = 0.066; // delay between successive glyphs — 0.033–0.066 s typical
  //   0.066 ≈ 2 frames @ 30 fps (concept-demo-decode-pan, slower decode)
  //   0.033 ≈ 2 frames @ 60 fps (proof-logo-chain, more rapid reveal)
  //   tighter staggers give a more rapid reveal
  const FLIP_DURATION = 0.55; // per-glyph flip duration
  const REVEAL_AT = 0.6; // progress threshold to swap random → real
  const CHAR_POOL = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&";
  const FLICKER_RATE = 3; // frames between glyph reshuffles
  const FPS = 60; // synthetic clock for the flicker hash

  // Cheap integer hash — deterministic, no Math.random()
  const hash = (i, t) => ((i * 374761393 + t * 668265263) >>> 0) % CHAR_POOL.length;

  document.querySelectorAll(".flip-glyph").forEach((glyph) => {
    const index = Number(glyph.dataset.index);
    const real = glyph.dataset.char;
    const anim = glyph.querySelector(".anim");
    const start = DELAY + index * STAGGER;

    // A "progress" proxy: tween a CSS variable on the element from 0 → 1.
    // We read it back in onUpdate to derive both the flicker glyph and the
    // reveal threshold. Tweening a numeric proxy makes the value a pure
    // function of timeline time, so seek-back behaves correctly.
    tl.fromTo(
      anim,
      { rotationX: 90, opacity: 0, "--p": 0 },
      {
        rotationX: 0,
        opacity: 1,
        "--p": 1,
        duration: FLIP_DURATION,
        ease: "back.out(1.6)", // approximates spring(stiffness:150, damping:14)
        onUpdate: function () {
          const p = gsap.getProperty(anim, "--p");
          if (p >= REVEAL_AT) {
            anim.textContent = real;
          } else {
            // Discrete flicker bucket — same for every frame inside the same bucket
            const localFrame = Math.floor((tl.time() - start) * FPS);
            const bucket = Math.floor(localFrame / FLICKER_RATE);
            anim.textContent = CHAR_POOL[hash(index, bucket)];
          }
        },
      },
      start,
    );
  });

  window.__timelines["main"] = tl; // match data-composition-id
</script>
```

## Why an onUpdate, not a chain of `gsap.set()` calls

You could imagine pre-baking every flicker as discrete `tl.set(anim, { textContent: "X" }, t)` calls. **Don't.** Two reasons:

1. HyperFrames seeks the timeline backwards and forwards. `set()` calls behave reliably only in the forward direction unless paired with `immediateRender`. An `onUpdate` that derives state purely from `tl.time()` is monotonic-safe.
2. A 9-character flip at 3-frame flicker = ~50 set() calls per glyph. The bookkeeping is brittle and noisy.

The `onUpdate` approach keeps glyph state stateless: it's a function of `(index, floor(time * fps / flickerRate))`.

## Spring → GSAP Ease Mapping

The Remotion source used `spring({ stiffness: 150, damping: 14 })`. HyperFrames doesn't have a Remotion-style spring helper; map to GSAP eases that feel similar:

| Remotion spring                    | GSAP ease equivalent               | Use for                                                               |
| ---------------------------------- | ---------------------------------- | --------------------------------------------------------------------- |
| stiffness 150, damping 14 (snappy) | `back.out(1.6)` or `back.out(1.7)` | Glyph flip — what we use here                                         |
| stiffness 120, damping 14          | `back.out(1.4)`                    | Ticker step (see [vertical-spring-ticker](vertical-spring-ticker.md)) |
| stiffness 80, damping 18           | `power3.out`                       | Text slide-out                                                        |
| stiffness 45, damping 22 (gentle)  | `power2.out`                       | Camera recenter                                                       |

These are approximations — visually indistinguishable for the 0.4–0.8s ranges we use. For physically exact springs, use `gsap.registerPlugin(CustomEase)` and `CustomEase.create()` with a Bezier curve fitted to the spring response — overkill for most cases.

## Critical Constraints

- **Perspective required**: Either on the parent (preferred — applies to all glyphs in one go) or inline per-glyph. Without it `rotateX` flattens to a Y-scale.
- **Ghost placeholder**: The hidden duplicate (`.ghost`) reserves correct width for variable-width fonts. Without it, the row jitters as the random glyph swaps.
- **Seed stability**: Use `(index, bucket)` not `(index, frame)`. Same bucket = same glyph for `FLICKER_RATE` consecutive frames — that's the flicker rhythm.
- **`transform-origin: bottom`**: Required for the flap-display hinge feel. `center` looks like a card flip; `top` like a roller blind.
- **One paused timeline, one register**: All glyphs share `window.__timelines["main"]`. Don't create per-glyph timelines.
- **No `Math.random()`, no `Date.now()`**: HyperFrames is a deterministic renderer. The integer hash is your only randomness source.

## Combinations

- Pair with [vertical-spring-ticker](vertical-spring-ticker.md) for a "decode then swap word" effect.
- Layer with a sine-wave `tl.to(".flip-row", { y: "+=4", duration: 2, repeat: 2, yoyo: true })` for subtle post-reveal breathing.
- Anchor the row inside [coordinate-target-zoom](coordinate-target-zoom.md) when the camera needs to push into the revealed text.

## Examples

- [proof-logo-chain.html](../examples/proof-logo-chain.html) — full Authority scene with hacker flip on "Opus Clip" at t≈0.32s.
