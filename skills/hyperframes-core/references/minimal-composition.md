# Minimal Composition

The smallest renderable HyperFrames composition — a standalone (top-level) root with one clip and one tween:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>Minimal HyperFrames Composition</title>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      body {
        margin: 0;
        background: #0b0f14;
        color: white;
        font-family: Inter, system-ui, sans-serif;
      }
      #root {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
      }
      .clip {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
      }
      h1 {
        margin: 0;
        font-size: 96px;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-width="1920"
      data-height="1080"
      data-duration="5"
    >
      <section id="title-card" class="clip" data-start="0" data-duration="5">
        <h1 id="title">Hello HyperFrames</h1>
      </section>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.from("#title", { y: 48, opacity: 0, duration: 0.6, ease: "power3.out" }, 0.2);
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
```

What the runtime actually requires:

- Root `<div>` with `data-composition-id`, `data-width`, `data-height`. Root `data-start="0"` is written above by convention and every shipped block has it, but the runtime stamps it when absent, so it is not required.
- A duration source: root `data-duration` (as above), or a GSAP timeline, or media, or an adapter that can infer one.
- Timed elements carry `data-start` plus a duration. That attribute alone is what makes an element a clip: `class="clip"` is a layout and tooling convention, and `data-track-index` is a Studio display lane. Neither is required, and a composition with no clips at all renders fine.
- A GSAP timeline created paused and registered on `window.__timelines["<composition-id>"]`.

Everything else in the skeleton is ordinary HTML and CSS: the `#root` box, `.clip` positioning, and fonts are yours to choose.

This pattern is **standalone** (top-level `index.html`) — no `<template>` wrapper around the root. For sub-compositions (files loaded by `data-composition-src`), see `sub-compositions.md`.
