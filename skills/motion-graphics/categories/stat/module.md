# stat — category module

A single **hero number** reveal. Asset-free (the "input" is the number). ~4–6s.

Read [data in motion](../../../hyperframes-creative/references/data-in-motion.md) before planning or building the number reveal.

## Plan (Director)

`content`: `{ value, prefix ($), suffix (% / x / K-M-B), label, ring: bool }`. Envelope: bold display font, restrained palette + one accent.

## Vocabulary / leans on

- Block: **`apple-money-count`** (finance-flavoured: $ counter + green flash + money burst + SFX) when it fits; otherwise hand-author.
- Rules: `hyperframes-animation/rules/{counting-dynamic-scale, stat-bars-and-fills}`.
- Primitives: `count_up` (odometer) · `scale_pop` · `ring_fill` (arc) · `label_stagger` (after value) · `hold`.

## Build (reuse-first)

Reuse `apple-money-count` + set target / prefix / suffix / label / palette; **or** hand-author per the proven prototype `v0-stat-motion-demo`:

- **count-up is timeline-driven** — tween a proxy `{v:0}→target` with `onUpdate` writing the formatted number (seek-safe; never setInterval/wall-clock).
- `font-variant-numeric: tabular-nums`; decelerating ease; ~1.2–1.6s then **hold** the final value.
- ring/arc via `stroke-dashoffset`, finishing in sync with the count-up; label fades in **after** the number lands (value → meaning).
