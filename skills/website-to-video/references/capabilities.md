# HyperFrames — Complete Capabilities Inventory

Everything possible in HyperFrames as of today's workspace, synthesized from direct source reads of all 7 packages, 16 skills, and the full registry.

> **How to read this file.** Scan the **Table of Contents** below first. **Do NOT read this file linearly** — it is a 700+ line inventory; reading top-to-bottom every session wastes context. When the storyboard or a specific beat needs a particular capability (HTML-in-Canvas, shader transitions, audio-reactive, dynamic counters, etc.), jump straight to that section.

You are NOT limited to what was captured from the website. You can create shaders from scratch, search for and download registry blocks, build Three.js scenes, write custom WebGL effects, use any web API — anything a browser can render.

For implementation patterns (working code), see `techniques.md`. This file is the WHAT; techniques.md is the HOW.

## Essential Rules

- **Deterministic:** No `Math.random()`, no `Date.now()`, no `requestAnimationFrame`, no `repeat: -1`. The render engine seeks to exact timestamps.
- **Timeline contract:** `window.__timelines["composition-id"] = tl` must be set synchronously. The timeline length defines the composition duration.
- **Sub-compositions:** External `.html` files loaded via `data-composition-src`. Auto-nested timelines, scoped CSS, scoped scripts.
- **Linter:** 60+ rules. Run `npx hyperframes lint` before render. Catches missing timelines, overlapping clips, broken paths, GSAP errors.

## Table of Contents

| #   | Section                                              | What it covers                                                                                                                                                                                                                  |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Composition fundamentals**                         | Data attributes, timeline contract, resolution presets (1080p, 4K, portrait, square, custom)                                                                                                                                    |
| 2   | **Animation engines (6 adapters)**                   | GSAP + 15 plugins, Anime.js v4, CSS @keyframes, WAAPI, Lottie (lottie-web + dotlottie), Three.js (hf-seek event)                                                                                                                |
| 3   | **Shader transitions (14 WebGL)**                    | domain-warp, ridged-burn, whip-pan, sdf-iris, ripple-waves, gravitational-lens, cinematic-zoom, chromatic-split, swirl-vortex, thermal-distortion, flash-through-white, cross-warp-morph, light-leak, glitch — plus custom GLSL |
| 4   | **CSS scene transitions (30+)**                      | Push/slide, scale/zoom, radial/clip, 3D flip, blur, dissolve, cover/blinds, light leak/burn, distortion/glitch, mechanical/shutter, grid dissolve, destruction/burn, VHS/gravity/morph — 6 timing presets                       |
| 5   | **Visual effects + textures**                        | Text markers (highlight, circle, burst, scribble, sketchout), grain/noise, light leaks, film burn, vignette, glow, paper texture, shimmer sweep                                                                                 |
| 6   | **Caption techniques**                               | Per-word karaoke, intensity tiers, 5 exit styles, 6 tone mappings, per-word styling triggers, 7 audio source formats, positioning helpers                                                                                       |
| 7   | **Audio-reactive animation**                         | Bass→scale, mid→shape, treble→glow; any GSAP property; band extraction script; banned patterns                                                                                                                                  |
| 8   | **HTML-in-canvas**                                   | Live DOM as GPU texture (drawElementImage), Three.js planes, WebGL shaders on HTML, 7 VFX blocks (iPhone/MacBook device, liquid, glass, magnetic, portal, shatter, text cursor)                                                 |
| 9   | **Three.js / WebGL custom scenes**                   | Full 3D: AnimationMixer, custom GLSL, post-processing, GLTF models, lights, cameras, materials — all deterministic via hf-seek                                                                                                  |
| 10  | **SVG / canvas / variable fonts**                    | SVG path drawing, Canvas 2D procedural art, CSS 3D card, per-word type, variable font axes, character typing, velocity-matched cuts, MotionPath                                                                                 |
| 11  | **Media: video, audio, TTS**                         | Video compositing + frame injection, audio mixer (multi-track), Kokoro TTS (54 voices, 9 languages), Whisper/Groq/OpenAI transcription, background removal (u2net)                                                              |
| 12  | **Registry (51 blocks + 4 components + 8 examples)** | Social overlays (8), showcases (5), data viz (2), logo branding (1), 3D/VFX (7), shader transitions (14), transition galleries (13), components (grain, shimmer, pixelate, texture-mask), 8 starter examples                    |
| 13  | **CLI (25 commands)**                                | init, add, catalog, play, preview, publish, render (MP4/WebM/MOV/PNG, HDR, GPU, parallel), lint, validate, inspect, snapshot, capture, tts, transcribe, remove-background, doctor, and more                                     |
| 14  | **Linter (60+ rules)**                               | Core, media, GSAP, captions, composition, adapters, textures, fonts — plus async URL checks                                                                                                                                     |
| 15  | **Player web component**                             | `<hyperframes-player>` with seek/play/pause API, 11 events, media mirror, runtime auto-inject                                                                                                                                   |
| 16  | **Engine + Producer**                                | MP4/WebM/MOV/PNG output, HDR (PQ/HLG), transparency (ProRes), GPU encoding (NVENC/VideoToolbox/VAAPI/QSV), parallel rendering, video frame injection                                                                            |
| 17  | **Studio (in-browser NLE)**                          | Timeline editor, drag/resize clips, asset browser, render queue, lint modal, caption editor, element picker                                                                                                                     |
| 18  | **Determinism guarantees**                           | No Math.random, no Date.now, no RAF, no repeat:-1, no callbacks, synchronous construction                                                                                                                                       |
| 19  | **Variables / parameterization**                     | Typed runtime variables (string, color, number, boolean, enum), CLI override, strict validation                                                                                                                                 |
| 20  | **Sub-compositions**                                 | External file or inline template, auto-nested timelines, scoped CSS, scoped scripts, variable inheritance                                                                                                                       |
| 21  | **Global runtime APIs**                              | 25+ window globals for timelines, player, variables, adapters, hooks                                                                                                                                                            |
| 22  | **Skills (16)**                                      | hyperframes, cli, media, registry, contrast, animation-map, website-to-video, remotion, gsap, animejs, css-animations, waapi, lottie, three, tailwind, contribute-catalog                                                       |
| 23  | **References (15 docs)**                             | transitions, css-patterns, dynamic-techniques, motion-principles, typography, narration, captions, audio-reactive, transcript-guide, techniques, beat-direction, visual-styles, and more                                        |
| 24  | **Documentation (27 pages)**                         | Guides + package docs covering rendering, HDR, html-in-canvas, performance, prompting, troubleshooting, etc.                                                                                                                    |

