# Motion Blur

Fast-moving elements get a shutter smear along their path. It is opt-in: nothing blurs until the composition root has `data-motion-blur="on"`.

## Turn it on

- `data-motion-blur` — `on` enables blur; `off` opts out, on the root or on any subtree
- `data-motion-blur-shutter` — shutter angle in degrees, 0-720 (default: 240)
- `data-motion-blur-samples` — samples per frame, 2-64 (default: at least 32, sized to the smear)
- `data-motion-blur-events` — `on` runs timeline callbacks while blur looks for movers; needed when motion is set from a `render(t)` callback
- `data-motion-blur-tier` — `auto` (default), `capture` or `filter`

The same attributes drive the browser editor preview and `hyperframes render`.

## Two ways it is drawn

- `capture` redraws each mover along its path, so turns and zooms smear truthfully. Needs a browser with HTML in Canvas.
- `filter` puts an SVG filter on each mover. Works in any Chrome and costs little; turns and zooms are only softened.

`auto` uses `filter` when every mover only translates and `capture` when anything turns or scales.

## Check and render

- `npx hyperframes check` reports `motion_blur_filter_fallback`, `motion_blur_no_movers` and `motion_blur_unverified`
- `hyperframes render --page-motion-blur off` renders without the composition's blur
- Blur is off for HDR, distributed, and sub-frame-blur renders

Full guide: https://hyperframes.heygen.com/guides/motion-blur
