# HyperFrames Schema

Reference for generating and editing HyperFrames HTML compositions. This is your source of truth for how to author compositions.

**New to HyperFrames?** Start with the [quickstart template](./quickstart-template.html) — a copy-paste composition with inline comments explaining every required piece. See [common mistakes](./common-mistakes.md) for pitfalls that break compositions.

For Frame adapters and deterministic frame rendering direction, see [`../../FRAME.md`](../../FRAME.md) and [`../adapters/README.md`](../adapters/README.md).

Producer-canonical parity note:

- Producer render behavior is the source of truth for deterministic parity.
- Preview should emulate producer seek semantics (`renderSeek`, frame quantization, readiness gates) in parity mode.
- Non-parity smooth playback can exist, but parity mode is the correctness baseline.

## Overview

HyperFrames uses HTML as the source of truth for describing a video:

- **HTML clips** = video, image, audio, composition
- **Data attributes** = timing, metadata, styling
- **CSS** = positioning and appearance
- **GSAP timeline** = animations and playback sync

### Framework-Managed Behavior

The framework reads data attributes and automatically manages:

- **Primitive clip timeline entries** — the framework reads `data-start`, `data-duration`, and `data-track-index` from primitive clips and adds them to the composition's GSAP timeline. You do not manually add primitive clips to the timeline in scripts.
- **Media playback** (play, pause, seek) for `<video>` and `<audio>`
- **Clip lifecycle** — clips are **mounted** (made visible on screen) and **unmounted** (removed from screen) based on `data-start` and `data-duration`
- **Timeline synchronization** (keeping media in sync with the GSAP master timeline)
- **Media loading** — the framework waits for all media elements to load before resolving timing and starting playback

Mounting and unmounting controls **presence**, not appearance. A clip that is mounted is on screen; a clip that is unmounted is not. Transitions (fade in, slide in, etc.) are separate — they are animated in scripts and happen _after_ a clip is mounted or _before_ it is unmounted.

The framework does **not** handle transitions, effects, or visual animation — those are driven by GSAP in JavaScript.

Do not manually call `video.play()`, `video.pause()`, set `audio.currentTime`, or mount/unmount clips in scripts. The framework owns media playback and clip lifecycle. Animating visual properties like `opacity` or `transform` for transitions is fine — that's what scripts are for.

## Viewport

Every composition must include `data-width` and `data-height` so scripts and CSS can reference concrete pixel dimensions for layout. Common sizes:

- **Landscape**: `data-width="1920" data-height="1080"`
- **Portrait**: `data-width="1080" data-height="1920"`

e.g.,

```html
<div id="main" data-composition-id="my-video" data-start="0" data-width="1920" data-height="1080">
  <!-- clips -->
</div>
```

Every composition's container is full-screen within the viewport by default. The framework applies full-screen sizing to composition containers automatically.

To position or size individual clips (e.g., picture-in-picture, overlay placement), use standard CSS on the element.

## Compositions

A composition is the fundamental grouping unit in HyperFrames. Every clip — video, image, audio — must live inside a composition. The `index.html` file is itself a composition (the top-level one), and it can contain nested compositions within it. Any composition can be imported into another composition as a sub-composition — there is no special "root" type.

A composition carries the same core attributes as any other clip (`id`, `data-start`, `data-track-index`), so it can be placed and timed on a timeline just like a video or image. A composition's length is determined by its GSAP timeline — there is no `data-duration` on compositions. This means compositions can be nested: a composition clip inside another composition behaves like a self-contained video within the parent timeline.

### Composition File Structure

**Each composition should be defined in its own HTML file.** This keeps compositions modular, reusable, and maintainable. The file contains the complete composition: HTML structure, inline styles, and script.

```
project/
├── index.html              # Root composition
├── compositions/
│   ├── intro-anim.html     # Intro animation composition
│   ├── caption-overlay.html # Caption composition
│   └── outro-title.html     # Outro composition
```

**Composition file format** (`compositions/intro-anim.html`):

