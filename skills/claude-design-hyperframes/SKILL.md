---
name: claude-design-hyperframes
description: Claude Design entry point for HyperFrames. Produce renderable HyperFrames videos in Claude Design with a working in-pane preview. Use for any request to create a video, animation, launch teaser, editorial explainer, product tour, social reel, or motion deliverable.
---

# Claude Design + HyperFrames

For this project, your medium is **HyperFrames compositions**: plain HTML + CSS + a paused GSAP timeline. A separate CLI (`npx hyperframes render index.html`) turns the HTML into an MP4. You are authoring the HTML files — the user runs the CLI locally. You do NOT need a CLI environment to produce these files.

**HyperFrames replaces your default video-artifact workflow for this project.** When the user asks for a video, animation, launch teaser, editorial explainer, product tour, social reel, or any motion deliverable:

- Do **NOT** call `copy_starter_component` with `kind: "animations.jsx"`. The animations.jsx starter is the wrong format here — HyperFrames uses plain HTML + GSAP, not React Sprites.
- Do **NOT** invoke the built-in "Animated video" skill. HyperFrames replaces it for this project.
- Do **NOT** use React, Babel, or `<script type="text/babel">`. Compositions are plain HTML; animation state lives on a paused GSAP timeline registered on `window.__timelines`.
- Do **NOT** hand-roll a 1920×1080 scale-to-fit stage wrapper. `<hyperframes-player>` (loaded in `preview.html`) handles viewport scaling and letterboxing for you.

Your first action on a new brief is to **read the brief, ask a clarifying question if it's sparse, and commit to a visual identity** — not to copy a starter component.

Users attach this skill to a Claude Design chat, drop brand assets (screenshots, PDFs, reference videos, pasted palettes), and describe a video. You return `index.html`, `preview.html`, `README.md`, and `DESIGN.md` as a downloadable ZIP. The user runs `npx hyperframes render index.html` locally to produce the MP4. Work through the five steps below — each has a gate you must pass before moving to the next.

---

## Approach

Before touching HTML, think in phases. Skipping phases is the single biggest quality problem in AI-generated video.

1. **Brief** — what does the user want? What have they given you to synthesize from?
2. **Identity** — what does this video LOOK like? palette, type, motion character, committed in one document before any HTML.
3. **Beats** — what happens in what order? scenes, durations, verbs per element, mid-scene activity.
4. **Build** — static layout first, then motion, then self-review.
5. **Deliver** — preview shell + README for local render + caveats.

---

## Step 1: Understand the brief

**Gate:** You can name the subject, the duration, the aspect ratio, and at least one source of visual direction (attachment, pasted palette/type/copy, named aesthetic, or clarifying-question answer). If you can't — you don't have enough to build.

### Inputs, in order of reliability

1. **Attachments (strongest visual source).** `.fig` Figma files, PDFs (brand guidelines, spec docs), `.docx`/`.pptx`, images/screenshots, reference video stills. Claude Design reads these natively with detail preserved. Mine for palette, typography, spacing, UI chrome, tone of voice.
2. **Pasted content.** Hex codes, typefaces, copy samples, scripts, pasted style guides. Authoritative for what it covers.
3. **Research.** When a brand, product, or topic is named, `web_search` and `web_fetch` aggressively. Static pages fetch fine — company blogs (`<brand>.com/blog`), press pages, Wikipedia, Crunchbase, TechCrunch, docs sites — and yield (a) tone/positioning, (b) real copy (taglines, feature names, product language), (c) sometimes hex codes + typeface names from press kits. SPA marketing homepages (React/Vue/Angular) are the one weak case — they return near-empty shells because JavaScript isn't executed. Pivot to the brand's blog / press / Wikipedia when the homepage returns little.
4. **URLs the user provided.** Start there, expand outward.

Combine channels. Strong attachments + light research gives you brand-accurate visuals AND brand-accurate copy.

### Mechanical trigger — ask ONE short question if the brief is sparse

If the prompt contains NONE of the following, ask one clarifying question before generating:

- A file attachment
- A pasted hex code or named typeface
- A named aesthetic / style / movement / director / genre
- A specific brand with a well-known visual identity (Apple, Linear, Stripe, Notion, Figma, Vercel, Tesla, Spotify, etc.)
- The words "go", "just build", "make it", "surprise me", "ship it"
- A follow-up turn continuing an existing composition

Do NOT rationalize past this check. "The user's email domain is the brand so I know what they want" is NOT a valid skip condition. "It's a well-known company so I'll just build" is NOT valid unless the brand is in the list above.

Send one short message (4–6 lines) with concrete options:

> To make this look like _yours_ — drop any of these (or describe in words):
>
> - A screenshot or two of your product, site, or an ad you like.
> - A brand PDF / style guide.
> - A reference video for pacing / color / energy.
> - A vibe in words — _"clinical and cold"_, _"loud and fast"_, _"a particular director / movie"_.
> - A must-have — a specific shader, transition, text effect, or element you already want.
>
> Or say _"just build"_ and I'll commit to _<one concrete aesthetic you've chosen for this brief — named concretely, not "warm editorial" or "generic dark mode">_.

Wait for the reply. When the user answers, incorporate fully. When they say "just build" / "go" / "ship it" / "surprise me", commit to the aesthetic you offered and proceed.

---

## Step 2: Commit to a visual identity

**Gate:** `DESIGN.md` exists in the project directory with palette, typography, and motion character defined.

### Visual Identity Gate

<HARD-GATE>
Before writing ANY composition HTML, you MUST have a visual identity defined. Do NOT write compositions with default or generic colors.
</HARD-GATE>

Commit to ONE aesthetic and write `DESIGN.md` before `index.html`. The document is a thinking step, not a deliverable template.

`DESIGN.md` contains:

- **Palette.** Name each color's role (bg, ink, accent, muted). Use exact hex values or OKLCH. One accent hue, tinted neutrals.
- **Typography.** Display face + body face. See banned list below — and look beyond the standard pairs. Weight contrast must be dramatic (300 vs 900, not 400 vs 700). Video sizes: 60px+ headlines, 20px+ body, 16px+ data labels.
- **Motion character.** Pacing (fast/medium/slow/cinematic), primary transition family (CSS vs shader, which shader), easing defaults, what NOT to do.

