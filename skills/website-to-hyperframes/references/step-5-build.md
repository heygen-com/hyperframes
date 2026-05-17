# Step 5: Build Compositions

**Captions rule — read before building anything:** Never create `compositions/captions.html` with an empty transcript (`const script = []`). If the VO/transcript step was skipped or failed, do not create a captions composition at all. An empty captions file silently does nothing and wastes a track slot. Only create it when `transcript.json` has real word timestamps.

**Captions stacking bug:** Every caption word group must start with `opacity: 0` (or `visibility: hidden`) and be positioned `position: absolute`. Never show more than one group at a time — GSAP controls visibility sequentially. If multiple groups are visible simultaneously it means either (a) the initial CSS state isn't hidden, or (b) a group's exit tween is missing before the next group's entrance fires. After building captions.html, take a snapshot at 3–4 timestamps mid-narration and verify only one word group is visible per frame.

**Before building, verify you have:**

- **STORYBOARD.md** — the beat-by-beat plan. Re-read it now if you don't remember every beat's concept, assets, and techniques.
- **DESIGN.md** — if you need to check a specific value (color, font, component style) you can't recall, look it up. Don't re-read the whole file.
- **`capture/extracted/asset-descriptions.md`** — when the storyboard assigns an asset to a beat, check the description to understand what it shows. Re-read this file if you can't recall the asset inventory.
- **transcript.json** — word-level timestamps that drive scene durations.

Load the `hyperframes` skill — it has the rules for data attributes, timeline contracts, deterministic rendering, and layout. Read it now if you haven't already this session.

**For capabilities.md and techniques.md:** read the Table of Contents to orient yourself, then go deep only on the sections your storyboard actually calls for. You don't need to re-read sections for animation engines, registry blocks, or techniques that none of your beats use.

---

## 1. Copy SFX to project

```bash
cp -r skills/website-to-hyperframes/assets/sfx/ <project-dir>/sfx/
# If skill is installed elsewhere:
find . -path "*/website-to-hyperframes/assets/sfx" -exec cp -r {} <project-dir>/sfx/ \;
```

## 2. Build the root index.html

Create `index.html` yourself. This is the orchestrator — it holds beat slots, narration audio, SFX, and shader transitions (if any).

**Critical CSS — every beat must overlap in the same frame:**

```css
.scene {
  position: absolute;
  top: 0;
  left: 0;
  width: 1920px;
  height: 1080px;
  overflow: hidden;
}
```

**Beat structure:**

```html
<div
  id="root"
  data-composition-id="main"
  data-start="0"
  data-duration="TOTAL"
  data-width="1920"
  data-height="1080"
>
  <div
    id="beat-1"
    class="scene"
    data-composition-id="beat-1-hook"
    data-composition-src="compositions/beat-1-hook.html"
    data-start="0"
    data-duration="5.5"
    data-track-index="1"
    data-width="1920"
    data-height="1080"
  ></div>

  <!-- more beats... -->

  <audio
    id="narration"
    src="narration.wav"
    data-start="0"
    data-duration="NARRATION_LENGTH"
    data-track-index="0"
    data-volume="1"
  ></audio>

  <!-- SFX on content moments, NOT on shader transitions -->
  <audio
    id="sfx-impact"
    src="sfx/impact-bass-1.mp3"
    data-start="0.3"
    data-duration="2.1"
    data-track-index="41"
    data-volume="0.35"
  ></audio>
</div>
```

SFX were assigned in the storyboard (Step 3) — implement exactly what STORYBOARD.md specifies. Each SFX entry has a file, trigger time, and volume. Wire each one as an `<audio>` element with the exact `data-start`, `data-duration`, and `data-volume` from the storyboard. Do not add, remove, or substitute SFX beyond what the storyboard says.

**Choose architecture based on pacing (from Step 3)**

