---
name: claude-design-hyperframes
description: Claude Design entry point for HyperFrames. Produce renderable HyperFrames videos in Claude Design with a working in-pane preview. Use for any request to create a video, animation, launch teaser, editorial explainer, product tour, social reel, or motion deliverable.
---

# Claude Design + HyperFrames

HyperFrames is an open-source HTML-native video framework. Write HTML + CSS + a paused GSAP timeline; `npx hyperframes render index.html` produces the MP4. The composition file is the source of truth — the same file powers the in-browser preview and the render engine.

This file is self-contained. You have strong defaults for design, motion, typography, and GSAP — this skill only tells you the HyperFrames-specific rules and gotchas you couldn't guess.

## Deliverables

- `index.html` — the composition / render target.
- `preview.html` — thin shell embedding the composition via `@hyperframes/player`. Copy the template below verbatim.
- `README.md` — one paragraph + the commands to preview and render locally.
- `DESIGN.md` — when a brand, palette, visual identity, or named style is specified in the prompt, or when you invent one (which you should if nothing is given).

Default 1920×1080 at 30fps unless the prompt specifies otherwise.

## Pre-delivery checklist

Verify every item against your generated files before shipping. If any fails, fix it — do not ship with "I think it should work".

1. `index.html` loads GSAP, then on the very next line loads `@hyperframes/core/dist/hyperframe.runtime.iife.js`. Without the runtime pre-load, the player reports `ready` but the timeline never advances.
2. `preview.html` sets the player's `src` via the inline script `document.getElementById("p").setAttribute("src", "./index.html" + location.search)` — **not** via the `src=` attribute on the tag. Without the token forward, Claude Design's sandbox serves a `"preview token required"` placeholder and the in-pane preview renders black.
3. `preview.html` is the template below verbatim. No decorative chrome (no header, wordmark, aspect-ratio wrapper, caption). `<hyperframes-player>` fills the viewport at `width:100vw;height:100vh`.
4. The string in `data-composition-id` on the root and the key in `window.__timelines["..."]` are identical. A mismatch silently prevents playback. Default to `"main"` unless the brief specifies otherwise.
5. The GSAP timeline is created with `{ paused: true }` and `.play()` is never called on it.
6. No banned fonts (Inter, Inter Tight, Inter Display, Roboto, Syne, Playfair Display, and the rest of the list below).
7. Every multi-scene composition uses transitions between scenes and entrance animations within scenes. No jump cuts. No exit animations except on the final scene.
8. Deterministic rendering — no `Date.now()`, no unseeded `Math.random()`, no `setInterval`, no `repeat: -1`, no async timeline construction.

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

If a classic (non-module) script tag is required, swap to the global build but keep the token-forwarding script:

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

Clips (timed visual elements):

| Attribute          | Required                          | Values                                                |
| ------------------ | --------------------------------- | ----------------------------------------------------- |
| `id`               | yes                               | unique identifier                                     |
| `class="clip"`     | yes                               | literal string                                        |
| `data-start`       | yes                               | seconds, or clip-id reference (`"el-1"`, `"intro+2"`) |
| `data-duration`    | required for img/div/compositions | seconds. video/audio default to media duration        |
| `data-track-index` | yes                               | integer. same-track clips cannot overlap in time      |
| `data-media-start` | no                                | trim offset into source (seconds)                     |
| `data-volume`      | no                                | 0–1 (default 1) for audio                             |

`data-track-index` is timeline layering, NOT visual z-order. Use CSS `z-index` for stacking.

Composition roots also need:

| Attribute              | Required | Values                                     |
| ---------------------- | -------- | ------------------------------------------ |
| `data-composition-id`  | yes      | unique ID. root uses `"main"`              |
| `data-start`           | yes      | root: `"0"`                                |
| `data-duration`        | yes      | seconds. takes precedence over GSAP length |
| `data-width`           | yes      | pixel width (1920 or 1080)                 |
| `data-height`          | yes      | pixel height (1080 or 1920)                |
| `data-composition-src` | no       | path to external HTML sub-composition      |

