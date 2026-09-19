---
name: code-slice-hero
description: A tiled headline surface flips cell by cell under a sweeping depth field to reveal the rear headline. HyperFrames block, 1920×1080, 8s, 18 variables.
---

# Code Slice Hero

A full square-tile surface carries one seamless headline. An imaginary cursor crosses the surface; nearby tiles respond to its Gaussian depth field with lift and tilt, and only the cells intersecting either headline silhouette turn over to reveal the rear headline. The whole grid is one instanced WebGL 2 draw with a shared front/rear texture pair, plus a batched projected-shadow pass. Copy, text size and square cell size are independent, so tiles never stretch. Sweep direction, easing strength, cursor radius, falloff, depth, bounce and shadow are all variables.

Composition id: `code-slice-hero`. Duration 8 s at 30 fps, 1920×1080.

## Files

- `code-slice-hero.html` (24 KB)
- `assets/Geist-Bold.ttf` (65 KB)
- `assets/Geist-OFL.txt` (4 KB)
- `assets/gsap-3.14.2.min.js` (128 KB)
- `assets/GSAP-NOTICE.txt` (1 KB)
- `shadows.js` (10 KB)
- `surface.js` (8 KB)

## Install

Install with `npx hyperframes add code-slice-hero`; the files above land under `compositions/code-slice-hero/`. Then mount the block from the host `index.html`:

```html
<div
  data-composition-id="code-slice-hero"
  data-composition-src="compositions/code-slice-hero/code-slice-hero.html"
  data-start="0"
  data-duration="8"
  data-track-index="1"
  data-width="1920"
  data-height="1080"
></div>
```

Render with custom values by targeting the composition file directly:

```sh
npx --yes hyperframes@0.8.12 render 'compositions/code-slice-hero/code-slice-hero.html' --variables '{"headline":"MAKE IT","reverseHeadline":"MATTER."}'
```

## Variables

Read at runtime via `window.__hyperframes.getVariables()`; declared on the composition root as `data-composition-variables` (single-quoted attribute, plain JSON).

| id                  | type   | default           | label / range                                     |
| ------------------- | ------ | ----------------- | ------------------------------------------------- | -------------- |
| `headline`          | string | `"MAKE IT"`       | Copy · Front headline max 32 chars                |
| `reverseHeadline`   | string | `"MATTER."`       | Copy · Rear headline max 32 chars                 |
| `direction`         | enum   | `"left-to-right"` | Motion · Sweep direction (left-to-right           | right-to-left) |
| `sweepDuration`     | number | `4.2`             | Motion · Sweep duration 2.6–4.5 step 0.05         |
| `sweepEaseStrength` | number | `3`               | Motion · Sweep easing strength 0–3 step 0.05      |
| `flipDuration`      | number | `0.75`            | Motion · Each tile flip 0.65–1.65 step 0.05       |
| `cursorRadius`      | number | `210`             | Cursor · Influence radius 160–480 step 10         |
| `cursorFalloff`     | number | `1.4`             | Cursor · Influence falloff 0.4–3.5 step 0.05      |
| `cursorDepth`       | number | `80`              | Cursor · Depth (+ toward camera) -320–320 step 10 |
| `tiltStrength`      | number | `55`              | Cursor · Pull / tilt strength 0–55 step 1         |
| `noiseStrength`     | number | `2`               | Motion · Organic variation 0–2 step 0.05          |
| `flipBounce`        | number | `0.15`            | Motion · Elastic flip bounce 0–0.8 step 0.05      |
| `cellSize`          | number | `112`             | Slices · Square cell size 24–120 step 4           |
| `formationScale`    | number | `1`               | Slices · Local formation scale 0.94–1 step 0.001  |
| `fontSize`          | number | `310`             | Type · Maximum size 160–480 step 5                |
| `behindColor`       | color  | `"#212121"`       | Surface · Behind-tile background                  |
| `shadowStrength`    | number | `0.19`            | Surface · Cast shadow strength 0–0.65 step 0.01   |
| `shadowSoftness`    | number | `4`               | Surface · Cast shadow softness 0.5–4 step 0.1     |

## Runtime contract

- One paused GSAP timeline registered as `window.__timelines["code-slice-hero"]`.
- Re-syncs on the `hf-seek` CustomEvent; every frame is a closed-form function of time (seeded PRNG only, no rAF loops, no Date.now).
- Renderer: GSAP, Canvas 2D, Seeded PRNG.
- External runtime dependencies: none (served locally).
- Local fonts: assets/Geist-Bold.ttf.

## Editing rules (from the source project)

1. Keep `data-composition-variables` a single-quoted attribute with plain `"` JSON. Never save it through Studio's Design panel.
2. Do not put `<canvas>` in static markup; create it at runtime.
3. Keep every visual state a function of t; seek-safety is what makes the block renderable.
