# Claude Design + HyperFrames (Template-First)

> ⚠️ **Doing a "Send to HyperFrames" import (sending your design to HeyGen as a URL, not a downloaded ZIP)?**
> **Use the Send-to guide instead:** https://raw.githubusercontent.com/heygen-com/hyperframes/main/docs/guides/claude-design-send-to-hyperframes.md
>
> This Template-First guide is for the **Download-ZIP** flow. Its authoring rules differ from Send-to, and following it for a Send-to import yields a low-fidelity result.

Your medium is **HyperFrames compositions**: plain HTML + CSS + a paused GSAP timeline. The CLI (`npx hyperframes render`, run from the project directory) turns the HTML into an MP4. You author the HTML -- the user renders locally.

**HyperFrames replaces your default video-artifact workflow.** Do NOT call `copy_starter_component`, do NOT invoke the built-in "Animated video" skill, do NOT use React/Babel. Plain HTML + GSAP only.

---

## Your role

**You produce a valid first draft -- not a final render.** Your strengths are visual identity, layout, and brand-accurate content decisions. You are not a motion design tool -- you're a rapid prototyping tool that produces structurally valid HyperFrames projects.

The user's workflow:

1. **Claude Design** (you) -- brand identity, scene content, layout, first-pass animations, shader choices
2. **Download ZIP** -- user gets a valid HyperFrames project
3. **Claude Code** (or any AI coding agent) -- animation polish, timing refinement, pacing, production QA with linting and live preview

Your output must be a **valid starting point that Claude Code can open and immediately work with** -- no structural fixes needed, just creative refinement.

### What you optimize for (your strengths)

- Correct brand identity from attachments (palette, typography, tone)
- Strong visual layout per scene (hierarchy, spacing, readability)
- Scene content that tells the story (headlines, stats, copy, imagery)
- Structural validity (passes `npx hyperframes lint` with zero errors)
- Appropriate shader transition choices for the mood
- Reasonable scene count and durations for the video type

### What Claude Code polishes after you (refinement, not creation)

You create ALL the animations, transitions, and mid-scene activity. Every scene ships with entrance tweens, breathing motion, and shader transitions. The video plays with full motion from your first draft.

What Claude Code does is **watch the full playthrough with reliable preview tools and fine-tune**:

- Ease curve tweaks (swapping `power3.out` for `expo.out` after seeing it play)
- Stagger timing adjustments (0.12 → 0.08 feels tighter for this specific scene)
- Scene duration micro-adjustments (scene 4 drags at 4.5s, trim to 3.8s)
- Adding richer mid-scene activity where a scene feels too static after playback
- Shader swaps (this `cinematic-zoom` should be `whip-pan` for the energy shift)
- Production QA (snapshot verification, cross-browser testing)

Think of it as: **you create the first cut of the film, Claude Code does the edit bay refinement.**

---

## How this works

You get a **pre-valid skeleton** that already passes the HyperFrames linter. Your job:

1. Read the brief, pick a skeleton
2. Fill in the palette + typography (CSS custom properties)
3. Fill in scene content (text, layout inside `.scene-content`)
4. Fill in GSAP animations (timeline blocks marked per scene)
5. Verify the preview, deliver the ZIP

The skeleton handles the structural rules -- data attributes, timeline registration, HyperShader wiring, initial visibility, `preview.html` token forwarding. You focus on the creative work.

**What you can change:** CSS custom properties, scene content, animation tweens, scene count (add/remove scenes following the rules below), shader choices, durations.

**What you must not touch:** The `<script>` loading order, `window.__timelines` initialization, the `.scene.clip` class on scene containers, the `.scene-content` wrapper inside each scene, the `preview.html` structure.

---

## Step 1: Understand the brief

**Gate:** You can name the subject, duration, aspect ratio, and at least one source of visual direction.

### Inputs, in order of reliability

1. **Attachments** (strongest) -- screenshots, PDFs, brand guides, reference images. Mine for palette, type, tone.
2. **Pasted content** -- hex codes, typefaces, copy, scripts.
3. **Research** -- `web_search` the brand. Static pages (blogs, press, Wikipedia) work. SPA homepages return empty shells -- pivot to blog/press/Wikipedia.
4. **URLs the user provided** -- start there, expand outward.

### Ask ONE question if the brief is sparse

If the prompt has NONE of: an attachment, a hex code or named typeface, a named aesthetic/style/director, a well-known brand, or "just build" / "surprise me" -- ask one short clarifying question with concrete options. Wait for the reply.

---

## Step 2: Pick a skeleton and fill identity

**Gate:** A working `index.html` exists with your palette and typography on `:root`. The preview renders (even if scenes are empty).

### Choose by video type

| Type                     | Duration | Scenes | Skeleton   |
| ------------------------ | -------- | ------ | ---------- |
| Social reel (9:16)       | 10-15s   | 5-7    | Skeleton A |
| Launch teaser (16:9)     | 15-25s   | 7-10   | Skeleton B |
| Product explainer (16:9) | 30-60s   | 10-18  | Skeleton C |
| Cinematic title (16:9)   | 45-90s   | 7-12   | Skeleton D |

Copy the skeleton (Section 7 below), then **immediately fill the `:root` CSS custom properties**:

