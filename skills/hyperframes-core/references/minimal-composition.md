# Minimal Composition

The smallest renderable HyperFrames composition: a standalone (top-level) root with host media, one title clip, and one anime.js tween:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: #0b0f14;
      }
      body {
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
      data-width="1920"
      data-height="1080"
      data-duration="5"
    >
      <video
        id="a-roll"
        class="clip"
        src="assets/demo.mp4"
        muted
        playsinline
        data-start="0"
        data-duration="5"
        data-track-index="0"
        style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover"
      ></video>
      <audio
        id="a-roll-audio"
        src="assets/demo.mp4"
        data-start="0"
        data-duration="5"
        data-track-index="2"
        data-volume="1"
      ></audio>

      <section id="title-card" class="clip" data-start="0" data-duration="5" data-track-index="1">
        <h1 id="title">Hello HyperFrames</h1>
      </section>
    </div>
    <script>
      const tl = anime.createTimeline({ autoplay: false });
      tl.add(
        "#title",
        { translateY: [48, 0], opacity: [0, 1], duration: 600, ease: "outQuart" },
        200,
      );
      hyperframesAnime.register("main", tl, { labels: { intro: 0 } });
    </script>
  </body>
</html>
```

Required elements:

- Root `<div>` with `data-composition-id`, `data-width`, `data-height`, `data-duration`
- At least one clip (any element with `data-start`, `data-duration`, `data-track-index`)
- Anime.js timeline created with `autoplay: false`, registered with `hyperframesAnime.register("<composition-id>", tl, { labels })`
- Host media as direct root children when the composition contains `<video>` or `<audio>`

This pattern is **standalone** (top-level `index.html`), with no `<template>` wrapper around the root. For sub-compositions (files loaded by `data-composition-src`), see `sub-compositions.md`.
