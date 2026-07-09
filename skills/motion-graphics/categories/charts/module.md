# charts - category module

Animated **data-viz** from data. Asset-free (the "input" is the data). "One chart, one message" for short durations.

## Plan (Director)

`content`: `{ type: bar|line|pie|race|pct, data[], labels[], headline, axes: bool }`. For `race`, data must be cumulative/time-staged.

## Vocabulary / leans on

- Block: **`data-chart`** (animated **bar + line**, staggered reveal, value labels - proven: borrowed + customized + rendered to MP4 in the prototype `charts-demo`).
- Gaps (hand-author): **pie / donut, bar-chart-race, ring/%** - `data-chart` doesn't cover these. Use D3/visx for data -> geometry + anime.js for motion.
- Signature animations: bar stagger-grow · line `stroke-dashoffset` draw-on · pie radial sweep · ring fill · KPI count-up · race reorder.

## Build (reuse-first)

Reuse `data-chart`: `npx hyperframes add data-chart` → edit the data arrays + scales + headline/labels + palette in place (its data is baked in the script, not a `--variables` flag). Axes hidden by default; show muted only when magnitude is the message. Determinism: drive any animation from the seek clock, never wall-clock.

## Dashboard-skeleton variant

For a **product-dashboard** case: lay out a skeleton dashboard - a top bar with a **real test logo** (e.g. the hyperframes logo in `samples/_assets/`) + a title, then a grid of 3–4 **KPI cards** (each a `stat` count-up) + one `data-chart` panel. Reveal order: header/logo in → cards stagger in → the chart animates. Composes the `stat` + `charts` primitives inside a dashboard frame; the logo is a frozen project-local asset.
