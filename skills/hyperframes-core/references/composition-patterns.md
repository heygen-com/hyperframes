# Composition Patterns

How to architect a project — when to inline everything in one HTML, when to split into sub-compositions, what the `index.html` orchestrator looks like at scale, and the common sub-composition archetypes seen in real projects. Pair with `minimal-composition.md` (single-file shape) and `sub-compositions.md` (mechanics of a sub-comp file).

## Two Architectures

|                       | Monolithic (single file)                                | Modular (sub-compositions)                                                           |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Project layout        | `index.html` only                                       | `index.html` + `compositions/<scene>.html` per scene                                 |
| Where scenes live     | Inline `<section class="clip">` siblings under the root | Each scene is a separate file wrapped in `<template>`                                |
| Timeline registration | One timeline keyed at the root's `data-composition-id`  | Root timeline (often near-empty) + one timeline per sub-comp, each keyed by its `id` |
| Routing entry         | `references/minimal-composition.md`                     | `references/sub-compositions.md`                                                     |

Both architectures use the same runtime contract — `data-*` attributes + `window.__timelines[id]`. The choice is structural, not behavioral.

### Pick monolithic when

- The whole video is one continuous scene with no hard cuts.
- Scenes share heavy state (one canvas/WebGL context spanning the whole video, a single SVG that morphs across all beats).
- Total scope is small (~200–400 lines of markup + script).
- No scene is reused across projects.

### Pick modular when

- The video has clear scene cuts — each scene is its own segment of the timeline.
- Some scenes are large (>100 lines of markup or significant scripted animation).
- A scene is reusable (kinetic intro, end-card logo lockup, a transition).
- The video has a continuous audio track over multiple visual segments. Keep audio at the root, visual segments as sub-comps.
- You want to author/iterate on scenes in isolation (preview a single sub-comp file directly).

### Refactor between them

Conversion is mechanical and reversible. To lift a monolithic scene into a sub-comp: wrap the scene's markup + scoped CSS + its slice of the parent timeline into a `<template>`, save as `compositions/<scene>.html`, replace the inline content in `index.html` with a slot `<div data-composition-src="compositions/<scene>.html">`, and have the sub-comp register its own timeline at `window.__timelines["<scene>"]`. The parent timeline shrinks accordingly.

If a monolithic project is approaching three or more scene cuts, prefer modularizing _before_ adding the next scene. Mixed projects where some scenes are inline and siblings are in `compositions/` are the hardest to maintain.

## Modular Orchestrator Pattern

