---
name: cuboid-carousel
description: A chain of bevelled cuboids rides a travelling wave as a content carousel. HyperFrames block, 1920×1080, 6.666666666666667s, 40 variables.
---

# Cuboid Carousel

Rounded, bevelled cuboids carrying card content fly in from the right as one rigid group, cruise with a per-cuboid rotation stagger, decelerate to a hero hold, then exit left. Spacing is derived from the cuboid dimensions and the largest reachable X half-extent, so cuboids can never overlap. Forty-nine variables carry the original DialKit schema: geometry, materials, lights, shadows, backdrop, camera and every segment duration and easing. Cards come from the built-in list or a JSON variable.

Composition id: `cuboid-carousel`. Duration 6.666666666666667 s at 30 fps, 1920×1080.

## Files

- `cuboid-carousel.html` (38 KB)
- `assets/Three-LICENSE.txt` (1 KB)
- `assets/addons/environments/RoomEnvironment.js` (5 KB)
- `assets/addons/utils/BufferGeometryUtils.js` (36 KB)
- `assets/cuboid-motion.js` (593 KB)
- `assets/gsap-3.14.2.min.js` (128 KB)
- `assets/GSAP-NOTICE.txt` (1 KB)
- `assets/three.core.min.js` (554 KB)
- `assets/three.module.min.js` (468 KB)

## Install

Install with `npx hyperframes add cuboid-carousel`; the files above land under `compositions/cuboid-carousel/`. Then mount the block from the host `index.html`:

```html
<div
  data-composition-id="cuboid-carousel"
  data-composition-src="compositions/cuboid-carousel/cuboid-carousel.html"
  data-start="0"
  data-duration="6.666666666666667"
  data-track-index="1"
  data-width="1920"
  data-height="1080"
></div>
```

Render with custom values by targeting the composition file directly:

```sh
npx --yes hyperframes@0.8.12 render 'compositions/cuboid-carousel/cuboid-carousel.html' --variables '{"cardsJson":"","heroCard":4}'
```

## Variables

Read at runtime via `window.__hyperframes.getVariables()`; declared on the composition root as `data-composition-variables` (single-quoted attribute, plain JSON).

| id                  | type   | default     | label / range                                        |
| ------------------- | ------ | ----------- | ---------------------------------------------------- |
| `cardsJson`         | string | `""`        | Content · Cards JSON (optional, see CARDS in source) |
| `heroCard`          | number | `4`         | Content · Hero card (1-based) 1–12 step 1            |
| `count`             | number | `8`         | Content · Repeating card count 1–12 step 1           |
| `gap`               | number | `0.01`      | Layout · Extra gap between cuboids 0–1.5 step 0.005  |
| `cuboidWidth`       | number | `1.7`       | Cuboid · Width 0.3–5 step 0.01                       |
| `cuboidHeight`      | number | `2.4`       | Cuboid · Height 0.3–6 step 0.01                      |
| `cuboidDepth`       | number | `0.14`      | Cuboid · Thickness (depth) 0.02–2 step 0.01          |
| `cornerRadius`      | number | `0.105`     | Cuboid · Corner radius 0–0.6 step 0.005              |
| `bevelSize`         | number | `0.03`      | Cuboid · Bevel size (edge chamfer) 0–0.3 step 0.001  |
| `bevelThickness`    | number | `0.04`      | Cuboid · Bevel thickness 0–0.3 step 0.001            |
| `smoothness`        | number | `32`        | Cuboid · Smoothness (segments) 1–32 step 1           |
| `bodyColor`         | color  | `"#242424"` | Cuboid · Body colour                                 |
| `roughness`         | number | `0.6`       | Cuboid · Roughness 0–1 step 0.01                     |
| `metalness`         | number | `0.4`       | Cuboid · Metalness 0–1 step 0.01                     |
| `heroScale`         | number | `1`         | Hero · Isolated scale 1–1.6 step 0.01                |
| `heroFillIntensity` | number | `0.55`      | Hero · Face light intensity 0–2 step 0.05            |
| `heroExitX`         | number | `288`       | Hero · Exit X rotation degrees -720–720 step 1       |
| `heroExitY`         | number | `-234`      | Hero · Exit Y rotation degrees -720–720 step 1       |
| `heroExitZ`         | number | `198`       | Hero · Exit Z rotation degrees -720–720 step 1       |
| `ambientIntensity`  | number | `0.35`      | Lights · Ambient intensity 0–4 step 0.01             |
| `ambientColor`      | color  | `"#ffffff"` | Lights · Ambient colour                              |
| `topIntensity`      | number | `3.1`       | Lights · Top rig intensity 0–12 step 0.05            |
| `topColor`          | color  | `"#ffffff"` | Lights · Top rig colour                              |
| `bottomIntensity`   | number | `2.15`      | Lights · Bottom rig intensity 0–12 step 0.05         |
| `bottomColor`       | color  | `"#ffcaad"` | Lights · Bottom rig colour                           |
| `keyIntensity`      | number | `5`         | Lights · Key rig intensity 0–12 step 0.05            |
| `keyColor`          | color  | `"#ffe9d6"` | Lights · Key rig colour                              |
| `shadowRadius`      | number | `44.5`      | Shadows · Softness at map size 2048 0–50 step 0.5    |
| `shadowMapSize`     | number | `2048`      | Shadows · Map size 512–4096 step 256                 |
| `backdrop`          | color  | `"#0b0d13"` | Background · Colour                                  |
| `cameraFov`         | number | `11`        | Camera · Initial Field of view 10–90 step 0.5        |
| `cameraX`           | number | `-1.65`     | Camera · Initial X -20–20 step 0.05                  |
| `cameraY`           | number | `8.5`       | Camera · Initial Y -20–20 step 0.05                  |
| `cameraZ`           | number | `-8.508708` | Camera · Initial Z (distance) -20–50 step 0.1        |
| `cameraSettleFrame` | number | `70`        | Camera · Settle frame (30 fps) 20–90 step 1          |
| `handheldStrength`  | number | `1`         | Camera · Handheld hold strength 0–1 step 0.05        |
| `cameraTargetFov`   | number | `34`        | Camera target · Field of view 10–90 step 0.5         |
| `cameraTargetX`     | number | `-7.25`     | Camera target · X -20–20 step 0.05                   |
| `cameraTargetY`     | number | `1.15`      | Camera target · Y -20–20 step 0.05                   |
| `cameraTargetZ`     | number | `6.2`       | Camera target · Z 2–50 step 0.1                      |

## Runtime contract

- One paused GSAP timeline registered as `window.__timelines["cuboid-carousel"]`.
- Re-syncs on the `hf-seek` CustomEvent; every frame is a closed-form function of time (seeded PRNG only, no rAF loops, no Date.now).
- Renderer: WebGL, GSAP, Canvas 2D, PMREM, Shadow maps. Budget roughly 350 MB per live instance; run one at a time.
- External runtime dependencies: `./assets/three.module.min.js`, `./assets/addons/`.
- Web fonts from Google Fonts: Inter.

## Editing rules (from the source project)

1. Keep `data-composition-variables` a single-quoted attribute with plain `"` JSON. Never save it through Studio's Design panel.
2. Do not put `<canvas>` in static markup; create it at runtime.
3. Keep every visual state a function of t; seek-safety is what makes the block renderable.
