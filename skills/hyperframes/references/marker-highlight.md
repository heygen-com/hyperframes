# Marker Highlight

Animated canvas-based text highlighting using MarkerHighlight.js. Wraps text in `<mark>` tags and renders effects (marker pen, circle, burst, scribble, sketchout) on a canvas overlay without modifying text DOM.

The library runs its own requestAnimationFrame loop — **not** GSAP-driven. Use `tl.call()` to trigger at specific timeline points.

## Required Script

Download and convert to global script:

```bash
curl -sL "https://cdn.jsdelivr.net/gh/Robincodes-Sandbox/marker-highlight@main/dist/marker-highlight.min.js" \
  | sed 's/export{[^}]*};$/window.MarkerHighlighter=W;/' > marker-highlight.global.js
```

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script src="marker-highlight.global.js"></script>
```

## Color Setup

Set via `data-color`, copy to `data-original-bgcolor` before constructing. Never set `background-color` in CSS.

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
document
  .querySelectorAll("mark[data-color]")
  .forEach((m) => m.setAttribute("data-original-bgcolor", m.getAttribute("data-color")));
```

## GSAP Integration Pattern

ONE MarkerHighlighter per container with `animate: false`, hide all canvases, then clear+show+reanimate per mark at trigger time.

```js
var hl = new MarkerHighlighter(document.getElementById("text-container"), {
  animate: false,
  animationSpeed: 800,
  padding: 0.3,
  highlight: { amplitude: 0.3, wavelength: 5 },
});

setTimeout(function () {
  document.querySelectorAll(".highlight").forEach((div) => (div.style.opacity = "0"));
}, 100);

function addHighlight(highlighter, markId, time) {
  tl.to(
    {},
    {
      duration: 0.001,
      onStart: function () {
        var mark = document.getElementById(markId);
        var ref = mark.getAttribute("data-mark-ref");
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
        mark.parentElement
          .querySelectorAll('.highlight[data-mark-id="' + ref + '"]')
          .forEach((div) => (div.style.opacity = "0"));
      },
    },
    time,
  );
}

addHighlight(hl, "m1", 1.0);
```

## Drawing Modes

| Mode        | Effect                       | Best for                   |
| ----------- | ---------------------------- | -------------------------- |
| `highlight` | Wavy marker stroke (default) | Phrases, key terms         |
| `circle`    | Hand-drawn ellipse           | Single words, annotations  |
| `burst`     | Radiating lines/curves/puffs | Excitement, energy         |
| `scribble`  | Chaotic scribble             | Crossing out, messy energy |
| `sketchout` | Rough rectangle outline      | Boxed callouts, blueprint  |

```html
<mark data-drawing-mode="circle" data-color="rgba(229, 57, 53, 0.6)">critical</mark>
<mark
  data-drawing-mode="burst"
  data-burst='{"style":"cloud","count":20}'
  data-color="rgba(255, 220, 50, 0.5)"
  >amazing</mark
>
```

## Configuration

### Global (constructor)

| Option           | Default       | Description               |
| ---------------- | ------------- | ------------------------- |
| `animate`        | `true`        | `false` to defer for GSAP |
| `animationSpeed` | `5000`        | Duration in ms            |
| `drawingMode`    | `"highlight"` | Default mode              |
| `height`         | `1`           | Relative to line height   |
| `offset`         | `0`           | Vertical shift            |
| `padding`        | `0`           | Horizontal padding        |

### Per-Mode

**highlight**: `amplitude` (0.25), `wavelength` (1), `roughEnds` (5), `jitter` (0.1)
**circle**: `curve` (0.5), `wobble` (0.3), `loops` (3), `thickness` (5)
**burst**: `style` ("lines"/"curve"/"cloud"), `count` (10), `power` (1), `randomness` (0.5)

### Named Styles

```js
MarkerHighlighter.defineStyle("underline", {
  animationSpeed: 400,
  height: 0.15,
  offset: 0.8,
  padding: 0,
  highlight: { amplitude: 0.2, wavelength: 5, roughEnds: 0 },
});
```

## Mode-to-Caption Energy Mapping

| Energy      | Mode                  | Use for             |
| ----------- | --------------------- | ------------------- |
| High        | `burst` + `highlight` | Launches, hype      |
| Medium-high | `circle`              | Key stats, terms    |
| Medium      | `highlight`           | Standard emphasis   |
| Medium-low  | `scribble`            | Subtle, tutorials   |
| Low         | `sketchout`           | Contrast, blueprint |

## Notes

- One highlighter per container (clears all `.highlight` divs on init)
- Canvas pre-draw + clear pattern for clean reveals
- rAF-based — not seekable mid-stroke
- Use `onReverseComplete` for rewind support

For CSS+GSAP fallback (no library, fully seekable), see [css-patterns.md](css-patterns.md).
For full examples, see [examples.md](examples.md).
