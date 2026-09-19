---
name: wireframe-portal-title
description: A wireframe portal bursts open, the title comes through, then its letters swap into a second phrase. HyperFrames block, 1920×1080, 8s, 9 variables.
---

# Wireframe Portal Title

Extruded wireframe letterforms are built from the bundled Geist face with a TTF loader and polygon offsetting, then revealed through a portal burst whose chaos is a variable. A second beat swaps the letters into a replacement phrase with whole-word wrapping and auto type size, staggered with a tunable easing curve and settle glitch, with optional depth fog.

Composition id: `wireframe-portal-title`. Duration 8 s at 30 fps, 1920×1080.

## Files

- `wireframe-portal-title.html` (63 KB)
- `assets/fonts/Geist-Bold.ttf` (65 KB)
- `assets/fonts/Geist-Regular.ttf` (65 KB)
- `assets/fonts/Geist-SemiBold.ttf` (65 KB)
- `assets/fonts/Geist-OFL.txt` (4 KB)

## Install

Install with `npx hyperframes add wireframe-portal-title`; the files above land under `compositions/wireframe-portal-title/`. Then mount the block from the host `index.html`:

```html
<div
  data-composition-id="wireframe-portal-title"
  data-composition-src="compositions/wireframe-portal-title/wireframe-portal-title.html"
  data-start="0"
  data-duration="8"
  data-track-index="1"
  data-width="1920"
  data-height="1080"
></div>
```

Render with custom values by targeting the composition file directly:

```sh
npx --yes hyperframes@0.8.12 render 'compositions/wireframe-portal-title/wireframe-portal-title.html' --variables '{"title":"BREAKTHROUGH","replacementPhrase":"Lets do this sir!"}'
```

## Variables

Read at runtime via `window.__hyperframes.getVariables()`; declared on the composition root as `data-composition-variables` (single-quoted attribute, plain JSON).

| id                  | type    | default                      | label / range                                       |
| ------------------- | ------- | ---------------------------- | --------------------------------------------------- |
| `title`             | string  | `"BREAKTHROUGH"`             | Title max 18 chars                                  |
| `replacementPhrase` | string  | `"Lets do this sir!"`        | 3D replacement phrase (auto layout)                 |
| `phraseDuration`    | number  | `1.85`                       | Phrase transition duration (s) 0.65–2.9 step 0.05   |
| `phraseEasing`      | number  | `8`                          | Transition easing (1 gentle – 8 snap) 1–8 step 0.25 |
| `settleGlitch`      | number  | `0.2`                        | Letter settle glitch strength 0–4 step 0.05         |
| `depthFog`          | boolean | `true`                       | Depth fog (early fade always on)                    |
| `subtitle`          | string  | `"HYPERFRAMES PORTAL TITLE"` | Subtitle max 48 chars                               |
| `accent`            | color   | `"#F5C518"`                  | Accent                                              |
| `burstChaos`        | number  | `1`                          | Burst chaos (0-2) 0–2 step 0.01                     |

## Runtime contract

- One paused GSAP timeline registered as `window.__timelines["wireframe-portal-title"]`.
- Re-syncs on the `hf-seek` CustomEvent; every frame is a closed-form function of time (seeded PRNG only, no rAF loops, no Date.now).
- Renderer: three.js 0.181.2, GSAP 3.14.2, Canvas 2D, GLSL shaders, Post-processing, Seeded PRNG, Clipper. Budget roughly 350 MB per live instance; run one at a time.
- External runtime dependencies: `https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js`, `https://cdn.jsdelivr.net/npm/clipper-lib@6.4.2/clipper.js`, `https://cdn.jsdelivr.net/npm/three@0.181.2/build/three.module.js`, `https://cdn.jsdelivr.net/npm/three@0.181.2/examples/jsm/`.
- Local fonts: assets/fonts/Geist-Regular.ttf, assets/fonts/Geist-SemiBold.ttf, assets/fonts/Geist-Bold.ttf.

## Editing rules (from the source project)

1. Keep `data-composition-variables` a single-quoted attribute with plain `"` JSON. Never save it through Studio's Design panel.
2. Do not put `<canvas>` in static markup; create it at runtime.
3. Keep every visual state a function of t; seek-safety is what makes the block renderable.
