---
name: marker-highlight
description: Use when highlighting text, circling words, or adding hand-drawn annotation effects in a composition. Marker pen, circle, burst, scribble, and sketchout modes via animated canvas overlays.
---

# Marker Highlight

Animated canvas-based text highlighting using [MarkerHighlight.js](https://github.com/Robincodes-Sandbox/marker-highlight). Wraps text in `<mark>` tags and renders animated highlight effects (marker pen, hand-drawn circle, burst rays, scribble, sketchout) on a canvas overlay without modifying the text DOM.

The library runs its own requestAnimationFrame animation loop — it is **not** GSAP-driven. Use GSAP `tl.call()` to trigger highlights at specific points in the timeline.

## Required Script

The library is an ES module. For HyperFrames, create a global-script version by downloading the minified file and replacing the `export` line:

```bash
curl -sL "https://cdn.jsdelivr.net/gh/Robincodes-Sandbox/marker-highlight@main/dist/marker-highlight.min.js" \
  | sed 's/export{[^}]*};$/window.MarkerHighlighter=W;/' > marker-highlight.global.js
```

The `sed` command replaces the ES module `export` with a global assignment. The variable name `W` is the minifier's alias for MarkerHighlighter — if the library is rebuilt and the minifier picks a different name, check the last line of the minified file for the correct alias.

Then load it as a regular script:

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script src="marker-highlight.global.js"></script>
```

## Color Setup

Set highlight colors via `data-color` on each `<mark>`, then copy them to `data-original-bgcolor` before constructing the highlighter. Never set `background-color` in CSS — it flashes before the library takes over.

```css
mark {
  color: inherit;
  background-color: transparent;
}
```

```html
<mark id="m1" data-color="rgba(255, 220, 50, 0.5)">highlighted</mark>
```

```js
// Copy colors before any MarkerHighlighter construction
document.querySelectorAll("mark[data-color]").forEach(function (m) {
  m.setAttribute("data-original-bgcolor", m.getAttribute("data-color"));
});
```

## GSAP Integration Pattern

The library has three behaviors that matter for timeline control:

1. **`animate: false`** draws highlights statically on construction — canvas is pre-filled
2. **`reanimateMark()`** animates from scratch, but only works on a clean canvas
3. **Multiple MarkerHighlighter instances** on sibling elements conflict — the library clears ALL `.highlight` divs from the shared parent container on init

The correct pattern: use ONE `MarkerHighlighter` per container with `animate: false`, hide all canvases immediately, then clear + show + reanimate per mark at trigger time.

```js
// 1. Construct once — draws everything statically
var hl = new MarkerHighlighter(document.getElementById("text-container"), {
  animate: false,
  animationSpeed: 800,
  padding: 0.3,
  highlight: { amplitude: 0.3, wavelength: 5 },
});

// 2. Hide all canvases after static render
setTimeout(function () {
  document.querySelectorAll(".highlight").forEach(function (div) {
    div.style.opacity = "0";
  });
}, 100);

// 3. Trigger individual marks from the timeline
function addHighlight(highlighter, markId, time) {
  tl.to(
    {},
    {
      duration: 0.001,
      onStart: function () {
        var mark = document.getElementById(markId);
        var ref = mark.getAttribute("data-mark-ref");
        if (!ref) return;
        var divs = mark.parentElement.querySelectorAll('.highlight[data-mark-id="' + ref + '"]');
        divs.forEach(function (div) {
          var canvas = div.querySelector("canvas");
          if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
          div.style.opacity = "1";
        });
        highlighter.reanimateMark(mark);
      },
      onReverseComplete: function () {
        var mark = document.getElementById(markId);
        var ref = mark.getAttribute("data-mark-ref");
        if (!ref) return;
        mark.parentElement
          .querySelectorAll('.highlight[data-mark-id="' + ref + '"]')
          .forEach(function (div) {
            div.style.opacity = "0";
          });
      },
    },
    time,
  );
}

addHighlight(hl, "m1", 1.0);
addHighlight(hl, "m2", 2.2);
```

The `onReverseComplete` hides the highlight when the timeline rewinds past the trigger point.

## Drawing Modes

Set via the `drawingMode` option or `data-drawing-mode` attribute per mark.

| Mode        | Effect                                       | Best for                                 |
| ----------- | -------------------------------------------- | ---------------------------------------- |
| `highlight` | Wavy marker pen stroke behind text (default) | Emphasizing phrases, key terms           |
| `circle`    | Hand-drawn circle/ellipse around text        | Calling out single words, annotations    |
| `burst`     | Radiating lines, curves, or cloud puffs      | Excitement, emphasis, visual energy      |
| `scribble`  | Chaotic hand-drawn scribble over text        | Crossing out, messy energy, redaction    |
| `sketchout` | Rough rectangle outline around text          | Boxed callouts, technical/blueprint feel |

```html
<mark data-drawing-mode="circle" data-color="rgba(229, 57, 53, 0.6)">critical</mark>
<mark
  data-drawing-mode="burst"
  data-burst='{"style":"cloud","count":20,"power":1.5}'
  data-color="rgba(255, 220, 50, 0.5)"
  >amazing</mark
>
```

## Configuration

### Global Options (constructor)

| Option           | Type   | Default       | Description                                            |
| ---------------- | ------ | ------------- | ------------------------------------------------------ |
| `animate`        | bool   | `true`        | Set `false` to defer animation for GSAP control        |
| `animationSpeed` | number | `5000`        | Animation duration in ms                               |
| `drawingMode`    | string | `"highlight"` | Default mode for all marks                             |
| `height`         | number | `1`           | Height relative to line height (0.15 = underline)      |
| `offset`         | number | `0`           | Vertical shift (-1 = above, 1 = below text)            |
| `padding`        | number | `0`           | Horizontal padding around text                         |
| `easing`         | string | `"ease"`      | `ease`, `linear`, `ease-in`, `ease-out`, `ease-in-out` |
| `skewX`          | number | `0`           | Horizontal slant                                       |
| `multiLineDelay` | number | `0`           | Delay between line segments (0-1 ratio of speed)       |

### Per-Mode Options

**highlight** — `highlight` object or `data-highlight` attribute:

| Option       | Default | Description                         |
| ------------ | ------- | ----------------------------------- |
| `amplitude`  | `0.25`  | Edge waviness (0 = flat, 1+ = wavy) |
| `wavelength` | `1`     | Wave frequency                      |
| `roughEnds`  | `5`     | Irregularity at start/end           |
| `jitter`     | `0.1`   | Randomness in the wave path         |

**circle** — `circle` object or `data-circle` attribute:

| Option      | Default | Description                                   |
| ----------- | ------- | --------------------------------------------- |
| `curve`     | `0.5`   | Shape: 0 = square, 0.5 = rounded, 1 = ellipse |
| `wobble`    | `0.3`   | Hand-drawn irregularity                       |
| `loops`     | `3`     | Number of overlapping strokes                 |
| `thickness` | `5`     | Line thickness                                |

**burst** — `burst` object or `data-burst` attribute:

| Option       | Default   | Description               |
| ------------ | --------- | ------------------------- |
| `style`      | `"lines"` | `lines`, `curve`, `cloud` |
| `count`      | `10`      | Number of rays/puffs      |
| `power`      | `1`       | Ray length multiplier     |
| `randomness` | `0.5`     | Variation in placement    |

### Per-Element Overrides

Any option can be set per `<mark>` via `data-*` attributes:

```html
<mark
  data-drawing-mode="highlight"
  data-animation-speed="800"
  data-height="0.15"
  data-offset="0.8"
  data-padding="0"
  data-highlight='{"amplitude": 0.2, "wavelength": 5, "roughEnds": 0}'
  data-color="rgba(30, 136, 229, 0.5)"
  >underlined text</mark
>
```

## Named Styles

Define reusable presets and apply them with `data-highlight-style`:

```js
MarkerHighlighter.defineStyle("underline", {
  animationSpeed: 400,
  height: 0.15,
  offset: 0.8,
  padding: 0,
  highlight: { amplitude: 0.2, wavelength: 5, roughEnds: 0 },
});

MarkerHighlighter.defineStyle("redact", {
  drawingMode: "scribble",
  animationSpeed: 300,
  height: 1.2,
});
```

```html
<mark data-highlight-style="underline" data-color="rgba(30, 136, 229, 0.5)">key term</mark>
<mark data-highlight-style="redact" data-color="rgba(0, 0, 0, 0.8)">classified</mark>
```

Define styles before constructing the `MarkerHighlighter` instance.

## Mode-to-Caption Energy Mapping

Match modes to caption energy levels detected by the `hyperframes-captions` skill:

| Caption energy | Recommended mode      | Use for                               |
| -------------- | --------------------- | ------------------------------------- |
| High           | `burst` + `highlight` | Product launches, hype videos         |
| Medium-high    | `circle`              | Key stats, important terms            |
| Medium         | `highlight`           | Standard emphasis, clean professional |
| Medium-low     | `scribble`            | Subtle emphasis, tutorials            |
| Low            | `sketchout`           | Contrast with active text             |

## Recipes and Full Example

See [references/examples.md](./references/examples.md) for underline, strikethrough, circled annotation recipes, and a complete composition example with the full GSAP integration pattern.

## CSS+GSAP Fallback (No Library)

For deterministic rendering without the library, see [references/css-patterns.md](./references/css-patterns.md) — pure CSS+GSAP implementations of all five modes. Fully seekable and timeline-controlled, but without the hand-drawn canvas aesthetic.

## HyperFrames Integration Notes

- **One highlighter per container.** The library clears ALL `.highlight` divs from the parent element on init. Don't create multiple MarkerHighlighter instances on sibling marks in the same `<p>` — use one instance for the whole container.
- **No visible background-color on marks.** Use `data-color` + `data-original-bgcolor` to pass colors without a visible CSS flash. Set `mark { background-color: transparent }` in CSS.
- **Canvas pre-draw + clear pattern.** Init with `animate: false` (pre-draws statically), hide canvases, then clear + show + `reanimateMark()` at trigger time. This gives clean animated reveals.
- **Rewind support.** Use `onReverseComplete` to hide the highlight div when the timeline seeks backward past the trigger point.
- **rAF-based animation.** Highlights are not GSAP-driven and not seekable mid-stroke. Scrubbing won't show partial draw progress.
- The canvas overlay is positioned absolutely relative to the mark's parent. The library sets `position: relative` on the container's parent automatically.
- For multi-line text, the library creates separate canvas segments per line and animates them sequentially when `multiLineDelay > 0`.
- Nested `<mark>` tags work — inner marks render on top of outer marks via z-index layering.
