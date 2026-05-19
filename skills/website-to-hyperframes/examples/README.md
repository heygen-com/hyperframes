# HyperFrames Capability Showcase — Example Library

**Purpose:** Every HyperFrames technique demonstrated in one place, scene by scene. Read this when planning a video — pick the techniques you'll use, then study their scenes BEFORE writing any composition.

**Why this library exists:** Across 11 isolated pipeline-evaluation runs, ZERO agents used HyperFrames' powerful capabilities — they all defaulted to screenshot + Ken Burns + voiceover. Skill prose can't fix that. Worked examples can. Every scene in this library is 100% composed from divs/SVG/CSS/GSAP — no captured screenshots, no slideshow tricks.

---

## How to use this library

This library is a **reference frame**, not a template gallery. The website-to-hyperframes skill picks a mode per beat in step-3; honor that mode in step-5. The three modes:

| Mode             | When                                                                                                  | What you do                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **copy+mutate**  | A single scene is a near-1:1 fit (same UI shape, similar length, just different brand/content).       | Seed `compositions/beat-N-name.html` from the cited scene's `index.html`. Swap content + colors + copy + duration. Keep timeline + easings.|
| **recombine**    | No single scene fits, but 2-3 scenes each contribute a layer.                                          | Seed from the closest scene as structural base, then port patterns (counter logic, marker overlay, transition shape) from the others.       |
| **fresh**        | The beat is novel; nothing close enough exists. Examples set the bar for taste.                       | Write from scratch. Use cited scenes as taste references for easing variety, continuous-motion practice, snapshot determinism.              |

**Non-negotiable in every mode:** customize for the actual beat. If your output would be recognizable as "scene-X with content swapped," you copied without thinking. Examples are NEVER the finished beat — same scaffold, different soul.

**Process per beat:**

1. Find your beat's technique below in the lookup table. Open that scene's `index.html` and read the full source — markup, GSAP timeline, easings, comments.
2. Pick the mode that fits your beat (decided in step-3-storyboard.md).
3. In copy+mutate / recombine: seed from the cited scene. In fresh: write from scratch using examples as taste reference. **Always** customize.
4. Lint, snapshot, verify the result.

**When stuck on motion that feels static or boring:**

- Look at section `12-combined-vignettes/` — full multi-technique scenes. `scene-03-product-launch-beat/` combines 6 techniques (stroke-draw logo + kinetic headline + counter + marker + particle burst + breathing) in one beat — the most realistic "what a polished beat looks like" reference.
- The chat scene ([`04-composed-ui/scene-02-chat-with-typing/`](04-composed-ui/scene-02-chat-with-typing/)) is the gold standard for narration-synced events.
- Look at section `13-anti-patterns/` — the bad examples. Make sure your scene doesn't match any of these.

---

## The 13 sections