```html
<!-- Define the composition as a template that can be loaded -->
<template id="intro-anim-template">
  <div data-composition-id="intro-anim" data-width="1920" data-height="1080">
    <div class="title">Welcome!</div>
    <div class="subtitle">Let's get started</div>

    <style>
      [data-composition-id="intro-anim"] .title {
        font-size: 72px;
        color: white;
        text-align: center;
      }
      [data-composition-id="intro-anim"] .subtitle {
        font-size: 36px;
        color: #ccc;
        text-align: center;
      }
    </style>

    <script>
      const tl = gsap.timeline({ paused: true });
      tl.from(".title", { opacity: 0, y: -50, duration: 1 });
      tl.from(".subtitle", { opacity: 0, y: 50, duration: 1 }, 0.5);
      window.__timelines["intro-anim"] = tl;
    </script>
  </div>
</template>
```

### Loading Compositions

Use the `data-composition-src` attribute to load a composition from an external HTML file. The framework will automatically fetch the template and instantiate it:

```html
<div id="comp-1" data-composition-id="my-video" data-start="0" data-width="1920" data-height="1080">
  <!-- Primitive clips -->
  <video id="el-1" data-start="0" data-duration="10" data-track-index="0" src="..."></video>
  <video id="el-2" data-start="el-1" data-duration="8" data-track-index="0" src="..."></video>
  <img id="el-3" data-start="5" data-duration="4" data-track-index="1" src="..." />
  <audio id="el-4" data-start="0" data-duration="30" data-track-index="2" src="..." />

  <!-- Load composition from external file -->
  <div
    id="el-5"
    data-composition-id="intro-anim"
    data-composition-src="compositions/intro-anim.html"
    data-start="0"
    data-track-index="3"
  ></div>

  <!-- Another loaded composition -->
  <div
    id="el-6"
    data-composition-id="captions"
    data-composition-src="compositions/caption-overlay.html"
    data-start="0"
    data-track-index="4"
  ></div>
</div>
```

The framework will:

1. Fetch the HTML file specified in `data-composition-src`
2. Extract the `<template>` content
3. Clone and mount it into the composition element
4. Execute any `<script>` tags within the template
5. Register the timeline in `window.__timelines`

### Best Practices for Composition Files

**Use separate HTML files when:**

- The composition is reusable across multiple projects or scenes
- The composition has complex logic, styling, or structure (>20 lines)
- You want to keep the main `index.html` clean and focused on orchestration
- The composition represents a distinct functional unit (captions, titles, animations)

**Use inline compositions when:**

- The composition is truly one-off and project-specific
- The composition is very simple (<10 lines total)
- You're prototyping and iterating quickly

**File naming conventions:**

- Use kebab-case: `intro-anim.html`, `caption-overlay.html`, `emoji-burst.html`
- Name files descriptively based on their purpose or visual function
- Group related compositions in subdirectories if you have many: `compositions/titles/`, `compositions/overlays/`

## Clip Types

A clip is any discrete block on the timeline. We represent clips as HTML elements and apply data-attributes to describe them.

- `<video>` — Video clips, B-roll, A-roll
- `<img>` — Static images, overlays
- `<audio>` — Music, sound effects
- `<div data-composition-id="...">` — Nested compositions (animations, grouped sequences)

## HTML Attributes

### All Clips