Reference the tokens via CSS custom properties on `:root` in `index.html`.

### Anti-monoculture

Training-data defaults every LLM reaches for. Commit to something the brief specifically calls for instead.

- **Don't default to warm editorial** (cream paper + serif + terracotta accent).
- **Don't default to generic dark-mode tech** (black + violet accent + Inter + geometric sans).
- **Banned fonts:** Inter, Inter Tight, Roboto, Open Sans, Noto Sans, Arimo, Lato, Source Sans, PT Sans, Nunito, Poppins, Outfit, Sora, Fraunces, Playfair Display, Cormorant Garamond, Bodoni Moda, EB Garamond, Cinzel, Prata, Syne. Full list and reasoning: `skills/hyperframes/references/typography.md`.
- **Banned pairings (observed AI defaults):** Fraunces + JetBrains Mono (every test-run of an editorial brief lands here); Inter + anything; Playfair + Lato. Pick different faces each time.
- **Lazy defaults to question:** gradient text, left-edge accent stripes, cyan-on-dark, pure `#000` / `#fff`, identical card grids, everything centered with equal weight. See `skills/hyperframes/house-style.md` for the full list.

---

## Step 3: Plan the beats

**Gate:** You can list every scene, its duration, and at least one verb per animated element in that scene. If a verb is missing, the element isn't designed yet.

### Scene plan + pacing

**Hard ceiling: no scene longer than 5 seconds unless there's a deliberate pacing reason.** Scenes in the 6–12s range read as draggy slides; viewers feel the stall. Only go longer than 5s when you can name the reason — a deliberate hold on a hero frame, a long cinematic push, a silence beat, a counter that animates over 6+ seconds to feel substantial. Default to quick. Slow down with intention.

**Hard floor: scene must last at least as long as a viewer needs to read its text.** A 2-second scene with a 20-word paragraph is broken — viewers cannot read it before the transition fires. The "too short" failure is as real as "too long."

Reading-time budget per scene:

| Displayed text (visible during the scene)         | Minimum scene duration                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| No text (hero image, icon, decorative)            | **1.5–2s**                                                                                       |
| 1–3 words (kicker, label, number, short headline) | **2–3s**                                                                                         |
| 4–10 words (short headline + tiny subhead)        | **3–4s**                                                                                         |
| 11–20 words (a full sentence or two short lines)  | **4–6s**                                                                                         |
| 21–35 words (multi-line paragraph, bullet list)   | **6–8s**                                                                                         |
| 35+ words (dense explainer text)                  | **Split into two scenes.** A single scene should not ask the viewer to read more than ~35 words. |

On top of reading time, add entrance-animation buffer: 0.6–1.0s for the text to finish entering before the viewer can start reading it. Practical formula: **scene_duration ≥ entrance_buffer + (word_count × 0.25s) + 0.5s transition tail**, with a minimum of 1.5s.

Apply this per scene. If scene-3's display text is 18 words of serif body copy, scene-3 needs ~5s, not 3s. If scene-12 is a single-word slam ("Design."), 2s is fine — maybe ideal.

**Last readable element must finish entering by the 50% mark of the scene.** That gives the viewer the second half of the scene to actually read the text before the transition starts. If the last `tl.from("#s5-sub", …)` on a 4-second scene finishes at t=3.5s, the viewer has only 0.5s to read — not enough. Pull entrances earlier or lengthen the scene.

**Anti-pattern:** dividing total duration by scene count AND ignoring per-scene reading-time. A 2-minute video ÷ 10 scenes = 12-second scenes (too long per hard ceiling); or ÷ 60 scenes = 2-second scenes (too short if any of them has sentence-length text).

**Better:** pick a scene count targeting 3–5s average, then ADJUST each scene up or down based on what it has to show. Short scenes for punches, images, and kickers. Medium scenes for headlines. Longer scenes for body copy or bullet lists.

| Video length       | Target scene count | Avg scene | Notes                                                |
| ------------------ | ------------------ | --------- | ---------------------------------------------------- |
| 10–15s social ad   | 5–8                | 2–3s      | Relentless cuts, every scene is a punch              |
| 20–30s teaser      | 8–12               | 2–4s      | Open / build / payoff / close, varied                |
| 30–60s explainer   | 12–20              | 3–5s      | Each beat its own scene — don't combine two ideas    |
| 60–120s narrative  | 24–40              | 3–5s      | Dense pacing. Think YouTube explainer, not slideshow |
| 120–240s long-form | 40–70              | 4–5s      | Split into sub-compositions, each act ~8–14 scenes   |

Four mechanical checks before closing Step 3:

1. **Per-scene reading-time check:** count the words of display text in each scene. Does `scene.data-duration` satisfy the reading-time budget above? If not, extend the scene (if budget headroom exists) or split the text across two scenes.
2. **Last-readable-element check:** for each scene, find the last `tl.from` on a readable text element. Does it finish (start + duration) before the 50% mark of the scene? If not, pull the entrance earlier.
3. **If a scene's `data-duration` exceeds 5 seconds, write one sentence justifying why it holds that long.** If you can't, split it into two scenes with different beats.
4. **Model the rhythm as a wave, not a flat line.** `short-short-LONG-short-short-LONG-short` reads as intentional pacing. `flat-flat-flat-flat` reads as a slideshow. Same-duration across scenes = dividing, not designing.

### Build / Breathe / Resolve (per scene)

Every scene > 4 seconds has three phases. Dumping everything in the build and leaving nothing for breathe/resolve is the #1 quality failure.

| Phase       | When       | What                                                                                   |
| ----------- | ---------- | -------------------------------------------------------------------------------------- |
| **Build**   | 0 – 30%    | Elements enter, staggered. Don't dump everything at once. Offset first tween 0.1–0.3s. |
| **Breathe** | 30% – 70%  | Content visible, alive with at least ONE ambient motion. No element stands still here. |
| **Resolve** | 70% – 100% | A beat resolves — accent pulse, number lands, secondary element arrives, decisive end. |