| # | Section | Theme | Best for beats that need… |
|---|---------|-------|---------------------------|
| **01** | [`01-typography/`](01-typography/) | Text animations — 24 named effects from soft-blur-in to typewriter to kinetic-center-build | Headline reveals, statement beats, copy that needs personality |
| **02** | [`02-markers-and-emphasis/`](02-markers-and-emphasis/) | Hand-drawn marker effects: highlight sweep, circle, burst, scribble, sketchout | Emphasis words, "this matters" moments, editorial annotation |
| **03** | [`03-easing-variety/`](03-easing-variety/) | The 7 production easings side-by-side; comparison grid | Tuning motion intent — when `power2.out` everywhere feels wrong |
| **04** | [`04-composed-ui/`](04-composed-ui/) | Kanban / chat / terminal / command palette / dashboard / file tree / code editor / calendar — every one built from divs | Showing a product feature without using a screenshot |
| **05** | [`05-transitions-shader/`](05-transitions-shader/) | All 14 WebGL shader transitions (chromatic-split, sdf-iris, domain-warp, etc.) | Beat-to-beat transitions with real visual weight |
| **06** | [`06-transitions-css/`](06-transitions-css/) | Top 10 CSS transitions: push, scale, blur-dissolve, 3D flip, light-leak wipe, etc. | Lighter transitions when shaders are overkill |
| **07** | [`07-html-in-canvas/`](07-html-in-canvas/) | iPhone/MacBook mockups, 3D rotation+bloom, magnetic distortion, portal, shatter, liquid glass, text cursor | Cinematic VFX, device showcases, "wow" moments |
| **08** | [`08-svg-and-path/`](08-svg-and-path/) | Logo stroke-draw, icon draw-on, MotionPath, SVG shape morph, particle-field SVG | Logo reveals, illustrative moments, branded entrances |
| **09** | [`09-counters-and-data/`](09-counters-and-data/) | Counter 0→1M, sparklines, bar charts, pie/donut, multi-stat dashboards, arc gauges | Numbers, growth claims, dashboards, "stat" beats |
| **10** | [`10-particles-and-ambient/`](10-particles-and-ambient/) | Light leak, grain, particle drift, glow pulse, camera shake, lens distortion, parallax fields | Atmosphere, continuous-motion holds, mood setting |
| **11** | [`11-3d-and-parallax/`](11-3d-and-parallax/) | CSS 3D flip, perspective tilt, parallax layers, card-stack fan, three.js | Depth, dimensionality, "expensive" feel |
| **12** | [`12-combined-vignettes/`](12-combined-vignettes/) | Multi-technique scenes — 3-5 techniques running simultaneously. **The real beat demos.** | When you want a full reference for "what a good beat looks like" |
| **13** | [`13-anti-patterns/`](13-anti-patterns/) | Annotated BAD examples — slideshow trap, static-after-entrance, power2-everywhere, screenshot-Ken-Burns | Knowing what to avoid |

---

## Lookup by technique

Need a specific technique? Use this table to find the canonical scene.

