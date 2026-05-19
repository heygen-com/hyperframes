---
name: coordinate-target-zoom
description: Zoom into a non-centered element by combining scale with counter-translation, expressed as a GSAP timeline on nested wrappers in HyperFrames.
metadata:
  tags: camera, zoom, scale, translate, transform, gsap
  adapter: gsap
---

# Coordinate Target Zoom

When zooming into an off-center element, simply scaling pushes the target off-screen. Solve by applying inverse translation simultaneously with scale. In HyperFrames this is two nested divs animated by a single GSAP timeline; the seek-driven model handles the rest.

## Core Concept

Two nested wrappers with separated concerns:

1. **Outer**: handles `scale` — `transform-origin: center center`
2. **Inner**: handles `translate` — moves the target onto the screen center

**Scale must wrap Translate**, never the reverse. If you scale the translation layer, the coordinate system grows with the element, so a `translate(-200px, 0)` becomes `-200 × scale` pixels — the target accelerates past the screen center.

## Basic Pattern

```html
<div class="zoom-outer">
  <div class="zoom-inner">
    <!-- Layout content here. Target element sits at some offset from center. -->
    <div class="target" style="position: absolute; left: 60%; top: 40%;">
      <!-- the thing we want to zoom into -->
    </div>
    <!-- Other content -->
  </div>
</div>

<style>
  .zoom-outer {
    transform-origin: center center;
  }
  .zoom-inner {
    /* sized like the composition */
    width: 1920px;
    height: 1080px;
    position: relative;
  }
</style>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Pre-calculated offsets — these MUST be constants, not derived at runtime.
  // For a 1920×1080 composition with target at (60%, 40%):
  //   target world position = (1152, 432)
  //   screen center         = (960, 540)
  //   delta needed to recenter = (960 - 1152, 540 - 432) = (-192, 108)
  const TARGET_OFFSET_X = -192;
  const TARGET_OFFSET_Y = 108;
  const TARGET_SCALE = 1.6;

  const ZOOM_START = 2.0; // seconds
  const ZOOM_DUR = 0.9; // seconds

  // Outer = scale, Inner = translate. Animate them in parallel at the same start time.
  tl.to(
    ".zoom-outer",
    {
      scale: TARGET_SCALE,
      duration: ZOOM_DUR,
      ease: "power2.out", // approximates spring(stiffness:80, damping:20)
    },
    ZOOM_START,
  );

  tl.to(
    ".zoom-inner",
    {
      x: TARGET_OFFSET_X,
      y: TARGET_OFFSET_Y,
      duration: ZOOM_DUR,
      ease: "power2.out",
    },
    ZOOM_START,
  ); // same position parameter as the scale tween

  window.__timelines["main"] = tl;
</script>
```

## Critical Constraints

- **Coordinate stability**: `TARGET_OFFSET_X / Y` must be precise. For dynamic text whose width depends on the rendered font, measure once at composition setup (e.g. inside `document.fonts.ready.then(...)` or with `getBoundingClientRect()` against the laid-out DOM) and bake the value into a constant before the timeline is built. The rule is _no measurement at tween time_ — setup-time measurement is fine and often necessary; per-frame measurement in `onUpdate` is forbidden.
- **Transform order**: Scale wraps Translate. Always.
- **Identical position parameter**: Both tweens must start at the same timeline position. If they drift apart, the target arcs across the screen instead of zooming straight in.
- **`transform-origin: center center`** on the outer scale layer. Without it, the scale anchors top-left and the visible center drifts.
- **No layout properties**: Use `x` / `y` GSAP transform aliases, not `left` / `top`. HyperFrames forbids layout-triggering tweens.
- **Composition root dimensions**: `data-width` / `data-height` on the composition root must match the inner wrapper's intrinsic size, otherwise the inner-wrapper coordinates don't line up with the camera coordinates.

## Why a Pre-Calculated Constant?

The Remotion source warned: "For dynamic text, calculate via `measureText` before render." In HyperFrames the same constraint holds but for a stronger reason: HyperFrames re-renders the composition deterministically for each frame, and `measureText` results can vary by a sub-pixel on different rasterizers. Bake the number into a constant before the timeline tweens reference it.

If your target depends on responsive sizing (e.g. element is `60%` wide), still pre-resolve at known composition dimensions. For 1920×1080, write the px value as a comment so a future reader sees the derivation:

```js
// 60% × 1920 - 50% × 1920 = 192px → invert to -192 to pull target left
const TARGET_OFFSET_X = -192;
```

### Variant: Setup-Time Measurement (Brand-Reveal Pattern)

When the target's width depends on a webfont that may not be ready at script-eval time, measure synchronously after `document.fonts.ready` and bake the result into a `const` before the GSAP tweens are scheduled. The measurement still happens once, at setup — never inside a tween callback.

```js
/* Probe the laid-out brand text width via a hidden DOM node. */
const probe = document.createElement("span");
probe.className = "measure-probe";
probe.style.font = `700 ${BRAND_FONT_SIZE}px "Google Sans", Inter, system-ui, sans-serif`;
probe.style.whiteSpace = "pre";
probe.textContent = "hyperframes";
document.body.appendChild(probe);
const brandTextWidth = probe.getBoundingClientRect().width;
probe.remove();

/* Derive the offset constant from the measurement. */
const HERO_FINAL_OFFSET_X =
  (COMPANION_WIDTH + COMPANION_GAP + brandTextWidth + HERO_GAP) / 2 + FINAL_RECENTER_OFFSET;

tl.to(".zoom-translate", { x: -HERO_FINAL_OFFSET_X /* ... */ });
```

The `getBoundingClientRect()` call resolves to a single number that the tween then references — semantically equivalent to a hand-baked literal, but the layout system computed it for you. See [`brand-reveal-assemble-zoom.html`](../examples/brand-reveal-assemble-zoom.html) for the full pattern.

## Typical Phase Timeline

```
Phase 1: Content Assembly    → elements enter / build           (t = 0 .. 1.2)
Phase 2: Shift & Center      → layout settles, no transforms    (t = 1.2 .. 2.0)
Phase 3: Target Zoom         → outer scale + inner translate    (t = 2.0 .. 2.9)
Phase 4: Idle Loop           → sine-wave breathing (finite)     (t = 2.9 .. end)
```

For the idle loop, use a finite repeat — never `repeat: -1`. Compute repeats from `data-duration` minus `2.9`.

## Combinations

- After zoom completes, layer a sine-wave breathing tween: `tl.to(".target", { scale: "+=0.02", yoyo: true, repeat: 4, duration: 1.2, ease: "sine.inOut" }, "+=0.1")`.
- Combine with [hacker-flip-3d](hacker-flip-3d.md) for "decode text, then zoom into it."
- Use as the wrapper for [avatar-cloud-network](avatar-cloud-network.md) when you need to pull the camera into the network center.

## Examples

- [proof-logo-chain.html](../examples/proof-logo-chain.html) — Phase 3 uses this pattern to slide the logo to screen center after the text swap.
