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
    <!-- Multi-segment glyph; draw all segments sequentially -->
    <path id="bar-left" d="M 60 40 L 60 160" />
    <path id="bar-right" d="M 140 40 L 140 160" />
    <path id="bar-mid" d="M 60 100 L 140 100" />
  </svg>
  <div class="brand-line">{Brand}</div>
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
  background: {bgColor};
  gap: 32px;
}

.logo-mark {
  width: 320px;
  height: 320px;
}

.logo-mark path {
  fill: none;
  stroke: {accentColor};
  stroke-width: 12;
  stroke-linecap: round; /* soften endpoints */
  stroke-linejoin: round;
  /* Initial state: invisible. GSAP fills strokeDasharray + strokeDashoffset
     based on each path's measured length. */
}

.brand-line {
  font-family: {font};
  font-weight: 700;
  font-size: 48px;
  color: {textColor};
  opacity: 0; /* fades in after stroke completes */
  letter-spacing: 0.04em;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};

  // Named constants — assignments live in the example, not here.
  // See "How to Choose Values" below for ranges and selection criteria.
  const SEGMENT_DRAW_DUR; // per-segment stroke duration
  const FINAL_SEGMENT_DUR; // shorter draw on the last (shorter) segment
  const SEG_1_START; // first segment start time
  const SEG_2_START; // second segment start time (overlaps SEG_1 tail)
  const SEG_3_START; // third segment start time (overlaps SEG_2 tail)
  const BRAND_FADE_DUR; // wordmark fade-in duration
  const BRAND_FADE_START; // wordmark fade-in start (after last stroke settles)

  // Measure each path's total length and set up its dash pattern.
  // getTotalLength() is a real DOM API — its return value is dynamic
  // measured geometry, NOT a magic number.
  const paths = document.querySelectorAll(".logo-mark path");
  paths.forEach((p) => {
    const len = p.getTotalLength();
    p.style.strokeDasharray = `${len}`;
    p.style.strokeDashoffset = `${len}`;
  });

  const tl = gsap.timeline({ paused: true });

  // Stagger draws across segments — each starts before the previous finishes
  // so the eye reads continuous motion.
  tl.to(
    "#bar-left",
    {
      strokeDashoffset: 0,
      duration: SEGMENT_DRAW_DUR,
      ease: "power2.out",
    },
    SEG_1_START,
  );
  tl.to(
    "#bar-right",
    {
      strokeDashoffset: 0,
      duration: SEGMENT_DRAW_DUR,
      ease: "power2.out",
    },
    SEG_2_START,
  );
  tl.to(
    "#bar-mid",
    {
      strokeDashoffset: 0,
      duration: FINAL_SEGMENT_DUR,
      ease: "power2.out",
    },
    SEG_3_START,
  );

  // Brand line fades in after the strokes settle
  tl.to(
    ".brand-line",
    {
      opacity: 1,
      duration: BRAND_FADE_DUR,
      ease: "power1.out",
    },
    BRAND_FADE_START,
  );

  window.__timelines["svg-draw-scene"] = tl;
