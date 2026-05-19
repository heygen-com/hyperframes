---
id: problem-mockup-overwhelm
role: problem
duration_seconds: [4, 6]
phases: 4
visual_arc: mockups-appear → icons-scatter → morph-to-avatar → bubbles-overwhelm
uses_rules: [card-morph-anchor]
element_roles:
  mockups: 3 product / platform mockups establishing the familiar context
  icons: Platform / social icons scattered around mockups for density
  morph_container: Center mockup that scales down + crossfades into the avatar
  avatar: Character that represents the viewer / user
  bubbles: Task / problem text bubbles surrounding the avatar
when_to_use:
  - Frame a problem by showing familiar complexity (too many platforms / tasks)
  - Transition from "tools" to "person" — products → user experience
  - Problem should feel physically overwhelming (surrounded by tasks)
when_not_to_use:
  - Problem is abstract, can't be shown with mockups
  - No character / avatar representation needed
  - Scene should stay product-focused
triggers: [too many platforms, overwhelmed creator, complex workflow, surrounded by tasks]
---

# Problem · Mockup Overwhelm (HyperFrames)

Product mockups appear → platform icons scatter → center mockup scales down and crossfades into the avatar → task bubbles surround and overwhelm.

<!--
  Choreography (4 phases, 6 seconds total) — derived from HTML TIMING constants:
    0.08 – 1.28s   Three HyperFrames workflow mockups spring-in (center → left → right)
                   (mockupCenterAt 0.08 → mockupLeftAt 0.20 + mockupFanDur 1.08)
    0.33 – 0.78s   Nine scattered HyperFrames tool icons stagger in around the cluster
                   (iconsAt 0.33 + iconEntryDur 0.45; stagger tail extends to ~1.34s)
    3.20 – 3.80s   MORPH:
                     center mockup compositor-scale down to the avatar footprint
                     borderRadius repaint (42px → 50% = reads as circle)
                     content fades out at 0-40% of morph
                     non-center mockups + icons exit concurrently
                     avatar pop (scale 0 → 1) starts at morph trigger
                     avatar layer opacity fades in at 50% of morph
                     at 85-100% of morph, mockup-center fades to 0 → avatar visible underneath
    3.53 – 4.47s   Eight task bubbles stagger-enter in a radial pattern around the avatar
                   (bubblesAt 3.53 + (8-1)*bubbleStagger 0.07 + bubbleDur 0.45)
    4.47 – 6.00s   Idle: bubble micro-float + avatar orbit dots + avatar breath
-->

This blueprint is the HyperFrames port of the Remotion `mockup-morph-overwhelm` choreography. The visual arc is identical; the implementation runs on a single paused GSAP timeline driven by HyperFrames' seek loop. Because HyperFrames forbids tweening `width` / `height` (they cause layout reflows), the center mockup's "shape morph" is rendered as **uniform `scale` + `borderRadius` repaint + opacity hand-off to the real avatar underneath** — visually indistinguishable from a width/height interpolation, but allowlist-clean.

## When to Use

- Problem-framing scene showing "too many tools / too complex"
- Need narrative shift from product view to user view
- The reveal of "overwhelm" should build progressively

## Phase Pipeline

All phase boundaries are expressed in **seconds**, not frames. HyperFrames operates on continuous time; GSAP tween `duration` and `start` carry the choreography.

| Phase | Time window (s)                | What Happens                                                                       | Skill Reference                                             |
| ----- | ------------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1     | `0 – ICONS_APPEAR`             | 3 stacked mockups spring-in with subtle floating                                   | inline entry + [sine-wave-loop](../rules/sine-wave-loop.md) |
| 2     | `ICONS_APPEAR – MORPH_TRIGGER` | Platform icons pop in around mockups (staggered)                                   | [svg-icon-enrichment](../rules/svg-icon-enrichment.md)      |
| 3     | `MORPH_TRIGGER – +MORPH_DUR`   | Center mockup scales down + borderRadius rounds + fades; avatar reveals underneath | [card-morph-anchor](../rules/card-morph-anchor.md)          |
| 4     | `BUBBLES_START – end`          | Task bubbles enter in radial pattern around avatar                                 | inline staggered entry                                      |

