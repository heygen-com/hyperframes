---
name: orbit-card
description: A single feature card orbits a dot sphere on approved Blender camera motion. HyperFrames block, 1920×1080, 10s, 4 variables.
---

# Orbit Card

One centred feature card with a circular cut-out framing a dot sphere. The card enters from the right (0.25–1.80 s), holds with a subtle bob and depth drift, orbits a full turn around the sphere's centre (smoothstep between 4.97 and 5.97 s), and exits left (7.35–8.55 s). The camera path and card F-curves are exported from the approved Blender rig at 30 fps and interpolated; the sphere keeps its own translation and a constant spin. Title, description, accent and the orbit angle are variables; 180° and 720° work without touching keys.

Composition id: `orbit-card`. Duration 10 s at 30 fps, 1920×1080.

## Files

- `orbit-card.html` (3 KB)
- `assets/Archivo-LICENSE.txt` (4 KB)
- `assets/Three-LICENSE.txt` (1 KB)
- `assets/archivo-regular.ttf` (108 KB)
- `assets/archivo-semibold.ttf` (109 KB)
- `assets/gsap-3.14.2.min.js` (128 KB)
- `assets/GSAP-NOTICE.txt` (1 KB)
- `assets/orbit-motion.js` (59 KB)
- `assets/orbit-scene.js` (8 KB)
- `assets/three.core.min.js` (554 KB)
- `assets/three.module.min.js` (468 KB)

## Install

Install with `npx hyperframes add orbit-card`; by default the files above land under `compositions/orbit-card/`. Then mount the block from the host `index.html`:

```html
<div
  data-composition-id="orbit-card"
  data-composition-src="compositions/orbit-card/orbit-card.html"
  data-start="0"
  data-duration="10"
  data-track-index="1"
  data-width="1920"
  data-height="1080"
></div>
```

Render with custom values by targeting the composition file directly:

```sh
npx --yes hyperframes@0.8.12 render 'compositions/orbit-card/orbit-card.html' --variables '{"feature1Title":"Always in sync","feature1Desc":"Changes reach every screen the moment they happen."}'
```

## Variables

Read at runtime via `window.__hyperframes.getVariables()`; declared on the composition root as `data-composition-variables` (single-quoted attribute, plain JSON).

| id                 | type   | default                                                | label / range                          |
| ------------------ | ------ | ------------------------------------------------------ | -------------------------------------- |
| `feature1Title`    | string | `"Always in sync"`                                     | Card title max 28 chars                |
| `feature1Desc`     | string | `"Changes reach every screen the moment they happen."` | Card description max 110 chars         |
| `feature1Accent`   | color  | `"#4cc9ff"`                                            | Card accent                            |
| `cardOrbitDegrees` | number | `360`                                                  | Card orbit degrees -36000–36000 step 1 |

## Runtime contract

- One paused GSAP timeline registered as `window.__timelines["orbit-card"]`.
- Re-syncs on the `hf-seek` CustomEvent; every frame is a closed-form function of time (seeded PRNG only, no rAF loops, no Date.now).
- Renderer: GSAP.
- External runtime dependencies: none (served locally).
- Local fonts: assets/archivo-regular.ttf, assets/archivo-semibold.ttf.

## Editing rules (from the source project)

1. Keep `data-composition-variables` a single-quoted attribute with plain `"` JSON. Never save it through Studio's Design panel.
2. Do not put `<canvas>` in static markup; create it at runtime.
3. Keep every visual state a function of t; seek-safety is what makes the block renderable.