</script>
```

## How to Choose Values

- **SEGMENT_DRAW_DUR** — per-segment stroke duration
  - Range: 0.3-0.8s
  - Effects: low end reads as a fast snap (good for short segments); high end reads as a deliberate pen trace (good for long curves)
  - Constraints: must be short enough that the total chain (last segment finish) ends before BRAND_FADE_START; longer than ~1s feels sluggish for a logo reveal
  - Reference: short outline segments use ~0.5s

- **FINAL_SEGMENT_DUR** — duration of the shortest / final segment
  - Range: 0.25-0.6s
  - Effects: should be proportional to segment length — a short connector drawn at SEGMENT_DRAW_DUR appears slower than its longer siblings
  - Constraints: typically 60-80% of SEGMENT_DRAW_DUR when the segment is visibly shorter than the others
  - Reference: a mid-bar that is roughly 2/3 the length of the verticals uses ~0.35s

- **SEG_1_START** — first segment start time
  - Range: 0-0.4s
  - Effects: 0 starts immediately on play; >0 gives a brief beat of empty stage before motion
  - Constraints: should be ≥ 0
  - Reference: a small lead-in of ~0.2s lets the viewer settle before motion

- **SEG_2_START** — second segment start time
  - Range: SEG_1_START + (0.5 \* SEGMENT_DRAW_DUR) to SEG_1_START + SEGMENT_DRAW_DUR
  - Effects: closer to SEG_1_START + 0.5\*SEGMENT_DRAW_DUR feels rapid/overlapping; closer to SEG_1_START + SEGMENT_DRAW_DUR feels sequential
  - Constraints: stagger ~70-80% of SEGMENT_DRAW_DUR reads as continuous motion (not 3 isolated animations)
  - Reference: SEG_1_START + ~0.25s (about half of SEGMENT_DRAW_DUR)

- **SEG_3_START** — third segment start time
  - Range: SEG_2_START + (0.5 \* SEGMENT_DRAW_DUR) to SEG_2_START + SEGMENT_DRAW_DUR
  - Effects: same as SEG_2_START — controls perceived rhythm
  - Constraints: should preserve the same stagger ratio used between SEG_1 and SEG_2
  - Reference: SEG_2_START + ~0.4s

- **BRAND_FADE_DUR** — wordmark fade-in duration
  - Range: 0.3-0.8s
  - Effects: low end snaps in (urgent); high end glides in (premium / branded)
  - Constraints: must finish before the composition's `data-duration` ends
  - Reference: a calm logo lockup uses ~0.5s

- **BRAND_FADE_START** — wordmark fade-in start time
  - Range: max(SEG_3_START + FINAL_SEGMENT_DUR, …) to that value + 0.4s
  - Effects: starting exactly at last stroke end feels tightly chained; adding a small beat gives the strokes a moment to "settle" before the wordmark joins
  - Constraints: MUST be ≥ SEG_3_START + FINAL_SEGMENT_DUR (otherwise wordmark appears during the draw and competes with it)
  - Reference: SEG_3_START + FINAL_SEGMENT_DUR + ~0.2s

Ease families used here are discrete choices, not tunable scalars:

- **stroke draws** use `power2.out` — gentle deceleration mimics a hand lifting at end of stroke. Do NOT use `back.out` or `elastic.out` (pens don't bounce).
- **brand fade** uses `power1.out` — soft tail on an opacity tween.
- For a constant-speed "real pen" tracing feel, swap to `none` (see Variations).

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
tl.to("#path", { strokeDashoffset: 0, duration: SEGMENT_DRAW_DUR, ease: "none" }, SEG_1_START);
```

### Draw then fill

For SVG shapes that have a fill color, animate fill opacity to come in AFTER the stroke completes:

```js
tl.to(
  "#path",
  { strokeDashoffset: 0, duration: SEGMENT_DRAW_DUR, ease: "power2.out" },
  SEG_1_START,
);
tl.to(
  "#path",
  { fillOpacity: 1, duration: FILL_FADE_DUR, ease: "power1.out" },
  SEG_1_START + SEGMENT_DRAW_DUR,
);
```

Requires `fill-opacity: 0` initially and a real `fill` color in CSS.

## Key Principles

- **Set `strokeDasharray` to the path's `getTotalLength()` value**, not an arbitrary number — guessing means stroke will animate but not match the geometry
- **Start `strokeDashoffset` at the same length**, animate down to `0`
- **Measure inside the timeline setup, not at module top** — SVG may not be rendered when module code runs in some environments. In HF runtime this works at top because SVG is inline, but be safe
- **`stroke-linecap: round`** for softer endpoints (less abrupt finish)
- **For sequential multi-path draws, stagger by ~70-80% of the previous segment's duration** — eye reads it as continuous motion, not N separate animations
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

- `/hyperframes-animation` — timeline + stroke property tween
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