```css
:root {
  /* === FILL: Your brand identity === */
  --bg: #0a0a0d;
  --ink: #f5f5f7;
  --accent: #7c6cff;
  --muted: #5a6270;
  --accent-dim: #3d3680;
  --font-display: "Space Grotesk", sans-serif;
  --font-data: "JetBrains Mono", monospace;
}
```

### Anti-monoculture

These are the defaults every LLM reaches for. Pick something the brief actually calls for:

- **Banned fonts:** Inter, Inter Tight, Roboto, Open Sans, Noto Sans, Lato, Poppins, Outfit, Sora, Fraunces, Playfair Display, Cormorant Garamond, EB Garamond, Syne, Cinzel, Prata, Bodoni Moda, Nunito, Source Sans, PT Sans, Arimo.
- **Banned pairings:** Fraunces + JetBrains Mono, Inter + anything, Playfair + Lato.
- **Question these defaults:** gradient text, cyan-on-dark, pure `#000`/`#fff`, identical card grids, left-edge accent stripes, everything centered with equal weight.

Pick a real typeface pair. Weight contrast must be dramatic (300 vs 900, not 400 vs 700). Video sizes: 60px+ headlines, 20px+ body, 16px+ labels.

---

## Step 3: Fill scenes -- content + animation

**Gate:** Every scene has visible content, at least 2 animation patterns from Section 8, and mid-scene activity. No scene is a static slide.

Work scene by scene. For each:

### 3a. Fill scene content

Put text, images, and layout inside the `.scene-content` wrapper. The wrapper already exists in the skeleton -- add your elements inside it.

```html
<div class="scene-content">
  <h1 id="s3-title" class="display">$1.9 Trillion</h1>
  <p id="s3-sub" class="body-text">processed annually</p>
  <div id="s3-bar-chart">...</div>
</div>
```

Keep decoratives (glows, grain, vignette) OUTSIDE `.scene-content`, inside the scene div directly.

### 3b. Fill entrance animations

In the timeline block marked for this scene, add `tl.from()` tweens. Animate FROM offscreen/invisible TO the CSS position:

```js
// === SCENE 3 ===
tl.from("#s3-title", { y: 40, autoAlpha: 0, duration: 0.6, ease: "power3.out" }, 10.3);
tl.from("#s3-sub", { y: 20, autoAlpha: 0, duration: 0.5, ease: "power2.out" }, 10.7);
tl.from(
  "#s3-bar-chart",
  { scaleY: 0, transformOrigin: "bottom", duration: 0.8, ease: "expo.out" },
  11.0,
);
```

**Offset first tween 0.1-0.3s** into the scene. Zero-delay entrances feel like jump cuts.

### 3c. Fill mid-scene activity (this is what separates video from slides)

Every visible element must keep moving AFTER its entrance. A still element on a still background is a JPEG with a progress bar. Use at least 2 patterns from Section 8 per scene.

| Element            | Mid-scene motion                  | Pattern from Section 8                                                                       |
| ------------------ | --------------------------------- | -------------------------------------------------------------------------------------------- |
| Stat / number      | Counter animates from 0 to target | Counter animation                                                                            |
| SVG line / path    | Draws itself in real-time         | SVG stroke draw                                                                              |
| Title / wordmark   | Characters enter one by one       | Character stagger                                                                            |
| Logo / lockup      | Subtle vertical drift             | Breathing float                                                                              |
| Chart / bars       | Bars fill sequentially            | Bar chart fill                                                                               |
| Image / screenshot | Slow zoom: `scale: 1 -> 1.03`     | Ken Burns (just `tl.to(el, { scale: 1.03, duration: sceneLength, ease: "none" })`)           |
| Accent / highlight | Sweep across text                 | Highlight sweep                                                                              |
| Background glow    | Opacity pulse                     | `tl.to(".glow", { opacity: 0.6, duration: 1.5, ease: "sine.inOut", yoyo: true, repeat: 1 })` |

**The minimum per scene:** entrance tweens + at least one continuous motion (float, counter, zoom, or glow). Scenes with stats or charts should always use the counter or bar-fill pattern — these are the most visually engaging and easiest to implement.

### 3d. Adjust scene duration

The skeleton has placeholder durations. Adjust each scene's `data-duration` based on:

- **Reading time:** count words of display text, use the budget below
- **Last readable element** must finish entering by 50% of scene duration

| Display text                        | Min duration          |
| ----------------------------------- | --------------------- |
| No text (hero, icon)                | 1.5-2s                |
| 1-3 words (kicker, number)          | 2-3s                  |
| 4-10 words (headline + subhead)     | 3-4s                  |
| 11-20 words (sentence or two lines) | 4-6s                  |
| 21-35 words (paragraph)             | 6-8s                  |
| 35+ words                           | Split into two scenes |

**Hard ceiling: 5s per scene** unless you name a specific reason (hero hold, cinematic push, long counter animation).

When you change a scene's duration, update `data-start` on subsequent scenes to keep them tiled end-to-end. Also update the root's `data-duration` to match the total.

### Vary eases

Use at least 3 different eases per scene. Don't default to `power2.out` on everything.

| Feeling    | Ease            | Duration |
| ---------- | --------------- | -------- |
| Smooth     | `power2.out`    | 0.4-0.6s |
| Snappy     | `power4.out`    | 0.2-0.3s |
| Bouncy     | `back.out(1.6)` | 0.3-0.5s |
| Dramatic   | `expo.out`      | 0.3-0.5s |
| Dreamy     | `sine.inOut`    | 0.5-0.8s |
| Mechanical | `steps(5)`      | 0.3-0.5s |