Full motion theory (easing as emotion, direction rules, speed as weight, transitions as meaning): `skills/hyperframes/references/motion-principles.md`.

### Animation verbs

Every element gets a verb. If you can't name the verb, the element is not yet designed.

| Energy        | Verbs                                         | Example                               |
| ------------- | --------------------------------------------- | ------------------------------------- |
| High impact   | SLAMS, CRASHES, PUNCHES, STAMPS, SHATTERS     | "$1.9T" SLAMS in from left at -5°     |
| Medium energy | CASCADE, SLIDES, DROPS, FILLS, DRAWS          | Three cards CASCADE in staggered 0.3s |
| Low energy    | types on, FLOATS, morphs, COUNTS UP, fades in | Counter COUNTS UP from 0 to 135K      |

### Mid-scene activity (kills the "animated slides" failure)

Every visible element must have motion during the Breathe phase — not just an entrance. A still image on a still background is a JPEG with a progress bar.

| Element type           | Mid-scene activity                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| Image / screenshot     | Slow zoom (`scale: 1 → 1.03-1.05` over scene duration), slow pan, or Ken Burns                    |
| Stat / number          | Counter animates from 0 to target                                                                 |
| Chart / bars           | Bars fill in sequence; line draws via `strokeDashoffset`                                          |
| Logo / lockup          | Subtle shimmer sweep, gentle scale pulse, or audio-reactive (if music present)                    |
| Background decoratives | Radial glow breathing, gradient shift, grain drift, hairline rule pulse                           |
| Any persistent element | Subtle float (`y: ±4-6px`, `sine.inOut`, `yoyo: true, repeat: 1`) so it's alive instead of frozen |

**Anti-pattern:** entrance tween at t=0.5, element never moves again for the remaining 4+ seconds. If that's the shape of a scene, it's a slideshow, not video.

### Cinematic planning, not CSS planning

Write each scene as an experience first, specs second. The difference:

**Mediocre:** _"Dark navy background. '$1.9T' in white, 280px. Logo top-left. Wave image bottom-right."_

**Great:** _"Camera is already mid-flight over a vast dark canvas. The gradient wave sweeps across the frame like aurora borealis — alive, shifting. '$1.9T' SLAMS into existence with such force the wave ripples in response. This isn't a slide — it's a moment."_

The first describes pixels. The second describes an experience. Write the second, then figure out the pixels.

---

## Step 4: Build

**Gate:** Every composition you wrote passes the self-review checklist at the end of this section.

### Layout Before Animation

Static layout FIRST, motion SECOND.

1. Write the scene's HTML + CSS as if it were a static poster — where every element LANDS at its most-visible moment.
2. Verify the static layout works in a browser (no GSAP, no JS).
3. Only after the layout is correct, add timeline + animations. `gsap.from()` animates FROM offscreen/invisible TO the CSS position. The CSS position is the ground truth.

Scene containers use `.scene-content` flex centering, not absolute positioning on inner content. Keep decoratives (backgrounds, glows, hairlines, grain) OUTSIDE `.scene-content`. Keep animated content INSIDE `.scene-content`.

### Clip contract

Every scene is a HyperFrames clip. **EVERY scene has a `<div class="scene-content">` wrapper — not just scene-1. This is the single most-missed rule in output audits.** The wrapper exists so `HyperShader.captureIncomingScene()` can hide scene content during `html2canvas` capture, preventing pre-animation from-states from leaking into the WebGL texture. Without the wrapper on a non-first scene, you'll see boxes, clipped text, or empty placeholders during the transition INTO that scene.

```html
<!-- SCENE 1 — visible from t=0, no inline style -->
<div class="scene clip" id="s1" data-start="0" data-duration="5" data-track-index="0">
  <!-- OUTSIDE .scene-content: backgrounds, decoratives. Captured into shader textures. -->
  <div class="bg-grain"></div>
  <div class="bg-vignette"></div>
  <!-- INSIDE .scene-content: every animated element. REQUIRED on every scene. -->
  <div class="scene-content">
    <h1 id="s1-title">…</h1>
    <p id="s1-sub">…</p>
  </div>
</div>

<!-- SCENE 2+ — starts hidden; same wrapper structure.
     Inline style is opacity:0 ONLY (no visibility:hidden). See "Scene initial visibility" below. -->
<div
  class="scene clip"
  id="s2"
  data-start="5"
  data-duration="5"
  data-track-index="0"
  style="opacity:0;"
>
  <div class="bg-grain"></div>
  <div class="scene-content">
    <!-- ← MANDATORY, not just a scene-1 pattern -->
    <h1 id="s2-title">…</h1>
    <p id="s2-sub">…</p>
  </div>
</div>
```

### Data attributes

Every timed element (scene, image, video, audio, sub-composition host) is a "clip" and must carry:

| Attribute          | Required                          | Values                                                |
| ------------------ | --------------------------------- | ----------------------------------------------------- |
| `id`               | yes                               | unique identifier                                     |
| `class="clip"`     | yes                               | literal string (scenes use `"scene clip"`)            |
| `data-start`       | yes                               | seconds, or clip-id reference (`"el-1"`, `"intro+2"`) |
| `data-duration`    | required for img/div/compositions | seconds. video/audio default to media duration        |
| `data-track-index` | yes                               | integer. same-track clips cannot overlap in time      |
| `data-media-start` | no                                | trim offset into source (seconds) for video/audio     |
| `data-volume`      | no                                | 0–1 (default 1) for audio                             |