### Sub-compositions

Load external sub-comp HTMLs with `data-composition-src`. Sub-comp files use a `<template>` wrapper — standalone `index.html` does NOT (a `<template>` hides its contents from the browser; applied to the root it breaks rendering).

**The HyperFrames runtime auto-nests sub-compositions in both preview AND render.** Don't hedge with a plain `<iframe src="compositions/sub.html">` — a `<template>`-wrapped file renders empty in a plain iframe because the template contents are inert by HTML spec. The `data-composition-src` attribute on a div is the supported mechanism. Examples: `registry/examples/kinetic-type`, `nyt-graph`, `decision-tree`.

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

Framework auto-nests sub-timelines — do NOT manually add them to the root.

### Video and audio

Video must be `muted playsinline`. Audio is ALWAYS a separate `<audio>` element, even if the audio is from the same video file:

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

The render engine seeks to exact frames and expects pixel-identical output on repeat renders.

| ❌ Never                                   | ✅ Use instead                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `Date.now()`, `performance.now()`          | `tl.time()` inside `onUpdate`, or hard-coded timing                                                     |
| `Math.random()` unseeded                   | seeded PRNG (e.g. mulberry32)                                                                           |
| `setInterval`, `setTimeout`                | timeline tweens + `onUpdate` callbacks                                                                  |
| `repeat: -1` on any tween                  | `repeat: Math.ceil(duration / cycleDuration) - 1`                                                       |
| building timelines in `async`/`setTimeout` | construct synchronously at page load                                                                    |
| `video.play()`, `audio.play()`             | framework owns playback                                                                                 |
| animating `visibility` / `display`         | `autoAlpha` (animates opacity AND visibility) or opacity-only                                           |
| `gsap.set()` on clips from later scenes    | later-scene clips don't exist in DOM yet at page load. Use `tl.set(selector, vars, timePosition)`       |
| `<br>` in content text                     | use `max-width` for natural wrap. Exception: short display titles where each word is deliberately split |
| `data-layer`, `data-end` attributes        | use `data-track-index` and `data-duration`                                                              |

## Scene transitions

Non-negotiable rules for multi-scene compositions:

1. Every composition uses transitions. No jump cuts.
2. Every scene uses entrance animations (`gsap.from()`). No element pops fully-formed.
3. Exit animations are BANNED except on the final scene. Do NOT `gsap.to()` elements to `opacity: 0` or offscreen before a transition. The transition IS the exit.
4. Final scene only may fade out (e.g., fade to black).

### Energy → primary transition

Pick ONE primary for 60–70% of scene changes, plus 1–2 accents.

| Energy                                   | CSS primary                  | Shader primary                       | Duration  | Easing                 |
| ---------------------------------------- | ---------------------------- | ------------------------------------ | --------- | ---------------------- |
| **Calm** (wellness, brand story, luxury) | blur crossfade, focus pull   | cross-warp-morph, thermal-distortion | 0.5–0.8s  | `sine.inOut`, `power1` |
| **Medium** (corporate, SaaS, explainer)  | push slide, staggered blocks | whip-pan, cinematic-zoom             | 0.3–0.5s  | `power2`, `power3`     |
| **High** (promos, sports, music, launch) | zoom through, overexposure   | ridged-burn, glitch, chromatic-split | 0.15–0.3s | `power4`, `expo`       |

### Mood → transition type (quick guide)

| Mood                 | Shaders to reach for                             |
| -------------------- | ------------------------------------------------ |
| Warm / inviting      | thermal-distortion, light-leak, cross-warp-morph |
| Cold / clinical      | gravitational-lens                               |
| Editorial / magazine | whip-pan                                         |
| Tech / futuristic    | glitch, chromatic-split                          |
| Tense / edgy         | ridged-burn, glitch, domain-warp                 |
| Playful / fun        | ripple-waves, swirl-vortex                       |
| Dramatic / cinematic | cinematic-zoom, gravitational-lens, domain-warp  |
| Premium / luxury     | cross-warp-morph, thermal-distortion             |
| Retro / analog       | light-leak                                       |

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