| Technique | Canonical scene |
|---|---|
| 4-shader transitions side-by-side (chromatic-split, sdf-iris, domain-warp, whip-pan) | [`05-transitions-shader/scene-01-shader-transitions-showcase/`](05-transitions-shader/scene-01-shader-transitions-showcase/) |
| 6 CSS transitions side-by-side (push, scale, blur-dissolve, 3D flip, light leak, dissolve) | [`06-transitions-css/scene-01-css-transitions-grid/`](06-transitions-css/scene-01-css-transitions-grid/) |
| Headline blur entrance (Apple keynote) | [`01-typography/scene-01-soft-blur-in/`](01-typography/scene-01-soft-blur-in/) |
| Terminal-style typewriter | [`01-typography/scene-02-typewriter-mechanical/`](01-typography/scene-02-typewriter-mechanical/) |
| Per-word kinetic build (word locks center) | [`01-typography/scene-03-kinetic-center-build/`](01-typography/scene-03-kinetic-center-build/) |
| Per-line mask-reveal-up (editorial Fraunces italic) | [`01-typography/scene-04-line-reveal-staggered/`](01-typography/scene-04-line-reveal-staggered/) |
| Stagger wave (center-out vs edges-in comparison) | [`01-typography/scene-05-stagger-wave/`](01-typography/scene-05-stagger-wave/) |
| Variable-font weight shift (wght 100→900) | [`01-typography/scene-06-variable-font-weight-shift/`](01-typography/scene-06-variable-font-weight-shift/) |
| Material shared-axis-z depth crossfade | [`01-typography/scene-07-shared-axis-crossfade/`](01-typography/scene-07-shared-axis-crossfade/) |
| RGB glitch split (cyberpunk emphasis) | [`01-typography/scene-08-glitch-rgb-split/`](01-typography/scene-08-glitch-rgb-split/) |
| Scramble decrypt (per-char intermediates) | [`01-typography/scene-09-scramble-decrypt/`](01-typography/scene-09-scramble-decrypt/) |
| Per-word + hand-drawn marker overlay | [`01-typography/scene-10-per-word-emphasis/`](01-typography/scene-10-per-word-emphasis/) |
| Serif orbital title with SVG accent + tagline | [`01-typography/scene-11-orbital-title/`](01-typography/scene-11-orbital-title/) |
| Intro kinetic text — large word stacks with gradient sweep fills | [`01-typography/scene-12-intro-kinetic-text/`](01-typography/scene-12-intro-kinetic-text/) |
| Yellow highlight sweep behind key word | [`02-markers-and-emphasis/scene-01-highlight-sweep/`](02-markers-and-emphasis/scene-01-highlight-sweep/) |
| Hand-drawn SVG ellipse circle around word | [`02-markers-and-emphasis/scene-02-hand-drawn-circle/`](02-markers-and-emphasis/scene-02-hand-drawn-circle/) |
| 12-spike radial burst on key word | [`02-markers-and-emphasis/scene-03-burst-radial/`](02-markers-and-emphasis/scene-03-burst-radial/) |
| Wavy scribble underline | [`02-markers-and-emphasis/scene-04-scribble-underline/`](02-markers-and-emphasis/scene-04-scribble-underline/) |
| Sketchout X (with replacement phrase) | [`02-markers-and-emphasis/scene-05-sketchout-x/`](02-markers-and-emphasis/scene-05-sketchout-x/) |
| All 5 markers in cascade | [`02-markers-and-emphasis/scene-06-combined-marker-cascade/`](02-markers-and-emphasis/scene-06-combined-marker-cascade/) |
| Magnetic WebGL caption (GLSL distortion + chromatic aberration follows cursor) | [`02-markers-and-emphasis/scene-07-magnetic-caption-webgl/`](02-markers-and-emphasis/scene-07-magnetic-caption-webgl/) |
| 6x3 grid of pure-CSS animations | [`03-easing-variety/scene-01-css-animation-grid/`](03-easing-variety/scene-01-css-animation-grid/) |
| Animated kanban board with drag | [`04-composed-ui/scene-01-kanban-board/`](04-composed-ui/scene-01-kanban-board/) |
| Chat with typing dots + reactions (narration-sync gold standard) | [`04-composed-ui/scene-02-chat-with-typing/`](04-composed-ui/scene-02-chat-with-typing/) |
| Terminal with multi-line command + output | [`04-composed-ui/scene-03-terminal-typeon/`](04-composed-ui/scene-03-terminal-typeon/) |
| Cmd+K command palette with filtering | [`04-composed-ui/scene-04-command-palette/`](04-composed-ui/scene-04-command-palette/) |
| Dashboard with counters + sparklines + donut + gauge | [`04-composed-ui/scene-05-dashboard-counters/`](04-composed-ui/scene-05-dashboard-counters/) |
| VS Code file tree progressive reveal | [`04-composed-ui/scene-06-file-tree-reveal/`](04-composed-ui/scene-06-file-tree-reveal/) |
| Code editor typing with syntax + error squiggle + fix | [`04-composed-ui/scene-07-code-editor-typing/`](04-composed-ui/scene-07-code-editor-typing/) |
| Weekly calendar with events + popover + now-line | [`04-composed-ui/scene-08-calendar-events/`](04-composed-ui/scene-08-calendar-events/) |
| 3D iPhone mockups with composed app UI | [`04-composed-ui/scene-09-phone-mockups/`](04-composed-ui/scene-09-phone-mockups/) |
| Terminal + live preview split (`npx create-app` → mockup builds in pane) | [`04-composed-ui/scene-10-terminal-with-preview/`](04-composed-ui/scene-10-terminal-with-preview/) |
| Video editor UI with timeline scrubber + render HUD | [`04-composed-ui/scene-11-timeline-editor-ui/`](04-composed-ui/scene-11-timeline-editor-ui/) |
| WebGL fragment shader + Canvas 2D fallback | [`07-html-in-canvas/scene-01-webgl-shader/`](07-html-in-canvas/scene-01-webgl-shader/) |
| Canvas 2D procedural ASCII art + lightning | [`07-html-in-canvas/scene-02-canvas-ascii/`](07-html-in-canvas/scene-02-canvas-ascii/) |
| Canvas 2D cursor blur + chromatic aberration text | [`07-html-in-canvas/scene-03-cursor-blur-sweeps/`](07-html-in-canvas/scene-03-cursor-blur-sweeps/) |
| iPhone frame with live composed app UI inside (no screenshots) | [`07-html-in-canvas/scene-04-iphone-mockup-live/`](07-html-in-canvas/scene-04-iphone-mockup-live/) |
| MacBook frame with simulated browser session inside | [`07-html-in-canvas/scene-05-macbook-mockup-live/`](07-html-in-canvas/scene-05-macbook-mockup-live/) |
| SVG vinyl record + tonearm | [`08-svg-and-path/scene-01-vinyl-record/`](08-svg-and-path/scene-01-vinyl-record/) |
| Editorial timeline diagram + SVG easing curve | [`09-counters-and-data/scene-01-timeline-diagram/`](09-counters-and-data/scene-01-timeline-diagram/) |
| Vertical scroll-pan pipeline diagram | [`09-counters-and-data/scene-02-pipeline-diagram/`](09-counters-and-data/scene-02-pipeline-diagram/) |
| Canonical 0 → 1,000,000 counter (33 deterministic `tl.set` steps) | [`09-counters-and-data/scene-03-counter-million-showcase/`](09-counters-and-data/scene-03-counter-million-showcase/) |
| Radial bloom dot grid (stagger from center) | [`10-particles-and-ambient/scene-01-radial-bloom-grid/`](10-particles-and-ambient/scene-01-radial-bloom-grid/) |
| Aurora end-card + particles + tri-color text gradient | [`10-particles-and-ambient/scene-02-aurora-end-card/`](10-particles-and-ambient/scene-02-aurora-end-card/) |
| Scan-line CRT grid + telemetry HUD | [`10-particles-and-ambient/scene-03-scan-line-grid/`](10-particles-and-ambient/scene-03-scan-line-grid/) |
| CSS 3D torus (16-segment orbital ring) | [`11-3d-and-parallax/scene-01-css-3d-torus/`](11-3d-and-parallax/scene-01-css-3d-torus/) |
| Three.js pyramid roll with multi-material faces | [`11-3d-and-parallax/scene-02-vercel-triangle-roll/`](11-3d-and-parallax/scene-02-vercel-triangle-roll/) |
| CSS 3D card tumble + clip-path wipe (6 cards) | [`11-3d-and-parallax/scene-03-card-flyby-deck/`](11-3d-and-parallax/scene-03-card-flyby-deck/) |
| Three.js 3D text morph (MOTION ↔ DESIGN) + CRT HUD | [`11-3d-and-parallax/scene-04-anamorphic-text-crt/`](11-3d-and-parallax/scene-04-anamorphic-text-crt/) |
| CSS 3D iPhone with tap/swipe gesture overlays | [`11-3d-and-parallax/scene-05-iphone-device-gesture/`](11-3d-and-parallax/scene-05-iphone-device-gesture/) |
| 24-cell technique showcase grid | [`12-combined-vignettes/scene-01-techniques-grid/`](12-combined-vignettes/scene-01-techniques-grid/) |
| Binary rain + centered terminal boot sequence | [`12-combined-vignettes/scene-02-binary-rain-boot/`](12-combined-vignettes/scene-02-binary-rain-boot/) |
| **6-technique product-launch beat** (stroke-draw logo + kinetic headline + counter + marker + particles + breathing) | [`12-combined-vignettes/scene-03-product-launch-beat/`](12-combined-vignettes/scene-03-product-launch-beat/) |
| BAD EXAMPLE: slideshow trap | [`13-anti-patterns/scene-01-slideshow-trap/`](13-anti-patterns/scene-01-slideshow-trap/) |
| BAD EXAMPLE: static after entrance | [`13-anti-patterns/scene-02-static-after-entrance/`](13-anti-patterns/scene-02-static-after-entrance/) |
| BAD EXAMPLE: power2.out everywhere | [`13-anti-patterns/scene-03-power2-everywhere/`](13-anti-patterns/scene-03-power2-everywhere/) |
| BAD EXAMPLE: screenshot + Ken Burns | [`13-anti-patterns/scene-04-screenshot-ken-burns/`](13-anti-patterns/scene-04-screenshot-ken-burns/) |

