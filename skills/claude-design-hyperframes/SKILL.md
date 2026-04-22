---
name: claude-design-hyperframes
description: Claude Design entry point for HyperFrames. Produce renderable HyperFrames videos in Claude Design with a working in-pane preview. Use for any request to create a video, animation, launch teaser, editorial explainer, product tour, social reel, or motion deliverable.
---

# Claude Design + HyperFrames

HyperFrames is an open-source HTML-native video framework. Write HTML + CSS + a paused GSAP timeline; `npx hyperframes render index.html` produces the MP4. The composition file is the source of truth — the same file powers the in-browser preview and the render engine.

This file is self-contained. Every rule, contract, table, and template you need to produce a correct composition is inlined below. Do not skip sections assuming they are "references for later" — read through in order, then start writing.

## Deliverables

Produce exactly these files per project:

- `index.html` — the composition. The root render target.
- `preview.html` — a thin shell embedding the composition via `@hyperframes/player`. Copy the template below verbatim.
- `README.md` — one paragraph describing the video + the commands to preview and render locally.
- `DESIGN.md` — when a brand, palette, visual identity, or named style is specified in the prompt (or you invent one, which you should when nothing is given).

Default to 1920×1080 at 30fps unless the prompt specifies otherwise.

## Pre-delivery checklist

Before saying "done", verify every item against your generated files. Each has caused silent preview failures in past runs. If any fails, fix it before shipping — do not ship with "I think it should work".

1. `index.html` loads GSAP, then on the very next line loads `@hyperframes/core/dist/hyperframe.runtime.iife.js`. Without the runtime pre-load, the player reports `ready` but `currentTime` never advances — the preview is a static frame.
2. `preview.html` sets the player's `src` via the inline script `document.getElementById("p").setAttribute("src", "./index.html" + location.search)` — **not** via the `src=` attribute on the element. Without the token forward, Claude Design's sandbox serves a `"preview token required"` placeholder to the iframe and the preview renders black.
3. `preview.html` is the verbatim template from the section below. No decorative chrome (no header, no wordmark, no aspect-ratio wrapper, no caption bar). `<hyperframes-player>` fills the viewport at `width:100vw;height:100vh`.
4. The string in `data-composition-id` on the root element and the key in `window.__timelines["..."]` are identical. A mismatch silently prevents playback — the player cannot find the timeline and never becomes ready. Default to `"main"` in both places unless the brief specifies otherwise.
5. The GSAP timeline is created with `{ paused: true }` and `.play()` is never called on it. The player and renderer drive playback via frame-accurate seeking.
6. No banned fonts (see Typography section below). Inter, Roboto, Playfair Display, Syne, and their siblings (Inter Tight, Inter Display) are in every LLM's default stack. Use something else.
7. Every multi-scene composition uses transitions between scenes and entrance animations within scenes. No jump cuts. No exit animations except on the final scene.
8. Rendering is deterministic — no `Date.now()`, no unseeded `Math.random()`, no `setInterval`, no `setTimeout` inside timeline construction, no `repeat: -1` on any tween or timeline.

## `preview.html` template (copy verbatim)

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>HyperFrames Preview</title>
    <style>
      html,
      body {
        margin: 0;
        padding: 0;
        background: #111;
        height: 100%;
        overflow: hidden;
      }
    </style>
    <script type="module" src="https://cdn.jsdelivr.net/npm/@hyperframes/player"></script>
  </head>
  <body>
    <hyperframes-player
      id="p"
      controls
      autoplay
      muted
      style="display:block;width:100vw;height:100vh"
    ></hyperframes-player>
    <script>
      document.getElementById("p").setAttribute("src", "./index.html" + location.search);
    </script>
  </body>
</html>
```

If a classic (non-module) script tag is required, swap in the global build but keep the token-forwarding script exactly as-is:

```html
<script src="https://cdn.jsdelivr.net/npm/@hyperframes/player/dist/hyperframes-player.global.js"></script>
<hyperframes-player
  id="p"
  controls
  autoplay
  muted
  style="display:block;width:100vw;height:100vh"
></hyperframes-player>
<script>
  document.getElementById("p").setAttribute("src", "./index.html" + location.search);
</script>
```

## `index.html` composition contract

### Required elements

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>

<div
  id="root"
  data-composition-id="main"
  data-start="0"
  data-duration="30"
  data-width="1920"
  data-height="1080"
>
  <!-- scenes with class="clip" + data-start + data-duration + data-track-index -->
</div>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } });
  // …tweens
  window.__timelines["main"] = tl;
</script>
```