Load the package and wire it to your timeline. The IIFE build exposes **`window.HyperShader`** (not `HyperframesShaderTransitions` — use the exact name below):

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

### Scene markup — always use the HyperFrames clip contract

Every scene must be a HyperFrames clip: `class="scene clip"` + `data-start` + `data-duration` + `data-track-index`. This is required (not optional) for multi-scene compositions. The runtime's time-based visibility gate (`packages/core/src/runtime/init.ts`) sets `style.visibility = "hidden"` on every `[data-start]` element outside its window, every frame — scenes without this markup get no such protection.

### Wrap animated scene content in `.scene-content`

`HyperShader`'s `captureIncomingScene` (in `packages/shader-transitions/src/capture.ts`) looks for a child with `class="scene-content"` and sets it to `visibility:hidden` **during** `html2canvas` so the content's pre-animation state doesn't leak into the WebGL texture. Without this wrapper, any element using `tl.from()` (default `immediateRender:true`) gets captured in its from-state — `yPercent:110` off-screen, `scaleX:0` as a zero-width rectangle, `autoAlpha:0` invisible. The shader texture then contains those broken states, and users see boxes/rectangles/empty slivers during the transition.

```html
<div
  class="scene clip"
  id="scene-2"
  data-start="6"
  data-duration="6"
  data-track-index="0"
  style="opacity:0;visibility:hidden;background-color:#0a0a0d;"
>
  <!-- OUTSIDE .scene-content: static bg, gradients, ambient decoratives.
       Captured into shader texture. Keep these still. -->
  <div class="scene-bg-gradient"></div>

  <!-- INSIDE .scene-content: everything that animates in. Hidden during
       incoming-capture, so from-state does NOT leak into texture. -->
  <div class="scene-content">
    <h1 id="s2-title">…</h1>
    <div class="s2-body">…</div>
  </div>
</div>
```

Rule: any element with an entrance animation goes INSIDE `.scene-content`. Static backgrounds go OUTSIDE.

### Transition timing — scene boundary must fall INSIDE the transition window

Scene windows tile end-to-end: scene-1 ends at time B, scene-2 starts at B — same instant. Scene windows are **half-open** (`[start, start+duration)`), so at `t=B` the runtime has already set scene-1 to `visibility:hidden`. If `transition.time === B`, HyperShader's `html2canvas(scene-1)` captures a blank texture (element is already hidden) → shader transitions blank → scene-2 → **visible blink**.

Rule: **`transition.time < B` AND `transition.time + transition.duration > B`**. The boundary must fall strictly inside the transition window. Simplest: center it — `transition.time = B - duration/2`.

```js
// Scene-1 window [0, 6), scene-2 window [6, 12). Transition duration 0.5s.
// Boundary B = 6. transition.time = 6 - 0.25 = 5.75. Runs 5.75 → 6.25.
transitions: [{ time: 5.75, shader: "cinematic-zoom", duration: 0.5 }];
```

Anti-pattern (causes a blink):

```js
// scene-1 ends at 4.8 → boundary at 4.8. Transition fires AT the boundary →
// scene-1 already visibility:hidden → capture = blank → blink.
transitions: [{ time: 4.8, shader: "cross-warp-morph", duration: 0.6 }];
```

```html
<!-- Scene windows tile end-to-end with no gaps. Initial scene has no inline opacity/visibility. -->
<div class="scene clip" id="scene-1" data-start="0" data-duration="6.3" data-track-index="0">…</div>
<div
  class="scene clip"
  id="scene-2"
  data-start="6.3"
  data-duration="6.4"
  data-track-index="0"
  style="opacity:0;visibility:hidden;"
>
  …
</div>
<div
  class="scene clip"
  id="scene-3"
  data-start="12.7"
  data-duration="9.0"
  data-track-index="0"
  style="opacity:0;visibility:hidden;"
>
  …
</div>
```