---

## Shared assets

- [`_shared/hyper-shader-local.js`](_shared/hyper-shader-local.js) — local shader build (copied from `packages/shader-transitions/dist/index.global.js`). Scenes in `05-transitions-shader/` and `12-combined-vignettes/` import this.
- [`_shared/shared-styles.css`](_shared/shared-styles.css) — design tokens (color palette, type scale, spacing). Every scene `<link>`s this so the catalog feels cohesive.
- [`_shared/easing-glossary.md`](_shared/easing-glossary.md) — the 7 production easings and when to use each. Single source of truth.

## Stitched Grand Tour reel

All 57 scenes concatenated back-to-back as a single 6:26 MP4. Useful for visual-gestalt review or for sharing the library at a glance:

- **Grand Tour reel:** https://www.heygenverse.com/s/b9cdfa1b-6fbd-45a1-b71f-7183edc9bd61/raw
- **Browsable gallery (per-section grid, all 57 scenes as embedded videos):** https://www.heygenverse.com/a/1636f2fe-3ddc-4543-9a56-0d0b99538807

Rebuild the reel after adding scenes: `ffmpeg -f concat -safe 0 -i /tmp/concat-list.txt -c copy out.mp4` where the concat list orders all scene MP4s in section sequence.

---

## Authoring conventions (read before adding a scene)

