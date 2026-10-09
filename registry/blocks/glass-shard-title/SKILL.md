---
name: glass-shard-title
description: Glass shards fly in through fog and tile themselves into the headline. HyperFrames block, 1920×1080, 12.16s, 19 variables.
---

# Glass Shard Title

Voronoi-cut glass panes fly in from depth, rotating, and land as a tiled silhouette of the headline, then fly out past the camera. Each shard is a Sutherland–Hodgman clip of a jittered blob against its Voronoi cell, so the pieces always cover the type. Glass and matcap surfaces get per-fragment fog; the z-flight is decoupled from the ease so shards visibly traverse it. Tile count 1 gives a single pane.

Composition id: `glass-shard-title`. Duration 12.16 s at 30 fps, 1920×1080.

## Files

- `glass-shard-title.html` (16 KB)
- `assets/ferndale_studio_01_1k.hdr` (1.6 MB)
- `assets/fonts/Geist-Bold.ttf` (65 KB)
- `assets/fonts/Geist-Regular.ttf` (65 KB)
- `assets/fonts/Geist-SemiBold.ttf` (65 KB)
- `assets/fonts/Geist-OFL.txt` (4 KB)
- `assets/fonts/cormorant-garamond.woff2` (37 KB)
- `assets/fonts/CormorantGaramond-OFL.txt` (4 KB)
- `assets/glass-main.js` (549 KB)
- `assets/Three-LICENSE.txt` (1 KB)
- `assets/matcap-1.png` (fetched from the CDN at install)

## Install

Install with `npx hyperframes add glass-shard-title`; by default the files above land under `compositions/glass-shard-title/`. Then mount the block from the host `index.html`:

```html
<div
  data-composition-id="glass-shard-title"
  data-composition-src="compositions/glass-shard-title/glass-shard-title.html"
  data-start="0"
  data-duration="12.16"
  data-track-index="1"
  data-width="1920"
  data-height="1080"
></div>
```

Render with custom values by targeting the composition file directly:

```sh
npx --yes hyperframes@0.8.12 render 'compositions/glass-shard-title/glass-shard-title.html' --variables '{"headline":"Designed in glass","tileCount":8}'
```

## Variables

Read at runtime via `window.__hyperframes.getVariables()`; declared on the composition root as `data-composition-variables` (single-quoted attribute, plain JSON).

| id               | type   | default               | label / range                                 |
| ---------------- | ------ | --------------------- | --------------------------------------------- |
| `headline`       | string | `"Designed in glass"` | Headline max 40 chars                         |
| `tileCount`      | number | `8`                   | Tiles 1–400 step 1                            |
| `roundness`      | number | `0.4`                 | Roundness (0-1) 0–1 step 0.01                 |
| `bevel`          | number | `0.35`                | Bevel (0-1) 0–1 step 0.01                     |
| `meshSmooth`     | number | `0.6`                 | Surface smoothness (0-1) 0–1 step 0.01        |
| `flyInTime`      | number | `2.3`                 | Fly-in time (s) 0.2–6 step 0.05               |
| `flyOutTime`     | number | `2.4`                 | Fly-out time (s) 0.2–6 step 0.05              |
| `stagger`        | number | `0.27`                | Stagger (0-1) 0–1 step 0.01                   |
| `flyInRotation`  | number | `5`                   | Fly-in rotation (0-60) 0–60 step 0.1          |
| `flyOutRotation` | number | `6`                   | Fly-out rotation (0-6) 0–6 step 0.1           |
| `chaos`          | number | `0.25`                | Outline chaos (0-1) 0–1 step 0.01             |
| `padding`        | number | `1`                   | Edge padding (0-1) 0–1 step 0.01              |
| `sizeVariance`   | number | `0.35`                | Size variance (0-1) 0–1 step 0.01             |
| `gap`            | number | `0.03`                | Tile gap 0–0.3 step 0.002                     |
| `easePow`        | number | `10`                  | Fly-in position ease (1-10) 1–10 step 0.1     |
| `sideDist`       | number | `3`                   | Side fly distance 0–60 step 0.5               |
| `zDist`          | number | `-42`                 | Z fly-from (negative) -400–0 step 2           |
| `zOut`           | number | `14`                  | Z fly-out to (+ = past camera) -400–60 step 2 |
| `fog`            | number | `36`                  | Fog distance (0 = off) 0–400 step 2           |

## Runtime contract

- One paused GSAP timeline registered as `window.__timelines["glass-shard-title"]`.
- Re-syncs on the `hf-seek` CustomEvent; every frame is a closed-form function of time (seeded PRNG only, no rAF loops, no Date.now).
- Renderer: three.js 0.181.2 (bundled), GSAP 3.14.2, Canvas 2D, GLSL shaders, HDR environment, Matcap, Seeded PRNG, d3-delaunay, Shadow maps. Budget roughly 350 MB per live instance; run one at a time.
- External runtime dependencies: `https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js`, `https://cdn.jsdelivr.net/npm/d3-delaunay@6.0.4/dist/d3-delaunay.min.js`.
- Local fonts: assets/fonts/Geist-Regular.ttf, assets/fonts/Geist-SemiBold.ttf, assets/fonts/Geist-Bold.ttf.
- Bundled code is inlined into the composition (assets/glass-main.js); rebuild with esbuild and re-inline after editing the .mjs source.

## Editing rules (from the source project)

1. Keep `data-composition-variables` a single-quoted attribute with plain `"` JSON. Never save it through Studio's Design panel.
2. Do not put `<canvas>` in static markup; create it at runtime.
3. Keep every visual state a function of t; seek-safety is what makes the block renderable.
