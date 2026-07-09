# The demo.html Convention

## Why components ship demo.html

Every component in the registry ships a companion `demo.html` file alongside its snippet. The demo serves two purposes:

1. **Preview fixture**: the CI preview pipeline renders the demo to generate thumbnail images and preview videos for the catalog docs page.

2. **Usage example**: the demo shows the component effect applied to representative content, serving as a working reference.

## Demo structure

A demo is a complete, standalone HTML composition:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>Component Name Demo</title>
    <script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
    <style>
      /* reset + canvas size */
    </style>
  </head>
  <body>
    <div data-composition-id="<name>-demo" data-width="1920" data-height="1080" data-duration="N">
      <!-- Demo content showing the effect -->
      <!-- Component snippet inlined here -->
    </div>
    <script>
      const tl = anime.createTimeline({ autoplay: false });
      // anime.js timeline demonstrating the effect
      hyperframesAnime.register("<name>-demo", tl, { labels: {} });
    </script>
  </body>
</html>
```

Key conventions:

- `data-composition-id` is `<component-name>-demo` to avoid collisions
- The demo is self-contained; all CSS and JS from the snippet is inlined
- The anime.js timeline is registered with `hyperframesAnime.register("<name>-demo", tl, { labels: {} })`
- Duration should be long enough to showcase the effect, typically 5-8 seconds

> **Non-default GSAP adapter path.** Existing GSAP demos can keep a paused GSAP timeline and GSAP adapter registration, but new demos default to anime.js.

## Blocks don't need demo.html

Blocks are already standalone compositions that can be rendered directly. Only components need the demo wrapper.

## Demos are not installed

The `demo.html` is NOT installed by `hyperframes add`. It exists only in the registry for preview generation and as a reference.