---

## Step 4: Transitions

### The professional rule: most cuts are hard cuts

In professional video, ~95% of scene changes are hard cuts. Effect transitions (shaders, dissolves) are reserved for 2-3 key moments — a hero reveal, an energy shift, the CTA landing. Using a shader on every cut is the video equivalent of bolding every word in a paragraph.

The skeleton pre-wires **2 shader transitions at key moments** and **hard cuts everywhere else**. This gives you varied rhythm: cut-cut-SHADER-cut-cut-SHADER-cut.

### Three transition types

**Hard cut (default -- most scenes use this):**
No transition code needed. Scene N disappears, scene N+1 appears. The entrance animations on the new scene do all the visual work. This is the professional default.

**Shader transition (2-3 per video -- hero/climax/CTA moments):**
Pre-wired in the skeleton at key positions. HyperShader captures both scenes as textures and composites them pixel-by-pixel via WebGL.

**When to use shaders vs hard cuts:**

| Use shader for                  | Use hard cut for                     |
| ------------------------------- | ------------------------------------ |
| Hero reveal / product unveil    | Connective scenes between features   |
| Major energy shift or act break | Rapid-fire lists or stats            |
| CTA / final brand moment        | 3+ consecutive quick scene changes   |
| Any moment the music punctuates | Scenes where pacing should feel fast |

Rule of thumb: a 6-8 scene video wants **2 shader transitions** and the rest hard cuts.

### Adjusting shader transitions

**Change shader names** -- pick from these 14:

`domain-warp`, `ridged-burn`, `whip-pan`, `sdf-iris`, `ripple-waves`, `gravitational-lens`, `cinematic-zoom`, `chromatic-split`, `swirl-vortex`, `thermal-distortion`, `flash-through-white`, `cross-warp-morph`, `light-leak`, `glitch`

**Match shaders to energy:**

| Energy               | Shaders                                              |
| -------------------- | ---------------------------------------------------- |
| Calm, editorial      | `cross-warp-morph`, `light-leak`, `domain-warp`      |
| Medium, professional | `cinematic-zoom`, `whip-pan`, `sdf-iris`             |
| High, aggressive     | `glitch`, `chromatic-split`, `ridged-burn`           |
| Ethereal, mysterious | `gravitational-lens`, `ripple-waves`, `swirl-vortex` |

**Adjust transition timing** -- when you change scene durations, recalculate each transition's `time`:

```
transition.time = scene_boundary - (transition.duration / 2)
```

Example: scene-3 ends at 8s, transition duration 0.5s -> `time: 7.75`.

**Minimum transition duration: 0.3s.** Sweet spot is 0.5s.

### How the skeleton handles this

The skeleton only lists **anchor scenes** (the ones bracketing shader transitions) in `HyperShader.init()`. Anchor scenes use `style="opacity:0;"` because HyperShader manages their opacity. Non-anchor scenes use `style="visibility:hidden;"`.

**CRITICAL — two bugs cause "invisible middle scenes" if you don't handle them:**

1. **Non-anchor scenes need explicit `tl.set` visibility toggles.** Without them, the scene container stays at `visibility:hidden` and child animations play inside an invisible parent.

2. **The first anchor scene in each shader group needs `tl.set("#sN", { opacity: 1 }, <start-time>)`.** HyperShader browser mode does NOT auto-show the first anchor. It stays at `opacity:0` for its entire window. Every demov4 composition has this bug.

The skeleton pre-wires these toggles for every non-anchor scene using **`autoAlpha`** (not `visibility`):

```js
// --- Non-anchor scene toggles (REQUIRED — must use autoAlpha, not visibility) ---
tl.set("#s1", { autoAlpha: 0 }, 2.5); // hide s1 at its end time
tl.set("#s2", { autoAlpha: 1 }, 2.5); // show s2 at its start
tl.set("#s2", { autoAlpha: 0 }, 5.0); // hide s2 at its end
tl.set("#s3", { autoAlpha: 1 }, 5.0); // show s3 at its start
tl.set("#s3", { autoAlpha: 0 }, 7.5); // hide s3 at its end
```

**Why `autoAlpha` and NOT `visibility`:** When any shader transition fires, HyperShader blanks ALL `.scene` elements to `opacity:0`. If a non-anchor scene only toggles `visibility`, the blanket reset poisons its `opacity` — the scene becomes `visibility:visible` but `opacity:0` (invisible). `autoAlpha` sets BOTH `opacity` AND `visibility` in one call, overriding the blanket reset.

**Rules:**

- Every non-anchor scene gets `tl.set("#sN", { autoAlpha: 1 }, <data-start>)` AND `tl.set("#sN", { autoAlpha: 0 }, <data-start + data-duration>)`
- Scene 1 gets only a hide at its end time (it starts visible)
- Anchor scenes do NOT get autoAlpha toggles — HyperShader owns their opacity
- When you add or remove scenes, update these toggles to match

Example for an 8-scene video with shaders at s4→s5 and s7→s8:

- Anchor scenes: s4, s5, s7, s8 (listed in HyperShader `scenes` array, use `opacity:0`)
- Non-anchor scenes: s1, s2, s3, s6 (NOT in HyperShader, use `visibility:hidden`, with explicit `tl.set` toggles)
- Scene 1 has no inline style (visible from t=0)

