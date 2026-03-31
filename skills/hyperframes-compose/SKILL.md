---
name: hyperframes-compose
description: Create HyperFrames HTML video compositions. Use when asked to create a video, build an animation, make a composition, add a title card, or generate any HTML-based video content for HyperFrames.
---

# Compose Video

HTML is the source of truth for video. A composition is an HTML file with `data-*` attributes for timing, a GSAP timeline for animation, and CSS for appearance. The framework handles clip visibility, media playback, and timeline sync.

## Approach

Before writing HTML, think at a high level:

1. **What** — what should the viewer experience? Identify the narrative arc, key moments, and emotional beats.
2. **Structure** — how many compositions, which are sub-compositions vs inline, what tracks carry what (video, audio, overlays, captions).
3. **Timing** — which clips drive the duration, where do transitions land, what's the pacing.
4. **Execute** — then implement using the rules below.

For small edits (fix a color, adjust timing, add one element), skip straight to the rules.

When no `visual-style.md` or animation direction is provided, follow [house-style.md](./house-style.md) for motion defaults, sizing, and color palettes.

## Data Attributes

### All Clips

| Attribute          | Required                          | Values                                                 |
| ------------------ | --------------------------------- | ------------------------------------------------------ |
| `id`               | Yes                               | Unique identifier                                      |
| `data-start`       | Yes                               | Seconds or clip ID reference (`"el-1"`, `"intro + 2"`) |
| `data-duration`    | Required for img/div/compositions | Seconds. Video/audio defaults to media duration.       |
| `data-track-index` | Yes                               | Integer. Same-track clips **cannot overlap**.          |
| `data-media-start` | No                                | Trim offset into source (seconds)                      |
| `data-volume`      | No                                | 0-1 (default 1)                                        |

`data-track-index` does **not** affect visual layering — use CSS `z-index`.

### Composition Clips

| Attribute                    | Required | Values                                       |
| ---------------------------- | -------- | -------------------------------------------- |
| `data-composition-id`        | Yes      | Unique composition ID                        |
| `data-duration`              | Yes      | Takes precedence over GSAP timeline duration |
| `data-width` / `data-height` | Yes      | Pixel dimensions (1920x1080 or 1080x1920)    |
| `data-composition-src`       | No       | Path to external HTML file                   |

## Composition Structure

Every composition is a `<template>` wrapping a `<div>` with `data-composition-id`. Each must include its own GSAP script and register its timeline:

```html
<template id="my-comp-template">
  <div data-composition-id="my-comp" data-width="1920" data-height="1080">
    <!-- content -->
    <style>
      [data-composition-id="my-comp"] {
        /* scoped styles */
      }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      // tweens...
      window.__timelines["my-comp"] = tl;
    </script>
  </div>
</template>
```

Load in root: `<div id="el-1" data-composition-id="my-comp" data-composition-src="compositions/my-comp.html" data-start="0" data-duration="10" data-track-index="1"></div>`

## Video and Audio

Video must be `muted playsinline`. Audio is always a separate `<audio>` element:

```html
<video
  id="el-v"
  data-start="0"
  data-duration="30"
  data-track-index="0"
  src="video.mp4"
  muted
  playsinline
></video>
<audio
  id="el-a"
  data-start="0"
  data-duration="30"
  data-track-index="2"
  src="video.mp4"
  data-volume="1"
></audio>
```

## Timeline Contract

- All timelines start `{ paused: true }` — the player controls playback
- Register every timeline: `window.__timelines["<composition-id>"] = tl`
- Framework auto-nests sub-timelines — do NOT manually add them
- Duration comes from `data-duration`, not from GSAP timeline length
- Never create empty tweens to set duration

## Rules (Non-Negotiable)

**Deterministic:** No `Math.random()`, `Date.now()`, or time-based logic. The renderer must produce identical output every time.

**GSAP:** Only animate visual properties (`opacity`, `x`, `y`, `scale`, `rotation`, `color`, `backgroundColor`, `borderRadius`, transforms). Do NOT animate `visibility`, `display`, or call `video.play()`/`audio.play()`.

**Animation conflicts:** Never animate the same property on the same element from multiple timelines simultaneously — causes flickering in headless renders.

**Never do:**

1. Forget `window.__timelines` registration
2. Use video for audio — always muted video + separate `<audio>`
3. Nest video inside a timed div — use a non-timed wrapper
4. Use `data-layer` (use `data-track-index`) or `data-end` (use `data-duration`)
5. Animate video element dimensions — animate a wrapper div
6. Call play/pause/seek on media — framework owns playback
7. Create a top-level container without `data-composition-id`

## Editing Existing Compositions

- Read the full composition first — match existing fonts, colors, animation patterns
- Only change what was requested — don't rewrite untouched sections
- Don't rewrite entire files for small changes
- Preserve timing of unrelated clips

## Typography and Assets

- Every composition loads its own fonts (`@import` or `@font-face` in `<style>`)
- Use `font-display: block` for local fonts — renderer needs fonts loaded before capturing
- Add `crossorigin="anonymous"` to media loaded from external URLs
- Minimum readable text: 20px landscape, 18px portrait
- For dynamic text that may overflow its container, use `window.__hyperframes.fitTextFontSize(text, { maxWidth, fontFamily, fontWeight })` to compute the largest font size that fits on one line. Returns `{ fontSize, fits }`. Options: `baseFontSize` (default 78), `minFontSize` (default 42), `step` (default 2). `fontFamily` and `fontWeight` must match the CSS applied to the element.
- All files (video, audio, fonts, images) live at the project root alongside `index.html`
- From sub-compositions, use `../` to reference root files

For PiP, title cards, and slide show patterns, see [patterns.md](./patterns.md).
For data, stats, and infographics, see [data-in-motion.md](./data-in-motion.md).
For typewriter text and other GSAP animation effects, see the `gsap-effects` skill.

## Output Checklist

- [ ] Every top-level container has `data-composition-id`
- [ ] Every composition has `data-width`, `data-height`, `data-duration`
- [ ] Compositions in own HTML files, loaded via `data-composition-src`
- [ ] `<template>` wrapper on sub-compositions
- [ ] `window.__timelines` registered for every composition
- [ ] 100% deterministic — no randomness
- [ ] Each composition includes GSAP: `<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>`
