---
name: hyperframes-handoff
description: |
  Produce a HyperFrames-valid HTML composition — paused GSAP timeline, data
  attributes, scene structure — that any AI coding agent can immediately
  refine with `npx hyperframes lint` and `npx hyperframes preview`. Use when
  the brief mentions "video", "reel", "motion graphic", "title card",
  "animated explainer", or pairs Open Design with HyperFrames for export.
triggers:
  - "hyperframes"
  - "video"
  - "reel"
  - "motion graphic"
  - "animated explainer"
  - "title card"
  - "kinetic typography"
  - "动效视频"
  - "视频海报"
od:
  mode: prototype
  platform: desktop
  scenario: marketing
  preview:
    type: html
    entry: index.html
  design_system:
    requires: true
    sections: [color, typography, layout, motion]
  example_prompt: "Design a 15-second Instagram reel announcing dark mode for Taskflow (#6C5CE7). Output as a HyperFrames composition I can render locally."
---

# HyperFrames Handoff — for Open Design

> **Drop this file at `skills/hyperframes-handoff/SKILL.md` inside your local
> [Open Design](https://github.com/nexu-io/open-design) checkout, restart the
> daemon, and the skill appears in the picker. Or attach it to a fresh chat
> as a one-shot.**

This skill teaches Open Design to emit a **valid first draft** of a
[HyperFrames](https://github.com/heygen-com/hyperframes) composition — plain
HTML + CSS + a paused GSAP timeline. The CLI (`npx hyperframes render
index.html`) turns the HTML into an MP4. You author the HTML; the user runs
the render locally.

**HyperFrames replaces the default video-artifact workflow.** Do NOT emit a
React/Babel composition, do NOT call other prototype skills, do NOT use the
sandboxed iframe's wall-clock playback for timing decisions. Plain HTML +
GSAP only. Treat the [`claude-design-hyperframes.md`](https://github.com/heygen-com/hyperframes/blob/main/docs/guides/claude-design-hyperframes.md)
companion document as the **upstream spec for HyperFrames structural rules** —
the rules below condense it to what Open Design needs at emission time, but
that file is the source of truth for shader catalogs, skeleton variants, and
edge cases.

---

## Your role

**You produce a valid first draft — not a final render.** Open Design's
strengths are visual identity (driven by the active `DESIGN.md`), layout, and
brand-accurate content decisions. The user (or their coding agent) handles
animation polish, timing micro-adjustments, and production QA after handoff.

The user's workflow:

1. **Open Design** (you) — pick palette + typography from the active
   `DESIGN.md`, fill scene content, lay down first-pass GSAP entrances and
   mid-scene activity, pick shader transitions for 2–3 key moments
2. **Save to disk** — Open Design writes the project into
   `.od/projects/<id>/` (real `cwd`, agent-ready)
3. **Any AI coding agent** (Claude Code, Codex, Cursor, …) — `npx hyperframes
   lint`, `npx hyperframes preview`, then iterate timing, eases, shader
   choices, pacing

Your output must be a **valid starting point a coding agent can open and
refine immediately** — no structural fixes needed.

### What you optimize for

- The active `DESIGN.md` palette + typography bound onto `:root` (never
  freestyle a palette when one is active)
- Strong visual layout per scene (hierarchy, spacing, readability at video
  size — 60px+ headlines, 20px+ body)
- Scene content that tells the story (headlines, stats, copy, imagery)
- Structural validity (passes `npx hyperframes lint` with zero errors)
- Appropriate shader choices for the mood (use the catalog at
  [hyperframes.heygen.com/catalog](https://hyperframes.heygen.com/catalog))
- Reasonable scene count and durations for the video type

### What the coding agent polishes after you

You ship every scene with entrance tweens, breathing motion, and shader
transitions. The video plays with full motion from your first draft. The
agent does the **edit-bay refinement**: ease curve tweaks, stagger timing,
scene-duration micro-adjustments, richer mid-scene activity, shader swaps,
production QA.

---

## Hard rules (must-pass before emitting `<artifact>`)

These are HyperFrames-structural and non-negotiable. Open Design's
five-dimensional self-critique gate must verify all of them before emission.

1. **Single HTML file.** `<!doctype html>` through `</html>`, all CSS inline,
   GSAP loaded from CDN. No build step.
2. **Root composition element.** A single `<div id="stage">` with:
   - `data-composition-id="<kebab-name>"`
   - `data-start="0"`
   - `data-width` / `data-height` (e.g. `1080` × `1920` for 9:16, `1920` ×
     `1080` for 16:9, `1080` × `1080` for square)
   - `data-duration="<total-seconds>"` matching the sum of scene durations
3. **Scenes are children of `#stage`.** Each scene is `<div class="scene
   clip">` with:
   - `data-start="<seconds-from-zero>"`
   - `data-duration="<scene-seconds>"`
   - `data-track-index="0"` (HyperFrames uses tracks for layering; visual
     scenes share track 0 unless you intentionally overlap)
   - A `.scene-content` wrapper inside it that holds the readable content
     (headlines, stats, imagery). Decoratives (glows, grain, vignette) live
     directly inside `.scene` but **outside** `.scene-content`.
4. **GSAP timeline registered paused.** A single timeline created with
   `gsap.timeline({ paused: true })` and registered on
   `window.__timelines = window.__timelines || {}; window.__timelines["<comp-id>"] = tl;`.
   This is what makes the composition deterministically seekable — the
   HyperFrames engine drives the playhead.
5. **`tl.from()` for entrances.** Animate FROM offscreen/invisible TO the
   resting CSS position. Offset the first tween 0.1–0.3s into each scene to
   avoid jump-cuts.
6. **Mid-scene activity on every scene.** Every visible element keeps moving
   after its entrance. A still element on a still background is a JPEG with
   a progress bar. Use at least 2 patterns per scene from the table below.
7. **Shader transitions ONLY at scene boundaries**, and at most 2–3 in the
   whole video. Use HyperFrames' built-in shader blocks
   (`flash-through-white`, `whip-pan`, `cinematic-zoom`, `glitch`,
   `ripple-waves`, `light-leak`, `cross-warp-morph`, `chromatic-radial-split`,
   `swirl-vortex`, `gravitational-lens`, `domain-warp-dissolve`, `ridged-burn`,
   `sdf-iris`, `thermal-distortion`). Hard cuts everywhere else.
8. **No external assets the user didn't provide.** Use solid colors, CSS
   gradients, inline SVG, `data:` images. Reference the user's uploaded
   images by their saved filenames; don't invent stock URLs.
9. **`preview.html` token forwarding** — emit a sibling `preview.html` that
   loads `index.html` in an iframe and forwards URL hash tokens (`?frame=…`
   for scrubbing). Skeleton is in §6.

---

## Step 1 — Understand the brief

**Gate:** You can name the subject, duration, aspect ratio, and at least one
source of visual direction.

Open Design's `RULE 1` already covers this — turn 1 is a `<question-form>`
when the brief is sparse. **Do not skip it for video briefs**; pacing
decisions hinge on locking duration and aspect ratio early.

Inputs in order of reliability:

1. **Active `DESIGN.md`** (strongest) — Open Design always has one bound when
   this skill runs. Read its palette, typography, and motion sections; bind
   verbatim onto `:root`.
2. **Attachments** — screenshots, PDFs, brand guides; mine for any signal the
   active DS doesn't already cover.
3. **Pasted content** — hex codes, copy, scripts, exact durations.
4. **Web research** (`WebFetch` + grep for hex) — only if the user names a
   brand and the active DS isn't theirs.

---

## Step 2 — Pick a skeleton, fill identity

**Gate:** A working `index.html` exists with the active DS's palette and
typography on `:root`. The preview renders even if scenes are empty.

| Type                      | Aspect | Duration  | Scenes |
| ------------------------- | ------ | --------- | ------ |
| Social reel               | 9:16   | 10–15s    | 5–7    |
| Launch teaser             | 16:9   | 15–25s    | 7–10   |
| Product explainer         | 16:9   | 30–60s    | 10–18  |
| Cinematic title           | 16:9   | 45–90s    | 7–12   |

Bind `:root` from the active `DESIGN.md`:

```css
:root {
  /* From active DESIGN.md — never invented */
  --bg: var(--ds-canvas);
  --ink: var(--ds-foreground);
  --accent: var(--ds-accent);
  --muted: var(--ds-muted);
  --font-display: var(--ds-display);
  --font-body: var(--ds-body);
}
```

If the active DS uses different token names, alias them — but **always
source the values from the DS file**, never hard-code a hex from memory.

---

## Step 3 — Fill scenes (content + animation)

**Gate:** Every scene has visible content, at least 2 animation patterns from
the table, and mid-scene activity. No scene is a static slide.

### 3a. Content goes inside `.scene-content`

```html
<div class="scene clip" data-start="10.0" data-duration="3.0" data-track-index="0">
  <div class="scene-content">
    <h1 id="s3-title" class="display">$1.9 Trillion</h1>
    <p id="s3-sub" class="body-text">processed annually</p>
    <div id="s3-bar-chart"><!-- ... --></div>
  </div>
  <div class="glow" aria-hidden="true"></div>
</div>
```

### 3b. Entrance tweens (offset 0.1–0.3s into each scene)

```js
// === SCENE 3 (data-start=10.0) ===
tl.from("#s3-title", { y: 40, autoAlpha: 0, duration: 0.6, ease: "power3.out" }, 10.3);
tl.from("#s3-sub",   { y: 20, autoAlpha: 0, duration: 0.5, ease: "power2.out" }, 10.7);
tl.from("#s3-bar-chart", { scaleY: 0, transformOrigin: "bottom", duration: 0.8, ease: "expo.out" }, 11.0);
```

### 3c. Mid-scene activity (this is what separates video from slides)

| Element            | Mid-scene motion                         | Pattern                                                                 |
| ------------------ | ---------------------------------------- | ----------------------------------------------------------------------- |
| Stat / number      | Counter from 0 → target                  | `tl.to({n:0}, { n: target, duration, onUpdate: …, ease: "power2.out" })` |
| SVG line / path    | Draws itself in real time                | `strokeDashoffset` from `pathLength → 0`                                 |
| Title / wordmark   | Characters enter one by one              | `tl.from(chars, { autoAlpha: 0, y: 8, stagger: 0.04 })`                  |
| Logo / lockup      | Subtle vertical drift                    | `tl.to(el, { y: -6, duration: sceneLength, ease: "sine.inOut" })`        |
| Chart / bars       | Bars fill sequentially                   | `tl.from(bars, { scaleY: 0, transformOrigin: "bottom", stagger: 0.08 })` |
| Image / screenshot | Slow zoom: `scale: 1 → 1.03`             | Ken Burns — `tl.to(img, { scale: 1.03, duration: sceneLength, ease: "none" })` |
| Background glow    | Opacity pulse                            | `tl.to(".glow", { opacity: 0.6, duration: 1.5, ease: "sine.inOut", yoyo: true, repeat: 1 })` |

**Minimum per scene:** entrance tweens + at least one continuous motion
(float, counter, zoom, or glow).

### 3d. Adjust scene duration by reading time

| Display text                | Min duration |
| --------------------------- | ------------ |
| No text (hero, icon)        | 1.5–2s       |
| 1–3 words                   | 2–3s         |
| 4–10 words                  | 3–4s         |
| 11–20 words                 | 4–6s         |
| 21–35 words                 | 6–8s         |
| 35+ words                   | Split scenes |

**Hard ceiling: 5s per scene** unless you name a specific reason (hero hold,
cinematic push, long counter animation).

When you change a scene's duration, update `data-start` on every subsequent
scene to keep them tiled end-to-end, and update `#stage`'s `data-duration` to
match the total.

### 3e. Vary eases

Use at least 3 different eases across the timeline. Don't default to
`power2.out` on everything. Good defaults: `power3.out` (heavy entrances),
`expo.out` (snappy stat reveals), `sine.inOut` (breathing loops),
`elastic.out(1, 0.5)` (playful overshoot — sparingly).

---

## Step 4 — Shader transitions (2–3 max)

Use HyperFrames' built-in shader blocks at scene boundaries. Pick by mood:

| Shader                     | Mood                                  |
| -------------------------- | ------------------------------------- |
| `flash-through-white`      | Energetic, optimistic, pop            |
| `whip-pan`                 | High-energy, sports/news cut          |
| `cinematic-zoom`           | Reveal, magnification, "let me show you" |
| `glitch`                   | Tech, edgy, glitch-pop                |
| `ripple-waves`             | Soft, organic, lifestyle              |
| `light-leak`               | Warm, nostalgic, film-like            |
| `cross-warp-morph`         | Smooth scene-to-scene continuity      |
| `chromatic-radial-split`   | Retro tech, VHS aesthetic             |
| `swirl-vortex`             | Disorienting, dream sequence          |

Hard cuts everywhere else. A good rule: shader at the beginning, shader at
the climax, shader at the end. Anything more is over-decorated.

---

## Step 5 — Self-critique (Open Design's 5-dim gate)

Before emitting `<artifact>`, score yourself 1–5 across:

- **Philosophy** — Is the visual stance coherent with the brief and the
  active DS, or is it generic?
- **Hierarchy** — Does each scene have a single dominant element? Is
  reading order obvious?
- **Detail** — Do shader/eases/durations match the mood, or are they
  defaulted?
- **Function** — Does the timeline play smoothly when the engine seeks?
  Are all scene `data-start`s tiled? Does total `data-duration` match?
- **Innovation** — Is there at least one moment that wouldn't appear in a
  generic AI render?

Anything under 3/5 is a regression — fix and rescore. Two passes is normal.

---

## Step 6 — Output contract

Emit exactly two files inside `<artifact>`:

### `index.html` — the composition

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title><!-- from brief --></title>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
  <style>
    :root { /* bound from active DESIGN.md */ }
    html, body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--font-body); }
    #stage { position: relative; width: 100vw; aspect-ratio: 16/9; overflow: hidden; }
    .scene { position: absolute; inset: 0; opacity: 0; }
    .scene.clip { /* HyperFrames toggles visibility per playhead */ }
    .scene-content { position: absolute; inset: 0; display: grid; place-items: center; padding: 6vmin; }
    /* + per-scene overrides */
  </style>
</head>
<body>
  <div id="stage" data-composition-id="my-video" data-start="0" data-width="1920" data-height="1080" data-duration="20">
    <div class="scene clip" data-start="0"   data-duration="3" data-track-index="0">
      <div class="scene-content"><!-- scene 1 content --></div>
    </div>
    <div class="scene clip" data-start="3"   data-duration="4" data-track-index="0">
      <div class="scene-content"><!-- scene 2 content --></div>
    </div>
    <!-- ... -->
  </div>

  <script>
    const tl = gsap.timeline({ paused: true });
    // === SCENE 1 ===
    tl.from(".scene[data-start='0'] .scene-content > *", { y: 30, autoAlpha: 0, duration: 0.6, ease: "power3.out", stagger: 0.08 }, 0.2);
    // === SCENE 2 ===
    tl.from(".scene[data-start='3'] .scene-content > *", { y: 30, autoAlpha: 0, duration: 0.6, ease: "power3.out", stagger: 0.08 }, 3.2);
    // ...
    window.__timelines = window.__timelines || {};
    window.__timelines["my-video"] = tl;
  </script>
</body>
</html>
```

### `preview.html` — the local-preview shim

```html
<!doctype html>
<html><head><title>Preview</title>
<style>html,body{margin:0;background:#111;color:#eee;font:14px ui-sans-serif} iframe{border:0;width:100vw;height:100vh}</style>
</head><body>
<iframe id="f" src="index.html"></iframe>
<script>
  const f = document.getElementById('f');
  // Forward HyperFrames preview tokens (frame=, paused=, …) into the iframe
  const u = new URL('index.html', location.href);
  for (const [k,v] of new URL(location.href).searchParams) u.searchParams.set(k, v);
  f.src = u.toString();
</script>
</body></html>
```

Save both files into the project's `cwd` (Open Design has already set this
to `.od/projects/<id>/`). The agent can immediately run:

```bash
npx hyperframes lint        # should pass with zero errors
npx hyperframes preview     # opens the studio
npx hyperframes render      # writes MP4
```

---

## Anti-AI-slop blacklist (HyperFrames-specific)

- **No purple gradients on dark backgrounds** unless the brief explicitly
  names that aesthetic.
- **No generic emoji icons** — use inline SVG or DS-provided iconography.
- **No "10× faster" / "AI-powered" filler copy** — write the user's actual
  words or use honest placeholders (`—` or labelled grey blocks).
- **No invented brand colors** — read from the active DS or the user's
  attachment, never from memory.
- **No identical card grids** for every scene — at least 3 distinct layout
  postures across the video.
- **No wall-clock JS animations** — `setTimeout`, `setInterval`,
  `requestAnimationFrame`-driven animation breaks deterministic seeking. GSAP
  timeline only. (Library-clock animations like Anime.js, Motion One, and
  Lottie are supported via [HyperFrames' Frame Adapter](https://hyperframes.heygen.com/concepts/frame-adapters)
  pattern, but stick to GSAP for first-draft handoffs unless the brief
  requires another runtime.)

---

## When to defer to the Claude Design instructions

For these advanced areas, treat
[`claude-design-hyperframes.md`](https://github.com/heygen-com/hyperframes/blob/main/docs/guides/claude-design-hyperframes.md)
as the canonical reference and follow its patterns verbatim:

- The full skeleton catalog (Skeletons A–D)
- Complete shader-block insertion patterns
- HDR / wide-gamut color handling
- Audio-reactive animation (`hf-seek` + `window.__hfAudio`)
- Captions / TTS integration
- The `hyperframes add` registry (50+ blocks and components)

This skill stays focused on what Open Design needs at emission time — the
structural rules, the active-`DESIGN.md` binding, and the 5-dim self-critique
that's specific to OD's prompt stack.