- `id` — Unique identifier (e.g., "el-1")
- `data-start` — Start time in seconds, or a clip `id` reference. See [Relative Timing](#relative-timing).
- `data-duration` — Duration in seconds. Required for `<img>` clips. Optional for `<video>` and `<audio>` (defaults to the source media's full duration). Not used on compositions.
- `data-track-index` — Timeline track number. Tracks serve two purposes: they determine visual layering (higher tracks render in front) and they group clips into rows on the timeline. Clips on the same track **cannot overlap in time**.

### Media Clips (video, audio)

- `data-media-start` — (optional) Playback begins at this time in the source file, in seconds. Defaults to `0`.

### Composition Clips

- `data-composition-id` — Unique composition ID
- `data-composition-src` — (optional) Path to external HTML file containing the composition template. The framework will fetch, instantiate, and mount the template automatically.

> Compositions do **not** use `data-duration`. Their duration is determined by their GSAP timeline.

## Relative Timing

Instead of calculating absolute start times, a clip can reference another clip's `id` in its `data-start` attribute. This means "start when that clip ends." The referenced clip must be in the same composition and must have a known duration (either an explicit `data-duration` or an inferred duration from the source media).

### Basic Sequential Clips

```html
<video id="intro" data-start="0" data-duration="10" data-track-index="0" src="..."></video>
<video id="main" data-start="intro" data-duration="20" data-track-index="0" src="..."></video>
<video id="outro" data-start="main" data-duration="5" data-track-index="0" src="..."></video>
```

`main` resolves to second 10, `outro` resolves to second 30. If `intro`'s duration changes to 15, `main` and `outro` shift automatically.

### Offsets (gaps and overlaps)

Add `+ N` or `- N` after the ID to offset from the end of the referenced clip:

```html
<!-- intro ends at 10. "intro + 2" = 10 + 2 = starts at second 12 (2s gap) -->
<video
  id="scene-a"
  data-start="intro + 2"
  data-duration="20"
  data-track-index="0"
  src="..."
></video>

<!-- intro ends at 10. "intro - 0.5" = 10 - 0.5 = starts at second 9.5 (0.5s overlap for crossfade) -->
<!-- Different track because clips on the same track cannot overlap -->
<video
  id="scene-b"
  data-start="intro - 0.5"
  data-duration="20"
  data-track-index="1"
  src="..."
></video>
```

### Rules

- **Same composition only** — references resolve within the clip's parent composition
- **No circular references** — A cannot start after B if B starts after A
- **Referenced clip must have a known duration** — the system needs a known end time to resolve the reference (either explicit `data-duration` or inferred from source media)
- **Parsing** — if the value is a valid number, it is absolute seconds; otherwise it is parsed as `<id>`, `<id> + <number>`, or `<id> - <number>`

## Video Clips

Full-screen or positioned video clips. Videos sync their playback to the timeline position.

```html
<video
  id="el-1"
  data-start="0"
  data-duration="15"
  data-track-index="0"
  src="./assets/video.mp4"
></video>
```

- `data-media-start` — Playback begins at this time in the source video file (seconds). Default: `0`.
- `data-duration` — (optional) How long the clip occupies on the timeline, in seconds. Playback runs from `data-media-start` for up to `data-duration` seconds. If the source media runs out before `data-duration` elapses, playback naturally stops (the clip remains mounted showing the last frame). If omitted, defaults to the remaining duration of the source file from `data-media-start`.

## Image Clips

Static images that appear for a duration.

```html
<img id="el-2" data-start="5" data-duration="4" data-track-index="1" src="./assets/video.mp4" />
```

## Audio Clips

Background music or sound effects. Audio clips are invisible.

```html
<audio
  id="el-4"
  data-start="0"
  data-duration="30"
  data-track-index="2"
  src="./assets/music.mp3"
></audio>
```

- `data-media-start` — Playback begins at this time in the source audio file (seconds). Default: `0`.
- `data-duration` — (optional) How long the clip occupies on the timeline, in seconds. Playback runs from `data-media-start` for up to `data-duration` seconds. If the source media runs out before `data-duration` elapses, playback naturally stops (the clip remains mounted but silent). If omitted, defaults to the remaining duration of the source file from `data-media-start`.

## Two Layers: Primitives and Scripts

Every composition — master or sub — has the same two layers:

- **HTML** — primitive clips (`video`, `img`, `audio`, nested `div[data-composition-id]`). This is the declarative structure: what plays, when, and on which track.
- **Script** — effects, transitions, dynamic DOM, canvas, SVG — creative animation and visuals via GSAP. Scripts do **not** control media playback or clip visibility; the framework handles those via data attributes.

Both layers are available to every composition. The schema defines the primitives and the timeline contract; scripts handle visual creativity on top of that.

> **Warning:** Never use scripts to play/pause/seek media elements or to show/hide clips based on timing. The framework does this automatically from `data-start`, `data-duration`, and `data-media-start`. Scripts that duplicate this behavior will conflict with the framework.

### Script Isolation

Each composition's script is scoped to that composition. When a composition is loaded from an external HTML file via `data-composition-src`, its inline `<script>` and `<style>` tags are automatically included and scoped to that composition.

**Preferred approach** — Composition in separate HTML file:

```html
<!-- In index.html -->
<div
  id="el-5"
  data-composition-id="intro-anim"
  data-composition-src="compositions/intro-anim.html"
  data-start="0"
  data-track-index="2"
></div>
```

**Alternative approach** — External JS file:

```html
<!-- In index.html -->
<div
  id="el-5"
  data-composition-id="intro-anim"
  data-start="0"
  data-track-index="2"
  data-width="1920"
  data-height="1080"
>
  <script src="intro-anim.js"></script>
</div>
```

The separate HTML file approach is preferred because it keeps all composition code (structure, style, script) in one self-contained, reusable file.

The only required file is `index.html`. Every composition must have at least a script to create and register its GSAP timeline.

### Top-Level Composition

The top-level composition is the `index.html` entry point. It acts as the conductor — sequencing clips and placing sub-composition timelines into an overall master timeline. It can technically do anything in its script, but its primary purpose is high-level orchestration. Any composition can serve as a top-level composition or be nested into another — there is no structural difference.

```html
<div id="comp-1" data-composition-id="my-video" data-start="0" data-width="1920" data-height="1080">
  <!-- Primitive clips -->
  <video id="el-1" data-start="0" data-duration="10" data-track-index="0" src="..."></video>
  <video id="el-2" data-start="el-1" data-duration="8" data-track-index="0" src="..."></video>
  <img id="el-3" data-start="5" data-duration="4" data-track-index="1" src="..." />
  <audio id="el-4" data-start="0" data-duration="30" data-track-index="2" src="..." />

  <!-- Load sub-compositions from external files -->
  <div
    id="el-5"
    data-composition-id="intro-anim"
    data-composition-src="compositions/intro-anim.html"
    data-start="0"
    data-track-index="3"
  ></div>

  <div
    id="el-6"
    data-composition-id="captions"
    data-composition-src="compositions/caption-overlay.html"
    data-start="0"
    data-track-index="4"
  ></div>

  <script>
    // Just register the timeline - framework auto-nests sub-compositions
    const tl = gsap.timeline({ paused: true });
    window.__timelines["my-video"] = tl;
  </script>
</div>
```

### Sub-Compositions

Sub-compositions are a spectrum. One might simply group a few primitive clips. Another might be a fully custom program with its own HTML, CSS, and JavaScript — creating, animating, and destroying DOM however it sees fit. There are no categories or constraints on what a sub-composition does internally. The only rule: it must be driven by a GSAP timeline and export it. If children use `position: absolute`, always set explicit `left`/`top`/`bottom`/`right` — the composition root is a positioned container, so omitting coordinates produces unpredictable placement.

## Wrapping Dynamic Content in Compositions

**Critical Rule: All visual content must live inside a composition with data attributes to appear in the timeline.**

When you have dynamic or script-animated content (captions, emojis, overlays, text animations), wrap them in a composition element with `data-start`, `data-duration` (or let the timeline determine duration), and `data-track-index`. The children inside can be freely created and animated via JavaScript—they don't need individual data attributes.

### Wrong: Dynamic content outside a composition

```html
<!-- BAD: captions-container is not a composition - won't appear in timeline -->
<div id="ui-layer">
  <div id="captions-container">
    <!-- Dynamically created caption groups via JS -->
  </div>
  <div class="emoji" id="emoji-1">🤩</div>
</div>

<script>
  // These animations work visually but elements don't appear in timeline
  tl.to(".caption-group", { opacity: 1 }, 0.5);
  tl.to("#emoji-1", { scale: 1.2 }, 2);
</script>
```

### Correct: Dynamic content wrapped in compositions

**Preferred approach** — Load from external HTML files:

```html
<!-- GOOD: Each logical group is a composition loaded from its own file -->
<div
  id="captions-comp"
  data-composition-id="captions"
  data-composition-src="compositions/captions.html"
  data-start="0"
  data-track-index="5"
></div>

<div
  id="emojis-comp"
  data-composition-id="emojis"
  data-composition-src="compositions/emojis.html"
  data-start="0"
  data-track-index="6"
></div>
```

**Alternative approach** — Inline composition (useful for one-off custom compositions):

```html
<div
  id="captions-comp"
  data-composition-id="captions"
  data-start="0"
  data-track-index="5"
  data-width="1080"
  data-height="1920"
>
  <!-- Children created/animated by script - no data attributes needed -->
  <div id="captions-container"></div>
  <script>
    const captionTL = gsap.timeline({ paused: true });
    // Dynamically create and animate caption groups...
    window.__timelines["captions"] = captionTL;
  </script>
</div>

<div
  id="emojis-comp"
  data-composition-id="emojis"
  data-start="0"
  data-track-index="6"
  data-width="1080"
  data-height="1920"
>
  <div class="emoji" id="emoji-1">🤩</div>
  <div class="emoji" id="emoji-2">🏔️</div>
  <script>
    const emojiTL = gsap.timeline({ paused: true });
    emojiTL.to("#emoji-1", { opacity: 1, scale: 1.2 }, 2);
    emojiTL.to("#emoji-2", { opacity: 1, scale: 1.2 }, 4);
    window.__timelines["emojis"] = emojiTL;
  </script>
</div>
```

### When to create separate compositions

- **Captions**: One composition for all captions, script manages word groups
- **Emojis/Stickers**: One composition for the emoji layer
- **Hooks/Titles**: One composition per distinct title sequence
- **Overlays**: Group related overlays into compositions by purpose

The composition appears in the timeline with its start time and duration (determined by its GSAP timeline). Everything inside is managed by the script but inherits the composition's timeline position.

### Caption discoverability contract

To make caption previews deterministic and easy to isolate in downstream UIs (timeline, mini-player, editor overlays), caption compositions should expose a stable root selector.

Use these attributes on the caption root node:

- `data-timeline-role="captions"` (required)
- `data-caption-root="true"` (recommended)

Example:

```html
<div
  id="captions-comp"
  data-composition-id="captions"
  data-start="0"
  data-track-index="5"
  data-width="1080"
  data-height="1920"
  data-timeline-role="captions"
  data-caption-root="true"
>
  <div id="caption-container"></div>
  <script>
    const captionTL = gsap.timeline({ paused: true });
    window.__timelines["captions"] = captionTL;
  </script>
</div>
```

## Timeline Contract

The framework initializes `window.__timelines = {}` before any scripts run. Every composition **must** have a script that creates a GSAP timeline and registers it:

```js
const tl = gsap.timeline({ paused: true });
// ... add tweens, nested timelines, etc.
window.__timelines["<data-composition-id>"] = tl;
```

### Rules

- **Every composition needs a script** — at minimum, to create and register its timeline. A composition without a script has no timeline and cannot participate in the hierarchy.
- **All timelines start paused** — create timelines with `{ paused: true }`. The top-level timeline is controlled externally by the frontend player or renderer.
- **Framework auto-nests sub-timelines** — you do **not** need to manually add sub-composition timelines to the master timeline. The framework automatically nests any timeline registered in `window.__timelines` into its parent based on the composition's `data-start` attribute.
- **Duration comes from the timeline** — a composition's duration is `tl.duration()`. The timeline is the sole source of truth; there is no `data-duration` on compositions.
- **Timelines must be finite** — every timeline must have a finite duration. Infinite or indefinite timelines are not supported.

### What NOT to do

```js
// UNNECESSARY - the framework does this automatically
if (window.__timelines["captions"]) {
  masterTL.add(window.__timelines["captions"], 0);
}
```

Just register your timeline in `window.__timelines` and the framework handles the rest.

## Output Checklist

- [ ] Every composition has `data-width` and `data-height` attributes
- [ ] Each reusable composition is in its own HTML file (in `compositions/` directory)
- [ ] Compositions loaded via `data-composition-src` attribute
- [ ] Each composition file uses `<template>` tag to wrap its content
- [ ] `window.__timelines` given all compositions' timelines
- [ ] Complex/dynamic animations are handled by scripts in compositions
