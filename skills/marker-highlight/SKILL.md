---
name: marker-highlight
description: Canvas-based animated text highlighting for HyperFrames captions using MarkerHighlight.js. Five drawing modes (highlight, circle, burst, scribble, sketchout) for dynamic emphasis in video compositions.
trigger: When captions or text overlays need animated highlighting, marker-style emphasis, hand-drawn circles, burst effects, scribble underlines, or canvas-based text decoration in HyperFrames compositions.
---

# Marker Highlight

Canvas-based animated text highlighting for HyperFrames compositions. Uses [MarkerHighlight.js](https://marker-highlight.solarise.dev/) to add dynamic, hand-drawn-style emphasis to text — highlight sweeps, circles, bursts, scribbles, and sketchouts rendered on a `<canvas>` overlay.

## When to Use

Use this skill when captions or text overlays need visual emphasis beyond simple color changes:

- **Highlight mode** — yellow marker sweep behind important words
- **Circle mode** — hand-drawn circle around key terms
- **Burst mode** — radiating lines from emphasized text
- **Scribble mode** — wavy underlines or strikethroughs
- **Sketchout mode** — cross-hatch deletion effect

Combine with the `hyperframes-captions` skill for tone-adaptive captions that use marker highlighting as the emphasis mechanism.

## Setup

Load MarkerHighlight.js from CDN inside the composition:

```html
<script src="https://cdn.jsdelivr.net/npm/marker-highlight@latest/dist/marker-highlight.min.js"></script>
```

The library attaches `MarkerHighlight` to the global scope. No import/export — use it directly in composition scripts.

## Basic Pattern

```html
<div id="caption-text">This is <span class="mh-target">important</span> information</div>

<script>
  // Create instance AFTER DOM is ready
  var marker = new MarkerHighlight({
    color: "#FDD835",
    mode: "highlight",
    animation: {
      duration: 600,
      delay: 0,
    },
  });

  // Mark target elements — canvas overlay is created automatically
  marker.mark(".mh-target");
</script>
```

## Configuration Reference

```js
var marker = new MarkerHighlight({
  // Drawing mode (required)
  mode: "highlight", // 'highlight' | 'circle' | 'burst' | 'scribble' | 'sketchout'

  // Color (any CSS color)
  color: "#FDD835",

  // Animation timing
  animation: {
    duration: 600, // ms — total draw time
    delay: 0, // ms — wait before starting
  },

  // Mode-specific options
  padding: 4, // px — space around text (highlight, circle)
  height: 0.35, // 0-1 — highlight bar height relative to text
  skew: -2, // degrees — highlight bar angle
  wave: 0.02, // 0-1 — waviness for scribble/circle
  lineWidth: 3, // px — stroke width for circle/scribble/burst
  burstLines: 12, // number of burst rays
  burstLength: 40, // px — burst ray length
});
```

## Integration with GSAP Timelines

MarkerHighlight.js uses its own animation system, which conflicts with HyperFrames' deterministic frame-by-frame capture. **Do not use MarkerHighlight's built-in animation in rendered compositions.** Instead, use the canvas-based rendering for the visual style and control timing with GSAP.

### Pattern: GSAP-Controlled Marker Highlighting

```js
window.__timelines = window.__timelines || {};
var tl = gsap.timeline({ paused: true });

// 1. Create marker with animation disabled (duration: 0)
var marker = new MarkerHighlight({
  color: "#FDD835",
  mode: "highlight",
  animation: { duration: 0, delay: 0 },
});

// 2. Mark targets — creates canvas but draws instantly (0ms duration)
marker.mark(".mh-target");

// 3. Get the canvas element MarkerHighlight created
var canvas = document.querySelector(".marker-highlight-canvas");

// 4. Control visibility via GSAP
gsap.set(canvas, { opacity: 0 });
tl.to(canvas, { opacity: 1, duration: 0.3, ease: "power2.out" }, 1.0);
tl.to(canvas, { opacity: 0, duration: 0.2, ease: "power2.in" }, 3.0);

window.__timelines["my-comp"] = tl;
```

### Pattern: CSS Simulation (No Library Dependency)

For deterministic rendering without external dependencies, simulate MarkerHighlight's visual effects with pure CSS + GSAP. This is the **recommended approach** for production compositions:

```html
<!-- Highlight mode: colored bar behind text -->
<div class="marker-hl-wrapper">
  <div class="marker-hl-bar" id="hl-bar-1"></div>
  <span class="marker-hl-text">highlighted text</span>
</div>

<style>
  .marker-hl-wrapper {
    position: relative;
    display: inline-block;
  }
  .marker-hl-bar {
    position: absolute;
    top: 0;
    left: -6px;
    right: -6px;
    bottom: 0;
    background: #fdd835;
    opacity: 0.35;
    transform: scaleX(0);
    transform-origin: left center;
    border-radius: 3px;
    z-index: 0;
  }
  .marker-hl-text {
    position: relative;
    z-index: 1;
  }
</style>

<script>
  tl.to("#hl-bar-1", { scaleX: 1, duration: 0.5, ease: "power2.out" }, 0.6);
</script>
```

See [css-patterns.md](./css-patterns.md) for all five modes implemented as CSS + GSAP.

## Mode-to-Caption Mapping

Match MarkerHighlight modes to caption energy levels detected by the `hyperframes-captions` skill:

| Caption energy | Recommended mode      | Visual effect                            | Use for                                 |
| -------------- | --------------------- | ---------------------------------------- | --------------------------------------- |
| High           | `burst` + `highlight` | Radiating lines + sweep on hero words    | Product launches, hype videos           |
| Medium-high    | `circle`              | Hand-drawn emphasis circles              | Key stats, important terms              |
| Medium         | `highlight`           | Classic marker sweep                     | Standard emphasis, clean professional   |
| Medium-low     | `scribble`            | Wavy underlines                          | Subtle emphasis, tutorials              |
| Low            | `sketchout`           | Gentle cross-hatch on de-emphasized text | Storytelling, contrast with active text |

## Per-Word Styling with Modes

Different words in the same caption group can use different modes:

```js
// Hero word gets burst
new MarkerHighlight({ mode: "burst", color: "#E53935" }).mark("#word-hero");

// Supporting words get highlight
new MarkerHighlight({ mode: "highlight", color: "#FDD835" }).mark(".word-support");

// De-emphasized words get sketchout
new MarkerHighlight({ mode: "sketchout", color: "#666" }).mark(".word-dim");
```

## Color Palette

MarkerHighlight.js's default palette (from the library's documentation page):