---

## 1. Composition fundamentals

### Data attributes recognized by the runtime

- **Root composition:** `data-composition-id`, `data-start`, `data-duration`, `data-width`, `data-height`, `data-composition-src` (external sub-comp), `data-composition-duration`, `data-composition-variables` (JSON), `data-variable-values` (override)
- **Every clip:** `id`, `data-start`, `data-duration`, `data-track-index`, `class="clip"`, optional `data-media-start`, `data-volume`, `data-playback-start`
- **Sub-composition host:** `data-composition-id`, `data-composition-src` OR inline `<template id="${compId}-template">`
- **Parser also reads:** `data-type` (composition|text), `data-end`, `data-keyframes` (JSON), `data-x|y|scale|opacity`, `data-color|font-size|font-weight|font-family|text-shadow|outline|highlight*`, `data-layer` (z-index, deprecated for timeline but used for audio mixer layers), `data-resolution`, `data-composition-width|height`

### Timeline contract

- `gsap.timeline({ paused: true })` registered on `window.__timelines["<composition-id>"]`
- Master clock (TransportClock + WebAudioTransport) drives the timeline via `tl.totalTime(t, false)` or `tl.seek(t, false)`
- Framework auto-nests sub-comp timelines
- Duration sourced from `data-duration` on root, not from GSAP length
- Synchronous timeline construction required (no async/await/setTimeout)
- Looping handled by `<hyperframes-player>`, not GSAP `repeat: -1`

### Resolution presets

VALID_CANVAS_RESOLUTIONS: 1920×1080 default, 1080×1920 portrait, 1080×1080 square, 4K, 1440×2560, plus `normalizeResolutionFlag` for `--resolution` CLI flag.

---

## 2. Animation engines (6 deterministic frame adapters)

The runtime registers these adapters in order; each implements `discover()` / `seek({time})` / `pause` / `play?` / `revert`:

| Adapter                            | What it drives                                                                | How to load                                                     | Notable                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| GSAP (createGsapAdapter)           | The primary timeline + all tweens registered on `window.__timelines[<id>]`    | CDN `https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js` | Plugins via standard GSAP register; HyperFrames does NOT patch THREE.Clock (uses `__hfThreeTime` instead) |
| Anime.js v4 (createAnimeJsAdapter) | Anime instances pushed to `window.__hfAnime`                                  | CDN `animejs@4.0.2/lib/anime.iife.min.js` or ESM                | Adapter multiplies composition seconds by 1000 for ms                                                     |
| CSS animations (createCssAdapter)  | Any element with computed `animation-name`                                    | Declarative `@keyframes`                                        | Falls back to negative `animation-delay` when WAAPI unavailable                                           |
| WAAPI (createWaapiAdapter)         | All Animation objects on document                                             | `element.animate()`                                             | Uses `document.getAnimations()`                                                                           |
| Lottie (createLottieAdapter)       | `window.__hfLottie` array; supports lottie-web + dotlottie-web                | CDN `lottie.min.js` + `@lottiefiles/dotlottie-web`              | `goToAndStop(time*1000)` or `setCurrentRawFrameValue` / `seek(%)`                                         |
| Three.js (createThreeAdapter)      | `window.__hfThreeTime` + dispatches `CustomEvent("hf-seek", {detail:{time}})` | ESM CDN `three@0.181.2/+esm`                                    | Composition's render loop listens to `hf-seek`; pattern: `mixer.setTime(time)`                            |

### GSAP plugins (documented patterns)

- **TextPlugin** — text mutation in `tl.call` (skills/gsap/references/effects.md)
- **MotionPathPlugin** — curve-constrained tweens (skills/hyperframes/references/techniques.md)
- **CustomEase** — bezier eases imported from Remotion-style timing
- **ScrollTrigger / Flip / SplitText / Draggable / Inertia / Observer / ScrambleText / CustomWiggle / CustomBounce / ScrollSmoother / GSDevTools** — work natively if loaded and tweens are on the registered paused timeline, but no special HyperFrames adapter
- Producer injects ScrollTrigger CDN automatically when needed (packages/producer/src/services/htmlCompiler.ts)

---

## 3. Shader transitions — @hyperframes/shader-transitions

14 named WebGL fragment shaders. All share the same uniforms: `u_from`, `u_to`, `u_progress`, `u_resolution`, `u_accent`, `u_accent_dark`, `u_accent_bright`.