### Scene visibility: HANDS OFF when using HyperShader

HyperShader owns scene `opacity` end-to-end in both browser preview and engine/render mode. `captureIncomingScene` forces `opacity:1` on the incoming scene temporarily during its `html2canvas` capture, and at transition end HyperShader sets the incoming scene's inline `style.opacity = "1"` itself. You do **not** need to — and must **not** — add `tl.set(#scene-N, { autoAlpha: 1|0 }, …)` on scene containers for transition handoff.

**Why (blink root cause).** `html2canvas` captures are async (~80-150ms). If you manually set the incoming scene to `autoAlpha:1` at the transition's start AND the scenes lack the clip markup above, the browser paints both scenes stacked for the full capture window before HyperShader hides them and shows the canvas. That's the blink. With clip markup, the runtime's visibility gate keeps the incoming scene hidden until its `data-start` window opens, so even a misguided `tl.set` doesn't produce a visible flash.

```js
const tl = gsap.timeline({ paused: true });
// animate elements INSIDE each scene — never the .scene container itself
tl.from("#scene-1 .headline", { y: 40, autoAlpha: 0, duration: 0.8 }, 0.2);
// …

window.HyperShader.init({ bgColor, scenes, timeline: tl, transitions });
```

Anti-pattern (causes the blink when scenes lack clip markup):

```js
tl.set("#scene-2", { autoAlpha: 1 }, 5.7); // double-scene overlap during capture → flash
tl.set("#scene-1", { autoAlpha: 0 }, 6.3);
```

### Shader-compatible CSS rules

Apply only to shader-transition compositions — `html2canvas` captures each scene to a WebGL texture, and its rendering pipeline doesn't match CSS exactly:

- **No `transparent` in gradients.** Canvas interpolates `transparent` as `rgba(0,0,0,0)` (black at zero alpha), creating dark fringes. Use the target color at zero alpha: `rgba(200,117,51,0)` not `transparent`.
- **No gradients on elements thinner than 4px.** Use solid `background-color`.
- **No CSS variables (`var(...)`) on captured elements.** Use literal hex colors in inline styles.
- **No gradient opacity below 0.15.** Raise to 0.15+ or use a solid equivalent.
- **Every `.scene` div must have explicit `background-color`**, AND the same color must be passed as `bgColor` in `init()`.
- **Mark uncapturable decoratives with `data-no-capture`.**

### When NOT to use shaders

Don't mix CSS and shader transitions — pick one. **Prefer CSS transitions** when the composition will be previewed interactively with lots of scrubbing: shader transitions are optimized for linear playback, scrubbing produces visible capture-latency blanks.

**Dev-time scrubbing trap:** don't call `tl.progress(n)` in rapid succession on a shader-transition composition — html2canvas captures queue up and deadlock. `tl.pause()` first, call `tl.time(t)` once.

## Typography

### Banned fonts — do not use

Training-data defaults every LLM reaches for. They produce monoculture.

```
Inter, Roboto, Open Sans, Noto Sans, Arimo, Lato, Source Sans, PT Sans,
Nunito, Poppins, Outfit, Sora, Playfair Display, Cormorant Garamond,
Bodoni Moda, EB Garamond, Cinzel, Prata, Syne
```

**Also banned:** close siblings that read as the same voice (Inter Tight, Inter Display, Source Sans 3). Syne is the most overused "distinctive" display font — an instant AI tell.

Safe modern picks by category:

- **Display serif:** Fraunces, Instrument Serif, Newsreader, Libre Caslon Display, DM Serif Display
- **Display sans:** Space Grotesk, Geist, General Sans, Bricolage Grotesque, Host Grotesk, Unbounded
- **Monospace:** JetBrains Mono, Geist Mono, IBM Plex Mono, Fira Code, Azeret Mono, DM Mono
- **Impact / condensed:** Bebas Neue, Oswald (heavy weight), Anton, Hepta Slab, Big Shoulders Display

