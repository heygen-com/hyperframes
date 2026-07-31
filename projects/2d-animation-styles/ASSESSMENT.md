# 15 × 2D animation styles in HyperFrames

Which classical and digital 2D animation styles this framework can actually
render, graded by how much fighting it takes. Every verdict below is backed by
a beat in the sampler reel (`index.html`) — nothing here is theoretical.

```bash
npx hyperframes lint && npx hyperframes check   # see "Verifying" for the grading caveat
npx hyperframes render . -o style-sampler.mp4
```

## The one constraint that shapes everything

HyperFrames ships a **production-grade painterly shader stack** in
`packages/core/src/runtime/colorGrading.ts` — `kuwahara` (the oil-paint
filter), `crosshatch` and `engraving` (both with `Wave`/`WaveFrequency`
parameters, i.e. hand-wobble), `halftone`, `twoInkPrint`, `dither`, `pixelate`,
`ascii`, `monoScreen`, plus paper simulation and film grain. It is genuinely
good, and it is already installed.

**It only applies to real `<img>` and `<video>` elements.**
`colorGrading.ts:3582` selects `video[data-color-grading], img[data-color-grading]`
and nothing else, and `packages/lint/src/rules/media.ts:270` raises an error if
you attach it anywhere else:

> `data-color-grading on <div> has no effect. The shader runtime only grades
real <video> and <img> elements.`

So a painterly _animated character_ cannot be run through the shipped shaders.
That forks every painterly style into two routes:

| Route                           | How                                                                  | Cost                                                              |
| ------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **A — grade the media**         | Art lives in an `<img>`/`<video>`; the shipped shaders do the work   | Nearly free, best fidelity, but the art cannot animate internally |
| **B — SVG filters on live DOM** | `feTurbulence` + `feDisplacementMap` + `feComposite` on animated SVG | Hand-rolled, but works on a moving rig                            |

Beat 04 is route A. Beat 05 is route B. Compare them in the reel — that
comparison is the single most useful thing in this document.

## Verdicts

### Traditional and art-driven

| #   | Style                 | Verdict                                 | Technique                                                                                                                                                             | Catch                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | --------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | **Cel animation**     | Works, hand-rolled                      | N drawings swapped by zero-duration `tl.set()`; 8 poses held on twos                                                                                                  | No sprite-sheet or PNG-sequence input exists. Either author N `<img class="clip">` tags, or ship a GIF — `packages/producer/src/services/animatedGifPrep.ts` transcodes it to VP9 and swaps in a `<video>`, which lands on the frame-exact path                                                                                                                                                                               |
| 02  | **Rotoscoping**       | Strong                                  | Trace SVG over a video plate                                                                                                                                          | The engine never seeks a live `<video>`: `videoFrameExtractor.ts` pre-decodes to numbered stills at render fps and injects the right frame per capture, so tracing is exact. But `data-playback-rate` is honoured only in preview — it is ignored at render, so no slow-motion reference. No roto tooling of any kind                                                                                                         |
| 03  | **Anime / manga**     | Idiomatic                               | `ease: "steps(n)"`, baked `tl.set()` pose chains, one-frame flash, held blinks                                                                                        | Limited framerate is a house pattern, not a workaround. `data-fps` accepts 1–240 including rationals, so a true 12fps render is legal — but **cloud render only accepts {24, 30, 60}** (`compositionFps.ts:41`), and fps is a root-level attribute, so it is one rate for the whole composition                                                                                                                               |
| 04  | **Paint-on-glass**    | Constrained by design                   | `<img>` + `kuwahara` grading, strength tweened via `--hf-color-grading-kuwahara`                                                                                      | Real paint-on-glass is _temporally accumulative_ — each frame smears the last. HyperFrames requires every frame to be a pure function of `t` under arbitrary seek order, and `adapters/three.md:115` warns off passes depending on frame history. You can fake the look; you cannot accumulate. **Also: kuwahara is an edge-preserving smoother, so it needs textured input — over flat vector fills it is nearly invisible** |
| 05  | **Charcoal / pencil** | Works, and this is the one that matters | `feTurbulence` + `feDisplacementMap` warp, plus a second turbulence thresholded into an alpha mask so pigment drops out mid-stroke                                    | The boil comes from quantising timeline time into 8 buckets/second and re-rolling the turbulence `seed` per bucket — the same trick core uses for film grain (`colorGrading.ts:3103` seeds from `floor(frameTime * 60)`). Interpolating those attributes reads as jelly; jumping them reads as charcoal. **This is the only painterly route that survives on a live animated rig**                                            |
| 06  | **Ink-wash**          | Works                                   | Gooey `feGaussianBlur` → `feColorMatrix` alpha threshold so blobs fuse, `stroke-dasharray` brush draw-on at constant pen speed, `mix-blend-mode: multiply` over paper | `multiply` requires `isolation: isolate` on the composition root or it punches through to the page background                                                                                                                                                                                                                                                                                                                 |

### Digital and computer-generated

