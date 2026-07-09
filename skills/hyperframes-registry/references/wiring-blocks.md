# Wiring Blocks

Blocks are standalone compositions with their own `data-composition-id`, dimensions, duration, and a registered animation runtime (anime.js by default, GSAP also supported). Include them in a host composition using `data-composition-src` on a `<div>`.

## Basic wiring

After `hyperframes add data-chart`, wire it into your `index.html`:

```html
<div id="stage" data-composition-id="main" data-width="1920" data-height="1080" data-duration="20">
  <video id="a-roll" src="video.mp4" data-start="0" data-duration="20" data-track-index="0"></video>

  <!-- Block: appears at 2s, plays for 15s, on layer 1 -->
  <div
    data-composition-id="data-chart"
    data-composition-src="compositions/data-chart.html"
    data-start="2"
    data-duration="15"
    data-track-index="1"
    data-width="1920"
    data-height="1080"
  ></div>
</div>
```

## Required attributes

| Attribute              | Description                                                          |
| ---------------------- | -------------------------------------------------------------------- |
| `data-composition-src` | Path to the block HTML file (relative to index.html)                 |
| `data-composition-id`  | Unique ID matching the block's internal composition ID               |
| `data-start`           | When the block appears in the host timeline (seconds)                |
| `data-duration`        | How long the block plays (seconds, at most the block's own duration) |
| `data-track-index`     | Layer ordering, higher numbers render in front                       |
| `data-width`           | Block canvas width (match the block's dimensions)                    |
| `data-height`          | Block canvas height (match the block's dimensions)                   |

## Timeline coordination

The block's internal animation runtime (anime.js or GSAP) runs independently from the host timeline. The HyperFrames runtime loads the sub-composition, finds its registration (`hyperframesAnime` registry or non-default GSAP adapter `window.__timelines`), and seeks the block in sync with the host, offset by `data-start`. You do NOT need to reference the block's timeline in your host's script.

## Positioning blocks

To position a block in a specific area of the screen, add CSS:

```html
<div
  data-composition-id="data-chart"
  data-composition-src="compositions/data-chart.html"
  data-start="2"
  data-duration="15"
  data-track-index="1"
  data-width="1920"
  data-height="1080"
  style="position: absolute; right: 0; top: 0; width: 40%; height: 100%;"
></div>
```

## Multiple blocks

Add additional `<div data-composition-src="...">` siblings with non-overlapping or overlapping `data-start` values. Each block's timeline is independent and seeked in sync by the runtime.
