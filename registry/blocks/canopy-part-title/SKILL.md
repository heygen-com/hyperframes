---
name: canopy-part-title
description: Leaves sweep through the frame and part to reveal the headline. HyperFrames block, 1920×1080, 12s, 11 variables.
---

# Canopy Part Title

A dense canopy of textured leaves sweeps across the frame with shallow depth of field, then parts to uncover the first headline; a second, depth-lifted batch carries the second headline past the camera. A handful of leaves stay behind on the type and keep a light breeze. Font, weight, size, letter spacing, leaf counts, sweep speed and the retained-leaf breeze are variables.

Composition id: `canopy-part-title`. Duration 12 s at 30 fps, 1920×1080.

## Files

- `canopy-part-title.html` (57 KB)
- `assets/leaf-surface-color.webp` (64 KB)
- `assets/leaf-surface-normal.webp` (136 KB)

## Install

Install with `npx hyperframes add canopy-part-title`; by default the files above land under `compositions/canopy-part-title/`. Then mount the block from the host `index.html`:

```html
<div
  data-composition-id="canopy-part-title"
  data-composition-src="compositions/canopy-part-title/canopy-part-title.html"
  data-start="0"
  data-duration="12"
  data-track-index="1"
  data-width="1920"
  data-height="1080"
></div>
```

Render with custom values by targeting the composition file directly:

```sh
npx --yes hyperframes@0.8.12 render 'compositions/canopy-part-title/canopy-part-title.html' --variables '{"headline1":"Understory","headline2":"Move slowly"}'
```

## Variables

Read at runtime via `window.__hyperframes.getVariables()`; declared on the composition root as `data-composition-variables` (single-quoted attribute, plain JSON).

| id               | type   | default         | label / range                            |
| ---------------- | ------ | --------------- | ---------------------------------------- |
| `headline1`      | string | `"Understory"`  | Headline 1                               |
| `headline2`      | string | `"Move slowly"` | Headline 2                               |
| `font`           | string | `"Helvetica"`   | Headline font                            |
| `fontWeight`     | number | `900`           | Font weight 100–900 step 100             |
| `fontSize`       | number | `1`             | Font size (1 = auto-fit) 0.3–2 step 0.01 |
| `letterSpacing`  | number | `0.01`          | Letter spacing (em) -0.2–1 step 0.01     |
| `background`     | color  | `"#020805"`     | Background                               |
| `leafCount`      | number | `170`           | Leaves per sweep 40–320 step 1           |
| `stayCount`      | number | `5`             | Leaves left behind 0–20 step 1           |
| `sweepSpeed`     | number | `1`             | Sweep speed 0.3–3 step 0.05              |
| `retainedBreeze` | number | `1`             | Retained leaf breeze 0–2 step 0.05       |

## Runtime contract

- One paused GSAP timeline registered as `window.__timelines["canopy-part-title"]`.
- Re-syncs on the `hf-seek` CustomEvent; every frame is a closed-form function of time (seeded PRNG only, no rAF loops, no Date.now).
- Renderer: three.js 0.170.0, GSAP 3.14.2, Canvas 2D, Post-processing, Seeded PRNG, Shadow maps. Budget roughly 350 MB per live instance; run one at a time.
- External runtime dependencies: `https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js`, `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js`, `https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/postprocessing/EffectComposer.js`, `https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/postprocessing/RenderPass.js`, `https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/postprocessing/BokehPass.js`.
- Web fonts from Google Fonts: Gelasio.

## Editing rules (from the source project)

1. Keep `data-composition-variables` a single-quoted attribute with plain `"` JSON. Never save it through Studio's Design panel.
2. Do not put `<canvas>` in static markup; create it at runtime.
3. Keep every visual state a function of t; seek-safety is what makes the block renderable.