`data-track-index` is TIMELINE layering (which clip's timeline wraps which) — **not visual z-order.** Use CSS `z-index` for stacking. Same-track clips can't overlap in time; use different tracks for simultaneous clips or put them on the same track with non-overlapping windows.

Composition roots (the outer `index.html` and any `<template>`-wrapped sub-comp root) also need:

| Attribute              | Required | Values                                                    |
| ---------------------- | -------- | --------------------------------------------------------- |
| `data-composition-id`  | yes      | unique ID. root uses `"main"` by convention               |
| `data-start`           | yes      | root: `"0"`                                               |
| `data-duration`        | yes      | seconds. takes precedence over GSAP timeline length       |
| `data-width`           | yes      | pixel width (1920 for 16:9, 1080 for 9:16, 1080 for 1:1)  |
| `data-height`          | yes      | pixel height (1080 for 16:9, 1920 for 9:16, 1080 for 1:1) |
| `data-composition-src` | no       | path to external HTML sub-composition (`compositions/…`)  |

### Timeline contract

- Every composition has exactly ONE timeline, created `paused: true`.
- Register it on `window.__timelines["<composition-id>"]` — the key MUST match the root's `data-composition-id` exactly.
- The composition root's DOM `id` attribute should also equal its `data-composition-id` (convention: `<div id="main" data-composition-id="main" …>`). Nothing in the runtime enforces this, but consistent IDs make `#main` selectors in your timeline code and the `__timelines` key one word apart — preventing the `id="root"` / `data-composition-id="main"` / `__timelines["main"]` three-way drift that's easy to typo.
- Never call `.play()` on the timeline — the player/render engine drives playback via frame-accurate seeking.
- Framework auto-nests sub-comp timelines — DO NOT manually `.add()` them to the root timeline.
- Duration comes from `data-duration` on the root, NOT from GSAP timeline length.
- Construct synchronously at page load. No `async`/`await`/`setTimeout` wrapping timeline code.

### Video and audio

Video elements must be `muted playsinline`. Browsers silently block audio playback on inline video, so HyperFrames **never uses `<video>` for audio** — even when the audio is from the same source file, it goes on a separate `<audio>` element with its own `data-track-index`. Never call `video.play()` or `audio.play()` in your code; the framework owns media playback.

```html
<video
  id="v-main"
  class="clip"
  data-start="0"
  data-duration="30"
  data-track-index="0"
  src="footage.mp4"
  muted
  playsinline
></video>

<audio
  id="v-main-audio"
  class="clip"
  data-start="0"
  data-duration="30"
  data-track-index="2"
  src="footage.mp4"
  data-volume="1"
></audio>
```

If your video has audio that only plays during part of the scene, use `data-media-start` to offset into the source, and trim `data-duration` to the audible window.

### Scene initial visibility — TWO paths depending on whether HyperShader runs in this file

The runtime's visibility gate sets `style.visibility = "hidden"` on every `[data-start]` element outside its window — BUT it **never touches `style.opacity`**. That splits the rules for non-first scenes:

**WITH HyperShader in this file:** non-first scenes carry `style="opacity:0;"` ONLY — no `visibility:hidden`. The runtime's visibility gate already keeps the scene hidden before its `data-start`, and HyperShader's `captureIncomingScene` temporarily forces `opacity:1` during `html2canvas` capture so the shader gets a real texture of the incoming scene's background + decoratives. At transition end, HyperShader sets the incoming scene's `style.opacity = "1"` itself.

Do NOT add `visibility:hidden` in the inline style on these scenes. It's redundant (the runtime gate handles hiding) AND it breaks `captureIncomingScene` — `html2canvas` sees the element as `visibility:hidden`, renders it as blank, and the shader ends up transitioning from a real outgoing scene to a blank incoming texture. Visually: content morphs/fades into the background color during the transition, then pops in after — a visible "blink" at the transition.

**WITHOUT HyperShader in this file:** non-first scenes carry `style="visibility:hidden;"` ONLY — no `opacity:0`. Nothing animates scene-container opacity back to 1 without HyperShader; if you include `opacity:0` the scene stays invisible for its entire window.

Scene-1 always has no inline style — it's visible from t=0.

### Shader transitions

Use `@hyperframes/shader-transitions`. Exactly **14 shader names** are valid — any other string throws `[HyperShader] Unknown shader`:

`domain-warp`, `ridged-burn`, `whip-pan`, `sdf-iris`, `ripple-waves`, `gravitational-lens`, `cinematic-zoom`, `chromatic-split`, `swirl-vortex`, `thermal-distortion`, `flash-through-white`, `cross-warp-morph`, `light-leak`, `glitch`.

Authoritative list: `packages/shader-transitions/src/shaders/registry.ts`.

Mood → shader mapping: `skills/hyperframes/references/transitions.md`.

The IIFE build registers the package on **`window.HyperShader`** (not `HyperframesShaderTransitions`):

```html
<script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions/dist/index.global.js"></script>
<script>
  const tl = gsap.timeline({ paused: true });
  window.HyperShader.init({
    bgColor: "#0a0a0d",
    scenes: ["s1", "s2", "s3"],
    timeline: tl,
    transitions: [
      { time: 5.75, shader: "cinematic-zoom", duration: 0.5 },
      { time: 11.75, shader: "whip-pan", duration: 0.5 },
    ],
  });
  window.__timelines["main"] = tl;
</script>
```

**Scene-count invariant — `scenes.length === transitions.length + 1`:** HyperShader enforces this at init. Pick one anchor scene BEFORE the first transition, and one anchor AFTER each transition. A video with three act-boundary transitions needs exactly four anchor scenes. Scenes between anchors (non-bracketing, runtime-managed) carry `style="visibility:hidden;"` instead of `style="opacity:0;"` — they're not HyperShader-managed so nothing animates their opacity back to 1.

The simplest working pattern: list only the scene just before AND just after each shader cut. Do NOT list every scene in Act II just because they "span" a transition — that violates the invariant. If you genuinely need MORE listed anchors than real shader transitions (rare — e.g., tracking an additional fade beat that's not a visible shader bridge), insert `{ shader: "flash-through-white", duration: 0.01 }` as an invisible no-op bridge to satisfy the invariant. This is a workaround; the cleaner fix is almost always to drop the extra anchor.

**Transition timing (critical — the scene boundary must fall INSIDE the transition window):**

Scene windows are half-open (`[start, start+duration)`). At time `B` (the boundary), the runtime has already flipped the outgoing scene to `visibility:hidden`. If `transition.time === B`, `html2canvas` captures a blank outgoing texture → shader transitions from blank → incoming → visible blink.

Rule: `transition.time < B` AND `transition.time + duration > B`. Simplest — center it: `transition.time = B - duration/2`. Example: scene-1 ends at 6, duration 0.5 → `time: 5.75`.

**Scene visibility: HANDS OFF.** HyperShader owns scene `opacity` end-to-end. Do NOT add `tl.set(#scene-N, {autoAlpha: …}, …)` on scene containers. If you do, you create the same visibility race that produces the blink.

### Sub-compositions — default NO for videos ≤ 3 minutes

Default to a single `index.html` with scenes tiled inline. 30-second to 2-minute compositions fit cleanly in one file (~1500–2000 lines). Single file = single HyperShader instance = no canvas conflicts = everything works.

Split into sub-compositions ONLY when one of these is true:

- Video length > 3 minutes AND you need organizational structure.
- You're extracting a REUSABLE sub-comp that appears in multiple places (chart block, logo outro).
- A single scene is so complex it deserves its own file (full UI recreation, heavy data-vis).

If you do split, **HyperShader lives at the ROOT `index.html` ONLY** — never inside a sub-composition. HyperShader hardcodes `#gl-canvas` as its canvas ID (see the canvas creation path in `packages/shader-transitions/src/hyper-shader.ts`); multiple HyperShader instances can't share one canvas. When a sub-comp's HyperShader fails silently on canvas conflict, its fallback code calls `document.querySelectorAll(".scene")` document-wide and sets every scene's opacity to 0 — corrupting visibility across the whole document. Symptom: only scene-1 of each act shows, scenes 2+ never appear.

#### Sub-composition file shape

Every sub-comp file in `compositions/` is wrapped in a `<template>`. The template's contents are INERT in the browser by spec — the runtime extracts and nests them into the parent at render time. A standalone `index.html` (the main composition) does NOT use `<template>`; the data-composition-id div goes directly in `<body>`.

```html
<!-- compositions/act-1-intro.html -->
<template id="act-1-intro-template">
  <div class="hf-sub" data-composition-id="act-1-intro" data-width="1920" data-height="1080">
    <style>
      .hf-sub {
        position: relative;
        width: 1920px;
        height: 1080px;
      }
      /* scene styles scoped to this sub-comp */
    </style>

    <div class="scene clip" id="a1-s1" data-start="0" data-duration="5" data-track-index="0">
      <div class="scene-content">…</div>
    </div>
    <div
      class="scene clip"
      id="a1-s2"
      data-start="5"
      data-duration="5"
      data-track-index="0"
      style="visibility:hidden;"
    >
      <div class="scene-content">…</div>
    </div>

    <script>
      // Sub-comp does NOT re-load GSAP — parent loads it once.
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      // Tween positions are LOCAL (0 = sub-comp start). Parent auto-offsets at its data-start.
      tl.from("#a1-s1 .title", { y: 40, autoAlpha: 0, duration: 0.8 }, 0.3);
      tl.from("#a1-s2 .body", { y: 20, autoAlpha: 0, duration: 0.6 }, 5.3);
      // DO NOT call window.HyperShader.init() here — HyperShader is root-only.
      window.__timelines["act-1-intro"] = tl;
    </script>
  </div>
</template>
```

#### Parent `index.html` wiring

The parent mounts each sub-comp via `data-composition-src` on an empty div that carries the clip contract:

```html
<div
  id="act-1"
  class="scene clip"
  data-composition-id="act-1-intro"
  data-composition-src="compositions/act-1-intro.html"
  data-start="0"
  data-duration="30"
  data-track-index="0"
></div>
```

Three rules when splitting:

1. `<template id="<id>-template">` wrapper required on every sub-comp. Contents are inert; the runtime extracts them.
2. The `data-composition-id` on the sub-comp's inner root div MUST match BOTH (a) the parent container's `data-composition-id` AND (b) the key in `window.__timelines[...]` inside the sub-comp's script.
3. Tween positions in a sub-comp are LOCAL to that sub-comp (0 = its start). The parent auto-offsets by the container's `data-start`. Never manually add sub-timelines to the root timeline.

Since the sub-comps in this pattern don't use HyperShader (by the rule above), their non-first scenes carry `style="visibility:hidden;"` only — see "Scene initial visibility" above for why.

### Determinism ❌ / ✅

The render engine seeks to exact frames and expects pixel-identical output on every repeat render. Violations produce broken output.

| ❌ Never                                   | ✅ Use instead                                        |
| ------------------------------------------ | ----------------------------------------------------- |
| `Date.now()`, `performance.now()`          | `tl.time()` inside `onUpdate`, or hard-coded timing   |
| `Math.random()` unseeded                   | seeded PRNG (e.g. mulberry32) with a known seed       |
| `setInterval`, `setTimeout` in timeline    | timeline tweens + `onUpdate` callbacks                |
| `repeat: -1` on any tween or timeline      | `repeat: Math.ceil(duration / cycleDuration) - 1`     |
| Timelines built in `async`/`await` wrapper | Construct synchronously at page load                  |
| `video.play()`, `audio.play()` in code     | Framework owns media playback                         |
| Animating `visibility` or `display`        | `autoAlpha` (animates opacity AND toggles visibility) |

### Motion rules (HyperFrames-native, non-negotiable)

Inherited from `skills/hyperframes/SKILL.md#Rules-Non-Negotiable`:

- **GSAP visual properties only.** Animate `opacity`, `x`, `y`, `scale`, `rotation`, `color`, `transforms`. Do NOT animate `visibility` or `display` directly (use `autoAlpha`).
- **One paused timeline per composition.** `{ paused: true }`. Register on `window.__timelines["<composition-id>"]`. Never call `.play()`.
- **Vary eases** — at least 3 different eases per scene. Don't default to `power2.out` on everything.
- **Offset first tween 0.1–0.3s.** Zero-delay entrances feel like jump cuts.
- **Exit animations BANNED** except on the final scene. The transition IS the exit. See the code examples below — this is the single most frequently-violated rule in generated output.

### Motion anti-patterns (observed in generated output, with fixes)

These four patterns keep appearing in generated compositions despite the rules above. Each one is observed in real outputs; each has a known-clean replacement. Pattern-match these, not just the prose rules.

#### Anti-pattern 1: Exit tween before a shader transition

The shader's `captureScene(fromScene)` runs `html2canvas` on the outgoing scene at transition time. If you've animated content to `opacity: 0` (or `autoAlpha: 0`, or off-screen) before the transition fires, `html2canvas` captures an empty scene. The shader morphs from an empty outgoing texture → the incoming scene, which looks like "the content vanished, then the transition happened." This is independent of whether the shader itself works — it's a composition-level bug.

This matches industry practice: in Remotion's `<TransitionSeries>`, in the GSAP community's own guidance, and in HyperFrames' core `references/transitions.md` — the transition component owns the visual handoff. The scene's content does not animate its own exit.

```js
// ✖ WRONG — card fades to 0 before transition at t=17.80 fires.
//   Shader captures an empty phone. User sees the card disappear
//   0.85s before the transition, then an empty-phone-to-next-scene morph.
tl.to("#s6-card", { x: 180, rotation: 14, duration: 0.55, ease: "power3.in" }, 16.5);
tl.to("#s6-card", { autoAlpha: 0, duration: 0.25 }, 16.95); // BANNED

// HyperShader transition at 17.80 captures #s6 with card invisible
```

```js
// ✓ RIGHT — mid-scene swipe gesture, then a different beat holds the final
//   frame. Card moves but stays visible. Transition handles the actual exit.
tl.to("#s6-card", { x: 180, rotation: 14, duration: 0.55, ease: "power3.in" }, 15.3);
tl.from("#s6-check", { scale: 0, duration: 0.3, ease: "back.out(2)" }, 15.6);
tl.from("#s6-match-stamp", { scale: 1.5, autoAlpha: 0, duration: 0.4 }, 16.1);
// scene 6 ends at 18.0 with the matched-stamp + pulsing check button visible.
// HyperShader transition at 17.80 captures a FULL scene → clean morph.
```

Common trap: "I want to show a swipe gesture, so the card has to exit." No — the swipe gesture happens mid-scene, at 60–70% of scene duration. The last 30% of the scene shows the RESULT of the swipe (a match stamp, a confirmation, a badge). Keep something visible at transition time. If there's nothing logically left to show, the scene is too long — shorten it.

#### Anti-pattern 2: Non-deterministic `stagger` origin

```js
// ✖ WRONG — `from: "random"` picks a random origin at timeline-construction
//   time using GSAP's internal unseeded random. Two renders of the same
//   composition produce different stagger orderings. Fails PSNR regression
//   tests and violates the deterministic-render rule.
tl.from(
  "#s12 .card",
  {
    scale: 0.7,
    autoAlpha: 0,
    y: 40,
    duration: 0.45,
    stagger: { each: 0.04, from: "random" }, // BANNED
  },
  34.55,
);
```

```js
// ✓ RIGHT — deterministic stagger origins. All of these are safe.
tl.from(
  "#s12 .card",
  { scale: 0.7, autoAlpha: 0, y: 40, duration: 0.45, stagger: { each: 0.04, from: "start" } },
  34.55,
); // natural order

tl.from(
  "#s12 .card",
  { scale: 0.7, autoAlpha: 0, y: 40, duration: 0.45, stagger: { each: 0.04, from: "center" } },
  34.55,
); // ripple outward

tl.from(
  "#s12 .card",
  {
    scale: 0.7,
    autoAlpha: 0,
    y: 40,
    duration: 0.45,
    stagger: { each: 0.04, grid: [3, 5], from: [0, 0] },
  },
  34.55,
); // grid-aware
```

If you truly need pseudo-random ordering (rare), pre-shuffle the cards in the markup using a seeded PRNG like mulberry32 — the ordering is then committed to the DOM and deterministic forever.

#### Anti-pattern 3: Centering content with `position: absolute; top; left` on `.scene-content`

```css
/* ✖ WRONG — absolute-positioned content container with hardcoded pixels.
   Renders at 1920×1080 but overflows at any other aspect ratio. Also
   pushes you toward absolute-positioning every child, which is fragile. */
.scene-content {
  position: absolute;
  top: 200px;
  left: 160px;
  width: 1920px;
  height: 1080px;
}
```

```css
/* ✓ RIGHT — flex-filled container with padding for the positioning.
   Works at any aspect ratio. Children flow naturally. */
.scene-content {
  width: 100%;
  height: 100%;
  padding: 120px 160px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 24px;
  box-sizing: border-box;
}
```

See `skills/hyperframes/SKILL.md#Layout-Before-Animation` for the full rationale — in short: position every element at its final landing state first, then `gsap.from()` the entrance animating TO that position.

#### Anti-pattern 4: SVG filter data URLs used as `background-image` (grain, noise, turbulence)

Safari's WebKit applies stricter canvas-taint rules than Chrome. When a scene has a `<filter>` SVG element referenced as a `background-image: url("data:image/svg+xml...")` — a common grain/noise pattern — `html2canvas` produces a tainted canvas. Safari's WebGL then throws `SecurityError: The operation is insecure` at `gl.texImage2D()`, which has no framework opt-out (WebGL spec requires the check). Every shader transition falls through to the CSS-crossfade fallback; in Claude Design's cross-origin iframe sandbox this compounds with iframe throttling, and users see the whole piece play as hard cuts.

Empirically observed: skill-test8 in Safari + Claude Design = transitions work. skill-test-9 (identical framework, different grain implementation) in the same environment = zero shader transitions, all catch-handler fallbacks. The only structural difference was this:

```css
/* ✖ WRONG — SVG filter as background-image.
   Taints html2canvas's output canvas in Safari → breaks every shader
   transition in Safari + cross-origin iframes. Also measurably slower in
   WebKit than CSS gradients even when it does work. */
.grain {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.08;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  mix-blend-mode: overlay;
}
```

```css
/* ✓ RIGHT — layered CSS radial-gradient dots. Same grain effect visually,
   pure CSS rendering, zero canvas taint, fast everywhere. */
.grain {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.18;
  background-image:
    radial-gradient(rgba(255, 255, 255, 0.08) 1px, transparent 1.2px),
    radial-gradient(rgba(0, 0, 0, 0.18) 1px, transparent 1.2px);
  background-size:
    3px 3px,
    5px 5px;
  background-position:
    0 0,
    1px 2px;
  mix-blend-mode: overlay;
}
```

The same principle applies to other SVG-filter decoratives (paper fiber via `feTurbulence + feDisplacementMap`, CRT scanline overlays built from SVG patterns, etc.). In general, **avoid SVG filter data URLs in scene markup** — prefer layered CSS gradients, `backdrop-filter`, or solid-color overlays.

**Escape hatch for unavoidable SVG effects.** If a scene genuinely needs an SVG filter (rare — usually a specific decorative that cannot be replicated in CSS), mark that element with `data-no-capture`. The shader's `captureScene()` already has logic to skip elements with this attribute — it won't enter the html2canvas clone pass, so it can't taint the output canvas. The element will still render live in the browser; it just won't appear in the shader transition textures (which for a grain overlay is usually invisible anyway, since the overlay is typically so subtle and repetitive that not seeing it mid-transition is imperceptible).

```html
<!-- SVG decorative element skipped from shader capture only — still renders live -->
<div class="grain svg-filter-grain" data-no-capture></div>
```

### Self-review — run this checklist before calling the build done

Check every item with actual code, not assumptions.

- [ ] Every scene has `class="scene clip"` + `data-start` + `data-duration` + `data-track-index`.
- [ ] Non-first scenes have the correct inline style for the path in use. With HyperShader: `style="opacity:0;"` ONLY (no `visibility:hidden` — it breaks `captureIncomingScene` and produces content-fading-into-blank blinks during transitions). Without HyperShader: `style="visibility:hidden;"` ONLY (no `opacity:0` — nothing animates it back to 1).
- [ ] Scene windows tile end-to-end with no gaps (scene-N's `data-duration` = next scene's `data-start` − this scene's `data-start`).
- [ ] **Every scene has a `<div class="scene-content">` wrapper — not just scene-1.** Scan each scene's opening block and confirm the wrapper is present. Missing on any scene causes boxes/clipped elements during that scene's transition.
- [ ] Animated content is INSIDE `.scene-content`; static decoratives are OUTSIDE.
- [ ] **No scene is longer than 5 seconds** unless you can name the specific pacing reason (hero hold, cinematic push, silence beat, counter that needs ≥6s of runtime). Scenes of uniform length indicate you divided total duration by scene count instead of designing the rhythm.
- [ ] **Every scene is long enough for its text to be read** — per the reading-time budget table in Step 3. 11–20 words needs ≥4s; 21–35 words needs ≥6s. The last readable text element in each scene finishes entering by the 50% mark of the scene so the viewer has the second half to actually read.
- [ ] Shader transitions (if used) have the scene boundary strictly INSIDE the transition window — `transition.time < boundary < transition.time + duration`.
- [ ] Zero `tl.set` / `tl.to` / `tl.from` / `tl.fromTo` on scene containers.
- [ ] Every visible scene > 4s has a Breathe phase — at least one element in continuous motion, not just entrance + static.
- [ ] Every element has a verb (from the verbs table) and an identifiable beat (build / breathe / resolve).
- [ ] No banned fonts. No Inter, Roboto, Playfair, Syne. Check the full list.
- [ ] No `Date.now()`, `Math.random()` unseeded, `repeat: -1`, `setInterval`, async timeline construction.
- [ ] No `stagger: { from: "random" }` — GSAP's random is unseeded (Anti-pattern 2). Use `from: "start"`, `"center"`, `"end"`, or a grid origin instead.
- [ ] No exit tweens except on the final scene. Grep every scene for `tl.to(..., { opacity: 0 })`, `tl.to(..., { autoAlpha: 0 })`, and `tl.to(..., { y: <offscreen> })` — these are Anti-pattern 1 and produce empty-scene captures.
- [ ] No SVG filter data URLs as `background-image` (Anti-pattern 4). Grep for `data:image/svg+xml` in the CSS — if present, either replace with layered `radial-gradient`s (preferred) or add `data-no-capture` to the element. SVG filters taint html2canvas's canvas in Safari, killing every shader transition in Safari + cross-origin iframe environments.
- [ ] Minimum font sizes: 60px+ headlines, 20px+ body, 16px+ labels. `font-variant-numeric: tabular-nums` on number columns.
- [ ] No full-screen dark linear gradients (H.264 banding). Use radial or solid + localized glow.
- [ ] `window.__timelines["<id>"] = tl` is registered and the id matches `data-composition-id` on the root.

---

## Step 5: Deliver

**Gate:** `index.html`, `preview.html`, `README.md`, and (when identity was invented) `DESIGN.md` all exist in the project. `preview.html` loads in Claude Design's in-pane preview.

### `preview.html` template (copy verbatim)

Claude Design's sandbox requires a `?t=<token>` query on every internal URL. Without token forwarding, the iframe receives a `"preview token required"` placeholder and renders black.

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

Verbatim means verbatim. No decorative chrome (no header, wordmark, aspect-ratio wrapper, caption bar). `<hyperframes-player>` fills the viewport.

### `README.md` template (for the user who downloads the ZIP)

Claude Design can't run CLI commands — the user runs them locally after download. Include these instructions verbatim. Swap `<project-name>` and adjust render flags if the brief needs non-default resolution / fps.

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

### Caveats to surface to the user

When relevant, call these out in your final message:

- Placeholder assets (stripe patterns, CSS shapes, gradient blocks used where real images/video should go) — tell the user which selectors to replace and with what.
- Unverified stats or numbers in the composition — label them as illustrative and say where real figures should be confirmed.
- Any element copied from a real brand's identity — flag that the composition is an original interpretation, not a recreation of branded UI.

---

## Claude Design sandbox essentials

These are the non-negotiable Claude-Design-specific invariants. All must hold:

1. **Runtime preload.** `index.html` loads GSAP, then IMMEDIATELY on the next line loads `@hyperframes/core/dist/hyperframe.runtime.iife.js`. Without the runtime pre-load, the player reports `ready` but `currentTime` never advances — the preview is a static frame.

   ```html
   <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
   <script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>
   ```

2. **Preview token forwarding.** `preview.html` sets the player's `src` via the inline script `document.getElementById("p").setAttribute("src", "./index.html" + location.search)` — not via `src=` on the element. See the verbatim template in Step 5.

3. **`data-composition-id` ↔ `__timelines` key match.** The string on the root element and the key in `window.__timelines["..."]` must be identical. Default to `"main"` unless the brief specifies otherwise.

4. **HyperShader root-only for multi-act compositions.** If you split into sub-compositions, call `HyperShader.init()` at the root level only, never inside a sub-comp. See Step 4.

5. **Every scene has a `<div class="scene-content">` wrapper** — not just scene-1. Non-first scenes without this wrapper cause visible boxes / clipped elements / empty placeholders during every shader transition into them, because `captureIncomingScene()` can't isolate pre-animation from-state from the shader texture.

6. **Deterministic rendering.** No `Date.now()`, no unseeded `Math.random()`, no `setInterval`, no `setTimeout` inside timeline construction, no `repeat: -1`.

---

## Video types quick reference

| Type                        | Duration | Scenes | Avg scene | Format (default)       |
| --------------------------- | -------- | ------ | --------- | ---------------------- |
| Social ad (IG/TikTok/Reels) | 10–15s   | 5–8    | 2–3s      | 1080×1920 (9:16)       |
| Launch teaser               | 10–20s   | 6–10   | 2–3s      | 1920×1080 or 1080×1920 |
| Product demo                | 20–45s   | 8–14   | 3–4s      | 1920×1080              |
| Feature announcement        | 15–30s   | 6–12   | 2–4s      | 1920×1080              |
| Brand reel                  | 20–45s   | 8–14   | 3–4s      | 1920×1080              |
| Explainer                   | 30–60s   | 12–20  | 3–5s      | 1920×1080              |
| Long-form narrative         | 60–180s  | 24–45  | 3–5s      | 1920×1080              |

Default to 1920×1080 at 30fps unless the brief specifies otherwise.

---

## References (loaded on demand)

Everything critical is inlined above — you should rarely need to fetch more. These fallbacks exist for edge cases.

**Foundational — fetch when you hit a pattern this skill doesn't cover:**

- Core composition contract (data attributes, composition structure, sub-comp wiring, video/audio, timeline contract): https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/SKILL.md
- Motion theory (build/breathe/resolve, easing as emotion, direction rules, speed as weight, transitions as meaning): https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/motion-principles.md
- Typography (full banned list, weight contrast rules, font-discovery Python script, dark-background compensations, OpenType features): https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/typography.md
- House style (lazy AI defaults, palette guidance, background layer ideas): https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/house-style.md
- Palettes (9 named palettes with hex values): https://github.com/heygen-com/hyperframes/tree/main/skills/hyperframes/palettes
- Transitions (energy/mood tables, shader catalog, CSS transition patterns): https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/transitions.md
- GSAP deep reference (advanced timelines, stagger, keyframes, plugins): https://github.com/heygen-com/hyperframes/blob/main/skills/gsap/SKILL.md
- `@hyperframes/player` docs (player element internals, event hooks, framework examples): https://github.com/heygen-com/hyperframes/blob/main/packages/player/README.md
- CLI reference (advanced `npx hyperframes` flags, non-standard commands): https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-cli/SKILL.md
- Registry examples (real working compositions authored by the framework team): https://github.com/heygen-com/hyperframes/tree/main/registry/examples
- Full docs site: https://hyperframes.heygen.com/

**Feature-specific — fetch only when the brief needs the feature:**

- URL-to-video capture pipeline (when the user wants a video built from a captured website): https://github.com/heygen-com/hyperframes/blob/main/skills/website-to-hyperframes/SKILL.md
- Captions / subtitles synced to audio: https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/captions.md
- TTS narration (Kokoro-82M): https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/tts.md
- Audio-reactive animation (amplitude, frequency bands): https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/audio-reactive.md
- CSS text-highlight patterns (marker, circle, burst, scribble, sketchout): https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/css-patterns.md
- Dynamic caption animations (karaoke, slam, scatter, elastic, 3D): https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/dynamic-techniques.md
- Audio transcript generation: https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/transcript-guide.md
- Installable blocks + components (`hyperframes add`): https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes-registry/SKILL.md

---

## Example prompts users tend to type

Prefer attachment-driven briefs — they produce brand-accurate output. URL-only briefs on SPA homepages produce generic results.

**Attachment-driven (strongest):**

- _[user drops 3 UI screenshots]_ — `Use the attached skill. 30s product walkthrough matching these screenshots. Feature-led, 16:9, dark theme.`
- _[user drops a brand PDF]_ — `Use the attached skill. 15s 9:16 teaser for the brand in this PDF. Honor palette and type exactly.`
- _[user drops a reference video]_ — `Use the attached skill. 20s video in the same tonal register as this reference. Match pacing, color, shader character; my copy below.`

**Pasted-content:**

- `Use the attached skill. 30s hero reel with this copy for each scene: [pasted script]. Dark theme, technical, no warmth.`
- `Use the attached skill. 45s editorial explainer. Palette: #0a0a0d / #f5f5f7 / #7c6cff. Type: Space Grotesk + JetBrains Mono. Copy below.`

**URL-only (weakest — may need to ask for attachments):**

- `Use the HyperFrames Claude Design skill. Turn https://www.anthropic.com/news/claude-design-anthropic-labs into a 45-second editorial explainer.` — static article, `web_fetch` works here.
- `Use the HyperFrames Claude Design skill. 30-second product video for linear.app.` — SPA, `web_fetch` returns little; ask for screenshots or pivot to the brand's blog/press/Wikipedia.

**Sparse (triggers the clarifying question):**

- `Use the attached skill. Make me a 30-second launch video for Orbit. Make it cool.` → expect the clarifying message with 5 options.

**Follow-up (skip the question):**

- `Cut it to 20 seconds and drop scene 3.` — continuing an existing composition; build immediately.