### The 14 shaders

| Name                | Visual                                                                                 | Notes                                                                                                                              |
| ------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| domain-warp         | Multi-octave FBM warps both scenes oppositely; organic dissolve edge with accent flash | Uses NQ noise bundle                                                                                                               |
| ridged-burn         | Ridged multifractal mask reveals B; accent → bright → white burn ramp; sparks          | NQ                                                                                                                                 |
| whip-pan            | 10-sample horizontal motion blur + lateral crossfade                                   | No noise                                                                                                                           |
| sdf-iris            | Aspect-corrected circle SDF expansion + accent-tinted glow rings                       | —                                                                                                                                  |
| ripple-waves        | Radial standing-wave UV displacement + tinted crossfade                                | —                                                                                                                                  |
| gravitational-lens  | Pinch pull toward center + R/B chromatic separation                                    | —                                                                                                                                  |
| cinematic-zoom      | 12 RGB-offset radial zoom blur samples (chromatic zoom streak)                         | —                                                                                                                                  |
| chromatic-split     | R/B radial channel shift outward / inward; G fixed                                     | Distinct from CSS chromatic aberration                                                                                             |
| swirl-vortex        | CCW swirl with FBM noise; reciprocal on incoming                                       | NQ                                                                                                                                 |
| thermal-distortion  | Vertical sin + FBM horizontal displacement; warm haze                                  | NQ                                                                                                                                 |
| flash-through-white | Fade through white midpoint — a visible white flash between scenes                     | No accent. Use only when the brand specifically calls for a white-flash beat boundary; this is NOT a neutral "default" transition. |
| cross-warp-morph    | FBM vector field displaces both scenes; third FBM biases irregular wipe                | NQ                                                                                                                                 |
| light-leak          | Fixed off-frame leak with exponential falloff + accent warmth + ridge flare            | Hard-coded leak anchor                                                                                                             |
| glitch              | Line displacement + RGB lateral split + scan modulation + posterization + flicker      | Deterministic                                                                                                                      |

### Public API

```js
HyperShader.init({
  bgColor: "#0b0f14",
  accentColor: "#f59e42",
  scenes: ["scene1", "scene2"],
  transitions: [{ time: 3, shader: "sdf-iris", duration: 0.65, ease: "power2.inOut" }],
  timeline: gsap.timeline({ paused: true }),
  compositionId: "main",
  previewCaptureFps: 30,
});
```

- Capability probe: `isHtmlInCanvasCaptureSupported()` (Chrome layoutSubtree/drawElementImage)
- Tuning: `?__hf_shader_capture_scale=` (0.25–1), `?__hf_shader_loading=` (internal|player|none)
- Cache: IndexedDB for PNG snapshots; max 2 textured transitions live at once
- Fallback (`applyFallbackTransition`): smoothstep opacity tween when capture / texImage2D fails
- Engine mode skips GL/capture when `window.__HF_VIRTUAL_TIME__` set (producer uses metadata)

You can also **write custom GLSL shaders from scratch** — any fragment shader works with the standard uniforms.

---

## 4. CSS scene transitions (30+ named patterns)

Documented in skills/hyperframes/references/transitions/ across 14 category files. All GSAP-driven, none mixable with shader transitions in same composition.

### By category

