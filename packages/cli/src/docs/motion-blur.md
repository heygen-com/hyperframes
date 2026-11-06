# Motion Blur

Fast-moving elements get a shutter smear along their path. It is opt-in: nothing blurs until the composition root has `data-motion-blur="on"`.

## Turn it on

- `data-motion-blur` — `on` enables blur; `off` opts out, on the root or on any subtree
- `data-motion-blur-shutter` — shutter angle in degrees, 0-720 (default: 240)
- `data-motion-blur-phase` — when the shutter opens, in degrees of a frame, -360 to 360: 0 opens on the frame (default: centred on the frame, which is minus half the shutter)
- `data-motion-blur-samples` — samples per frame, 2-64 (default: at least 32, sized to the smear)
- `data-motion-blur-events` — `on` runs timeline callbacks while blur looks for movers; needed when motion is set from a `render(t)` callback
- `data-motion-blur-tier` — `auto` (default, draws with `filter`), `filter` or `capture`

The same attributes drive the browser editor preview and `hyperframes render`.

## Two ways it is drawn

- `filter` puts an SVG filter on each mover. Works in any Chrome; costs about nothing with a few movers and more than `capture` with many (a film with 77 movers took about 2.9 times the CPU of no blur); turns and zooms are only softened. `auto` draws with it. It cuts off `::before`/`::after` content outside a mover's box, gives a mover's own `clip-path` or mask hard edges, makes a `position: fixed` child of a `left`-moved mover jump, lets `:last-child` match the `<svg>` it adds to the root, draws a visibility toggle inside the shutter at full strength, and mis-draws `backdrop-filter` on a mover.
- `capture` is opt-in. It redraws each mover along its path, so turns and zooms streak truthfully. Needs a browser with HTML in Canvas. It loses anything drawn in front of a mover, ignores `mix-blend-mode` on movers, and breaks selectors that reach the root through its parent.

## Check and render

- `npx hyperframes check` reports `motion_blur_filter_fallback`, `motion_blur_no_movers` and `motion_blur_unverified`
- `hyperframes render --page-motion-blur off` renders without the composition's blur
- Blur is off for HDR, distributed, and sub-frame-blur renders

Full guide: https://hyperframes.heygen.com/guides/motion-blur