Every scene in this library follows these rules. They exist so agents reading the library see consistent patterns, not random codebases.

1. **Standalone HTML5 document** per scene at `<section>/scene-NN-name/index.html`. Each scene is independently renderable via `npx tsx packages/cli/src/cli.ts render <scene-dir>`. Skeleton:
   ```html
   <!doctype html>
   <html lang="en">
   <head>
     <meta charset="UTF-8" />
     <title>scene-NN-name</title>
     <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
     <style>/* scoped to this scene */</style>
   </head>
   <body>
     <div id="scene-NN-name"
          data-composition-id="scene-NN-name"
          data-start="0"
          data-duration="<seconds>"
          data-width="1920"
          data-height="1080">
       <!-- scene markup -->
       <div class="scene-label">Section NN · &lt;Scene name&gt; · &lt;Technique&gt;</div>
     </div>
     <script>
       (function () {
         var BEAT = <duration-in-seconds>;
         window.__timelines = window.__timelines || {};
         var tl = gsap.timeline({ paused: true });
         // ... build timeline
         window.__timelines["scene-NN-name"] = tl;
       })();
     </script>
   </body>
   </html>
   ```

2. **`data-composition-id` matches the directory name** (which matches the scene id). e.g. directory `scene-01-soft-blur-in/` → id `scene-01-soft-blur-in`.

3. **`.scene-label`** at bottom-left of every scene shows what technique is being demonstrated. Lets viewers of the stitched reel know what they're looking at without playing detective.

4. **`tl.fromTo()` not `tl.from()`** for entrances. Avoids the "CSS opacity:0 + gsap.from(opacity:0)" 0→0 trap.

5. **Continuous motion** — no element stays unchanged for more than ~1.5s. If a beat is 8s, schedule 5-8 events spread across the duration, not 5 events crammed into the first second.

6. **Easing variety** — minimum 3 different easings per scene. See `_shared/easing-glossary.md`.

7. **Determinism** — no `Math.random()`, `Date.now()`, `requestAnimationFrame`, or `repeat: -1`. Seed any "random" particles via a fixed array of values.

8. **Lint clean** — every scene must pass `npx hyperframes lint .` with 0 errors before being committed.

9. **Snapshot verified** — every scene's 5-frame snapshot must show CHANGE between frames (not entrance + 4 identical hold frames).

10. **Comments** — one comment per timeline section explaining WHY that timing was picked. Not WHAT it does (the code shows that). e.g. `// 1.2s: settle with elastic — gives the counter time to "land" before the next stat enters`.