## Layout

In Remotion, the source uses `{showMockups && <MockupCluster />}` / `{showAvatar && <AvatarWithBubbles />}` for conditional rendering. **HyperFrames must keep both layers in the DOM** (seek can move time backward or forward arbitrarily); opacity tweens drive visibility instead.

```html
<div
  id="root"
  data-composition-id="main"
  data-start="0"
  data-duration="6"
  data-width="1920"
  data-height="1080"
  style="position: relative; width: 1920px; height: 1080px; overflow: hidden;"
>
  <!-- Background -->
  <div class="bg" style="position: absolute; inset: 0;"><!-- gradient / blobs --></div>

  <!-- Phase 1-2: Mockup cluster + scattered icons (visible 0 → MORPH_TRIGGER + 0.4s) -->
  <div class="mockup-cluster" style="position: absolute; inset: 0;">
    <div class="mockup-left" style="position: absolute; left: 12%;  top: 50%; z-index: 10;">
      <!-- left app mockup content -->
    </div>
    <div class="mockup-right" style="position: absolute; right: 12%; top: 45%; z-index: 12;">
      <!-- right app mockup content -->
    </div>
    <div
      class="mockup-center"
      style="position: absolute; left: 50%; top: 50%; z-index: 25;
                                       width: 300px; height: 540px; border-radius: 28px;
                                       overflow: hidden;"
    >
      <div class="mockup-center-content"><!-- TikTok-style content --></div>
    </div>

    <!-- Platform icons (positions pre-baked via CSS variables or inline left/top) -->
    <div class="platform-icon" style="position: absolute; left: 22%; top: 20%; z-index: 30;">
      <img src="./assets/icons/youtube.svg" />
    </div>
    <!-- ...more .platform-icon elements... -->
  </div>

  <!-- Phase 3-4: Avatar + bubbles (rendered from start, opacity: 0 until morph hands off) -->
  <div class="avatar-with-bubbles" style="position: absolute; inset: 0; opacity: 0;">
    <div
      class="avatar"
      style="position: absolute; left: 50%; top: 50%; z-index: 20;
                                width: 220px; height: 220px; border-radius: 50%;
                                overflow: hidden;"
    >
      <video
        src="./assets/avatar.mp4"
        muted
        playsinline
        style="width: 100%; height: 100%; object-fit: cover;"
      ></video>
    </div>
    <!-- task bubbles are appended by the setup script (see below) -->
  </div>

  <!-- Vignette overlay -->
  <div class="vignette" style="position: absolute; inset: 0; pointer-events: none;"></div>
</div>
```

The morph container (`.mockup-center`) sits **above** the avatar (`z-index: 25 > z-index: 20`). The avatar becomes visible the moment `.mockup-center` opacity reaches 0.

## Mockup Cluster Initial State

Three mockups: center (largest, highest z-index, intrinsic size matches `MOCKUP_W × MOCKUP_H`), left and right (smaller, slightly rotated, lower z-index). Static `rotation` and `scale` go through GSAP `set()` rather than CSS `transform:`, because GSAP owns the transform once it touches the element.

```js
// Composition constants
const COMP_W = 1920;
const COMP_H = 1080;

const MOCKUP_W = 300; // px — center mockup intrinsic width
const MOCKUP_H = 540; // px — center mockup intrinsic height
const AVATAR_SIZE = 220; // px — final avatar diameter
const MORPH_END_SCALE = AVATAR_SIZE / MOCKUP_W; // ≈ 0.73 — uniform scale at morph end

// Initial states (set once at script load — GSAP owns the transform from now on)
gsap.set(".mockup-left", { xPercent: 0, yPercent: -50, rotation: -1, scale: 0.93, opacity: 0 });
gsap.set(".mockup-right", { xPercent: 0, yPercent: -50, rotation: 1, scale: 0.93, opacity: 0 });
gsap.set(".mockup-center", { xPercent: -50, yPercent: -50, scale: 1, opacity: 0 });
gsap.set(".platform-icon", { scale: 0, opacity: 0 });
```

## Phase 1: Mockups Appear