### Adding or removing shader transitions

To add a shader transition between two scenes:

1. Add both scene IDs to the `scenes` array in `HyperShader.init()`
2. Add a transition object to the `transitions` array
3. Change both scenes from `visibility:hidden` to `opacity:0`
4. Invariant: `scenes.length === transitions.length + 1`

To remove a shader transition (make it a hard cut instead):

1. Remove the scene IDs from `scenes` (unless they're also anchors for another transition)
2. Remove the transition from `transitions`
3. Change affected scenes from `opacity:0` to `visibility:hidden`

**BANNED: invisible bridge transitions.** Never pad with `flash-through-white` at 0.01s.

---

## Step 5: Verify the preview + deliver

**Gate:** Preview plays start to finish. All scenes visible. No blinking. Text readable.

### Verify in the preview pane

Scrub through every scene and check:

1. Does scene 1 appear immediately? (If black: runtime not loaded, or `__timelines` key mismatch)
2. Do shader transitions fire cleanly? (If blinking: transition too short, or exit animation before transition)
3. Is all text readable against its background?
4. Does every scene have motion during its hold? (If static: missing mid-scene activity)
5. Do animations play in the correct order?

### Troubleshooting: preview is black

| Symptom                       | Cause                                                 | Fix                                                                                                                                                                   |
| ----------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All black                     | Runtime script missing or wrong order                 | Check GSAP loads before runtime in `<head>`                                                                                                                           |
| All black                     | `__timelines` key doesn't match `data-composition-id` | Both must be `"main"`                                                                                                                                                 |
| All black                     | Token not forwarded in preview.html                   | Check `location.search` is appended to src                                                                                                                            |
| Scene doesn't appear          | Wrong `data-start` / `data-duration`                  | Check scene windows tile end-to-end                                                                                                                                   |
| Blink before transition       | Exit animation before shader fires                    | Remove exit tweens -- shader IS the exit                                                                                                                              |
| Blink before transition       | Transition duration < 0.3s                            | Increase to 0.5s                                                                                                                                                      |
| Seeking backwards shows blank | Async capture race condition                          | Known bug in HyperShader browser mode. Forward seek usually works. For reliable scrubbing, download and use `npx hyperframes preview` locally                         |
| Middle scene invisible        | First shader anchor not shown                         | Add `tl.set("#sN", { opacity: 1 }, startTime)` for first anchor in each shader group                                                                                  |
| Middle scene invisible        | Non-anchor uses `visibility` instead of `autoAlpha`   | Change to `tl.set("#sN", { autoAlpha: 1 }, start)` and `tl.set("#sN", { autoAlpha: 0 }, end)`. Shader blanket reset poisons opacity; `visibility` alone can't fix it. |

### Deliver

Provide: `index.html`, `preview.html`, `README.md`, and `DESIGN.md`.

The `preview.html` and `README.md` are already in the skeleton -- don't modify `preview.html`. Generate `DESIGN.md` from your `:root` custom properties as a reference document.

In your final message, tell the user:

1. **What you built** -- scene count, duration, visual identity summary, shader transitions used
2. **What to do next** -- download the ZIP, run `npx hyperframes preview` locally to see the full composition with reliable playback
3. **What to refine in Claude Code** -- be specific about which scenes need animation polish, where timing could be tighter, which mid-scene activities are basic and could be richer. Don't just say "refine in Claude Code" -- say "scene 4's counter animation could be smoother with a longer duration, and scene 6 would benefit from a breathing float on the logo."
4. **Caveats** -- placeholder assets, unverified stats, elements inspired by a real brand

---

## Section 6: Rules you cannot break

The skeleton handles most structural rules. These are the runtime rules the skeleton can't enforce:

### Determinism (non-negotiable)

| Never                             | Use instead                                    |
| --------------------------------- | ---------------------------------------------- |
| `Math.random()`                   | Seeded PRNG (only if you need randomness)      |
| `Date.now()`, `performance.now()` | Hard-coded timing or `tl.time()` in `onUpdate` |
| `setInterval`, `setTimeout`       | Timeline tweens + `onUpdate`                   |
| `repeat: -1`                      | `repeat: Math.ceil(duration / cycle) - 1`      |
| `stagger: { from: "random" }`     | `from: "start"`, `"center"`, `"end"`           |
| Async timeline construction       | Synchronous at page load                       |

### Media rules

| Never                           | Use instead                 |
| ------------------------------- | --------------------------- |
| `video.play()`, `audio.play()`  | Framework owns playback     |
| `<video>` without `muted`       | Always `muted playsinline`  |
| Audio on `<video>`              | Separate `<audio>` element  |
| Base64 media                    | File reference or HTTPS URL |
| Placeholder URLs (placehold.co) | Real assets                 |

### Animation rules

| Never                                  | Use instead                                   |
| -------------------------------------- | --------------------------------------------- |
| Exit tweens before shader transition   | Shader IS the exit -- content stays visible   |
| `tl.set` / `tl.to` on scene containers | HyperShader owns scene opacity                |
| `requestAnimationFrame`                | GSAP tweens                                   |
| Template literals in selectors         | Hardcoded strings                             |
| CSS `transform` for centering          | Flexbox centering on a wrapper                |
| SVG filter `data:image/svg+xml` grain  | CSS radial-gradient grain (see pattern below) |
| Animating `visibility` / `display`     | Use `autoAlpha`                               |

### Self-review checklist

Run before delivering. Check with actual code, not assumptions.

**Structural validity (must pass -- Claude Code can't fix these easily):**

- [ ] Every scene has `class="scene clip"` + all data attributes
- [ ] Every scene has a `<div class="scene-content">` wrapper
- [ ] Anchor scenes have `style="opacity:0;"`. Non-anchor scenes have `style="visibility:hidden;"`
- [ ] **Every non-anchor scene has `tl.set` with `autoAlpha`** (NOT `visibility`). `autoAlpha: 1` at start, `autoAlpha: 0` at end.
- [ ] **First anchor scene in each shader group has `tl.set("#sN", { opacity: 1 }, startTime)`**. Without this, it stays invisible.
- [ ] Scene windows tile end-to-end (no gaps)
- [ ] Shader transitions have boundary INSIDE the window: `time < boundary < time + duration`
- [ ] No transition shorter than 0.3s
- [ ] No exit tweens except on the final scene
- [ ] No `Date.now()`, unseeded `Math.random()`, `repeat: -1`
- [ ] No SVG filter data URLs as `background-image`
- [ ] `window.__timelines["main"] = tl` matches `data-composition-id`

**Brand + content accuracy (your core job -- get these right):**

- [ ] Colors match the brief / attachments exactly
- [ ] No banned fonts
- [ ] Minimum font sizes: 60px+ headlines, 20px+ body, 16px+ labels
- [ ] `font-variant-numeric: tabular-nums` on number columns
- [ ] Every scene has meaningful content (not placeholder text)
- [ ] Scene count and durations match the video type

**Animation baseline (good enough to start -- Claude Code will polish):**

- [ ] Every scene has at least one entrance tween (`tl.from`)
- [ ] Every scene > 4s has at least one mid-scene activity (float, counter, glow)
- [ ] No scene is completely static (no tweens at all)
- [ ] Scene text is readable in the time allowed

---

## Section 7: Skeletons

### preview.html (universal -- copy verbatim for all video types)

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

### README.md (universal -- swap `<project-name>`)

````markdown
# <project-name>

A HyperFrames video composition. Plain HTML + GSAP; rendered to MP4 by the `hyperframes` CLI.

## Requirements

- **Node.js 22+** -- [nodejs.org](https://nodejs.org/)
- **FFmpeg** -- `brew install ffmpeg` (macOS) or `sudo apt install ffmpeg` (Debian/Ubuntu) or [ffmpeg.org/download](https://ffmpeg.org/download.html) (Windows)

Verify: `npx hyperframes doctor`

## Preview

```bash
npx hyperframes preview
```

Opens the HyperFrames Studio at `http://localhost:3002` with frame-accurate scrubbing.

## Refine with Claude Code

This project was drafted in Claude Design. To polish animations, timing, and pacing:

```bash
npx skills add heygen-com/hyperframes   # install HyperFrames skills (one-time)
npx hyperframes lint                     # verify structure (should pass with zero errors)
npx hyperframes preview                  # open the studio for live feedback
```

Then open in Claude Code and iterate:

- "Make scene 3's entrance snappier"
- "Add a counter animation to the stat in scene 5"
- "Tighten the pacing -- scenes 4 and 6 feel too long"
- "Change the shader on transition 3 to glitch"

## Render

Run from the project directory (the folder containing `index.html`). The
positional argument is the project directory, not a file, so pass a specific
composition with `-c` rather than as a bare path.

```bash
npx hyperframes render -o output.mp4
```

1920x1080 / 30fps by default. Use `--fps 60` or `--resolution 3840x2160` to override.
````

### Skeleton A -- Social Reel (1080x1920, 15s, 6 scenes)

Transition plan: s1→s2 hard cut, s2→s3 hard cut, **s3→s4 SHADER** (hero reveal), s4→s5 hard cut, s5→s6 hard cut. One shader at the midpoint.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions/dist/index.global.js"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <!-- FILL: Google Fonts link for your chosen typefaces -->
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;500;700&family=JetBrains+Mono:wght@400&display=swap"
      rel="stylesheet"
    />
    <style>
      :root {
        /* === FILL: Your brand identity === */
        --bg: #0a0a0d;
        --ink: #f5f5f7;
        --accent: #7c6cff;
        --muted: #5a6270;
        --accent-dim: #3d3680;
        --font-display: "Space Grotesk", sans-serif;
        --font-data: "JetBrains Mono", monospace;
      }

      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html,
      body {
        width: 1080px;
        height: 1920px;
        overflow: hidden;
        background: var(--bg);
        color: var(--ink);
      }

      .scene {
        position: absolute;
        top: 0;
        left: 0;
        width: 1080px;
        height: 1920px;
        overflow: hidden;
      }
      .scene-content {
        width: 100%;
        height: 100%;
        padding: 120px 80px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 24px;
        box-sizing: border-box;
        position: relative;
        z-index: 1;
      }
      .clip {
      }

      .display {
        font-family: var(--font-display);
        font-weight: 700;
        line-height: 1.1;
      }
      .body-text {
        font-family: var(--font-display);
        font-weight: 300;
        line-height: 1.4;
        color: var(--muted);
      }
      .data-text {
        font-family: var(--font-data);
        font-weight: 400;
        font-variant-numeric: tabular-nums;
      }

      .grain {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 50;
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

      /* === FILL: Per-scene styles below === */
    </style>
  </head>
  <body>
    <div
      id="main"
      data-composition-id="main"
      data-width="1080"
      data-height="1920"
      data-start="0"
      data-duration="15"
    >
      <!-- SCENE 1 -- visible from t=0 -->
      <div class="scene clip" id="s1" data-start="0" data-duration="2.5" data-track-index="0">
        <div class="grain"></div>
        <div class="scene-content">
          <!-- FILL: Scene 1 — hook / opener -->
        </div>
      </div>

      <div
        class="scene clip"
        id="s2"
        data-start="2.5"
        data-duration="2.5"
        data-track-index="0"
        style="visibility:hidden;"
      >
        <div class="grain"></div>
        <div class="scene-content">
          <!-- FILL: Scene 2 — build / context -->
        </div>
      </div>

      <!-- SCENE 3 -- SHADER ANCHOR (opacity:0, HyperShader manages) -->
      <div
        class="scene clip"
        id="s3"
        data-start="5"
        data-duration="2.5"
        data-track-index="0"
        style="opacity:0;"
      >
        <div class="grain"></div>
        <div class="scene-content">
          <!-- FILL: Scene 3 — build-up before hero -->
        </div>
      </div>

      <!-- SCENE 4 -- SHADER ANCHOR (opacity:0, HyperShader manages) -->
      <div
        class="scene clip"
        id="s4"
        data-start="7.5"
        data-duration="2.5"
        data-track-index="0"
        style="opacity:0;"
      >
        <div class="grain"></div>
        <div class="scene-content">
          <!-- FILL: Scene 4 — hero / key stat (shader reveals this) -->
        </div>
      </div>

      <div
        class="scene clip"
        id="s5"
        data-start="10"
        data-duration="2.5"
        data-track-index="0"
        style="visibility:hidden;"
      >
        <div class="grain"></div>
        <div class="scene-content">
          <!-- FILL: Scene 5 — proof -->
        </div>
      </div>

      <div
        class="scene clip"
        id="s6"
        data-start="12.5"
        data-duration="2.5"
        data-track-index="0"
        style="visibility:hidden;"
      >
        <div class="grain"></div>
        <div class="scene-content">
          <!-- FILL: Scene 6 — CTA / close -->
        </div>
      </div>
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });

      // --- Non-anchor scene toggles (REQUIRED — use autoAlpha) ---
      tl.set("#s1", { autoAlpha: 0 }, 2.5);
      tl.set("#s2", { autoAlpha: 1 }, 2.5);
      tl.set("#s2", { autoAlpha: 0 }, 5.0);
      // s3, s4 are shader anchors — HyperShader manages their opacity
      tl.set("#s3", { opacity: 1 }, 5.0); // first anchor must be explicitly shown
      tl.set("#s5", { autoAlpha: 1 }, 10.0);
      tl.set("#s5", { autoAlpha: 0 }, 12.5);
      tl.set("#s6", { autoAlpha: 1 }, 12.5);

      // === SCENE 1 (0-2.5s) — hook ===
      // FILL: entrance + mid-scene activity (use 2+ patterns from Section 8)

      // === SCENE 2 (2.5-5s) ===
      // FILL: entrance + mid-scene activity

      // === SCENE 3 (5-7.5s) — SHADER ANCHOR, no exit tweens ===
      // FILL: entrance + mid-scene activity

      // === SCENE 4 (7.5-10s) — hero (shader reveals this) ===
      // FILL: entrance + mid-scene activity

      // === SCENE 5 (10-12.5s) — proof ===
      // FILL: entrance + mid-scene activity

      // === SCENE 6 (12.5-15s) — CTA, final scene, exit OK ===
      // FILL: entrance + mid-scene activity + optional exit

      // --- Shader: 1 transition at the hero reveal ---
      window.HyperShader.init({
        bgColor:
          getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0a0a0d",
        scenes: ["s3", "s4"],
        timeline: tl,
        transitions: [{ time: 7.25, shader: "cinematic-zoom", duration: 0.5 }],
      });

      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
```

### Skeleton B -- Launch Teaser (1920x1080, 25s, 8 scenes)

Transition plan: s1→s2 hard cut, s2→s3 hard cut, s3→s4 hard cut, **s4→s5 SHADER** (hero reveal), **s5→s7 SHADER** (energy shift, s6 plays as runtime-managed interstitial), **s7→s8 SHADER** (CTA landing). 3 shaders out of 7 cuts.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/@hyperframes/shader-transitions/dist/index.global.js"></script>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <!-- FILL: Google Fonts link -->
    <link
      href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;500;700&family=JetBrains+Mono:wght@400&display=swap"
      rel="stylesheet"
    />
    <style>
      :root {
        /* === FILL: Your brand identity === */
        --bg: #0a0a0d;
        --ink: #f5f5f7;
        --accent: #7c6cff;
        --muted: #5a6270;
        --accent-dim: #3d3680;
        --font-display: "Space Grotesk", sans-serif;
        --font-data: "JetBrains Mono", monospace;
      }

      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html,
      body {
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: var(--bg);
        color: var(--ink);
      }

      .scene {
        position: absolute;
        top: 0;
        left: 0;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
      }
      .scene-content {
        width: 100%;
        height: 100%;
        padding: 100px 160px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 24px;
        box-sizing: border-box;
        position: relative;
        z-index: 1;
      }
      .clip {
      }

      .display {
        font-family: var(--font-display);
        font-weight: 700;
        line-height: 1.1;
      }
      .body-text {
        font-family: var(--font-display);
        font-weight: 300;
        line-height: 1.4;
        color: var(--muted);
      }
      .data-text {
        font-family: var(--font-data);
        font-weight: 400;
        font-variant-numeric: tabular-nums;
      }

      .grain {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 50;
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

      .vignette {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 49;
        background: radial-gradient(ellipse at center, transparent 50%, rgba(0, 0, 0, 0.4) 100%);
      }

      /* === FILL: Per-scene styles below === */
    </style>
  </head>
  <body>
    <div
      id="main"
      data-composition-id="main"
      data-width="1920"
      data-height="1080"
      data-start="0"
      data-duration="25"
    >
      <!-- SCENE 1 -- visible from t=0 -->
      <div class="scene clip" id="s1" data-start="0" data-duration="3" data-track-index="0">
        <div class="grain"></div>
        <div class="vignette"></div>
        <div class="scene-content"><!-- FILL: hook --></div>
      </div>

      <!-- s2-s3: hard cuts, runtime-managed -->
      <div
        class="scene clip"
        id="s2"
        data-start="3"
        data-duration="3"
        data-track-index="0"
        style="visibility:hidden;"
      >
        <div class="grain"></div>
        <div class="vignette"></div>
        <div class="scene-content"><!-- FILL: context --></div>
      </div>

      <div
        class="scene clip"
        id="s3"
        data-start="6"
        data-duration="3"
        data-track-index="0"
        style="visibility:hidden;"
      >
        <div class="grain"></div>
        <div class="vignette"></div>
        <div class="scene-content"><!-- FILL: build --></div>
      </div>

      <!-- s4-s5: SHADER ANCHOR pair (hero reveal) -->
      <div
        class="scene clip"
        id="s4"
        data-start="9"
        data-duration="3.5"
        data-track-index="0"
        style="opacity:0;"
      >
        <div class="grain"></div>
        <div class="vignette"></div>
        <div class="scene-content"><!-- FILL: build-up before hero --></div>
      </div>

      <div
        class="scene clip"
        id="s5"
        data-start="12.5"
        data-duration="3"
        data-track-index="0"
        style="opacity:0;"
      >
        <div class="grain"></div>
        <div class="vignette"></div>
        <div class="scene-content"><!-- FILL: hero / key feature --></div>
      </div>

      <!-- s6: hard cut, runtime-managed -->
      <div
        class="scene clip"
        id="s6"
        data-start="15.5"
        data-duration="3"
        data-track-index="0"
        style="visibility:hidden;"
      >
        <div class="grain"></div>
        <div class="vignette"></div>
        <div class="scene-content"><!-- FILL: proof / social proof --></div>
      </div>

      <!-- s7-s8: SHADER ANCHOR pair (CTA landing) -->
      <div
        class="scene clip"
        id="s7"
        data-start="18.5"
        data-duration="3"
        data-track-index="0"
        style="opacity:0;"
      >
        <div class="grain"></div>
        <div class="vignette"></div>
        <div class="scene-content"><!-- FILL: build to close --></div>
      </div>

      <div
        class="scene clip"
        id="s8"
        data-start="21.5"
        data-duration="3.5"
        data-track-index="0"
        style="opacity:0;"
      >
        <div class="grain"></div>
        <div class="vignette"></div>
        <div class="scene-content"><!-- FILL: CTA / close --></div>
      </div>
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });

      // --- Non-anchor scene visibility toggles (REQUIRED) ---
      tl.set("#s1", { autoAlpha: 0 }, 3.0);
      tl.set("#s2", { autoAlpha: 1 }, 3.0);
      tl.set("#s2", { autoAlpha: 0 }, 6.0);
      tl.set("#s3", { autoAlpha: 1 }, 6.0);
      tl.set("#s3", { autoAlpha: 0 }, 9.0);

      // --- First shader anchor must be explicitly shown ---
      tl.set("#s4", { opacity: 1 }, 9.0);

      // s4, s5 are shader anchors — HyperShader manages their opacity after transitions
      tl.set("#s6", { autoAlpha: 1 }, 15.5);
      tl.set("#s6", { autoAlpha: 0 }, 18.5);

      // --- Second shader group's first anchor must also be shown ---
      tl.set("#s7", { opacity: 1 }, 18.5);
      // s7, s8 are shader anchors — HyperShader manages their opacity after transitions

      // === SCENE 1 (0-3s) — hook ===

      // === SCENE 2 (3-6s) — hard cut ===

      // === SCENE 3 (6-9s) — hard cut ===

      // === SCENE 4 (9-12.5s) — SHADER ANCHOR, no exit tweens ===

      // === SCENE 5 (12.5-15.5s) — shader from s4, hero reveal ===

      // === SCENE 6 (15.5-18.5s) — hard cut ===

      // === SCENE 7 (18.5-21.5s) — SHADER ANCHOR, no exit tweens ===

      // === SCENE 8 (21.5-25s) — shader from s7, CTA. Final, exit OK ===

      // --- Shader transitions: 2 key moments ---
      // s4->s5 (hero reveal) and s7->s8 (CTA landing)
      // HyperShader requires consecutive anchors, so we use two groups:
      // Group 1: [s4, s5] with 1 transition
      // Group 2: [s7, s8] with 1 transition
      // But HyperShader only supports one init() call, so we chain them:
      // [s4, s5] — shader — then runtime hard-cuts s5->s6->s7 — then [s7, s8]
      // To satisfy the invariant with one init(), we include s5->s7 gap scenes.
      // Simplest: just use one contiguous anchor block [s4, s5, s7, s8] with
      // the s5->s7 transition as a real (visible) shader too. This gives you
      // 3 shaders total — still well under the "every cut" anti-pattern.
      window.HyperShader.init({
        bgColor:
          getComputedStyle(document.documentElement).getPropertyValue("--bg").trim() || "#0a0a0d",
        scenes: ["s4", "s5", "s7", "s8"],
        timeline: tl,
        transitions: [
          { time: 12.25, shader: "cinematic-zoom", duration: 0.5 },
          { time: 15.25, shader: "light-leak", duration: 0.5 },
          { time: 21.25, shader: "cross-warp-morph", duration: 0.5 },
        ],
      });

      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
```

### Skeleton C -- Product Explainer (1920x1080, 45s, 12 scenes)

Use the same structure as Skeleton B but with 12 scene divs (s1-s12), data-duration totaling 45s, and 11 transitions. Adjust scene durations: mix 3s, 3.5s, 4s, and 5s scenes based on content density. Include a scene rhythm like: `3-3-4-3.5-4-5-3.5-4-3.5-4-4-3.5`.

### Skeleton D -- Cinematic Title (1920x1080, 60s, 7 scenes)

Use the same structure with 7 scene divs (s1-s7), longer durations (6-10s each), fewer transitions (6), and more restrained shaders (`cross-warp-morph`, `thermal-distortion`). Scene rhythm: `8-7-8-10-9-10-8`.

---

## Section 8: Common animation patterns

Copy-paste these. They appear in every production composition.

### Counter animation

```js
var counterObj = { v: 0 };
tl.to(
  counterObj,
  {
    v: 1900000000000,
    duration: 2.0,
    ease: "power2.out",
    onUpdate: function () {
      document.getElementById("s3-stat").textContent = "$" + (counterObj.v / 1e12).toFixed(1) + "T";
    },
  },
  10.5,
);
```

### SVG stroke draw

```html
<svg viewBox="0 0 400 200" style="position:absolute; bottom:100px; left:160px;">
  <path
    id="s2-line"
    d="M 0 100 Q 200 20 400 100"
    stroke="var(--accent)"
    stroke-width="3"
    fill="none"
    stroke-linecap="round"
    stroke-dasharray="440"
    stroke-dashoffset="440"
  />
</svg>
```

```js
tl.to("#s2-line", { strokeDashoffset: 0, duration: 1.0, ease: "power2.out" }, 3.5);
```

### Character stagger

```html
<h1 class="display" style="font-size:120px;">
  <span class="char">N</span><span class="char">O</span><span class="char">R</span>
  <span class="char">T</span><span class="char">H</span>
</h1>
```

```js
tl.from(
  ".char",
  {
    y: 60,
    autoAlpha: 0,
    duration: 0.5,
    ease: "power3.out",
    stagger: { each: 0.12, from: "start" },
  },
  29.5,
);
```

### Breathing float (mid-scene activity)

```js
tl.to(
  "#s4-logo",
  {
    y: -5,
    duration: 1.5,
    ease: "sine.inOut",
    yoyo: true,
    repeat: 1,
  },
  15.0,
);
```

### Bar chart fill

```js
["#bar1", "#bar2", "#bar3", "#bar4"].forEach(function (sel, i) {
  tl.from(
    sel,
    {
      scaleY: 0,
      transformOrigin: "bottom",
      duration: 0.6,
      ease: "expo.out",
    },
    11.0 + i * 0.15,
  );
});
```

### Orbit / rotation

```js
tl.to(
  "#orbit-dot",
  {
    rotation: 360,
    duration: 3.0,
    ease: "none",
    transformOrigin: "50% 200px",
  },
  8.5,
);
```

### Highlight sweep (background-size animation)

```css
#s5-headline {
  background: linear-gradient(var(--accent), var(--accent)) no-repeat 0 85% / 0% 30%;
}
```

```js
tl.to("#s5-headline", { backgroundSize: "100% 30%", duration: 0.6, ease: "power2.out" }, 22.0);
```

### CSS radial-gradient grain (safe for Safari + Claude Design iframe)

```css
.grain {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 50;
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

**NEVER use SVG filter `data:image/svg+xml` grain** -- it taints html2canvas in Safari, breaking every shader transition in Claude Design's cross-origin iframe.

---

## References (fetch only when needed)

Everything critical is inlined above. These are for edge cases:

- Core composition contract (data attributes, sub-comp wiring): https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/SKILL.md
- Motion theory (easing as emotion, direction rules): https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/motion-principles.md
- Typography (full banned list, weight contrast, OpenType): https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/typography.md
- Transitions (shader catalog, CSS transition patterns): https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/transitions.md
- Captions synced to audio: https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/references/captions.md
- Full docs: https://hyperframes.heygen.com/