### Dark-background optical compensation

Light text on dark reads heavier and spacing reads tighter:

- Use `font-weight: 350` instead of 400 for body text.
- Increase `line-height` by 0.05–0.1 beyond your light-background equivalent.
- Add `letter-spacing: 0.01em` on display sizes.

### OpenType features for data

```css
.stat-value,
.timer,
.data-column {
  font-variant-numeric: tabular-nums; /* digits align vertically in columns */
}
.recipe-amount,
.ratio {
  font-variant-numeric: diagonal-fractions; /* renders 1/2 as ½ */
}
```

`tabular-nums` is essential anywhere numbers stack vertically. Without it, digits have proportional widths and columns don't align.

## GSAP — HyperFrames-specific gotchas

You know GSAP. These are the bits HyperFrames cares about:

### `immediateRender` gotcha

`from()` and `fromTo()` default to `immediateRender: true` — they apply their "from" state IMMEDIATELY at timeline construction, not when the tween starts. This is the root cause of the "stuck transition overlay" bug:

```js
// WRONG — sets #wipe to yPercent:-100 AT TIMELINE CONSTRUCTION,
// placing it over the stage before the transition is supposed to run.
tl.fromTo("#wipe", { yPercent: -100 }, { yPercent: 0, duration: 0.5 }, 17.3);

// RIGHT — define initial state via CSS or gsap.set() BEFORE the tween, use tl.to().
gsap.set("#wipe", { yPercent: 100 });
tl.to("#wipe", { yPercent: 0, duration: 0.5 }, 17.3);
```

Or set `immediateRender: false` on the `fromTo` explicitly.

### `autoAlpha` over `opacity`

