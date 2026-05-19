---
name: card-morph-anchor
description: >
  A container appears to morph between two visual states (rectangle → circle, card → icon)
  while serving as the viewer's eye-tracking anchor between shots. HyperFrames implementation
  uses `scale` (uniform when aspect ratios match, or non-uniform `scaleX`/`scaleY` when they
  don't) + paint-only `borderRadius` / `background` / `boxShadow` tweens, then fades the morph
  container to hand off to the real target rendered underneath — visually equivalent to the
  Remotion source's `width` / `height` interpolation, but allowlist-clean.
metadata:
  tags: morph, anchor, transition, border-radius, container, shape, gsap
  adapter: gsap
---

# Card Morph Anchor

A container smoothly transforms its apparent size, corner-radius, and surface treatment between two visual states. The morph itself **is** the shot transition — no separate transition effect is needed. The morph container also doubles as the viewer's eye-tracking anchor between the outgoing and incoming content.

## HyperFrames vs. Remotion

The Remotion source drove a single `spring()` and fed `morphProgress` into `interpolate(...)` calls for `width`, `height`, and `borderRadius`. Width/height tweens worked fine because Remotion recomputes the layout every frame anyway.

HyperFrames is seek-driven and forbids tweening `width` / `height` / `left` / `top` — they trigger layout reflows that compound badly across the camera scale wrapper. The morph must achieve the same visual effect using **only** transform aliases (`scale`, `scaleX`, `scaleY`, `x`, `y`, `rotation`) and paint-only properties (`borderRadius`, `background`, `boxShadow`, `opacity`).

| Remotion (source)             | HyperFrames (this rule)                                                               | Why the substitution works                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `width: W₀ → W₁` tween        | `scaleX: 1 → W₁/W₀` (or uniform `scale` if aspect ratios match)                       | Same visible footprint at every step. Content distortion is masked by the early fade-out.                                 |
| `height: H₀ → H₁` tween       | `scaleY: 1 → H₁/H₀` (or covered by the same uniform `scale` when aspect ratios match) | When source and target aspect ratios differ, drive X and Y independently. When they match, one `scale` tween covers both. |
| `borderRadius: r₀ → r₁` tween | `borderRadius: r₀ → r₁` (e.g. `28px → 50%`)                                           | Repaint-only, GSAP can tween CSS length strings and `%` directly.                                                         |
| `background: dark → gradient` | same — `background` tween via GSAP                                                    | Repaint-only, GSAP can tween color/gradient.                                                                              |
| `boxShadow: subtle → glow`    | same — `boxShadow` tween via GSAP                                                     | Repaint-only.                                                                                                             |
| `finalFade: 1 → 0 at 85-100%` | `opacity` tween at `MORPH_START + 0.85 * MORPH_DUR`                                   | Same hand-off pattern. The target element renders underneath and becomes visible when the morph fades.                    |

The result is visually indistinguishable from a width/height interpolation **provided the content fade-out and the morph-to-target hand-off are timed correctly** (see Content Crossfade below).

## Core Concept

In Remotion, "a single spring driver" was a numeric value that multiple `interpolate(...)` calls consumed. In HyperFrames, the GSAP idiom for "parallel motion under one driver" is **multiple tweens started at the same timeline position with the same `duration`**. GSAP advances them in lockstep automatically.

## Basic Pattern

Two forms — pick based on whether source and target share an aspect ratio.

### Form A — Uniform `scale` (source and target aspect ratios match)

Use when the source container is already roughly square (or whatever aspect the target uses). One `scale` tween covers both dimensions; content distortion is zero.

```js
const MORPH_START = 3.2; // seconds — when the morph fires
const MORPH_DUR = 0.6; // seconds — full morph length

const START_W = 300; // px — container intrinsic width (unscaled)
const START_H = 300; // px — container intrinsic height (unscaled, ~equal to START_W)
const END_VISUAL_SIZE = 160; // px — the footprint the morph collapses toward
const END_SCALE = END_VISUAL_SIZE / START_W; // ≈ 0.53 — uniform scale at morph end
const END_RADIUS_PX = (START_W * END_SCALE) / 2; // ≈ 80px → reads as a circle

// All four tweens at the same timeline position fire in lockstep — GSAP idiom for parallel.
tl.to(
  ".morph-container",
  {
    scale: END_SCALE,
    duration: MORPH_DUR,
    ease: "power3.out", // approximates spring(stiffness:80, damping:18)
  },
  MORPH_START,
);

tl.to(
  ".morph-container",
  {
    borderRadius: END_RADIUS_PX + "px",
    duration: MORPH_DUR,
    ease: "power3.out",
  },
  MORPH_START,
);

tl.to(
  ".morph-container",
  {
    background: "linear-gradient(135deg, #14B8A6, #06B6D4, #0EA5E9)",
    boxShadow: "0 0 50px rgba(20, 184, 166, 0.5), 0 0 100px rgba(6, 182, 212, 0.25)",
    duration: MORPH_DUR,
    ease: "power3.out",
  },
  MORPH_START,
);

// Content crossfade — see next section.
tl.to(
  ".morph-content",
  {
    opacity: 0,
    duration: MORPH_DUR * 0.4,
    ease: "power2.out",
  },
  MORPH_START,
);

// Final hand-off fade — at 85-100% of morph, container vanishes to reveal target underneath.
tl.to(
  ".morph-container",
  {
    opacity: 0,
    duration: MORPH_DUR * 0.15,
    ease: "none",
  },
  MORPH_START + MORPH_DUR * 0.85,
);
```

### Form B — Non-uniform `scaleX` / `scaleY` (source and target aspect ratios differ)

Use when the source is a tall card (e.g. a phone mockup) and the target is a circle or square — the aspect ratios don't match, so a single uniform scale would either overshoot one dimension or undershoot the other. Drive X and Y independently from the source dimensions. This is the canonical case for the avatar-circle-from-mockup-card morph: a 320×650 phone mockup collapsing to a 220px avatar.

```js
const MORPH_START = 3.2;
const MORPH_DUR = 0.6;

const MOCKUP_W = 320; // px — source phone mockup width
const MOCKUP_H = 650; // px — source phone mockup height (tall)
const AVATAR_DIAMETER = 220; // px — target avatar circle

const MORPH_END_SCALE_X = AVATAR_DIAMETER / MOCKUP_W; // ≈ 0.6875
const MORPH_END_SCALE_Y = AVATAR_DIAMETER / MOCKUP_H; // ≈ 0.3385

// Drive X and Y separately — they land on the same diameter at morph end despite
// starting from very different source dimensions.
tl.to(
  ".morph-container",
  {
    scaleX: MORPH_END_SCALE_X,
    scaleY: MORPH_END_SCALE_Y,
    duration: MORPH_DUR,
    ease: "power3.out",
  },
  MORPH_START,
);

// borderRadius: tween straight to "50%" — the post-scale footprint is square
// (AVATAR_DIAMETER × AVATAR_DIAMETER), so 50% reads as a clean circle.
tl.to(
  ".morph-container",
  {
    borderRadius: "50%",
    duration: MORPH_DUR,
    ease: "power3.out",
  },
  MORPH_START,
);

// The remaining tweens (background, boxShadow, content fade, container fade)
// are identical to Form A.
```

Form B is still paint-only and seek-safe — no `width` / `height` tweens — preserving the rule's core constraint. The aspect-ratio distortion of the source content is masked by the content fade-out at 40% of the morph, exactly as in Form A; by the time the scale ratio diverges visibly, the content is already invisible.

The DOM stays static the entire scene:

```html
<!-- Target (rendered first, lower z-index, initially invisible) -->
<div
  class="morph-target"
  style="position: absolute; left: 50%; top: 50%;
                                  width: 160px; height: 160px; border-radius: 50%;
                                  z-index: 20; opacity: 0;
                                  background: linear-gradient(135deg, #14B8A6, #06B6D4, #0EA5E9);"
>
  <!-- avatar / final icon content -->
</div>

<!-- Morph container (rendered second, higher z-index, visible during the morph) -->
<div
  class="morph-container"
  style="position: absolute; left: 50%; top: 50%;
                                     width: 300px; height: 540px; border-radius: 28px;
                                     z-index: 25; overflow: hidden;
                                     background: #000;"
>
  <div class="morph-content">
    <!-- Shot N content — fades out during first 40% of morph -->
  </div>
</div>

<script>
  // GSAP-owned centering (xPercent/yPercent are GSAP transform aliases, not CSS).
  gsap.set(".morph-target", { xPercent: -50, yPercent: -50 });
  gsap.set(".morph-container", { xPercent: -50, yPercent: -50 });
</script>
```

## Key Properties to Morph

| Property                      | Reflow? | Tween in HyperFrames? | Notes                                                                                                                                                                                               |
| ----------------------------- | ------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `width`, `height`             | yes     | **forbidden**         | Use uniform `scale` instead.                                                                                                                                                                        |
| `left`, `top`                 | yes     | **forbidden**         | Use GSAP `x`, `y`, or `xPercent` / `yPercent`.                                                                                                                                                      |
| `borderRadius`                | no      | yes                   | GSAP tweens CSS length strings directly.                                                                                                                                                            |
| `background` (color/gradient) | no      | yes                   | GSAP color plugin (built-in) handles colors; gradients tween cleanly with matching stop structures.                                                                                                 |
| `boxShadow`                   | no      | yes                   | GSAP can tween multi-shadow strings; structures must match (same number of shadows on both ends).                                                                                                   |
| `scale`, `scaleX`, `scaleY`   | no      | yes                   | GSAP transform aliases. Use uniform `scale` when source and target are roughly square; use `scaleX`/`scaleY` only if content can absorb the distortion (it can't, mostly — fade content out first). |
| `opacity`                     | no      | yes                   | Required for the final hand-off.                                                                                                                                                                    |
| `rotation`                    | no      | yes                   | Adds visual interest to the morph (e.g. a -5° → 0° settle). Use sparingly.                                                                                                                          |
| `filter: drop-shadow(...)`    | no      | yes                   | Alternative to `boxShadow` for glow effects on irregular shapes.                                                                                                                                    |

## Content Crossfade

The morph container's content fades out during the first ~40% of the morph. The target's content (rendered underneath) fades in during the last ~15%, exactly when the morph container vanishes. Three tweens, one continuous visual:

```js
const oldContentEnd = MORPH_DUR * 0.4; // 0.24s
const targetFadeIn = MORPH_DUR * 0.85; // 0.51s
const finalFadeEnd = MORPH_DUR; // 0.60s

// 1. Old content fades during the first 40%.
tl.to(
  ".morph-content",
  {
    opacity: 0,
    duration: oldContentEnd,
    ease: "power2.out",
  },
  MORPH_START,
);

// 2. Target fades in during the last 15%.
tl.to(
  ".morph-target",
  {
    opacity: 1,
    duration: finalFadeEnd - targetFadeIn,
    ease: "power2.out",
  },
  MORPH_START + targetFadeIn,
);

// 3. Morph container fades out simultaneously with target fade-in.
tl.to(
  ".morph-container",
  {
    opacity: 0,
    duration: finalFadeEnd - targetFadeIn,
    ease: "none",
  },
  MORPH_START + targetFadeIn,
);
```

By the time the morph container is gone, the target is fully visible at exactly the same screen footprint. The viewer reads this as "the rectangle became the circle" — never as "one element vanished and another appeared".

## Tips

- **Overflow hidden**: The morph container needs `overflow: hidden` to clip content cleanly as `borderRadius` increases. Without it, square content peeks through rounded corners during the transition.
- **Match the centering**: The morph container and the target must share the same center coordinates. Both use `xPercent: -50, yPercent: -50` for centering; their CSS `left` / `top` must match.
- **Position adjustments via `x`/`y`**: If the morph should drift slightly during the transition (e.g. settling up by 2%), add an `x` / `y` tween at the same start/duration as the scale tween. Never tween `top` or `left`.
- **Aspect-ratio mismatch — pick Form A or Form B**: If the source content is decorative and can be hidden by the early fade-out, uniform `scale` (Form A) works even when the source isn't square — viewers never see the distortion. If the morph needs to land exactly on the target's footprint (e.g. a 220px avatar circle from a 320×650 phone mockup), use Form B's `scaleX` / `scaleY` so both dimensions hit the target diameter simultaneously.
- **Pre-bake the end constants**: For Form A, `END_RADIUS_PX = (START_W * END_SCALE) / 2`. For Form B, `MORPH_END_SCALE_X = TARGET_W / SOURCE_W` and `MORPH_END_SCALE_Y = TARGET_H / SOURCE_H`. Bake these numbers; don't compute them at tween time. If you change source/target dimensions, recompute and edit the constants.
- **Pair with `x` / `y` for position morph**: A single set of tweens at the same start can simultaneously change shape and screen position. The viewer reads it as a single continuous transform.

## Critical Constraints

- **No `width` / `height` / `left` / `top` tweens**: Allowlist violation. Use `scale` and `x` / `y` instead.
- **GSAP owns the transform**: Once GSAP touches the element (via `set()` or `to()`), don't apply CSS `transform:` to the same element. They will fight.
- **Pre-baked end constants**: `END_SCALE`, `END_RADIUS_PX`, and any positional offsets are computed once at script load. Never read `getBoundingClientRect()` at tween time — sub-pixel drift compounds across the camera scale and produces visible jitter.
- **Target z-index < morph z-index**: The morph container sits above the target. When the morph fades to 0, the target becomes visible. If you reverse this, the target obscures the morph from the start.
- **Same center coordinates**: Both elements must share their final screen center. The morph itself doesn't move the center; only the apparent size and shape change.
- **No infinite repeats**: This rule is a one-shot transition. There's no scenario where a morph should loop.
- **No nondeterministic state**: The morph progresses as a pure function of `tl.time()`. No `Math.random`, no `Date.now`.

## Combinations

- [scale-swap-transition](scale-swap-transition.md) — simpler morph without dimension change, useful when source and target are already the same size.
- [sine-wave-loop](sine-wave-loop.md) — breathing on the target after the morph settles. Start the breath at `MORPH_START + MORPH_DUR + 0.1` so it doesn't overlap the morph spring's settle.
- [coordinate-target-zoom](coordinate-target-zoom.md) — if the morph also relocates the focal point, the camera can zoom into the target as the morph completes.

## Examples

- [problem-mockup-overwhelm.html](../examples/problem-mockup-overwhelm.html) — the canonical use: a tall mockup card (300×540) morphs into a 220-px avatar circle while non-center mockups and platform icons exit concurrently, then task bubbles enter around the avatar.