When using sub-compositions, `index.html` should be **thin**. Its job is to declare slots, lay them out in time, mount the audio track, and register a (usually empty) root timeline. All scene animation lives inside the sub-comps.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      body {
        margin: 0;
        background: #000;
      }
      #root {
        position: relative;
        width: 1920px;
        height: 1080px;
        overflow: hidden;
      }
      /* Sub-comp slots stretch to fill the root. */
      [data-composition-id="root"] > div[data-composition-src] {
        position: absolute;
        inset: 0;
      }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="root"
      data-width="1920"
      data-height="1080"
      data-duration="30"
    >
      <!-- Sequential scenes — each one a sub-composition slot. -->
      <div
        id="el-intro"
        data-composition-id="intro"
        data-composition-src="compositions/intro.html"
        data-start="0"
        data-duration="6"
        data-track-index="1"
      ></div>

      <div
        id="el-body"
        data-composition-id="body"
        data-composition-src="compositions/body.html"
        data-start="6"
        data-duration="18"
        data-track-index="1"
      ></div>

      <div
        id="el-outro"
        data-composition-id="outro"
        data-composition-src="compositions/outro.html"
        data-start="24"
        data-duration="6"
        data-track-index="1"
      ></div>

      <!-- Continuous audio at the root — survives scene cuts. -->
      <audio
        id="el-bgm"
        src="assets/bgm.mp3"
        data-start="0"
        data-duration="30"
        data-track-index="10"
        data-volume="0.6"
      ></audio>
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["root"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
```

Key properties of this layout:

- **Visual scenes on the same `data-track-index`** (e.g. `1`). Sequential — they cannot overlap on the same track. For a cross-fade between two scenes, put one on a higher track and overlap their times by the fade duration.
- **Audio on a separate, higher track index** (e.g. `10`). Keeps the linter's overlap rules clear of any visual collisions.
- **Root timeline is near-empty.** All animation lives in the sub-comps. A root-level fade-to-black at the very end is fine; do not stage a parallel animation track from the root.
- **Host slot ids** use `el-<name>` or `<scene-id>`. The slot's `data-composition-id` must still equal the sub-comp's internal id (see `sub-compositions.md`).

## Sub-Composition Archetypes

### A. Content scene (default)

The sub-comp contains the scene's full DOM, scoped CSS, and timeline. This is the standard pattern in `sub-compositions.md` — most scenes are this.

### B. Host media + main-timeline driver (one pattern for `<video>`/`<audio>`)

`<video>`/`<audio>` seek and decode at any nesting depth, so a scene-specific clip can live inside its scene's sub-comp with scene-local `data-start` and be driven by that sub-comp's own timeline. Use this host-media pattern instead when you want the media's motion authored on the **main** timeline: put the `<video>`/`<audio>` as a host-root sibling positioned over the scene's frame.

The reason to reach for it: a sub-comp timeline **cannot** drive host elements (a global selector or `document.querySelector` does not resolve across the boundary). So if the media lives at the host root, author its per-scene motion (scale/opacity/morph/tilt/breathing) on the **main timeline** in `index.html`, at **global time** = scene-local time + the scene slot's `data-start`.

```html
<!-- index.html (host) -->
<div
  id="el-final"
  data-composition-id="final-anim"
  data-composition-src="compositions/final-anim.html"
  data-start="20"
  data-duration="6"
  data-track-index="1"
></div>

<!-- media is a DIRECT root child; sits over the sub-comp's frame -->
<video
  id="final-video"
  class="clip"
  src="assets/final.mp4"
  data-start="20"
  data-duration="6"
  data-track-index="2"
  muted
  playsinline
  style="position:absolute; left:360px; top:100px; width:1200px; height:680px; object-fit:cover; border-radius:24px;"
></video>

<script>
  // MAIN timeline drives the host video. Global time: scene starts at 20.
  window.__timelines = window.__timelines || {};
  const main = window.__timelines["main"];
  main.fromTo(
    "#final-video",
    { scale: 1.4, filter: "blur(14px)" },
    { scale: 1.0, filter: "blur(0px)", duration: 0.9, ease: "power3.out" },
    20,
  ); // = slot data-start (+ any scene-local offset)
</script>

<!-- compositions/final-anim.html — frame/shell only, no <video>, no host-element animation -->
<template>
  <div
    data-composition-id="final-anim"
    data-width="1920"
    data-height="1080"
    data-duration="6"
    style="position:absolute; inset:0; pointer-events:none;"
  >
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      // animate ONLY this sub-comp's own elements here (labels, frame, overlays)
      window.__timelines["final-anim"] = tl;
    </script>
  </div>
</template>
```

Caveats:

- In this pattern the media is a host-root child, static in `index.html`, so the main timeline's selector resolves it. (Media nested in a sub-comp is also driven fine; it just can't be reached by the main timeline's selectors — drive it from the sub-comp's own timeline.)
- Clip lifecycle owns the media element's visibility across its `[data-start, data-start+data-duration]` window. The main-timeline opacity/scale tweens compose with it fine; for an opacity reveal/crossfade prefer a host **wrapper** so you are not fighting the lifecycle on the media element itself.
- Two media elements sharing the same `src` + `data-start` trigger `duplicate_media_discovery_risk` (benign — both still render).

### C. Multi-scene merge

When several beat-level scenes share continuous state — a chat thread that grows, a persistent headline word that carries across the cut, a single canvas with internal phase changes — collapse them into one sub-comp and use **internal phase divs** rather than multiple sub-comp slots.

```html
<!-- compositions/act2-merged.html -->
<template>
  <div data-composition-id="act2-merged" data-width="1920" data-height="1080" data-duration="9">
    <style>
      [data-composition-id="act2-merged"] .phase {
        position: absolute;
        inset: 0;
        opacity: 0;
      }
    </style>
    <div class="phase" id="phase-a">…</div>
    <div class="phase" id="phase-b">…</div>
    <div class="phase" id="phase-c">…</div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.set("#phase-a", { opacity: 1 }, 0);
      tl.to("#phase-a", { opacity: 0, duration: 0.4 }, 3.0);
      tl.set("#phase-b", { opacity: 1 }, 3.0);
      // …
      window.__timelines["act2-merged"] = tl;
    </script>
  </div>
</template>
```

Reach for this over multiple sequential slots when scenes share DOM, share a canvas, or need to cross-fade with persistent elements (a headline that survives the cut between phases). Each phase is just a div inside the same sub-comp — the parent timeline never has to know about the internal phase boundaries.

### D. Audio at root, reactive visual inside

Audio always lives at the host (`index.html`) as a root-level `<audio>` so playback survives scene cuts. A sub-comp that visualizes audio should read a **pre-baked** frequency curve at init, then sample the baked curve from its timeline — the visual must still be a deterministic function of `tl.time()`, not of `audio.currentTime`. See `determinism-rules.md` and `hyperframes-creative` for the authoring pattern.

## Naming Conventions

| Thing                               | Convention                                  | Example                                    |
| ----------------------------------- | ------------------------------------------- | ------------------------------------------ |
| Sub-comp file                       | `compositions/<scene-id>.html`              | `compositions/act0-intro-bell.html`        |
| Sub-comp `<template>` id (optional) | `<scene-id>-template`                       | `<template id="act0-intro-bell-template">` |
| Sub-comp root `data-composition-id` | `<scene-id>` (must match host slot)         | `data-composition-id="act0-intro-bell"`    |
| Timeline registry key               | matches `data-composition-id`               | `window.__timelines["act0-intro-bell"]`    |
| Host slot `id`                      | `el-<short>` or `<scene-id>`                | `id="el-intro"`, `id="act0"`               |
| Element ids inside a sub-comp       | prefix with the scene id                    | `#act0-bell`, `#b1-tape`                   |
| Audio at root                       | `data-track-index` well above visual tracks | `10` while visuals use `1`                 |

The `-template` suffix on `<template>` is conventional but not required — the runtime extracts contents from whichever `<template>` is in `<body>`, regardless of id. The prefix on inner element ids is the only safeguard against id collisions when multiple sub-comps are mounted into the same host page at once.

## Editing Existing Projects

Before adding or modifying scenes, identify which architecture is in use:

```bash
ls compositions/ 2>/dev/null && echo "modular" || echo "monolithic"
```

- In a **monolithic** project, add new scenes as inline `<section class="clip">` elements with a non-overlapping `data-start` and a sensible `data-track-index`, and extend the existing single timeline.
- In a **modular** project, match the pattern: add a new file under `compositions/`, add a slot in `index.html`, keep the root timeline thin. Do **not** start inlining new scenes into `index.html` when sibling scenes are sub-comps — the inconsistency is the worst of both worlds.
- If a monolithic project needs a third or fourth scene cut, lift each scene into a sub-comp before adding more. The conversion is mechanical (see "Refactor between them" above).

When picking the slot's `data-start`/`data-duration`, prefer continuing the existing sequencing convention (adjoining starts, deliberate overlaps for cross-fades). Don't introduce a new track index unless you actually need parallel visual layers — most sequential-scene projects use exactly one visual track.