`autoAlpha` animates opacity AND toggles `visibility: hidden` at 0 (elements won't catch pointer events while invisible). Prefer it unless you have a specific reason to keep visibility visible. Required for the shader-transition scene mount/unmount pattern above.

## Visual direction

Design is your strength. Use it. This skill is intentionally neutral on style — no preset palettes, no preset motion signatures, no content-type → aesthetic mapping. Pick your own.

**Four input channels. Additive — use as many as apply:**

1. **Attachments (strongest visual source).** `.fig`, PDFs (brand guidelines), `.docx`/`.pptx`, screenshots, reference videos. Claude Design reads these natively. Mine for palette, typography, UI chrome, tone of voice.
2. **Pasted content.** Hex codes, typefaces, copy, scripts, pasted style guides. Authoritative for the fields it covers.
3. **Research — use it aggressively.** When a brand, product, or topic is named, `web_search` and `web_fetch` aggressively. Research gives you: (a) **tone and positioning** (brand interviews, reviews, teardowns), (b) **real static content** (company blogs, press pages, Wikipedia, Crunchbase, TechCrunch, docs sites — all fetch fine), (c) **real copy material** (actual taglines, feature names, product language — so you quote the brand, not invent generic copy), (d) **visual references** (press kits often list hex codes + typefaces in plain HTML). SPA marketing homepages (React/Vue/Angular) are the one weak case — they return near-empty shells because JS isn't executed.
4. **URLs the user provided.** Start there, but don't stop. If the main URL is a SPA and returns little, pivot to the brand's blog, press page, Wikipedia entry, case study — those are almost always static. If identity is still unclear after you've done what you can, ask the user for a screenshot.

Combine channels: strong attachments + light research gets you brand-accurate visuals AND brand-accurate copy/tone.

**Two hard aesthetic rules:**

1. Synthesize from what you have (attachments first, pasted content next, subject matter and emotional tone last). Match the source; don't improvise around it.
2. Don't fall back to monoculture defaults — cream paper + serif + terracotta ("warm editorial"), or generic dark-mode + Inter + violet. Every LLM reaches for these. Commit to the brief.

### When the brief is sparse — ask ONE short question, then build

Output quality is capped by input quality. If the user's brief has no attachment, no URL, no pasted palette/type/copy, and no named aesthetic or reference, send one short message (4–6 lines) with concrete options before generating:

> To make this look like _yours_ — drop any of these (or describe in words):
>
> - A screenshot or two of your product, site, or an ad you like.
> - A brand PDF / style guide.
> - A reference video for pacing / color / energy.
> - A vibe in words — _"clinical and cold"_, _"loud and fast"_, _"a particular director / movie"_.
> - A must-have element — a specific shader, transition, text effect, anything you already want.
>
> Or say _"just build"_ and I'll commit to _<one concrete aesthetic you've chosen for this brief — named concretely>_.

Wait for the reply. No placeholder drafts. When the user replies, incorporate fully. When they say "just build" / "go" / "ship it", commit to the aesthetic you offered and write the composition.

**Skip the question — build immediately — when:** the user attached a file, pasted a palette/type/copy, named a specific aesthetic or well-known brand, is continuing an existing composition, or explicitly asked for speed.

Write `DESIGN.md` before `index.html` as a thinking step: palette, typography, motion character, in whatever shape makes sense for the brief. Reference the resulting tokens via CSS custom properties on `:root` in `index.html`.

## Registry blocks

HyperFrames ships 39 pre-built sub-compositions at `https://github.com/heygen-com/hyperframes/tree/main/registry/blocks`. Claude Design can't run `hyperframes add <name>` (CLI), but CAN fetch the block HTML directly:

1. Fetch `https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry/blocks/<name>/<name>.html`
2. Save as `compositions/<name>.html` in the project
3. Wire via `data-composition-src` (NOT plain iframe)

Common blocks:

| Block                                    | Purpose                                 |
| ---------------------------------------- | --------------------------------------- |
| `data-chart`                             | animated bar/line chart sub-composition |
| `flowchart`                              | animated flow diagram                   |
| `logo-outro`                             | animated logo reveal for closing scenes |
| `app-showcase`                           | product UI mock layout                  |
| `spotify-card`                           | Spotify-style music card UI             |
| `instagram-follow`                       | Instagram follow-button UI              |
| `reddit-post`, `x-post`, `tiktok-follow` | social card UIs                         |
| `macos-notification`                     | macOS-style notification                |
| `yt-lower-third`                         | YouTube-style lower-third graphic       |

## Worked examples

Every composition in `https://github.com/heygen-com/hyperframes/tree/main/registry/examples` is a full, renderable HyperFrames project authored by the framework team. They cover editorial layouts, kinetic typography, data visualization, product promos, decision-tree flows, and more. When a brief is technically ambitious (shaders, sub-compositions, complex sequencing) and you want to see the exact shape of working code, fetch one. Don't copy their aesthetic — pick one whose technical pattern matches your needs and mine it for implementation, not for style.

## Additional references (fetch when needed)

Everything critical is inlined in this skill — you should rarely need to fetch more. These fallbacks exist for edge cases.

**Foundational references — fetch only if you hit a pattern this skill doesn't cover:**

- **Core composition authoring (deep HyperFrames reference)** → https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/SKILL.md
- **GSAP (deep reference — advanced timelines, stagger, keyframes, plugins)** → https://github.com/heygen-com/hyperframes/blob/main/skills/gsap/SKILL.md
- **CLI reference (advanced `npx hyperframes` flags, non-standard commands)** → https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-cli/SKILL.md
- **`@hyperframes/player` docs (player element internals, event hooks)** → https://github.com/heygen-com/hyperframes/blob/main/packages/player/README.md
- **Full docs site** → https://hyperframes.heygen.com/
- **Real working compositions (mine for technical patterns)** → https://github.com/heygen-com/hyperframes/tree/main/registry/examples

**Feature-specific references — fetch ONLY when the brief needs that feature:**

- **URL-to-video capture pipeline** (when the user wants a video built from a captured website) → https://github.com/heygen-com/hyperframes/blob/main/skills/website-to-hyperframes/SKILL.md
- **Captions / subtitles synced to audio** → https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/captions.md
- **TTS narration (Kokoro-82M)** → https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/tts.md
- **Audio-reactive animation (beat sync, glow, pulse driven by music)** → https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/audio-reactive.md
- **CSS text-highlight patterns (marker, circle, burst, scribble, sketchout)** → https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/css-patterns.md
- **Dynamic caption animations (karaoke, slam, scatter, elastic, 3D)** → https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/dynamic-techniques.md
- **Audio transcript generation** → https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/transcript-guide.md
- **Installable blocks + components (`hyperframes add`)** → https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-registry/SKILL.md

## Surface behavior

- Claude Design does not use slash commands.
- The preview pane is sandboxed at `*.claudeusercontent.com` and requires a `?t=<token>` query on every request — that's why `preview.html` forwards `location.search`. When opened locally (no token), the forward is a no-op.
- Claude Design can't run CLI commands. Include commands in `README.md` for the user to run locally after downloading the ZIP.

## Output expectations

- `preview.html` plays the composition cleanly in Claude Design's in-pane preview AND when opened locally.
- `index.html` is renderable via `npx hyperframes render` with no lint errors.
- `README.md` is written for the end user and walks them step-by-step through previewing and rendering locally (template below).
- `DESIGN.md` exists when any visual identity was specified or invented.

## README.md template (for the user who downloads the ZIP)

Include these instructions verbatim. Swap `<project-name>` and adjust the render flags if the brief needs a non-default resolution / fps.

````markdown
# <project-name>

A HyperFrames video composition. Plain HTML + GSAP; rendered to MP4 by the `hyperframes` CLI.

## Requirements

- **Node.js 22+** — [nodejs.org](https://nodejs.org/)
- **FFmpeg** — `brew install ffmpeg` (macOS) · `sudo apt install ffmpeg` (Debian/Ubuntu) · [ffmpeg.org/download](https://ffmpeg.org/download.html) (Windows)

Chrome is downloaded automatically on first preview/render. Verify the environment with:

```bash
npx hyperframes doctor
```

`npx` downloads the `hyperframes` CLI from npm on first use — no global install required.

## Preview in your browser

```bash
npx hyperframes preview
```

Opens the HyperFrames Studio at `http://localhost:3002`.

## Render to MP4

```bash
npx hyperframes render index.html -o output.mp4
```

Produces `output.mp4` at 1920×1080 / 30fps by default. Roughly 1–3× real-time on a modern laptop. Use `--fps 60` or `--resolution 3840x2160` to override.

## Troubleshooting

- **"FFmpeg not found"** — install FFmpeg per Requirements.
- **"Node version too old"** — install Node 22+.
- **Full docs** — [hyperframes.heygen.com](https://hyperframes.heygen.com/).
````

## Example prompts users tend to type

Prefer attachment-driven briefs — they produce brand-accurate output. URL-only briefs on SPAs produce generic results.

- _[user drops 3 UI screenshots]_ — `Use the HyperFrames Claude Design skill. 30s product walkthrough matching these screenshots. Feature-led, 16:9, dark theme.`
- _[user drops a brand PDF]_ — `Use the HyperFrames skill. 15s 9:16 social teaser for the brand in this PDF. Honor palette and type exactly.`
- _[user drops a reference video]_ — `Use the HyperFrames skill. 20s video in the same tonal register as this reference. Match pacing, color, shader character; my copy below.`
- `Use the HyperFrames skill. 30s hero reel with this copy for each scene: [pasted script]. Dark theme, technical, no warmth.`
- `Use the HyperFrames skill. Turn https://www.anthropic.com/news/claude-design-anthropic-labs into a 45s editorial explainer.` — static article, web_fetch works here.
- `Use the HyperFrames skill. 30s product video for linear.app.` — SPA, web_fetch returns little; ask for screenshots.