### Data attribute tables

Every clip needs these:

| Attribute          | Required                              | Values                                                  |
| ------------------ | ------------------------------------- | ------------------------------------------------------- |
| `id`               | yes                                   | unique identifier                                       |
| `class="clip"`     | yes (on timed visual elements)        | literal string                                          |
| `data-start`       | yes                                   | seconds, or a clip-id reference (`"el-1"`, `"intro+2"`) |
| `data-duration`    | required for `img`/`div`/compositions | seconds. video/audio default to media duration          |
| `data-track-index` | yes                                   | integer. same-track clips cannot overlap in time        |
| `data-media-start` | no                                    | trim offset into source (seconds)                       |
| `data-volume`      | no                                    | 0–1 (default 1) for audio                               |

`data-track-index` controls timeline layering, **not** visual z-order. Use CSS `z-index` for stacking.

Composition roots (index.html's main div, sub-comp roots) also need:

| Attribute              | Required | Values                                     |
| ---------------------- | -------- | ------------------------------------------ |
| `data-composition-id`  | yes      | unique composition ID. root uses `"main"`  |
| `data-start`           | yes      | root: `"0"`                                |
| `data-duration`        | yes      | seconds. takes precedence over GSAP length |
| `data-width`           | yes      | pixel width (1920 or 1080)                 |
| `data-height`          | yes      | pixel height (1080 or 1920)                |
| `data-composition-src` | no       | path to external HTML sub-composition      |

### Layout before animation

Build the **static hero frame** for each scene first — the moment when the most elements are simultaneously visible — before adding any GSAP. Then animate INTO those positions. The CSS position is the ground truth; the tween describes the journey.

Use a `.scene-content` container that fills the scene and uses padding to inset content. Never `position: absolute; top: Npx` on a content container — absolute-positioned containers overflow when content is taller than the remaining space. Reserve `position: absolute` for decorative overlays only.

```css
.scene-content {
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 120px 160px;
  gap: 24px;
  box-sizing: border-box;
}
```

```js
// entrance: animate INTO the CSS position
tl.from(".title", { y: 60, opacity: 0, duration: 0.6, ease: "power3.out" }, 0.3);
tl.from(".subtitle", { y: 40, opacity: 0, duration: 0.5, ease: "power2.out" }, 0.5);
```

### Sub-compositions

Load external sub-comp HTMLs with `data-composition-src`. Sub-comp files use a `<template>` wrapper — standalone `index.html` does NOT (a `<template>` hides its contents from the browser; applied to the root it breaks rendering).

**The HyperFrames runtime auto-nests sub-compositions in both preview AND render.** Don't hedge with a plain `<iframe src="compositions/sub.html">` — a `<template>`-wrapped file renders empty in a plain iframe because the template contents are inert by HTML spec. The `data-composition-src` attribute on a div is the supported mechanism; the runtime handles loading, timeline attachment, and texture composite. Examples of real compositions using this: `registry/examples/kinetic-type`, `registry/examples/nyt-graph`, `registry/examples/decision-tree`.

```html
<!-- in index.html -->
<div
  id="chart"
  data-composition-id="data-chart"
  data-composition-src="compositions/data-chart.html"
  data-start="5"
  data-duration="8"
  data-track-index="1"
></div>

<!-- compositions/data-chart.html -->
<template id="data-chart-template">
  <div data-composition-id="data-chart" data-width="1920" data-height="1080">
    <!-- content -->
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      // tweens…
      window.__timelines["data-chart"] = tl;
    </script>
  </div>
</template>
```

Framework auto-nests sub-timelines — do NOT manually add them to the root timeline.

### Video and audio

Video must be `muted playsinline`. Audio is ALWAYS a separate `<audio>` element, even when the audio came from the same video file:

```html
<video
  id="v"
  data-start="0"
  data-duration="30"
  data-track-index="0"
  src="clip.mp4"
  muted
  playsinline
></video>
<audio
  id="v-audio"
  data-start="0"
  data-duration="30"
  data-track-index="2"
  src="clip.mp4"
  data-volume="1"
></audio>
```

## Determinism ❌ / ✅

The render engine seeks the timeline to exact frames and expects pixel-identical output on repeat renders. Anything non-deterministic breaks this.

| ❌ Never                                                           | ✅ Use instead                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `Date.now()`, `performance.now()`                                  | `tl.time()` inside `onUpdate`, or hard-coded timing                                                     |
| `Math.random()` unseeded                                           | seeded PRNG (e.g. mulberry32). Claude Design should inline a tiny PRNG if needed                        |
| `setInterval`, `setTimeout`                                        | timeline tweens + `onUpdate` callbacks                                                                  |
| `repeat: -1` on any tween                                          | `repeat: Math.ceil(duration / cycleDuration) - 1`                                                       |
| building timelines in `async`/`setTimeout`                         | construct synchronously at page load                                                                    |
| `video.play()`, `audio.play()`                                     | framework owns playback — never call these                                                              |
| animating `visibility` or `display`                                | use `autoAlpha` (animates opacity AND visibility) or opacity-only                                       |
| `gsap.set()` on clips from later scenes                            | clips in later scenes don't exist yet at page load. Use `tl.set(selector, vars, timePosition)` instead  |
| `<br>` in content text                                             | use `max-width` for natural wrap. Exception: short display titles where each word is deliberately split |
| animating the same property on the same element from two timelines | choose one driver per element-property pair                                                             |
| `data-layer`, `data-end` attributes                                | use `data-track-index` and `data-duration`                                                              |

## Scene transitions

Non-negotiable rules for multi-scene compositions:

1. **Every composition uses transitions.** No jump cuts.
2. **Every scene uses entrance animations.** Every element animates IN via `gsap.from()` — no element pops fully-formed onto screen.
3. **Exit animations are BANNED** except on the final scene. Do NOT `gsap.to()` elements to `opacity: 0` or offscreen before a transition. The transition IS the exit. Outgoing scene content must be fully visible the moment the transition starts.
4. **Final scene only** may fade out (e.g., fade to black). This is the only scene where exit animations are allowed.

```js
// WRONG — empties the scene before the transition fires
tl.to("#s1-title", { opacity: 0, duration: 0.4 }, 6.5);

// RIGHT — entrance only, transition at 7.2s handles the exit
tl.from("#s1-title", { y: 50, opacity: 0, duration: 0.7, ease: "power3.out" }, 0.3);
```

### Energy → primary transition

Pick ONE primary transition used for 60–70% of scene changes, plus 1–2 accents. Never use a different transition for every scene.

| Energy                                   | CSS primary                  | Shader primary                       | Accent                         | Duration  | Easing                 |
| ---------------------------------------- | ---------------------------- | ------------------------------------ | ------------------------------ | --------- | ---------------------- |
| **Calm** (wellness, brand story, luxury) | blur crossfade, focus pull   | cross-warp-morph, thermal-distortion | light-leak, circle iris        | 0.5–0.8s  | `sine.inOut`, `power1` |
| **Medium** (corporate, SaaS, explainer)  | push slide, staggered blocks | whip-pan, cinematic-zoom             | squeeze, vertical push         | 0.3–0.5s  | `power2`, `power3`     |
| **High** (promos, sports, music, launch) | zoom through, overexposure   | ridged-burn, glitch, chromatic-split | staggered blocks, gravity drop | 0.15–0.3s | `power4`, `expo`       |

### Mood → transition type

Transitions communicate — choose deliberately.

| Mood                     | CSS / shader transitions                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Warm / inviting**      | light leak, blur crossfade, focus pull, film burn · shader: thermal-distortion, light-leak, cross-warp-morph        |
| **Cold / clinical**      | squeeze, zoom out, blinds, shutter, grid dissolve · shader: gravitational-lens                                      |
| **Editorial / magazine** | push slide, vertical push, diagonal split, shutter · shader: whip-pan                                               |
| **Tech / futuristic**    | grid dissolve, staggered blocks, blinds, chromatic aberration · shader: glitch, chromatic-split                     |
| **Tense / edgy**         | glitch, VHS, chromatic aberration, ripple · shader: ridged-burn, glitch, domain-warp                                |
| **Playful / fun**        | elastic push, 3D flip, circle iris, morph circle, clock wipe · shader: ripple-waves, swirl-vortex                   |
| **Dramatic / cinematic** | zoom through, zoom out, gravity drop, overexposure, color dip to black · shader: cinematic-zoom, gravitational-lens |
| **Premium / luxury**     | focus pull, blur crossfade, color dip to black · shader: cross-warp-morph, thermal-distortion                       |
| **Retro / analog**       | film burn, light leak, VHS, clock wipe · shader: light-leak                                                         |

### Duration presets

| Preset     | Duration | Easing               |
| ---------- | -------- | -------------------- |
| `snappy`   | 0.2s     | `power4.inOut`       |
| `smooth`   | 0.4s     | `power2.inOut`       |
| `gentle`   | 0.6s     | `sine.inOut`         |
| `dramatic` | 0.5s     | `power3.in` → `.out` |
| `instant`  | 0.15s    | `expo.inOut`         |
| `luxe`     | 0.7s     | `power1.inOut`       |

### Narrative position

| Position               | Use                                                 | Why                                                  |
| ---------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| Opening                | most distinctive, match mood, 0.4–0.6s              | sets the visual language for the piece               |
| Between related points | your primary, consistent, 0.3s                      | content is continuing — don't distract               |
| Topic change           | something different from your primary               | signals a new section; the viewer's brain resets     |
| Climax / hero reveal   | boldest accent, fastest or most dramatic            | this is the payoff — spend your best transition here |
| Wind-down              | return to gentle, blur crossfade, 0.5–0.7s          | let the viewer exhale after the climax               |
| Outro                  | slowest, simplest, crossfade or color dip, 0.6–1.0s | closure — don't introduce new energy at the end      |

### Shader transitions (WebGL)

Use the `@hyperframes/shader-transitions` package. Exactly these 14 shader names are available — any other string throws `[HyperShader] Unknown shader`:

| Shader                | Description                                          |
| --------------------- | ---------------------------------------------------- |
| `domain-warp`         | organic noise-based warp with glowing edge           |
| `ridged-burn`         | ridged noise burn with sparks and heat glow          |
| `whip-pan`            | horizontal motion blur, fast camera pan              |
| `sdf-iris`            | circular iris wipe with glowing ring edge            |
| `ripple-waves`        | concentric ripple distortion from center             |
| `gravitational-lens`  | warping gravity well with chromatic aberration       |
| `cinematic-zoom`      | radial zoom blur with chromatic fringing             |
| `chromatic-split`     | RGB channel separation expanding from center         |
| `glitch`              | digital glitch with block displacement and scanlines |
| `swirl-vortex`        | spiral rotation with noise-based warping             |
| `thermal-distortion`  | heat shimmer rising from the bottom                  |
| `flash-through-white` | flash to white then reveal next scene                |
| `cross-warp-morph`    | noise-driven morph blending both scenes              |
| `light-leak`          | warm cinematic light leak with lens flare            |

Load the package from CDN and wire it to your timeline. The IIFE build exposes the package on **`window.HyperShader`** (not `HyperframesShaderTransitions` — use the exact name below):

```html
<script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions/dist/index.global.js"></script>
<script>
  const tl = gsap.timeline({ paused: true });
  // …scene entrance tweens…
  window.HyperShader.init({
    bgColor: "#0a0a0a",
    accentColor: "#ff6b2b",
    scenes: ["scene-1", "scene-2", "scene-3"],
    timeline: tl,
    transitions: [
      { time: 5.0, shader: "cinematic-zoom", duration: 0.6 },
      { time: 12.0, shader: "whip-pan", duration: 0.5 },
    ],
  });
  window.__timelines["main"] = tl;
</script>
```

**Scene visibility is yours to own.** HyperShader drives the transition overlay (the WebGL canvas during transition intervals) — it does NOT manage which scene is currently visible between transitions. Start every scene at `opacity: 0` in CSS (except scene-1, which is visible from t=0), then mount/unmount each scene on the timeline:

```js
// inside tl construction, after init()
tl.set("#scene-1", { autoAlpha: 1 }, 0); // scene 1 visible from start
tl.set("#scene-1", { autoAlpha: 0 }, 5.0); // at transition start, fade out
tl.set("#scene-2", { autoAlpha: 1 }, 5.0); // scene 2 visible
tl.set("#scene-2", { autoAlpha: 0 }, 12.0);
tl.set("#scene-3", { autoAlpha: 1 }, 12.0);
// …etc
```

Without these sets, all scenes stay at CSS opacity:0 and the composition shows nothing between transitions.

Shader-compatible CSS rules (apply only to shader-transition compositions — `html2canvas` captures each scene to a WebGL texture, and its rendering pipeline doesn't match CSS exactly):

- **No `transparent` in gradients.** Canvas interpolates `transparent` as `rgba(0,0,0,0)` (black at zero alpha), creating dark fringes. Use the target color at zero alpha: `rgba(200,117,51,0)` not `transparent`.
- **No gradients on elements thinner than 4px.** Use solid `background-color` on thin accent lines.
- **No CSS variables (`var(...)`) on elements captured.** Use literal hex colors in inline styles instead.
- **No gradient opacity below 0.15.** Raise to 0.15+ or use a solid equivalent.
- **Every `.scene` div must have explicit `background-color`**, AND the same color must be passed as `bgColor` in the `init()` config. Without either, the texture renders black.
- **Mark uncapturable decorative elements with `data-no-capture`.** They stay in the DOM but are skipped during texture capture.

### When NOT to use shaders

Don't mix CSS and shader transitions in the same composition — pick one. Shaders are powerful but heavier (WebGL context + per-pixel compositing).

**Prefer CSS transitions** when the composition will be previewed interactively with lots of scrubbing. Shader transitions are optimized for linear playback — the package captures scene textures via `html2canvas` at transition time and holds them between transitions. When a user scrubs to an arbitrary time, the canvas still holds a stale texture until a new capture completes, producing a visible blank gap. For final renders (`npx hyperframes render`) this doesn't matter — the render engine runs linearly.

**Dev-time scrubbing trap:** don't call `tl.progress(n)` in rapid succession (e.g. from a loop or dev tools) on a shader-transition composition. Each progress change can queue a fresh `html2canvas` capture; rapid scrubbing deadlocks the capture pipeline. If you need to inspect a specific time, `tl.pause()` first and call `tl.time(t)` once — or use the player's `currentTime` setter, which throttles.

For CSS transitions: scenes are absolute-positioned `.scene` containers with opacity driven directly by GSAP tweens. Every scrub position renders cleanly because the DOM is the surface, no capture latency.

## Typography

### Banned fonts — do not use these

Training-data defaults every LLM reaches for. They produce monoculture across compositions.

```
Inter, Roboto, Open Sans, Noto Sans, Arimo, Lato, Source Sans, PT Sans,
Nunito, Poppins, Outfit, Sora, Playfair Display, Cormorant Garamond,
Bodoni Moda, EB Garamond, Cinzel, Prata, Syne
```

**Also banned:** close siblings that read as the same voice (Inter Tight, Inter Display, Source Sans 3). Syne in particular is the most overused "distinctive" display font and is an instant AI tell.

When you reach for Inter, stop. Pick something else. Trending Google Fonts work well — some safe modern picks by category:

- **Display serif:** Fraunces, Instrument Serif, Newsreader, Libre Caslon Display, DM Serif Display
- **Display sans:** Space Grotesk, Geist, General Sans, Bricolage Grotesque, Host Grotesk, Unbounded
- **Monospace:** JetBrains Mono, Geist Mono, IBM Plex Mono, Fira Code, Azeret Mono, DM Mono
- **Impact / condensed:** Bebas Neue, Oswald (heavy weight), Anton, Hepta Slab, Big Shoulders Display

### Pairing rules

- **Don't pair two sans-serifs.** Cross the boundary: serif + sans, or sans + mono.
- **One expressive font per scene.** Pair one performer with one recessive face.
- **Weight contrast must be extreme.** 300 vs 900, not 400 vs 700. The contrast must be visible in motion at a glance.
- **Video sizes, not web sizes.** Body ≥20px, headlines ≥60px, data labels ≥16px. Never 14px for body.
- **Tracking tighter than web.** `-0.03em` to `-0.05em` on display sizes. Video encoding compresses letter detail.

### Dark-background compensation

Light text on dark backgrounds reads heavier and spacing reads tighter. Compensate:

- Use `font-weight: 350` instead of 400 for body text.
- Increase `line-height` by 0.05–0.1 beyond your light-background equivalent.
- Add `letter-spacing: 0.01em` on display sizes.

### OpenType features for data

```css
/* Tabular numbers — digits align vertically in columns */
.stat-value,
.timer,
.data-column {
  font-variant-numeric: tabular-nums;
}

/* Diagonal fractions — renders 1/2 as ½ */
.recipe-amount,
.ratio {
  font-variant-numeric: diagonal-fractions;
}

/* Small caps for abbreviations — less visual shouting */
.abbreviation {
  font-variant-caps: all-small-caps;
}

/* Disable ligatures in code — keep fi, fl, ffi separate */
code {
  font-variant-ligatures: none;
}
```

`tabular-nums` is essential anywhere numbers stack vertically — stat callouts, timers, scoreboards, data tables.

## Motion principles

### Guardrails

Rules LLMs violate by default. Stop.

- **Don't use the same ease on every tween.** Vary eases like you vary font weights — no more than 2 independent tweens with the same ease in a scene.
- **Don't use the same speed on everything.** 0.4–0.5s default is lazy. The slowest scene should be 3× slower than the fastest. Vary duration deliberately.
- **Don't enter every element from the same direction.** `y: 30, opacity: 0` on every tween is a tell. Vary: from left, from right, from scale, opacity-only, letter-spacing.
- **Don't use the same stagger on every scene.** Each scene needs its own rhythm.
- **Don't use ambient zoom on every scene.** Slow pan, subtle rotation, scale push, color shift, or stillness. Stillness after motion is powerful.
- **Don't start at t=0.** Offset the first animation 0.1–0.3s. Zero-delay feels like a jump cut.

### Easing is emotion

The tween is the verb. The easing is the adverb. `expo.out` = confident. `sine.inOut` = dreamy. `elastic.out` = playful. Choose deliberately.

- `.out` for entrances (fast start, decelerates into place, feels responsive). Your default.
- `.in` for exits (slow start, accelerates away, throws them off).
- `.inOut` for elements moving between positions.

### Speed communicates weight

| Range     | Feel                              |
| --------- | --------------------------------- |
| 0.15–0.3s | energy, urgency, confidence       |
| 0.3–0.5s  | professional, most content        |
| 0.5–0.8s  | gravity, luxury, contemplation    |
| 0.8–2.0s  | cinematic, emotional, atmospheric |

### Scene structure: build / breathe / resolve

Every scene has three phases. Don't dump everything in build and leave nothing for breathe or resolve.

- **Build (0–30%)** — elements enter, staggered.
- **Breathe (30–70%)** — content visible, alive with ONE ambient motion. Slow scale drift, hue rotation, hairline pulse.
- **Resolve (70–100%)** — decisive end. Exits are faster than entrances; a card takes 0.4s to appear and 0.25s to disappear.

### Visual composition — frames, not pages

You build for the web by default. Stop.

- **Two focal points minimum per scene.** The eye needs somewhere to travel. Never a single text block floating in empty space.
- **Fill the frame.** Hero text: 60–80% of width. No web-sized elements.
- **Three layers minimum per scene.** Background treatment (glow, oversized faded type, color panel). Foreground content. Accent elements (dividers, labels, data bars).
- **Background is not empty.** Radial glows, oversized faded type bleeding off-frame, subtle border panels, hairline rules. Pure solid `#000` reads as "nothing loaded."
- **Anchor to edges.** Pin content to left/top or right/bottom. Centered-and-floating is a web pattern.
- **Split frames.** Data panel on the left, content on the right. Top bar with metadata, full-width below. Zone-based layouts, not centered stacks.
- **Use structural elements.** Rules, dividers, border panels. They create paths for the eye and animate well (`scaleX` from 0).

### Animation guardrails

- Offset first animation 0.1–0.3s (not t=0).
- Use at least 3 different eases per scene.
- Don't repeat an entrance pattern within a scene.
- Avoid full-screen linear gradients on dark backgrounds (H.264 banding — use radial or solid + localized glow).
- 60px+ headlines, 20px+ body, 16px+ data labels for rendered video.
- `font-variant-numeric: tabular-nums` on number columns.

## Visual direction

If the prompt doesn't specify a style, brand, palette, or mood, do NOT default to warm editorial (cream paper + serif + terracotta). Either:

1. **Ask one clarifying question** — _"What mood — clinical, raw, luxury, warm, dramatic, playful?"_ — and wait for the answer, OR
2. **Commit to a specific aesthetic** from the 8 preset styles below that matches the content type, and write it into `DESIGN.md` before writing `index.html`.

Don't serve the same aesthetic for every brief. Match visual direction to the content:

| Style               | Mood                  | Best for                           | GSAP signature                         | Primary shader                      |
| ------------------- | --------------------- | ---------------------------------- | -------------------------------------- | ----------------------------------- |
| **Swiss Pulse**     | clinical, precise     | SaaS, dev tools, APIs, metrics     | `expo.out`, `power4.out` · snap        | `cinematic-zoom`, `sdf-iris`        |
| **Velvet Standard** | premium, timeless     | luxury, enterprise, keynotes       | `sine.inOut`, `power1` · glide         | `cross-warp-morph`                  |
| **Deconstructed**   | industrial, raw       | tech launches, security, punk      | `back.out(2.5)`, `steps(8)`, `elastic` | `glitch`, `whip-pan`                |
| **Maximalist Type** | loud, kinetic         | launches, announcements            | varied, explosive                      | `ridged-burn`                       |
| **Data Drift**      | futuristic, immersive | AI, ML, cutting-edge tech          | `power3.inOut`, slow                   | `gravitational-lens`, `domain-warp` |
| **Soft Signal**     | intimate, warm        | wellness, personal stories, brand  | `sine.out`, slow entrances             | `thermal-distortion`                |
| **Folk Frequency**  | cultural, vivid       | consumer apps, food, communities   | `back.out(1.4)`, playful               | `swirl-vortex`, `ripple-waves`      |
| **Shadow Cut**      | dark, cinematic       | dramatic reveals, security, exposé | `power4.in`, long holds                | `domain-warp`                       |

`DESIGN.md` format (write this BEFORE `index.html`):

```markdown
# <project> — DESIGN.md

## Style prompt

<one paragraph: mood, palette feel, typographic voice>

## Colors

- `#hexA` — role (background)
- `#hexB` — role (ink / foreground)
- `#hexC` — role (one accent)
- `#hexD` — role (secondary text, optional)

## Typography

- <display family> — role (headlines)
- <body family> — role (body, UI)
- <mono family> — role (metadata, numerics, optional)

## Motion

<1–3 rules: pacing, easing preference, what NOT to do>
```

Reference these tokens via CSS custom properties on `:root` in `index.html`.

## GSAP essentials (HyperFrames-specific)

### Core tween methods

| Method                                   | Use                                              |
| ---------------------------------------- | ------------------------------------------------ |
| `gsap.to(targets, vars)`                 | animate from current state to `vars`             |
| `gsap.from(targets, vars)`               | animate FROM `vars` TO current state (entrances) |
| `gsap.fromTo(targets, fromVars, toVars)` | explicit start and end                           |
| `gsap.set(targets, vars)`                | apply immediately at duration 0                  |

All property names are camelCase (`backgroundColor`, not `background-color`).

### `immediateRender` gotcha

`from()` and `fromTo()` default to `immediateRender: true` — they apply their "from" state IMMEDIATELY at timeline construction, not when the tween starts. This is the root cause of the "stuck transition overlay" bug:

```js
// WRONG — this sets #wipe to yPercent:-100 AT TIMELINE CONSTRUCTION,
// which may place it over the stage before the transition is supposed to run.
tl.fromTo("#wipe", { yPercent: -100 }, { yPercent: 0, duration: 0.5 }, 17.3);

// RIGHT — define initial state explicitly via CSS or gsap.set() BEFORE
// the tween, and use tl.to() for the actual animation.
gsap.set("#wipe", { yPercent: 100 }); // off-stage below
tl.to("#wipe", { yPercent: 0, duration: 0.5 }, 17.3); // enter from below
```

Or set `immediateRender: false` explicitly on the `fromTo` if you must use it and the initial state is only correct at the tween's start time.

### Transform aliases

Prefer GSAP's transform aliases over raw `transform` strings:

| Property                    | CSS equivalent         |
| --------------------------- | ---------------------- |
| `x`, `y`, `z`               | `translateX/Y/Z` in px |
| `xPercent`, `yPercent`      | `translateX/Y` in %    |
| `scale`, `scaleX`, `scaleY` | `scale`                |
| `rotation`                  | `rotate` in deg        |
| `rotationX`, `rotationY`    | 3D rotate              |
| `transformOrigin`           | `transform-origin`     |

### `autoAlpha` over `opacity`

`autoAlpha` animates opacity AND toggles `visibility: hidden` at 0 (so elements don't catch pointer events while invisible). Prefer it unless you have a specific reason to keep visibility visible.

### Timeline position parameter

Third argument to `tl.to()` / `tl.from()` / `tl.fromTo()`:

- absolute: `1` — at 1s
- relative: `"+=0.5"`, `"-=0.2"`
- label: `"intro"`, `"intro+=0.3"`
- alignment: `"<"` (same start as previous), `">"` (after previous ends), `"<0.2"` (0.2s after previous starts)

### Stagger > separate tweens

Use `stagger` for groups — much cleaner than N tweens with manual delays:

```js
tl.from(
  ".card",
  {
    y: 40,
    opacity: 0,
    duration: 0.5,
    stagger: { each: 0.08, from: "start" }, // or { amount: 0.3, from: "center" }
  },
  2.0,
);
```

## Registry blocks

HyperFrames ships a block registry at `https://github.com/heygen-com/hyperframes/tree/main/registry/blocks`. Blocks are pre-built sub-compositions you drop into a host composition via `data-composition-src`.

Claude Design can't run `hyperframes add <name>` (it's a CLI command), but it CAN fetch the block HTML directly and wire it manually:

1. Fetch `https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/blocks/<name>/<name>.html`
2. Save as `compositions/<name>.html` in the project
3. Wire into `index.html` with a sub-composition div

Available blocks (partial list, useful for Claude Design work):

| Block                | Purpose                                 |
| -------------------- | --------------------------------------- |
| `data-chart`         | animated bar/line chart sub-composition |
| `flowchart`          | animated flow diagram                   |
| `logo-outro`         | animated logo reveal for closing scenes |
| `app-showcase`       | product UI mock layout                  |
| `spotify-card`       | Spotify-style music card UI             |
| `instagram-follow`   | Instagram follow-button UI              |
| `reddit-post`        | Reddit post layout                      |
| `x-post`             | X/Twitter post layout                   |
| `macos-notification` | macOS-style notification                |
| `tiktok-follow`      | TikTok follow-button UI                 |
| `yt-lower-third`     | YouTube-style lower-third graphic       |

The full list of 39 blocks is at the URL above. Browse it when the brief calls for something specific.

## Optional feature references (fetch when needed)

The below cover specific capabilities beyond basic motion. Fetch ONLY when the request requires the feature — otherwise skip.

- **Captions / subtitles synced to audio** → https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/captions.md
- **TTS narration (Kokoro-82M)** → https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/tts.md
- **Audio-reactive animation (amplitude, frequency bands)** → https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/audio-reactive.md
- **CSS text-highlight patterns (marker, circle, burst, scribble, sketchout)** → https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/css-patterns.md
- **Dynamic caption animations (karaoke, slam, scatter, elastic, 3D)** → https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/dynamic-techniques.md
- **Audio transcript generation** → https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/transcript-guide.md
- **Installable blocks + components (`hyperframes add`)** → https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-registry/SKILL.md

## Worked examples

Pattern-match from real compositions. Browse `https://github.com/heygen-com/hyperframes/tree/main/registry/examples` — every example is a full, renderable composition authored by the HyperFrames team. Specific picks by aesthetic:

- **Editorial / Velvet Standard** → `vignelli` (`registry/examples/vignelli/index.html`)
- **Warm editorial** → `warm-grain` (`registry/examples/warm-grain/index.html`)
- **Swiss Pulse** → `swiss-grid` (`registry/examples/swiss-grid/index.html`)
- **Kinetic typography** → `kinetic-type` (`registry/examples/kinetic-type/index.html`)
- **Product launch** → `product-promo` (`registry/examples/product-promo/index.html`)
- **Data visualization** → `nyt-graph` (`registry/examples/nyt-graph/index.html`)
- **Decision-tree / flow** → `decision-tree` (`registry/examples/decision-tree/index.html`)

Fetch one that matches the brief before writing. Reading a real, working composition teaches more than prose rules ever will.

## Surface behavior

- Claude Design does not use slash commands.
- The preview pane runs compositions inside a sandbox at `*.claudeusercontent.com` that requires a `?t=<token>` query on every request — that's why the `preview.html` template forwards `location.search`. When opened locally (no token in URL), the forward is a no-op.
- Claude Design can't run CLI commands (`hyperframes render`, `hyperframes tts`, `hyperframes capture`). For the render/preview steps, include the commands in `README.md` for the user to run locally after downloading the ZIP.

## Output expectations

When done, the user's ZIP must satisfy:

- `preview.html` plays the composition cleanly in Claude Design's in-pane preview AND when opened locally after download.
- `index.html` is renderable via `npx hyperframes render index.html` with no lint errors.
- `README.md` explains how to preview locally (`open preview.html`) and render (`npx hyperframes render index.html`).
- `DESIGN.md` exists if any visual identity was specified or invented.

## Example prompts

- `Use https://github.com/heygen-com/hyperframes/blob/main/skills/claude-design-hyperframes/SKILL.md and make a 20-second product launch video about our new API. Deliver index.html, preview.html, and README.md.`
- `Use the HyperFrames Claude Design skill at https://github.com/heygen-com/hyperframes/blob/main/skills/claude-design-hyperframes/SKILL.md and turn https://www.anthropic.com/news/claude-design-anthropic-labs into a 45-second editorial launch video.`
- `Use the HyperFrames Claude Design skill entry point and build a 9:16 social teaser with captions, strong transitions, and a player-based preview.`
- `Apply the HyperFrames Claude Design skill. Make a 60s cinematic launch video for [product]. Shader transitions throughout (consistent primary matching the mood). Pattern-match from the vignelli example.`