Three near-simultaneous spring-in entries with small inter-element delays. The "subtle floating" component is a finite `sine.inOut` yoyo (see [sine-wave-loop](../rules/sine-wave-loop.md)) — **not** a frame-driven `Math.sin(frame * ...)` like in the Remotion source.

```js
const MOCKUPS_APPEAR = 0.0; // s
// spring(stiffness:70, damping:14) → back.out(1.4) is close enough for 0.5s tweens.

tl.to(
  ".mockup-left",
  { opacity: 1, scale: 0.93, duration: 0.55, ease: "back.out(1.4)" },
  MOCKUPS_APPEAR,
);
tl.to(
  ".mockup-right",
  { opacity: 1, scale: 0.93, duration: 0.55, ease: "back.out(1.4)" },
  MOCKUPS_APPEAR + 0.1,
);
tl.to(
  ".mockup-center",
  { opacity: 1, scale: 1, duration: 0.55, ease: "back.out(1.4)" },
  MOCKUPS_APPEAR + 0.2,
);
```

Floating idle (Phase 1 → all phases): see the [sine-wave-loop](../rules/sine-wave-loop.md) rule. Amplitude `±3px` translation, `±0.012` scale — anything larger reads as a glitch.

## Phase 2: Icons Scatter

Platform icons enter staggered. Each icon's `left`/`top` is **pre-baked into CSS** (deterministic positions); GSAP tweens only `scale` and `opacity`. This is critical: HyperFrames forbids tweening `left` / `top`.

```js
const ICONS_APPEAR = 0.33; // s — ≥ last mockup entry + 0.13s settle time

// stagger across all icons; spring(stiffness:180, damping:14) → back.out(1.6)
tl.to(
  ".platform-icon",
  {
    scale: 1,
    opacity: 1,
    duration: 0.45,
    ease: "back.out(1.6)",
    stagger: { each: 0.07, from: "start" },
  },
  ICONS_APPEAR,
);
```

