# HyperFrames — Capabilities Overview

Everything HyperFrames can do. Scan this to know what's available, then deep-dive specific sections in the full [capabilities.md](../../hyperframes/references/capabilities.md) when needed.

You are NOT limited to what was captured from the website. You can create shaders, download registry blocks, build Three.js scenes, write custom WebGL effects — anything a browser can render.

## What's Available

| #   | Capability                        | Key facts                                                                                                                                                                                                                                                                        |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Composition fundamentals**      | `data-composition-id`, `data-start`, `data-duration`, `data-width`, `data-height` on root div. Timeline via `window.__timelines["id"]`. Resolutions: 1080p, 4K, portrait, square.                                                                                                |
| 2   | **Animation engines (6)**         | **GSAP** (primary — 15 plugins including ScrollTrigger, SplitText, MotionPath, Flip, DrawSVG), Anime.js v4, CSS @keyframes, WAAPI, Lottie (lottie-web + dotlottie), Three.js (hf-seek event).                                                                                    |
| 3   | **Shader transitions (14 WebGL)** | domain-warp, ridged-burn, whip-pan, sdf-iris, ripple-waves, gravitational-lens, cinematic-zoom, chromatic-split, swirl-vortex, thermal-distortion, flash-through-white, cross-warp-morph, light-leak, glitch. Install: `npx hyperframes add <name>`. Custom GLSL also supported. |
| 4   | **CSS transitions (30+)**         | Push/slide, scale/zoom, radial/clip, 3D flip, blur, dissolve, cover/blinds, light leak, distortion/glitch, mechanical, grid dissolve, destruction. Timing presets: snappy 0.2s, smooth 0.4s, gentle 0.6s, dramatic 0.5s, luxe 0.7s.                                              |
| 5   | **Visual effects**                | Text markers (highlight, circle, burst, scribble, sketchout), grain/noise, light leaks, film burn, vignette, glow, shimmer sweep.                                                                                                                                                |
| 6   | **Captions**                      | Per-word karaoke, 5 exit styles, 6 tone mappings, per-word brand styling, 7 audio source formats.                                                                                                                                                                                |
| 7   | **Audio-reactive**                | Bass→scale, mid→shape, treble→glow. Any GSAP property mappable. Requires band extraction script.                                                                                                                                                                                 |
| 8   | **HTML-in-canvas**                | Live DOM as GPU texture via `drawElementImage`. Three.js planes, WebGL shaders on HTML. 7 VFX blocks: iPhone/MacBook device, liquid glass, magnetic, portal, shatter, text cursor.                                                                                               |
| 9   | **Three.js / WebGL**              | Full 3D: GLTF models, AnimationMixer, custom GLSL, post-processing, lights, cameras. Deterministic via `hf-seek` event.                                                                                                                                                          |
| 10  | **SVG / canvas / variable fonts** | SVG path drawing (DrawSVG), Canvas 2D procedural art, CSS 3D card, per-word type, variable font axes, MotionPath.                                                                                                                                                                |
| 11  | **Media**                         | Video compositing + frame injection, multi-track audio mixer, Kokoro TTS (54 voices, 9 languages, local/free), Whisper transcription, background removal.                                                                                                                        |
| 12  | **Registry**                      | 51 blocks (social overlays, showcases, data viz, logo, 3D/VFX, transitions) + 4 components (grain, shimmer, pixelate, texture-mask) + 8 starter examples. Install: `npx hyperframes add <name>`.                                                                                 |

## Essential Rules

- **Deterministic:** No `Math.random()`, no `Date.now()`, no `requestAnimationFrame`, no `repeat: -1`. The render engine seeks to exact timestamps.
- **Timeline contract:** `window.__timelines["composition-id"] = tl` must be set synchronously. The timeline length defines the composition duration.
- **Sub-compositions:** External `.html` files loaded via `data-composition-src`. Auto-nested timelines, scoped CSS, scoped scripts.
- **Linter:** 60+ rules. Run `npx hyperframes lint` before render. Catches missing timelines, overlapping clips, broken paths, GSAP errors.

## For Implementation Details

- **Working code patterns:** See `techniques.md` (in the hyperframes skill)
- **Full 704-line inventory:** See [capabilities.md](../../hyperframes/references/capabilities.md) — sections 12-24 cover registry, CLI, linter, player, engine, studio, determinism, variables, sub-compositions, global APIs, skills, references, documentation
