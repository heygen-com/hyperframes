---
name: svg-path-draw
description: Animate SVG paths drawing progressively using stroke-dasharray and stroke-dashoffset.
metadata:
  tags: svg, stroke, draw, path, reveal, icon, vector
---

# SVG Path Draw

Reveals an SVG shape by animating its stroke as if a pen were tracing it. The line appears to be drawn in real-time.

## How It Works

The trick uses two SVG stroke properties together:

1. **`stroke-dasharray = <pathLength>`** — sets the dash pattern to a single dash equal to the path's total length, so the entire path is "one dash"
2. **`stroke-dashoffset`** — controls how much of the dash is shifted out of view. Start at `pathLength` (entire path is offset out → invisible), animate to `0` (no offset → fully drawn)

The path length is computed via the DOM API `path.getTotalLength()`.

## HTML

```html
<div
  class="scene"
  id="svg-draw-scene"
  data-composition-id="svg-draw-scene"
  data-start="0"
  data-duration="3"
  data-track-index="0"
>
  <svg class="logo-mark" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
    <!-- Letter H as two verticals + one bar; draw all three sequentially -->
    <path id="bar-left" d="M 60 40 L 60 160" />
    <path id="bar-right" d="M 140 40 L 140 160" />
    <path id="bar-mid" d="M 60 100 L 140 100" />
  </svg>
  <div class="brand-line">Hedronverse</div>
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
  background: #05060d;
  gap: 32px;
}

.logo-mark {
  width: 320px;
  height: 320px;
}

.logo-mark path {
  fill: none;
  stroke: #a78bfa;
  stroke-width: 12;
  stroke-linecap: round; /* soften endpoints */
  stroke-linejoin: round;
  /* Initial state: invisible. GSAP fills strokeDasharray + strokeDashoffset
     based on each path's measured length. */
}

.brand-line {
  font-family: "Inter", sans-serif;
  font-weight: 700;
  font-size: 48px;
  color: #f5f6fb;
  opacity: 0; /* fades in after stroke completes */
  letter-spacing: 0.04em;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};

  // Measure each path's total length and set up its dash pattern
  const paths = document.querySelectorAll(".logo-mark path");
  paths.forEach((p) => {
    const len = p.getTotalLength();
    p.style.strokeDasharray = `${len}`;
    p.style.strokeDashoffset = `${len}`;
  });

  const tl = gsap.timeline({ paused: true });

  // Stagger draws across 3 paths
  tl.to(
    "#bar-left",
    {
      strokeDashoffset: 0,
      duration: 0.5,
      ease: "power2.out",
    },
    0.2,
  );
  tl.to(
    "#bar-right",
    {
      strokeDashoffset: 0,
      duration: 0.5,
      ease: "power2.out",
    },
    0.45,
  );
  tl.to(
    "#bar-mid",
    {
      strokeDashoffset: 0,
      duration: 0.35,
      ease: "power2.out",
    },
    0.85,
  );

  // Brand line fades in after the strokes settle
  tl.to(
    ".brand-line",
    {
      opacity: 1,
      duration: 0.5,
      ease: "power1.out",
    },
    1.4,
  );

  window.__timelines["svg-draw-scene"] = tl;
</script>
```

## Variations

### Rotation start point (start from top instead of 3 o'clock)

By default, `<circle>` and `<rect>` start their stroke at 3 o'clock. Rotate the element to start from top:

```html
<circle
  cx="100"
  cy="100"
  r="60"
  id="ring"
  style="transform-origin: 100px 100px; transform: rotate(-90deg);"
/>
```

### Linear (constant-speed) draw

Use `ease: 'none'` for steady-rate drawing (like an actual pen tracing):

```js
tl.to("#path", { strokeDashoffset: 0, duration: 1.0, ease: "none" }, 0);
```

### Draw then fill

For SVG shapes that have a fill color, animate fill opacity to come in AFTER the stroke completes:

```js
tl.to("#path", { strokeDashoffset: 0, duration: 0.8, ease: "power2.out" }, 0);
tl.to("#path", { fillOpacity: 1, duration: 0.4, ease: "power1.out" }, 0.8);
```

Requires `fill-opacity: 0` initially and a real `fill` color in CSS.

## Key Principles

- **Set `strokeDasharray` to the path's `getTotalLength()` value**, not an arbitrary number — guessing means stroke will animate but not match the geometry
- **Start `strokeDashoffset` at the same length**, animate down to `0`
- **Measure inside the timeline setup, not at module top** — SVG may not be rendered when module code runs in some environments. In HF runtime this works at top because SVG is inline, but be safe
- **`stroke-linecap: round`** for softer endpoints (less abrupt finish)
- **For sequential multi-path draws, stagger by ~70-80% of the previous segment's duration** — eye reads it as continuous motion, not 3 separate animations
- **Don't pair with `back.out` or `elastic.out`** — bouncing strokes feel wrong (the pen wouldn't bounce)

## Critical Constraints

- **`fill: none` in CSS for outline-only draws** — otherwise the fill area appears immediately and ruins the reveal
- **Path length is measured in the browser**: requires SVG to be in the DOM. HF inline SVG is fine; loaded `<image>` SVGs may not be
- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **Works on**: `<path>`, `<circle>`, `<rect>`, `<line>`, `<polyline>`, `<polygon>`, `<ellipse>` (anything with a stroke)
- **For complex paths**, if `getTotalLength()` looks wrong, overestimate `strokeDasharray` slightly (e.g. `len * 1.05`) — too large is invisible during animation start (no visible gap), too small clips the end

## Combinations

- [counting-dynamic-scale.md](counting-dynamic-scale.md) — pair: stroke draws an icon while a number counts up beside it
- [hacker-flip-3d.md](hacker-flip-3d.md) — pair: SVG logo draws, then a hacker-flipped wordmark reveals under it

## Pairs with HF skills

- `/hyperframes-gsap` — timeline + stroke property tween
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