Per-icon subtle float (`±5px x`, `±4px y`) is a finite `sine.inOut` yoyo on each icon, started at `ICONS_APPEAR + 0.5`. For >6 icons, consolidate the float into a single `onUpdate` (see [svg-icon-enrichment § shared scene-ticker](../rules/svg-icon-enrichment.md#shared-scene-ticker-for-multiple-sine-motions)).

## Phase 3: Morph (Core Glue)

In the Remotion source, the morph tweens `width` (300 → 160), `height` (540 → 160), and `borderRadius` (28 → 80) in lockstep via `interpolate(morphProgress, ...)`. HyperFrames cannot tween `width` / `height` — they trigger layout reflows and are blocked by the allowlist.

**HyperFrames substitution**: tween `scale` (uniform, intrinsic dimensions stay fixed) + `borderRadius` (paint-only, allowed). The content fades during the first 40% of the morph, and at 85–100% the entire morph container fades to 0, revealing the real avatar circle rendered underneath. The viewer reads this exactly as "rect morphs to circle" — the hand-off is the trick.

```js
const MORPH_TRIGGER = 3.2; // s — icons have been visible for ~2.5s
const MORPH_DUR = 0.6; // s — full morph length
// spring(stiffness:80, damping:18) ≈ power3.out

// 1. Center mockup uniform scale-down toward avatar footprint.
//    MORPH_END_SCALE = 220/300 ≈ 0.73 — close enough to the 160-px target after the
//    final fade-out is finished (the avatar at scale 1 takes over the visual).
tl.to(
  ".mockup-center",
  {
    scale: MORPH_END_SCALE,
    duration: MORPH_DUR,
    ease: "power3.out",
  },
  MORPH_TRIGGER,
);

// 2. borderRadius repaints from card-corner to half-of-current-size in parallel.
//    Final value (~half the post-scale size) reads as a circle even before the fade.
tl.to(
  ".mockup-center",
  {
    borderRadius: (MOCKUP_W * MORPH_END_SCALE) / 2 + "px", // ≈ 110px → looks round
    duration: MORPH_DUR,
    ease: "power3.out",
  },
  MORPH_TRIGGER,
);

// 3. Content fades out during first 40% of morph — hides the rectangular layout
//    before its aspect-ratio mismatch becomes visible.
tl.to(
  ".mockup-center-content",
  {
    opacity: 0,
    duration: MORPH_DUR * 0.4,
    ease: "power2.out",
  },
  MORPH_TRIGGER,
);

// 4. At 85–100% of morph, the entire morph container fades out → avatar takes over.
tl.to(
  ".mockup-center",
  {
    opacity: 0,
    duration: MORPH_DUR * 0.15,
    ease: "none",
  },
  MORPH_TRIGGER + MORPH_DUR * 0.85,
);

// 5. Concurrent exits — non-center mockups + icons must exit during the morph,
//    not before (would feel premature) or after (would feel detached).
tl.to(
  [".mockup-left", ".mockup-right"],
  {
    opacity: 0,
    scale: 0.85,
    duration: MORPH_DUR * 0.55,
    ease: "power2.out",
  },
  MORPH_TRIGGER,
);

tl.to(
  ".platform-icon",
  {
    opacity: 0,
    scale: 0.85,
    duration: MORPH_DUR * 0.5,
    ease: "power2.out",
    stagger: { each: 0.02, from: "edges" },
  },
  MORPH_TRIGGER,
);

// 6. Avatar layer fades in concurrently. Avatar entry pop (scale 0 → 1) starts at
//    MORPH_TRIGGER so it's already at full scale by the time the morph container
//    fades to 0 at MORPH_TRIGGER + 0.85 * MORPH_DUR.
tl.to(
  ".avatar-with-bubbles",
  {
    opacity: 1,
    duration: 0.3,
    ease: "power2.out",
  },
  MORPH_TRIGGER + MORPH_DUR * 0.5,
);

tl.fromTo(
  ".avatar",
  { scale: 0 },
  { scale: 1, duration: 0.55, ease: "back.out(1.4)" }, // spring(stiffness:120, damping:14)
  MORPH_TRIGGER,
);
```

Why this works visually: at the moment the morph container reaches `opacity: 0`, both objects (morph + avatar) occupy the same screen footprint at the same center coordinates. The viewer's eye doesn't register a swap — it registers a continuous morph. See [card-morph-anchor](../rules/card-morph-anchor.md) for the standalone rule on this hand-off pattern.

## Phase 4: Overwhelm Bubbles

Task bubbles enter in radial positions around the avatar. In the Remotion source, JSX iterates over `POSITIONS` and renders `<TaskBubble />` components. In HyperFrames, the DOM is **generated once at script load** (deterministic, position-pre-baked), then GSAP tweens scale + opacity for staggered entry.

```js
// Bubble positions — pre-baked, deterministic.
const BUBBLE_TASKS = [
  { label: "Edit hours of raw footage", angle: 270 }, // top
  { label: "Add captions manually", angle: 315 }, // top-right
  { label: "Create thumbnails", angle: 0 }, // right
  { label: "Optimize per platform", angle: 45 }, // bottom-right
  { label: "Reframe for vertical", angle: 90 }, // bottom
  { label: "Find viral moments", angle: 135 }, // bottom-left
  { label: "Post to 7+ platforms", angle: 180 }, // left
  { label: "Track analytics everywhere", angle: 225 }, // top-left
];

const BUBBLE_CENTER_X = COMP_W / 2; // 960 — matches avatar center
const BUBBLE_CENTER_Y = COMP_H / 2; // 540
const BUBBLE_RADIUS = 380; // px — distance from avatar center

const stage = document.querySelector(".avatar-with-bubbles");
BUBBLE_TASKS.forEach((task, i) => {
  const rad = (task.angle * Math.PI) / 180;
  const x = BUBBLE_CENTER_X + Math.cos(rad) * BUBBLE_RADIUS;
  const y = BUBBLE_CENTER_Y + Math.sin(rad) * BUBBLE_RADIUS;

  const el = document.createElement("div");
  el.className = "task-bubble";
  el.textContent = task.label;
  el.style.cssText = `
    position: absolute;
    left: ${x}px;
    top: ${y}px;
    z-index: 30;
    /* visual styling — high contrast against dark scene */
    background: rgba(255, 255, 255, 0.95);
    border: 3px solid rgba(139, 92, 246, 0.5);
    border-radius: 24px;
    padding: 20px 32px;
    box-shadow: 0 12px 35px rgba(139, 92, 246, 0.3);
    font: 600 24px/1.4 Inter, sans-serif;
    color: #1f2937;
    white-space: nowrap;
  `;
  stage.appendChild(el);

  // GSAP-owned centering + initial hidden state.
  gsap.set(el, { xPercent: -50, yPercent: -50, scale: 0, opacity: 0 });
});

// Staggered entry. spring(stiffness:180, damping:12) → back.out(1.4).
const BUBBLES_START = MORPH_TRIGGER + MORPH_DUR * 0.55; // ≈ 3.53 s

tl.to(
  ".task-bubble",
  {
    scale: 1,
    opacity: 0.95,
    duration: 0.45,
    ease: "back.out(1.4)",
    stagger: { each: 0.07, from: "start" },
  },
  BUBBLES_START,
);
```

Bubble micro-motion (`±5px x`, `±4px y` floating) is a finite `sine.inOut` yoyo per bubble, started at `BUBBLES_START + 0.5`. For 8 bubbles, prefer the shared `onUpdate` form in [svg-icon-enrichment](../rules/svg-icon-enrichment.md#shared-scene-ticker-for-multiple-sine-motions) — eight independent yoyo tweens are wasteful.

## Inter-Phase State Handoff

```
Phase 1 → Phase 2:
  Mockups settled before icons appear.
  ICONS_APPEAR ≥ last mockup entry (MOCKUPS_APPEAR + 0.20) + ~0.13s settle ≈ 0.33s.

Phase 2 → Phase 3:
  Icons must be visible for at least ~1s before morph fires, so the viewer
  registers the platform density before it dissolves.
  MORPH_TRIGGER ≥ ICONS_APPEAR + 0.45 (entry) + stagger total + ~1.0s read time.

Phase 3 → Phase 4:
  Avatar layer opacity reaches 1 at MORPH_TRIGGER + 0.5 * MORPH_DUR.
  Avatar pop (scale 0→1) starts at MORPH_TRIGGER and finishes ~0.55s later —
  fully scaled-up by the time the morph container fades to 0 (at 85% of MORPH_DUR).
  BUBBLES_START ≥ MORPH_TRIGGER + 0.55 * MORPH_DUR  (≈ 0.33s after morph trigger).
```

## Critical Constraints

- **Single paused GSAP timeline**: One `gsap.timeline({ paused: true })` per composition, registered to `window.__timelines["problem-mockup-overwhelm"]`. HyperFrames seeks it. Don't fork into multiple timelines.
- **DOM-permanent layers**: Both the mockup cluster and the avatar-with-bubbles layer stay in the DOM the entire scene. Seek can move time backward — conditional rendering would create flicker. Use `opacity` to gate visibility, not React conditionals.
- **No `width` / `height` / `left` / `top` tweens**: Forbidden by the HyperFrames animated-property allowlist (they trigger layout reflows). The morph uses `scale` + `borderRadius` instead.
- **`borderRadius` tween is OK**: Paint-only, no reflow. GSAP can tween it as a CSS property with a unit string.
- **Morph z-index > avatar z-index**: `.mockup-center` at z:25, `.avatar` at z:20. The avatar becomes visible only when the morph fades to 0 — preserves the "single morphing object" illusion.
- **Concurrent exits, not sequential**: Non-center mockups and platform icons exit _during_ the morph (same trigger, ~50% of morph duration). Exiting before feels premature; exiting after feels detached from the morph.
- **6-8 bubbles maximum**: More creates unreadable clutter; fewer doesn't convey "overwhelming". The radial pattern needs visual closure.
- **Bubble text concise**: 3-6 words each. These are labels, not sentences. Long text breaks the radial composition.
- **Avatar needs micro-motion**: A static avatar in the middle of moving bubbles reads as a placeholder. Use a `<video muted playsinline>` source, or add orbiting dots / breathing scale via a finite yoyo. See [sine-wave-loop](../rules/sine-wave-loop.md) form 2 for the multiplicative-breath pattern when the avatar already has a pop scale.
- **Pre-baked positions**: Bubble `left` / `top` and icon `left` / `top` are computed once at script load and written as CSS. GSAP tweens only `scale` / `opacity` / `x` / `y`. Never call `getBoundingClientRect()` at tween time.
- **No infinite repeats**: All breathing / floating yoyos use a computed finite `repeat` derived from `data-duration`. `repeat: -1` is forbidden.
- **No nondeterministic state**: No `Math.random()`, no `Date.now()`, no `performance.now()`. All bubble positions, icon positions, and stagger orders are pure functions of the script's constants.
- **`data-duration` on the root governs render length**, not the GSAP timeline's intrinsic length. If you author 6 seconds of motion but want a 4-second render, set `data-duration="4"`.

## Remotion → HyperFrames Mapping (this blueprint)

| Source pattern (`scene-02-mockup-morph-overwhelm.tsx`)                      | HyperFrames equivalent                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `frame = useCurrentFrame()`                                                 | Implicit — GSAP timeline carries time                                     |
| `useVideoConfig().fps`                                                      | Not needed; everything is in seconds                                      |
| `useVideoConfig().width / height`                                           | `COMP_W` / `COMP_H` constants matching `data-width` / `data-height`       |
| `toFrame(5.3)` (relative-to-scene frame)                                    | `5.3` (seconds, relative to composition start)                            |
| `spring({ frame: frame-delay, fps, config: { stiffness:70, damping:14 } })` | `ease: "back.out(1.4)"`, `duration: 0.55`                                 |
| `spring({ stiffness:80, damping:18 })` (morph driver)                       | `ease: "power3.out"`, `duration: MORPH_DUR`                               |
| `spring({ stiffness:120, damping:14 })` (avatar pop)                        | `ease: "back.out(1.4)"`, `duration: 0.55`                                 |
| `spring({ stiffness:180, damping:12 })` (bubble pop)                        | `ease: "back.out(1.4)"`, `duration: 0.45`                                 |
| `interpolate(morphProgress, [0,1], [300, 160])` (`width`)                   | `scale: 160/300` tween                                                    |
| `interpolate(morphProgress, [0,1], [540, 160])` (`height`)                  | covered by uniform `scale` + content fade-out                             |
| `interpolate(morphProgress, [0,1], [28, 80])` (`borderRadius`)              | `borderRadius: (MOCKUP_W * scale / 2) + "px"` tween                       |
| `interpolate(morphProgress, [0,0.4], [1,0])` (content opacity)              | `duration: MORPH_DUR * 0.4` opacity tween                                 |
| `interpolate(morphProgress, [0.85,1], [1,0])` (final fade)                  | tween at `MORPH_TRIGGER + 0.85 * MORPH_DUR`, `duration: 0.15 * MORPH_DUR` |
| `Math.sin((frame + i*30) * 0.025) * 5` (icon float)                         | Per-icon finite `sine.inOut` yoyo, or shared `onUpdate`                   |
| `frame < TIMING.avatarAppear + 10` (showMockups gate)                       | Opacity tween — both layers stay in DOM                                   |
| `<AbsoluteFill>`                                                            | `<div style="position: absolute; inset: 0;">`                             |
| `<OffthreadVideo src={staticFile(...)} volume={0}>`                         | `<video src="./assets/avatar.mp4" muted playsinline>`                     |
| `<Img src={staticFile(ICONS.youtube)}>`                                     | `<img src="./assets/icons/youtube.svg">`                                  |
| `POSITIONS.map(...)` JSX                                                    | `forEach` that builds DOM at script load                                  |

## Golden Sample

- [problem-mockup-overwhelm.html](../examples/problem-mockup-overwhelm.html) — YouTube Studio / TikTok Creator / Instagram Reels mockups, nine scattered platform icons (Google, Twitter, LinkedIn, Yelp, TripAdvisor, Facebook…), morph center TikTok card → cyan-teal-blue avatar circle, eight task bubbles ("Edit hours of raw footage", "Reframe for vertical", "Post to 7+ platforms"…) overwhelm the avatar. Single paused GSAP timeline; one shared scene-ticker `onUpdate` drives mockup floating, orbit dots, avatar breath, and bubble micro-float. 6 seconds.