| Color  | Hex       | Use for                            |
| ------ | --------- | ---------------------------------- |
| Red    | `#E53935` | Circles, burst lines, alerts       |
| Yellow | `#FDD835` | Highlight bars, primary emphasis   |
| Blue   | `#1E88E5` | Burst accents, scribble underlines |
| Black  | `#1a1a1a` | Background, sketchout              |
| White  | `#fafafa` | Text on dark backgrounds           |

Adapt to the composition's existing palette — these are starting points, not mandates.

## Constraints

- **Deterministic.** No `Math.random()`, no `Date.now()`. MarkerHighlight's internal randomness must be seeded or bypassed via CSS simulation.
- **GSAP owns timing.** Never rely on MarkerHighlight's built-in animation timing — use `duration: 0` and control visibility with GSAP tweens.
- **Canvas layering.** MarkerHighlight creates `<canvas>` overlays. Set appropriate `z-index` to keep canvas behind or in front of text as needed.
- **Font loading.** Canvas-based highlighting measures text bounding boxes. Fonts must be fully loaded before calling `marker.mark()`. Use `font-display: block` and load fonts via `@font-face` or Google Fonts `@import`.

## References

- [css-patterns.md](./css-patterns.md) — Pure CSS + GSAP implementations of all five modes (recommended for deterministic rendering)
- [MarkerHighlight.js docs](https://marker-highlight.solarise.dev/) — Library documentation and interactive demos