| #   | Style                 | Verdict            | Technique                                                                                                                        | Catch                                                                                                                                                                                                                                                 |
| --- | --------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 07  | **Digital vector**    | Native             | Inline SVG under a 14× scale tween                                                                                               | This is the framework's home turf                                                                                                                                                                                                                     |
| 08  | **Flat / minimalist** | Native             | Geometric primitives, flat fills, index-derived stagger                                                                          | —                                                                                                                                                                                                                                                     |
| 09  | **Isometric**         | Works, hand-rolled | 2:1 projection computed in JS (`x += (gx-gy)*64`, `y += (gx+gy)*32`), three fixed face shades, painter's-algorithm build order   | No isometric primitive exists anywhere in the repo — only prose references in a blueprint. The shading _is_ the depth cue; there is no lighting model                                                                                                 |
| 10  | **Pixel art**         | Native             | Author on a real 32×24 grid, `shape-rendering: crispEdges`, `image-rendering: pixelated`, integer-only motion on an 8fps cadence | Also available: `pixelate` + `dither` grading effects, and `skills/media-use/scripts/dither.mjs` does cached error diffusion on images _and_ MP4s                                                                                                     |
| 11  | **Motion graphics**   | Native             | Kinetic type, count-up on a proxy tween                                                                                          | The count must tween a proxy and write `textContent` in `onUpdate`, never animate the text node. And do **not** tween `letterSpacing` — the linter rejects it, because it reflows text and snaps glyphs to integer pixels under seek-by-frame capture |
| 12  | **Line art**          | Native             | `stroke-dasharray`/`stroke-dashoffset` draw-on, `ease: "none"`                                                                   | `fill: none` is load-bearing — any fill appears instantly and destroys the reveal, since dash offset only gates the stroke                                                                                                                            |

### Cut-out and hybrid

| #   | Style                        | Verdict                             | Technique                                                                                                            | Catch                                                                                                                                                                                                                 |
| --- | ---------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 13  | **Digital cut-out / puppet** | Native, and the cheapest per minute | Nested SVG `<g>` joints, GSAP `svgOrigin` pivots, shoulder→elbow drag, baked amplitude envelope driving mouth shapes | Use `svgOrigin` (SVG user space), **not** CSS `transform-origin` — the latter resolves against each group's own bounding box and snaps nested joints to the wrong centre. This is the sustainable choice for a series |
| 14  | **Paper cut-out**            | Works                               | Seeded torn `clip-path: polygon()`, `steps(3)` drops, contact squash, then baked `tl.set()` poses at 8fps            | The discreteness _is_ the medium — smooth easing kills it instantly                                                                                                                                                   |
| 15  | **Collage**                  | Works                               | Layered torn chips, `mix-blend-mode: multiply`, seeded crooked rotation, `steps(2)` landings                         | `multiply` is what makes overlaps read as physical layered material rather than stacked opaque rectangles                                                                                                             |

## Gaps worth knowing before you commit to a style

- **No MorphSVGPlugin, no DrawSVGPlugin.** Club GSAP plugins; only core GSAP is
  vendored (`skills/talking-head-recut/assets/vendor/gsap.min.js`). Shape
  interpolation has no support at all. Stroke draw is manual
  `stroke-dasharray`. The keyframes skill recommends both plugins anyway —
  treat that as aspirational.
- **`packages/shader-transitions` accepts no custom shaders.** `ShaderName` is
  a closed 14-name union and `getFragSource()` throws on anything else.
  Arbitrary full-frame shader work means hand-rolling WebGL per composition —
  well documented in `adapters/html-in-canvas-patterns.md`, but there is no
  shared harness.
- **No painterly components in `registry/` at all.** The registry is a
  UI-mockup / code-demo / shader-transition / caption catalog. The best
  painterly code in the repo is buried inside
  `skills/embedded-captions/scripts/make-theme.cjs`, an 8,585-line theme
  generator — not reusable as blocks.
- **No sprite-sheet or PNG-sequence input.** PNG sequence is an _output_
  (`--format png-sequence`), never an input.
- **No temporal accumulation, anywhere, by design.** Every frame must be
  reproducible from `t` alone under arbitrary seek order.
- **`Math.random()` is a lint error**, and so is `gsap.utils.random()` — render
  workers initialise independently, so values diverge across chunks. Use a
  seeded `mulberry32`, as every beat here does.

## Verifying this project

```bash
npx hyperframes lint       # 0 errors, 0 warnings across all 16 files
npx hyperframes check      # see caveat below
npx hyperframes render . -o style-sampler.mp4
```

**The grading caveat.** `data-color-grading` deadlocks `hyperframes check` in a
headless / no-GPU environment: the page's load event never fires and navigation
times out. This is not a slow-init problem — a 45-second timeout fails
identically, and it happens with _any_ grading payload, not just kuwahara. The
same composition **renders correctly**, because the render pipeline launches the
browser differently.

So beat 04 is verified in two passes:

1. Strip the `data-color-grading` attribute, run `check` — this covers the
   beat's layout, motion, and contrast, none of which the grading affects.
2. Restore it and `render` — this is what proves the shader actually paints.

If you are adding graded beats, keep that split. Everything else in the reel
passes `check` with the attribute in place.

## Recommendation for an animated series

Beat 13 (digital cut-out) plus beat 05 (charcoal boil) is the combination worth
building on. Cut-out gives you a rig you can pose for hours of footage without
redrawing; the boil gives that rig a handmade surface that the shipped shaders
cannot reach. Everything in beat 05 is plain SVG filters driven from the
timeline, so it composes with any rig you already have — including
`projects/character-rig/`.