| Pacing                        | Architecture                                                                                                                                                                    | Why                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Fast** (billboard-per-beat) | Single `index.html`, stacked `<div class="beat">` elements, GSAP opacity sequencing. NO sub-compositions, NO HyperShader. Hard cuts via `tl.set()`. Load `/launch-video` skill. | Sub-compositions add latency; hard cuts need instant swaps. One file = zero load delay. |
| **Moderate / Slow / Arc**     | Sub-compositions with `HyperShader.init()`. Each beat in `compositions/beat-N.html`. CSS crossfades or shader transitions between scenes.                                       | Transitions need HyperShader's compositing. Sub-agents build each beat independently.   |

If the storyboard says "fast" pacing: use the stacked-beats pattern from `/launch-video`. Do not use HyperShader — it adds scene registration overhead that creates gaps between hard cuts. Every frame is content, no transition frames.

If the storyboard says "slow" or "cinematic": build each beat as a sub-composition. Use long crossfades (0.8–1.2s `duration` with no `shader` key = CSS crossfade). Inside each beat, use continuous subtle motion — nothing is static:

- Ken Burns drift on screenshots: `tl.fromTo(img, {scale:1.05, x:20}, {scale:1, x:-20, duration: BEAT, ease:"none"})`
- Parallax text layers: `tl.fromTo(text, {y:30}, {y:-30, duration: BEAT, ease:"power1.inOut"})`
- 1–2s breathing room before text enters (don't animate everything at t=0)
- Soft easing: `expo.out` for entrances, `power1.inOut` for drifts

**Multi-scene index.html with HyperShader — for moderate/slow/arc pacing**

For videos with sub-composition beats and scene transitions, `index.html` MUST use `HyperShader.init()`. This is the entire scene orchestration layer. Do NOT try to use registry block sub-compositions (e.g. `compositions/domain-warp-dissolve.html`) for transitions — those are standalone showcase demos, not how HyperShader works in multi-scene compositions.

Copy the local shader build first:

```bash
cp packages/shader-transitions/dist/index.global.js <project-dir>/hyper-shader-local.js
```

Full working `index.html` pattern — every field matters:

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script src="hyper-shader-local.js"></script>

<div id="root" data-composition-id="main" data-start="0" data-duration="TOTAL"
     data-width="1920" data-height="1080">

  <!-- Host divs: MUST have both id AND data-composition-id matching the same value.
       HyperShader.init() uses getElementById() — without id="beat-1" it fails with
       "scene ids not found in DOM". -->
  <div id="beat-1" class="scene"
    data-composition-id="beat-1-hook"
    data-composition-src="compositions/beat-1-hook.html"
    data-start="0"        <!-- transition INTO this beat starts here -->
    data-duration="4.5"   <!-- must match the GSAP BEAT constant in the composition -->
    data-track-index="1"
    data-width="1920" data-height="1080"
    style="background: #YOUR_BEAT_BG_COLOR;"><!-- background here OR in sub-comp CSS — both work -->
  </div>

  <div id="beat-2" class="scene"
    data-composition-id="beat-2-features"
    data-composition-src="compositions/beat-2-features.html"
    data-start="4.0"
    data-duration="5.5"
    data-track-index="2"  <!-- use sequential track indices (1,2,3...) to avoid linter errors -->
    data-width="1920" data-height="1080"
    style="background: #YOUR_BEAT_BG_COLOR;">
  </div>

  <!-- ... more beats ... -->

  <!-- ALWAYS add a dummy s-end scene as the LAST entry.
       HyperShader renders scenes[N-1] as black in some contexts.
       s-end is invisible — it just prevents your CTA from being last. -->
  <div id="s-end" class="scene"
    data-composition-id="s-end"
    data-start="TOTAL_MINUS_0.1"
    data-duration="0.1"
    data-track-index="N"
    data-width="1920" data-height="1080">
  </div>

</div>

<script>
  window.__timelines = window.__timelines || {};
  var tl = HyperShader.init({
    bgColor: "#000000",
    accentColor: "#YOUR_ACCENT",
    scenes: ["beat-1", "beat-2", "beat-3", ..., "s-end"],
    transitions: [
      { time: 4.0, shader: "sdf-iris", duration: 0.7 },    // WebGL shader
      { time: 9.5, duration: 0.5 },                         // CSS crossfade (no shader)
      // ... one transition per scene boundary ...
      { time: TOTAL_MINUS_0.1, duration: 0.1 }              // dummy → s-end
    ],
  });
  // Add ALL beat animations to the returned tl AFTER init()
  window.__timelines["main"] = tl;
</script>
```

**Track index and the linter:** Use sequential track indices (`data-track-index="1"`, `"2"`, `"3"`...) for each beat — NOT all on track `"1"`. The linter flags overlapping clips on the same track as an error, and HyperShader compositions always have overlapping beats (the transition window). Using sequential indices silences the linter; HyperShader manages which scene is VISIBLE via opacity regardless of track index.

**Scene background colors:** setting `style="background: #3139FB"` on the host `<div id="beat-1">` in index.html is the simplest pattern — it's visible at a glance from the root file. Setting background inside the sub-composition's CSS also works. Either is fine; host div is preferred for clarity.

**Critical: beat host divs must have sequential `data-start` and matching `data-duration`.** Do NOT set `data-start="0"` on all beats — the render engine seeks each beat's GSAP timeline to `global_time - data_start`. At t=10s with `data-start=0`, a 5.5s timeline is seeked past its end and all content disappears.

`data-duration` must match the GSAP `BEAT` constant in the composition (the length of the sub-composition's internal timeline). If the two disagree, animations get cut off.

**Storyboard Beat Timing section** tells you both values — use them directly:

- `data-start` = "Transition in at:" value from the storyboard
- `data-duration` = "GSAP duration:" value from the storyboard

**Font handling:** Common fonts are auto-resolved by the renderer: use `"Inter"` (not `"Inter Variable"` — the compiler only maps the base name), `"Roboto"`, `"JetBrains Mono"`, `"Poppins"`. If a composition uses `"Inter Variable"` it will log compiler warnings and may fall back incorrectly — always use `"Inter"`. Only brand-specific fonts (GT Walsheim, Aeonik, etc.) need `@font-face`. Check `capture/assets/fonts/` — hashed filenames are Google Fonts subsets that auto-resolve; recognizable filenames (e.g. `BrandSans-Bold.woff2`) are brand fonts that need `@font-face` declarations.

**Brand font @font-face:** If the storyboard's BRAND VALUES lists a brand-specific font with a path in `capture/assets/fonts/`, add the `@font-face` block at the top of each composition that uses it — sub-agents won't do this unless you tell them explicitly. Paste the exact `@font-face` declaration in the sub-agent prompt's BRAND VALUES section. Without this, every composition falls back to `system-ui` and the brand typeface never loads.

**⚠ ASSET PATHS — most common sub-agent mistake (5+ agents per run):** All asset paths in compositions must be relative to the **PROJECT ROOT**, not to the composition file. `compositions/beat-N.html` lives one directory deep, but paths must be written as if from the root.

- ✅ `capture/assets/hero.png`
- ❌ `../capture/assets/hero.png`

The Studio preview server rewrites base URLs to the project root — `../` paths that seem to work locally will 404 in preview and in renders. Add this verbatim to every sub-agent prompt's RULES section.

## 3. Build each composition — USE SUB-AGENTS

**Before dispatching, re-read DESIGN.md and STORYBOARD.md.** You wrote these files earlier in the session and you think you remember them. You don't — not the exact hex values, not the specific font families, not the button border-radius, not the Do's/Don'ts. Re-read them now so you can paste accurate brand rules and beat specs into each sub-agent prompt.

**If your runtime supports parallel sub-agents** (Claude Code, Cursor, most agent frameworks): dispatch one sub-agent per beat — 3 to 4× faster than building sequentially. For 3+ beats, always dispatch in parallel. For 1–2 beats, sequential is fine.

**If your runtime does not support parallel sub-agents** (some Codex setups, serial-only models): build sequentially using the same context-packing template below. The template gives each build pass the same context a sub-agent would get — paste prev/this/next beat + brand values — so output quality is the same, just slower.

In either case, use the template. Do not skip it and build from memory.

Each sub-agent gets the full context it needs to build independently. Paste the COMPLETE storyboard sections — don't summarize or extract pieces. **Also paste the brand values inline** — do not tell sub-agents to re-read DESIGN.md in full. You already have DESIGN.md in context; extract the relevant values and paste them directly. This cuts each sub-agent's startup time by 30-40%.

```
Build the composition for Beat N. Save to compositions/beat-N-name.html.

═══ PREVIOUS BEAT (Beat N-1) ═══
[paste the FULL previous beat section from STORYBOARD.md — concept, VO,
visual description, animation sequence, SFX, everything. The sub-agent
needs to see what was just on screen to build a matching entrance.]

═══ THIS BEAT (Beat N) ═══
[paste the FULL beat section from STORYBOARD.md — concept, VO, visual
description with all animation sequences/timings/CSS values, SFX cues,
techniques referenced. This IS the build spec.]

═══ NEXT BEAT (Beat N+1) ═══
[paste the FULL next beat section from STORYBOARD.md — so the sub-agent
knows what's coming and can build an exit that sets it up.]

═══ BRAND VALUES (from DESIGN.md — use these exactly) ═══
Colors:
  --bg:        #[hex]   primary background
  --fg:        #[hex]   primary text
  --accent:    #[hex]   CTA / highlights
  --surface:   #[hex]   card / panel backgrounds
  [add 2-3 more if used in this beat]

Fonts:
  Headlines: [font family], [weight]
  Body:      [font family], [weight]
  [brand-specific font path if needed: capture/assets/fonts/Brand.woff2]

Key component styles for this beat:
  [paste 3-5 relevant lines from DESIGN.md for components this beat uses,
   e.g. button radius, card shadow, heading letter-spacing]

Do NOT read DESIGN.md. The values above are everything you need.

═══ CAPTURED ASSETS FOR THIS BEAT ═══
[Paste the ACTUAL file paths from capture/extracted/asset-descriptions.md for
every asset assigned to this beat. Include the one-line description so the
sub-agent knows what each file shows. Format:

- capture/assets/hero-dashboard.png — full-bleed product dashboard screenshot, dark theme
- capture/assets/logo.svg — brand wordmark, white on transparent
- capture/assets/feature-card.jpg — feature comparison grid, 3 columns

DO NOT just say "see asset-descriptions.md". Paste the relevant entries here.
The sub-agent has ZERO context — if you don't paste the path, it will build
CSS recreations instead of using the real captured assets.

If you don't know which assets to assign yet, read capture/extracted/asset-descriptions.md
NOW (before dispatching) and decide. Then paste the relevant ones here.]

═══ IMPORTANT: YOU START WITH ZERO CONTEXT ═══
You have no knowledge of HyperFrames, GSAP, or this project. Before writing
ANY code, read these — targeted reads only, not full files:

1. Load the `hyperframes` skill — data attributes, timeline contracts,
   deterministic rendering rules (this is non-negotiable, read the whole skill)
2. capabilities.md — read the Table of Contents first (lines 1-40), then
   read ONLY the sections relevant to this beat's techniques:
   [paste the section names/line ranges from capabilities.md that apply,
    e.g. "Section 3: Canvas 2D (lines 89-134)" or "Section 7: Shader Transitions"]
3. techniques.md — read ONLY the techniques this beat uses:
   [paste the technique names/line ranges from techniques.md that apply,
    e.g. "Technique 4: Kinetic Typography (lines 156-210)"]
4. If this beat uses HTML-in-Canvas/WebGL: read html-in-canvas-patterns.md in full
5. If this beat uses screenshots: VIEW them before placing text on them

Brand values are in the BRAND VALUES section above — no need to read DESIGN.md.

═══ RULES ═══
- ROOT ELEMENT: the root div inside every sub-composition template MUST have `data-composition-id`, `data-width`, and `data-height` attributes matching the host div's values. Sub-agents consistently miss these. Example: `<div id="beat-2-features" data-composition-id="beat-2-features" data-width="1920" data-height="1080">`. Without them the composition fails to register and lint errors fire.
- GSAP FROM TRAP: never use `gsap.from(el, {opacity:0})` when the element also has CSS `opacity:0`. GSAP reads the current CSS value as the animation target — it animates 0→0, not 0→1. The beat stays invisible. Always use `tl.fromTo(el, {opacity:0}, {opacity:1, ...})` or remove the CSS opacity and let GSAP control it entirely.
- CHARACTER SPANS AND SPACES: when splitting text into per-character `<span>` elements with `display:inline-block`, NEVER apply inline-block to space characters — they collapse to zero width. "What if your Mac" becomes "WhatifyourMac". Solution: use `&nbsp;` for spaces, or split at word level (per-word spans) instead of per-character.
- SVG CURRENTCOLOR VIA IMG: SVGs that use `fill="currentColor"` render black (invisible on dark backgrounds) when loaded via `<img src="logo.svg">`. The img tag cannot inherit CSS color into the SVG. Either: (a) inline the SVG directly in the HTML, (b) use `filter: brightness(0) invert(1)` for simple single-color SVGs you want white, or (c) hardcode the fill color in the SVG file.
- SCRIPT PLACEMENT: scripts MUST be inside the <template> element, not after </template>. The <template> content is inert until HyperFrames injects it — scripts outside see no DOM, every querySelector returns null, GSAP silently does nothing. This is the single most common cause of "all compositions completely static."
- STYLE PLACEMENT: CSS `<style>` blocks inside `<template>` are injected into the document and apply correctly. However, avoid setting `opacity: 0` on elements via CSS if GSAP will animate them — the interaction between CSS initial states and the render engine's GSAP seeking can produce black frames in some cases. Setting initial states via GSAP `tl.fromTo(el, {opacity:0,...}, {opacity:1,...})` FROM values is the safest pattern (matches how v4 compositions worked). Background colors, positioning, and layout styles in `<style>` blocks are fine.
- DATA-START: never set data-start="0" on all beat host divs. Each beat's GSAP timeline is seeked to global_time - data_start. With all data-start=0, a beat with a 5.5s GSAP timeline is seeked to t=10 at global t=10 — past its end, engine marks it invisible. Set each beat's data-start to its HyperShader transition point. data-duration = beat's GSAP timeline length. Use sequential data-track-index values (1, 2, 3...) to avoid linter overlap errors.
- HYPERSHADER TIMELINE: never pass `timeline: tl` to HyperShader.init(). Let HyperShader create the timeline. Add all tweens to the returned tl AFTER init(). Passing an existing timeline breaks the scrubber and pre-warming.
- PROXY+ONUPDATE: never use `tl.fromTo(proxy, {}, {val, onUpdate: () => el.textContent = proxy.val})` for counter animations. The onUpdate callback doesn't fire when the render engine seeks directly to a time. Use discrete tl.set(el, {textContent: value}, timestamp) calls instead.
- SHADER NAMES: block name ≠ shader name. `npx hyperframes add domain-warp-dissolve` installs the BLOCK but the HyperShader runtime name is `domain-warp`. After installing any block, open its showcase HTML in `compositions/` to find the exact shader name used in `HyperShader.init()`. Then delete the showcase file — it triggers lint warnings and isn't part of the video.
- CSS CENTERING: never use `transform: translate(-50%, -50%)` for centering elements you'll also animate with GSAP. GSAP overwrites the entire CSS transform, breaking the centering. Use `xPercent: -50, yPercent: -50` in the GSAP tween instead, or use flexbox centering.
- HYPERFRAMER LAST SCENE: HyperShader renders the final entry in `scenes[]` as black in some contexts. If your CTA beat is the last scene and appears black, add a dummy invisible scene after it: `scenes: [..., "beat-5-cta", "s-end"]` with a dummy `<div id="s-end">` and a 0.1s transition at the video's end.
- ASSET PATHS: always project-root-relative. capture/assets/file.png ✅  ../capture/assets/file.png ❌
- FONTS: if brand fonts are listed above with a capture/assets/fonts/ path, add @font-face at the top of your CSS. Without it everything falls back to system-ui.
- QUERYSELECTOR: never use document.querySelector("#host #child") — the host isn't in main DOM at script time. Use document.getElementById("child") with null guards. Never call .getTotalLength() or any DOM method without a null check first — one uncaught TypeError crashes the entire beat script before the timeline registers.
- If you want to place text over a screenshot: VIEW it first
- Use captured screenshots at full size, NOT CSS recreations unless you
  can recreate something almost pixel perfect
- Register timeline: window.__timelines["beat-N-name"] = tl
- No Math.random, no repeat:-1, no callbacks, no RAF
- Use tl.fromTo() not tl.from() for entrance animations
- No CSS transform for centering — use flexbox
- Never stack two transform tweens on same element
```

The storyboard beat already contains everything — the concept, the visual choreography with exact timings, the CSS values, the SFX cues. The sub-agent's job is to translate that description into working HTML/CSS/GSAP, not to re-invent the creative direction. If you want, you can also paste any other relative and useful context to subagents if think it's good, why not.

### Per-composition process

For each beat:

**1. Read the storyboard beat.** The storyboard IS the build spec. It tells you what elements exist, how they enter, what they do during the beat, and how they exit. Follow it. If something in the storyboard isn't clear or seems impossible, research how to do it or ask — don't silently skip it.

**2. Build the static end-state first.** Position every element at its most visible moment. HTML+CSS only, no GSAP yet. The CSS position is the ground truth.

**3. Add the animation sequence.** Follow the storyboard's choreography — it specifies what happens and when. Use `tl.fromTo()` (not `tl.from()`) for entrances. Build the timeline in the order the storyboard describes.

**4. Add exit** (if CSS transition out). If shader transition — no exit animation needed.

**5. View the result.** After building, take a snapshot of this beat at different timestamps (where things are supposed to happen, animate, move and etc) and look at it from all angles, corners and positinos. Is the frame full and everything is exactly where it supposed to be? Are you sure??? Are elements readable? Does it match what the storyboard describes?

### Technical rules

- **No `repeat: -1`** — calculate exact repeats from beat duration
- **No `Math.random()`** — use a seeded PRNG
- **No bare `gsap.to()`** — all tweens on `tl`, never standalone
- **No full-screen dark linear gradients** — H.264 banding
- **Minimum fonts**: 80px+ headlines, 20px+ body
- **WCAG contrast on gradient backgrounds:** The contrast validator samples actual background pixels under the text element — if the background is a gradient image, darker parts of the image make the measured ratio _worse_ when you darken the text color, not better. Fix: either place text over a solid-color zone, or add `data-layout-ignore` attribute to decorative labels that don't need WCAG compliance. Don't blindly darken text color when the background isn't solid.

## 4. After all compositions are built — reconciliation check

Before moving to Step 6, run this sanity check:

```bash
# List every file in compositions/ and verify each one has a host div in index.html
ls compositions/
```

For every `.html` file in `compositions/`, confirm that `index.html` has a `data-composition-src="compositions/<filename>"` pointing to it. If any composition file is not referenced in `index.html`, add the missing host div now — an unreferenced composition is completely invisible at runtime.

**Captions stub rule:** Never create a `compositions/captions.html` with an empty transcript (`const script = [];`). If the VO/transcript step was skipped or failed, do not create the captions composition at all. An empty captions file that returns immediately is worse than no captions file — it silently does nothing and wastes a track slot.

Once all compositions are built and all `compositions/` files are wired into `index.html`, move to Step 6 (Validate & Deliver) for lint, validate, snapshots, and visual review.