| Category                         | Patterns                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| Push / slide (css-push.md)       | Push slide, vertical push, elastic push, squeeze                                                 |
| Scale / zoom (css-scale.md)      | Zoom through, zoom out, scale-up swap                                                            |
| Radial / clip (css-radial.md)    | Circle iris, diamond iris, diagonal split                                                        |
| 3D (css-3d.md)                   | 3D card flip, hinge door                                                                         |
| Blur (css-blur.md)               | Crossfade, blur crossfade, focus pull                                                            |
| Dissolve (css-dissolve.md)       | Color dip (gap-to-black), staggered color blocks (2-block, 5-block)                              |
| Cover (css-cover.md)             | Horizontal blinds, vertical blinds (variable strip counts: 6 / 12 / 20)                          |
| Light (css-light.md)             | Light leak overlays, overexposure burn, film burn                                                |
| Distortion (css-distortion.md)   | Glitch (CSS — RGB layer jitter), chromatic aberration, ripple                                    |
| Mechanical (css-mechanical.md)   | Shutter (two-half), clock wipe (9-point rotating wedge)                                          |
| Grid (css-grid.md)               | Grid dissolve (12 or 120 cells), grid pixelate wipe                                              |
| Destruction (css-destruction.md) | Page burn (SVG clip-path + canvas char rim)                                                      |
| Other (css-other.md)             | VHS tape (strip-based seeded jitter), gravity drop, morph circle, blur through, directional blur |
| Rejected                         | Star iris, tilt-shift, lens flare (don't use — non-CSS-realistic)                                |

### Timing presets

| Preset   | duration | ease                   |
| -------- | -------- | ---------------------- |
| snappy   | 0.2s     | power4.inOut           |
| smooth   | 0.4s     | power2.inOut           |
| gentle   | 0.6s     | sine.inOut             |
| dramatic | 0.5s     | power3.in → power3.out |
| instant  | 0.15s    | expo.inOut             |
| luxe     | 0.7s     | power1.inOut           |

---

## 5. Visual effects + textures

### Marker/emphasis patterns (css-patterns.md)

| Mode      | What it does                      | Implementation                            |
| --------- | --------------------------------- | ----------------------------------------- |
| highlight | Yellow bar wipes behind text      | CSS bar + GSAP scaleX 0→1                 |
| circle    | Hand-drawn red ring around word   | CSS border ellipse + back.out scale       |
| burst     | 12 radial spikes from word center | DOM line array, --len/--angle vars        |
| scribble  | Wavy underline drawn over time    | SVG `<path>` quadratic + stroke-dash GSAP |
| sketchout | Cross-hatch x-out over text       | Two 2px rotated lines                     |

### Grain / noise

- **grain-overlay** (registry component): SVG feTurbulence data-URL + CSS keyframe jitter, `steps(1)`, default opacity 0.15
- **Layered radial-gradient grain** (preferred pattern): no SVG, no canvas-taint, fast everywhere

### Light / film

- Light leak transitions (CSS + shader variants)
- Overexposure burn — `brightness()` ramp + flash overlay
- Film burn — multi-layer amber/orange/red radials
- Vignette — radial-gradient overlay
- Paper texture (in registry/examples/warm-grain/)

### Glow

- Caption text glow: textShadow radius keyed to treble bands (always on active words only, never parents)
- Radial glow backgrounds: CSS gradients / blurred blobs

---

## 6. Caption techniques

### Animation styles

- Baseline: per-word karaoke highlight (every energy level)
- Intensity tiers: accent + glow + 15% scale (high energy) → 3% scale (low energy)
- Exits by energy (dynamic-techniques.md): scatter, drop, collapse, fade+slide, fade
- Tone mappings (captions.md): scale-pop `back.out(1.7)`, fade+slide `power3.out`, typewriter, bounce, `elastic.out`, word-by-word

### Per-word styling triggers

- Brand/product names
- ALL CAPS
- Numbers / stats
- Emotional keywords
- CTAs
- Marker highlight modes (5 listed above)

### Audio sources for caption timing

| Source                                     | Format   | Granularity       |
| ------------------------------------------ | -------- | ----------------- |
| hyperframes transcribe (local whisper.cpp) | JSON     | Word-level        |
| OpenAI verbose_json                        | JSON     | Word-level        |
| Groq verbose_json                          | JSON     | Word-level        |
| Manually authored                          | JSON     | Word-level        |
| SRT                                        | text     | Phrase-level only |
| VTT                                        | text     | Phrase-level only |
| hyperframes tts → transcribe chain         | wav→json | Word-level        |

### Positioning helpers

- Landscape: bottom 80–120px centered
- Portrait: ~600–700px from bottom
- `window.__hyperframes.fitTextFontSize(text, {maxWidth, fontFamily, fontWeight})` for dynamic sizing

---

## 7. Audio-reactive animation

### Data shape

```js
window.AUDIO_DATA = {
  fps: 30,
  totalFrames: 900,
  frames: [{ bands: [0.42, 0.18, ...] }]  // bands normalized 0–1 per band across track
};
```

Index 0 = bass, higher = treble. Bands range 0–1, normalized across full track length.

### Mappings documented

| Band                  | Property                     |
| --------------------- | ---------------------------- |
| Bass (bands[0–1])     | scale (pulse)                |
| Mid (bands[4–8])      | borderRadius, width          |
| Treble (bands[12–14]) | textShadow, boxShadow (glow) |
| Overall amplitude     | opacity, y, backgroundColor  |

Any GSAP-tweenable property is fair game — including clipPath, filter, SVG attrs, CSS variables.

### Extraction

```bash
python3 .../extract-audio-data.py audio.mp3 --fps 30 --bands 8
```

Pre-extracted only — no Web Audio at render time.

### Banned in audio-reactive

EQ bars, spectrum UI, generic waveforms, note clip-art, generic particles, rainbow cycling, white strobe on beats, abstract pulsing orbs.

---

## 8. HTML-in-canvas

Documented in skills/hyperframes/references/html-in-canvas-patterns.md (504 lines).

### Capability

- Chrome's experimental `layoutSubtree` + `drawElementImage` rasterizes live DOM into canvas
- Feature detection: `isHtmlInCanvasCaptureSupported()`
- Used by shader-transitions for scene textures
- Combined with Three.js: `CanvasTexture` + post-processing

### Available patterns

- HTML on a Three.js plane (displacement, distortion, liquid sim)
- HTML in shaders (texture sampling for VFX)
- Recursive HTML-in-canvas-in-shader-in-HTML

### Experimental VFX blocks using this

- `vfx-iphone-device` (GLTF iPhone + MacBook, HTML screens)
- `vfx-liquid-background` (liquid sim displaces HTML)
- `vfx-liquid-glass`
- `vfx-magnetic`
- `vfx-portal`
- `vfx-shatter`
- `vfx-text-cursor` (chromatic edges, canvas post)

---

## 9. Three.js / WebGL custom scenes

### Integration pattern

```js
window.addEventListener("hf-seek", (e) => {
  const time = e.detail.time;
  mixer.setTime(time);
  shaderUniforms.u_time.value = time;
  renderer.render(scene, camera);
});
```

- Load: `import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.181.2/+esm"`
- Deterministic: every frame must derive from `time`, never `requestAnimationFrame` / `Date.now()`
- Includes: AnimationMixer, custom GLSL shaders, post-processing, GLTF models, lights, cameras, materials

---

## 10. SVG / canvas / variable fonts (other authored techniques)

(From skills/hyperframes/references/techniques.md)

| Technique                | Mechanism                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------ |
| SVG path drawing         | `strokeDasharray` + `getTotalLength()` + GSAP stroke offset                          |
| Canvas 2D procedural art | Seeded hash function + `tl.to` proxy `{time}` onUpdate                               |
| CSS 3D card              | GSAP `rotationY` + `perspective: 900`                                                |
| Per-word kinetic type    | GSAP timings array, sliding decay                                                    |
| Variable font axes       | Animate CSS vars → `font-variation-settings: "opsz" var(--opsz), "wght" var(--wght)` |
| Character typing         | `tl.call` text mutation + `steps(1)` cursor blink                                    |
| Velocity-matched cuts    | Match outgoing blur/translate velocity to incoming for seamless beats                |
| MotionPathPlugin         | `gsap.registerPlugin(MotionPathPlugin)` + path string                                |

---

## 11. Media: video, audio, TTS

### Video compositing

- `<video muted playsinline data-start="..." data-duration="..." data-track-index="..." src="...">`
- HyperFrames extracts frames at render via videoFrameInjector (avoids unreliable headless `<video>` playback)
- Linter forbids `<video>` with audio at the same time — split into separate `<video muted>` + `<audio>`
- Video frame extraction uses FFmpeg
- HDR videos: PQ or HLG transfer detection + x265 with mastering metadata

### Audio mixer

- `<audio id="..." data-start="..." data-duration="..." data-volume="0.8" data-track-index="2" src="...">`
- Multiple tracks mixed with `amix normalize=0` + per-track adelay + volume
- Master audioGain from EngineConfig
- Output: AAC 192kbps

### TTS (Kokoro-82M, local)

- 54 bundled voices with prefixes: `a` American EN, `b` British EN, `e` Spanish, `f` French, `h` Hindi, `i` Italian, `j` Japanese, `p` Brazilian Portuguese, `z` Mandarin
- Default voice: `af_heart`
- Speed: 0.1–3.0 (default 1.0)
- Languages: en-us, en-gb, es, fr-fr, hi, it, pt-br, ja, zh (non-EN needs system espeak-ng)
- Output: WAV; no pitch/volume CLI flags
- No API key required

### Transcription

- Whisper.cpp models: tiny, base, small, medium, large-v3, small.en, medium.en (default small)
- Groq API: whisper-large-v3 with word granularities
- OpenAI API: whisper-1 verbose_json
- Imports: SRT, VTT, JSON formats
- Quality gates: music-token detection, garbage cleaning, retry with medium.en

### Background removal

- u2net ONNX models
- Devices: auto / cpu / coreml / cuda
- Quality presets: fast / balanced / best
- Outputs: transparent WebM, ProRes MOV, PNG sequence
- Optional dual output (foreground + extracted background)

---

## 12. Registry — 51 blocks + 4 components + 8 examples

### Blocks by category

**Social overlays (8):** instagram-follow, tiktok-follow, yt-lower-third, x-post, reddit-post, spotify-card, macos-notification, blue-sweater-intro-video

**Showcases (5):** app-showcase (3D phones), north-korea-locked-down (map + annotation), apple-money-count (counter + SFX), vpn-youtube-spot (app-store scroll), nyc-paris-flight (map + plane path)

**Data viz (2):** data-chart (animated bar+line, NYT-style), flowchart + flowchart-vertical (decision tree with SVG connectors, typing correction)

**Logo / branding (1):** logo-outro (build + glow + tagline + URL pill)

**3D / experimental VFX (8):** ui-3d-reveal, vfx-iphone-device (GLTF), vfx-liquid-background, vfx-liquid-glass, vfx-magnetic, vfx-portal, vfx-shatter, vfx-text-cursor

**Single shader transitions (14):** one block per named shader — domain-warp-dissolve, ridged-burn, whip-pan, sdf-iris, ripple-waves, gravitational-lens, cinematic-zoom, chromatic-radial-split, glitch, swirl-vortex, thermal-distortion, flash-through-white, cross-warp-morph, light-leak

**Transition galleries (13 showcase pieces):** transitions-3d, transitions-blur, transitions-cover, transitions-destruction, transitions-dissolve, transitions-distortion, transitions-grid, transitions-light, transitions-mechanical, transitions-other, transitions-push, transitions-radial, transitions-scale

### Components (4 reusable snippets)

- **grain-overlay** — SVG feTurbulence + CSS keyframes
- **shimmer-sweep** — Light sweep gradient mask on text
- **grid-pixelate-wipe** — Grid squares stagger fade scene wipe
- **texture-mask-text** — Luminance-masked letterforms with 66 mask PNGs (Masonry, Stone, Ground/Road, Wood, Metal, Organic/Soft texture categories)

### Examples (8 starter projects)

warm-grain, play-mode, swiss-grid, vignelli, decision-tree, kinetic-type, product-promo, nyt-graph

Install: `npx hyperframes add <name>` for blocks/components, `hyperframes init <dir> --example <name>` for examples.

---

## 13. CLI — 25 commands

| Command           | Purpose                                                                                                                                                                                                                                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| init              | Scaffold project from template/example (interactive or --non-interactive)                                                                                                                                                                                                                                                |
| add               | Install registry block / component                                                                                                                                                                                                                                                                                       |
| catalog           | Browse registry blocks/components (--type, --tag, --json, --human-friendly picker)                                                                                                                                                                                                                                       |
| play              | Lightweight browser player (default port 3003)                                                                                                                                                                                                                                                                           |
| preview           | Studio dev server (port 3002; --force-new, --list, --kill-all)                                                                                                                                                                                                                                                           |
| publish           | Zip + upload + return hyperframes.dev URL                                                                                                                                                                                                                                                                                |
| render            | Render to MP4 / WebM / MOV / PNG sequence — flags: --fps 24/30/60, --quality draft/standard/high, --workers, --docker, --hdr/--sdr, --crf, --video-bitrate, --gpu, --browser-gpu auto/software/hardware, --max-concurrent-renders 1-10, --variables JSON, --variables-file PATH, --strict-variables, --resolution preset |
| lint              | Static lint (--json, --verbose)                                                                                                                                                                                                                                                                                          |
| validate          | Bundle + headless Chrome + console + contrast (--contrast default true, --timeout 3000)                                                                                                                                                                                                                                  |
| inspect / layout  | Visual layout audit (overflow detection at N timestamps; --samples 9, --at, --tolerance 2, --max-issues 80)                                                                                                                                                                                                              |
| info              | Print project metadata                                                                                                                                                                                                                                                                                                   |
| compositions      | List compositions (root + sub-comps)                                                                                                                                                                                                                                                                                     |
| benchmark         | 5 preset configs × N runs (--runs 3)                                                                                                                                                                                                                                                                                     |
| browser           | Manage Chrome (ensure/path/clear)                                                                                                                                                                                                                                                                                        |
| remove-background | u2net + FFmpeg → transparent video                                                                                                                                                                                                                                                                                       |
| transcribe        | whisper.cpp or import SRT/VTT/JSON                                                                                                                                                                                                                                                                                       |
| tts               | Kokoro-82M (--voice, --speed, --lang, --list)                                                                                                                                                                                                                                                                            |
| docs              | Print bundled markdown topics (data-attributes, examples, rendering, gsap, troubleshooting, compositions)                                                                                                                                                                                                                |
| doctor            | Environment checklist (Node, CPU, memory, disk, FFmpeg, FFprobe, Chrome, Docker)                                                                                                                                                                                                                                         |
| upgrade           | npm update check + optional global install                                                                                                                                                                                                                                                                               |
| skills            | Run `npx skills add heygen-com/hyperframes --all`                                                                                                                                                                                                                                                                        |
| telemetry         | enable/disable/status                                                                                                                                                                                                                                                                                                    |
| snapshot          | PNG screenshots at timeline timestamps                                                                                                                                                                                                                                                                                   |
| capture           | Capture URL → site assets + screenshots + design tokens (uses Puppeteer + optional Gemini vision)                                                                                                                                                                                                                        |

### Website capture (`hyperframes capture <url>`)

Detects these libraries on captured sites (for context labeling): GSAP / ScrollTrigger, Three.js, Lottie, Anime.js, PixiJS, Babylon.js, Rive, Matter.js, Lenis, Framer Motion, Tailwind CSS, WebGL (shader fingerprinting). Captured outputs feed the website-to-video skill workflow.

---

## 14. Linter — 60+ rules

Across 8 files in packages/core/src/lint/rules/:

| Rule file   | Catches                                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| core        | Missing composition-id, missing dimensions, missing timeline registry, registry mismatch, invalid script syntax, scoped-CSS issues, non-deterministic code                                                                                                         |
| media       | Duplicate media id, video missing muted, video nested in timed element, placeholder URLs, base64 prohibited, missing src/start/id, imperative play()/pause()/seek()                                                                                                |
| gsap        | Overlapping tweens, exit missing hard kill, GSAP animating .clip element, unscoped selectors, CSS transform conflict, missing GSAP script, infinite repeat (repeat: -1), repeat ceil overshoot, scene layer visibility kill, audio-reactive single-tween-per-group |
| captions    | Caption exit missing kill, text overflow risk, transcript not inline, parse error, container position, scale mismatch, textShadow on parent container                                                                                                              |
| composition | File too large, dense tracks, missing class="clip", deprecated data-layer/data-end, split attribute selectors, external script deps, RAF in composition, invalid variable JSON                                                                                     |
| adapters    | Missing Lottie script, missing Three script                                                                                                                                                                                                                        |
| textures    | Drop-shadow on text, class missing base, text missing mask, unknown texture class                                                                                                                                                                                  |
| fonts       | Google Fonts import (use @font-face), font-family without @font-face                                                                                                                                                                                               |

Plus async URL checks (`lintMediaUrls`, `lintScriptUrls` — HEAD probes).

`validateCompositionGsap` also forbids: `Math.random`, `Date.now`, `new Date`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `repeat: -1`.

**Note:** `onUpdate` callbacks, `tl.call()`, and GSAP event callbacks (`onComplete`, `onStart`, etc.) are NOT banned by the linter — they are required for canvas/WebGL rendering and character-by-character typing patterns. The linter only catches the determinism violations listed above.

---

## 15. Player — `<hyperframes-player>` web component

### Attributes

`src`, `srcdoc`, `width`, `height`, `controls`, `muted`, `volume`, `poster`, `playback-rate`, `audio-src`, `shader-capture-scale`, `shader-loading` (internal|player|none), `loop`, `autoplay`, `speed-presets`

### Public API

`seek(t)` (synchronous when same-origin — uses `iframe.contentWindow.__player.seek` directly), `play()`, `pause()`, `currentTime`, `duration`, `paused`, `ready`, `playbackRate`, `iframeElement`

### Events

`ready`, `timeupdate`, `play`, `pause`, `ended`, `volumechange`, `ratechange`, `shadertransitionstate`, `playbackerror`, `error`, `audioownershipchange`

### Media mirror

Parent audio/video elements with `data-start` are proxied; `_mirrorParentMediaTime` corrects drift; `_audioOwner` promotes to parent if autoplay blocked.

### Runtime auto-inject

Loads `RUNTIME_CDN_URL` (`@hyperframes/core/dist/hyperframe.runtime.iife.js`) if missing `__hf`/`__player` but timelines exist.

---

## 16. Engine + Producer — rendering pipeline

### Output formats

mp4, webm, mov, png-sequence — with HDR (PQ / HLG / SDR / auto-detect), transparency (ProRes MOV / WebM / PNG), or standard 8-bit SDR

### Encoding controls

- `--fps`: 24 / 30 / 60
- `--quality`: draft / standard / high
- `--crf`: integer (mutually exclusive with `--video-bitrate`)
- `--video-bitrate`: e.g. `8M`
- `--gpu`: NVENC, VideoToolbox, VAAPI, QSV
- `--browser-gpu`: auto / software / hardware
- `--workers`: parallel render workers
- `--max-concurrent-renders`: 1–10 (sets `PRODUCER_MAX_CONCURRENT_RENDERS`)
- `--resolution`: preset (1080p, 4k, portrait, etc.)
- `--docker`: render inside Dockerfile.test image (reproducibility)
- `--hdr` / `--sdr`: force HDR or SDR pipeline

### Engine subsystems

- Frame capture: BeginFrame on Linux headless-shell (fast, no alpha) or `Page.captureScreenshot` (alpha + supersample)
- Video frame injector: pre-extracts video to images, swaps `<video>` for `<img>` during capture (LRU cache by path + byte budget)
- Audio mixer: FFmpeg-based; per-track delay, volume, master gain, AAC 192k output
- Chunk encoder: H.264 / H.265 / VP9 / ProRes presets with optional GPU
- Streaming encoder: `streamingEncodeMaxDurationSeconds` for long renders
- HDR compositing: `rgba16float` WebGPU readback (headed Chrome), PQ OETF helpers
- Layer compositor: groups DOM by z-order; splits HDR elements into separate layers
- Alpha blit: matrix3d affine extraction, `blitRgba8OverRgb48le`, `blitRgb48leAffine`
- Parallel coordinator: concurrency, coresPerWorker, minParallelFrames, largeRenderThreshold
- Browser pool: optional with timeout configs

### Producer-only

- `RenderConfig` with `hdrMode` (auto / force-hdr / force-sdr), `outputResolution` mapped to `deviceScaleFactor`
- File server injects `HF_EARLY_STUB`, `HF_BRIDGE_SCRIPT`, virtual-time so `window.__hf` bridges `window.__player.renderSeek`
- HDR-aware shader transition compositing via `window.__hf.transitions` metadata

---

## 17. Studio — in-browser NLE

Full editor in packages/studio/:

- **NLELayout**: NLE preview + timeline + controls
- **Timeline**: clip rendering, drag to move (`data-start`), resize (`data-duration`), `data-track-index` reassignment, asset drop, file drop
- **PlayerControls**: scrub, play, pause, frame step (`stepFrameTime`), `STUDIO_PREVIEW_FPS`
- **useTimelinePlayer**: resolves `__player` / `__timeline` / `__timelines`
- **LeftSidebar**: compositions list, asset browser
- **RenderQueue + useRenderQueue**: queue multiple renders
- **LintModal**: in-app lint output
- **MediaPreview + AudioWaveform**: waveform rendering
- **CaptionOverlay, CaptionTimeline, CaptionPropertyPanel**: caption editor
- **useCaptionSync**: word-level sync
- **useElementPicker**: click-to-inspect picker mode
- Built with Tailwind v3 (separate from Tailwind v4 browser runtime used by compositions).

---

## 18. Determinism guarantees

- No `Math.random()` (use seeded PRNGs; mulberry32 is the pattern in skills)
- No `Date.now()` / `new Date()`
- No `setTimeout` / `setInterval` in timeline construction
- No `requestAnimationFrame` (timeline-driven; engine seeks per frame)
- No `repeat: -1` (calculate exact repeats: `Math.ceil(duration / cycleDuration) - 1`)
- No `onComplete`/`onStart`/`onRepeat` callbacks (engine doesn't fire them). **Exception:** `onUpdate` and `tl.call()` ARE supported — they're required for canvas/WebGL rendering, character-by-character typing, and counter patterns. See §10 (Canvas 2D procedural art) for the documented pattern.
- No `gsap.set` on clips from later scenes (use `tl.set(selector, vars, position)`)
- Synchronous timeline construction (no async)
- Master clock can clamp at composition end

---

## 19. Variables / parameterization

Compositions support typed runtime variables:

```html
<html
  data-composition-variables='[
  {"name":"brand","type":"string","default":"Stripe"},
  {"name":"primary","type":"color","default":"#635BFF"},
  {"name":"duration","type":"number","default":15},
  {"name":"darkMode","type":"boolean","default":false},
  {"name":"layout","type":"enum","options":["hero","split","stacked"]}
]'
></html>
```

Access via `window.__hyperframes.getVariables()`. Override at render time:

```bash
npx hyperframes render --variables '{"brand":"Linear","primary":"#5E6AD2"}'
npx hyperframes render --variables-file vars.json
npx hyperframes render --strict-variables  # error if unused / mismatched
```

`validateVariables()` checks values against declarations at the CLI/tooling boundary.

---

## 20. Sub-compositions

Two loading mechanisms:

- **External file:** `data-composition-src="compositions/act-1.html"` — fetched at runtime
- **Inline template:** `<template id="<id>-template">` — extracted by `loadInlineTemplateCompositions`

Each sub-comp:

- Has its own `data-composition-id`
- Has its own `window.__timelines[<id>]`
- Auto-nested into the root timeline
- Scoped CSS via `scopeCssToComposition` (`[data-composition-id="<id>"]` selector)
- Wrapped scripts via `wrapScopedCompositionScript`
- Reads `data-variable-values` merged with own defaults into `window.__hfVariablesByComp[<id>]`
- External scripts load with `EXTERNAL_SCRIPT_LOAD_TIMEOUT_MS` timeout. Failed loads emit `external_composition_load_failed` / `external_composition_script_load_issue` diagnostics.

---

## 21. Global runtime APIs (`window.*`)

| Global                                | Purpose                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `__hyperframes`                       | `{ fitTextFontSize, getVariables }`                                     |
| `__timelines`                         | `{ [compositionId]: GsapTimeline }`                                     |
| `__player`                            | Internal player bridge: seek, play, pause, renderSeek, etc.             |
| `__clipManifest`                      | Computed clip array (for Studio)                                        |
| `__playerReady`                       | Resolved when player ready                                              |
| `__renderReady`                       | Resolved when ready for render capture                                  |
| `__HF_PARITY_MODE`                    | Engine parity flag                                                      |
| `__HF_FPS`                            | Render FPS hint                                                         |
| `__HF_MAX_DURATION_SEC`               | Engine clamp                                                            |
| `__HF_VIRTUAL_TIME__`                 | Set by engine in render mode (shader-transitions switches paths)        |
| `__hfThreeTime`                       | Current time for Three.js adapter                                       |
| `__HF_PICKER_API`                     | Element picker hook for Studio                                          |
| `__hfAnime`                           | Array of Anime.js instances                                             |
| `__hfLottie`                          | Array of Lottie animations                                              |
| `__hfVariables`                       | Resolved root variables                                                 |
| `__hfVariablesByComp`                 | Per-composition variable map                                            |
| `__hfRuntimeTeardown`                 | Cleanup function                                                        |
| `__tailwindReady`                     | Tailwind browser build ready (gates capture)                            |
| `__hf.transitions`                    | Shader transition metadata (read by producer for HDR-aware compositing) |
| `__beforeTimeline`, `__afterTimeline` | Optional user hooks                                                     |
| `__afterRender`, `__beforeRender`     | Optional user hooks                                                     |
| `gsap`, `THREE`, `anime`, `lottie`    | Library globals                                                         |

Control bridge actions: play, pause, seek, set-muted, set-playback-rate, enable-pick-mode, disable-pick-mode, set-volume, set-media-output-muted.

---

## 22. Skills available — 16

| Skill                     | Purpose                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| hyperframes               | Core framework skill (composition authoring)                            |
| hyperframes-cli           | All CLI commands as an agent skill                                      |
| media-use                 | Media workflows (TTS, transcribe, captions integration)                 |
| hyperframes-registry      | Installing blocks/components                                            |
| hyperframes-contrast      | WCAG audit (scripts/contrast-report.mjs)                                |
| hyperframes-animation-map | Per-tween bbox + flags report                                           |
| website-to-video          | Capture → DESIGN.md → brief → storyboard+script → VO → build → validate |
| remotion-to-hyperframes   | Migration patterns + API map + CustomEase                               |
| gsap                      | GSAP API + plugins reference                                            |
| animejs                   | Anime.js v4 patterns                                                    |
| css-animations            | @keyframes patterns                                                     |
| waapi                     | Web Animations API                                                      |
| lottie                    | Lottie integration                                                      |
| three                     | Three.js + deterministic seek                                           |
| tailwind                  | Tailwind browser runtime v4                                             |
| contribute-catalog        | Adding blocks to registry                                               |

---

## 23. References inventory (skills/hyperframes/references/)

16 reference docs covering:

- text-effects.md — 24 named text animation effects (per-character, per-word, per-line, whole) — vocabulary reference for the separate `pixel-point/animate-text` skill (load it via `npx skills add pixel-point/animate-text` or `/animate-text`). Specs live in that upstream skill, not in this repo.
- transitions.md + transitions/catalog.md + 14 category subfiles
- css-patterns.md (marker patterns)
- dynamic-techniques.md (caption animation)
- motion-principles.md (easing as emotion, choreography)
- typography.md (banned-font list, pairing rules, variable fonts)
- narration.md (script + VO pacing)
- captions.md (caption authoring contract)
- audio-reactive.md (band mappings + extraction)
- transcript-guide.md (whisper, Groq, OpenAI workflows)
- techniques.md (the big technique catalog — SVG, canvas 2D, 3D, kinetic, lottie, variable fonts, MotionPath, audio-reactive)
- beat-direction.md, design-picker.md, prompt-expansion.md, video-composition.md
- visual-styles.md (8 named visual styles: Swiss Pulse, Velvet Standard, Deconstructed, Maximalist Type, Data Drift, Soft Signal, Folk Frequency, Shadow Cut — available via the `visual-style` skill)

---

## 24. Documentation pages (docs/)

27 mdx pages in docs/guides/ and docs/packages/:

**Guides:** 4k-rendering, claude-design, common-mistakes, deploy, gsap-animation, hdr, html-in-canvas, hyperframes-vs-remotion, open-design, performance, prompting, remove-background, rendering, timeline-editing, troubleshooting, video-editor-cheatsheet, website-to-video, etc.

**Packages:** cli.mdx, core.mdx, engine.mdx, player.mdx, producer.mdx, studio.mdx
