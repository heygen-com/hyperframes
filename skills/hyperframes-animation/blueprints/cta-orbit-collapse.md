---
id: cta-orbit-collapse
role: cta
duration_seconds: [5, 8]
phases: 5
visual_arc: icons-orbit → cursor-click → collapse → demo-appears → demo-floats
uses_rules: [orbit-3d-entry, cursor-click-ripple, center-outward-expansion, sine-wave-loop]
element_roles:
  orbit_icons: 3D-entry icons representing categories / use-cases, orbiting the centerpiece
  center_cta: Central CTA element (input bar, button) that receives the click
  cursor: Animated cursor that moves to the CTA and clicks with ripple feedback
  demo: Product demo (video / image) that appears from the collapse point and floats
when_to_use:
  - Show product versatility (works for many categories / use-cases)
  - Icons represent different content types, genres or modes
  - User-click metaphor triggers transformation from categories → result
  - "Many options → one action → one result" narrative compression
when_not_to_use:
  - Categories have no distinct iconography (use a text list)
  - No user-action metaphor — product works automatically
  - Scene is purely informational
triggers: [works for any genre, multiple categories, click to generate, versatile tool, one click result]
---

# CTA · Orbit Collapse (HyperFrames)

Category icons enter with a 3D flip → orbit a central CTA → cursor moves to CTA and clicks → icons collapse inward toward the click point → product demo springs out from the collapse point → demo floats on a breathing idle.

This blueprint is the HyperFrames port of the Remotion `orbit-collapse-action` choreography. Same five-phase arc; one paused GSAP timeline; constituent patterns map to [orbit-3d-entry](../rules/orbit-3d-entry.md), [cursor-click-ripple](../rules/cursor-click-ripple.md), [center-outward-expansion](../rules/center-outward-expansion.md) (reversed), and [sine-wave-loop](../rules/sine-wave-loop.md) Form 1.

> The original Remotion blueprint expressed the orbit as `effectiveFrame * orbitSpeed` and the collapse as a `spring(stiffness:150, damping:15)`. HyperFrames forbids per-frame conditionals on `frame`, so both motions are folded into a single master `onUpdate` that reads `tl.time()` and an eased collapse proxy. The visual result is identical.

## When to Use

- Versatility / use-case scene showing the product handles many categories
- The transformation from "options" to "result" should feel **physical** — a click pulls the icons inward
- A cursor click drives the narrative pivot (versus a fade or zoom)
- Total duration 5–8 seconds (any shorter and the orbit doesn't register as ambient motion)

## Phase Pipeline

All boundaries are in **seconds** (at 30 fps; multiply by 30 to recover frames). The example below targets a 6.5 s scene.

| Phase | Time window (s) | What Happens                                                    | Skill Reference                                                             |
| ----- | --------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1     | `0 – 1.05`      | Icons enter with 3D flip, staggered; orbit motion runs from t=0 | [orbit-3d-entry](../rules/orbit-3d-entry.md)                                |
| 2     | `1.50 – 2.20`   | Cursor enters off-screen, moves to CTA, clicks with ripple      | [cursor-click-ripple](../rules/cursor-click-ripple.md)                      |
| 3     | `2.20 – 3.05`   | Icons collapse toward the click point; CTA pulses               | [center-outward-expansion](../rules/center-outward-expansion.md) (reversed) |
| 4     | `2.95 – 3.75`   | Product demo springs out of the collapse point                  | inline                                                                      |
| 5     | `3.95 – 6.50`   | Demo floats with a breathing yoyo                               | [sine-wave-loop](../rules/sine-wave-loop.md) Form 1                         |

Phase 3 and Phase 4 **overlap by ~0.10 s** — the demo entry begins just before the collapse fully completes, so the click reads as energy transfer rather than two separate moments.

## Layout

Each icon uses **three nested wrappers** so the orbit position, the collapse scale/opacity, and the 3D entry rotation each tween on their own element and never overwrite each other:

```
.icon-pos        ← outermost — gets x/y from the master onUpdate (orbit + collapse)
  .icon-collapse ← middle    — gets scale/opacity from the master onUpdate (collapse only)
    .icon-entry  ← innermost — gets rotateX/rotateY/scale/opacity from the entry tween
      <svg>...</svg>
```

`perspective` is applied to `.icon-pos` so the inner 3D rotation has depth. The orbit's elliptical radii (`RADIUS_X`, `RADIUS_Y`) are baked into the `onUpdate` math, not into per-icon CSS.

```html
<div class="stage" style="position: absolute; inset: 0; overflow: hidden;">
  <div class="bg"></div>

  <!-- Orbit ring — six icons spaced evenly around 2π -->
  <div class="orbit-stage" style="position: absolute; inset: 0;">
    <div class="icon-pos icon-music" style="perspective: 800px;">
      <div class="icon-collapse">
        <div class="icon-entry"><svg class="icon-svg">…</svg></div>
      </div>
    </div>
    <div class="icon-pos icon-gaming" style="perspective: 800px;">
      <div class="icon-collapse">
        <div class="icon-entry"><svg class="icon-svg">…</svg></div>
      </div>
    </div>
    <div class="icon-pos icon-education" style="perspective: 800px;">
      <div class="icon-collapse">
        <div class="icon-entry"><svg class="icon-svg">…</svg></div>
      </div>
    </div>
    <div class="icon-pos icon-sports" style="perspective: 800px;">
      <div class="icon-collapse">
        <div class="icon-entry"><svg class="icon-svg">…</svg></div>
      </div>
    </div>
    <div class="icon-pos icon-vlog" style="perspective: 800px;">
      <div class="icon-collapse">
        <div class="icon-entry"><svg class="icon-svg">…</svg></div>
      </div>
    </div>
    <div class="icon-pos icon-podcast" style="perspective: 800px;">
      <div class="icon-collapse">
        <div class="icon-entry"><svg class="icon-svg">…</svg></div>
      </div>
    </div>
  </div>

  <!-- Center CTA — fixed at viewport center; click target lives here -->
  <div
    class="cta"
    style="position: absolute; left: 50%; top: 50%;
       transform: translate(-50%, -50%); z-index: 5;"
  >
    <!-- CTA button / input bar -->
  </div>

  <!-- Ripple ring(s) — render from CTA center on click -->
  <div
    class="ripple"
    style="position: absolute; left: 50%; top: 50%;
       width: 120px; height: 120px; margin: -60px 0 0 -60px;
       border: 2px solid rgba(255,255,255,0.7); border-radius: 50%;
       opacity: 0; pointer-events: none; z-index: 6;"
  ></div>

  <!-- Cursor — sits above everything during move + click -->
  <div
    class="cursor"
    style="position: absolute; left: 0; top: 0;
       z-index: 999; pointer-events: none; opacity: 0;"
  >
    <svg width="28" height="28" viewBox="0 0 24 24">
      <path d="M5 3L19 12L12 13L9 20L5 3Z" fill="#fff" stroke="#0A0A0F" stroke-width="1.5" />
    </svg>
  </div>

  <!-- Demo — sits at viewport center, scaled to 0 until Phase 4 -->
  <div
    class="demo"
    style="position: absolute; left: 50%; top: 50%;
       width: 720px; height: 405px; margin: -202.5px 0 0 -360px;
       transform: scale(0); opacity: 0; z-index: 10;
       border-radius: 16px; overflow: hidden; background: #111;"
  >
    <!-- video / image -->
  </div>
</div>
```

CSS sets the CTA, ripple and demo at viewport center via `left/top + margin` (or `transform: translate(-50%,-50%)` on the CTA). GSAP only ever tweens transform aliases (`x`, `y`, `scale`, `rotation`, `opacity`) — never `left/top/width/height`.

## Constants

```js
const W = 1920,
  H = 1080;
const CENTER_X = W / 2; // 960
const CENTER_Y = H / 2; // 540

const RADIUS_X = 480; // elliptical horizontal radius
const RADIUS_Y = 280; // elliptical vertical radius (≈ 0.58 × X for perspective flattening)
const ORBIT_SPEED = 0.25; // radians per second — full revolution every ~25 s, slow ambient

// 6 icons distributed evenly around 2π
const ICONS = [
  { sel: ".icon-music", initialAngle: (0 * Math.PI) / 3, entryDelay: 0.0 },
  { sel: ".icon-gaming", initialAngle: (1 * Math.PI) / 3, entryDelay: 0.1 },
  { sel: ".icon-education", initialAngle: (2 * Math.PI) / 3, entryDelay: 0.2 },
  { sel: ".icon-sports", initialAngle: (3 * Math.PI) / 3, entryDelay: 0.3 },
  { sel: ".icon-vlog", initialAngle: (4 * Math.PI) / 3, entryDelay: 0.4 },
  { sel: ".icon-podcast", initialAngle: (5 * Math.PI) / 3, entryDelay: 0.5 },
];

const ENTRY_DUR = 0.55; // per-icon 3D flip
const CURSOR_AT = 1.5; // cursor fades in and starts moving
const CURSOR_MOVE = 0.5; // duration of the cursor move
const CLICK_AT = 2.2; // click instant — collapse pivot
const COLLAPSE_DUR = 0.85;
const DEMO_AT = 2.95; // overlaps collapse by 0.10 s for energy transfer
const DEMO_DUR = 0.8;
const IDLE_START = 3.95; // after the demo spring tail dissipates
const TOTAL = 6.5; // matches data-duration on the composition root
```

## Phase 1: 3D Flip Entry + Orbit (Core Glue, Part A)

Each icon enters with a single `tl.fromTo` on `.icon-entry` that performs the 3D flip. The orbit motion lives in a master `onUpdate` (see Phase 3) that writes `x` / `y` to `.icon-pos` every frame from t=0 onward, so internal motion is already running when each icon's `.icon-entry` becomes visible.

```js
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });

ICONS.forEach(({ sel, entryDelay }) => {
  tl.fromTo(
    `${sel} .icon-entry`,
    { rotateX: 90, rotateY: -45, z: -100, scale: 0, opacity: 0 },
    {
      rotateX: 0,
      rotateY: 0,
      z: 0,
      scale: 1,
      opacity: 1,
      duration: ENTRY_DUR,
      ease: "back.out(1.4)", // spring(stiffness:120, damping:14)
    },
    entryDelay,
  );
});
```

### Why `back.out(1.4)` and not a stiffer ease

The Remotion source uses `stiffness: 100–120, damping: 14` for icon entry — a mild overshoot. Per the SKILL.md mapping, that lands at `back.out(1.4)`. Keep it gentle here — the icons should _arrive_, not _snap into place_. The collapse spring in Phase 3 is the snappier one.

### Internal SVG enrichment

Each icon's internal motion (clock hand, music notes bouncing, controller buttons pulsing) runs on its own finite yoyo from t=0 via the [svg-icon-enrichment](../rules/svg-icon-enrichment.md) pattern. Do **not** gate the enrichment behind the entry delay — the user should see a living icon appear, not a static icon that starts moving on landing.

## Phase 2: Cursor + Click + Ripple

The cursor enters off-screen-right, slides to the CTA centroid, depresses on click, and recovers. The CTA depresses concurrently for physical feedback. One ripple ring expands from the click point.

```js
const CURSOR_START_X = W + 100; // off-screen right
const CURSOR_START_Y = H * 0.85; // bottom-right approach
const CURSOR_TARGET_X = CENTER_X + 60; // slightly past CTA center so the click reads
const CURSOR_TARGET_Y = CENTER_Y;

gsap.set(".cursor", { x: CURSOR_START_X, y: CURSOR_START_Y, opacity: 0 });

// (a) Fade in
tl.to(".cursor", { opacity: 1, duration: 0.1, ease: "none" }, CURSOR_AT);

// (b) Move to CTA
tl.to(
  ".cursor",
  {
    x: CURSOR_TARGET_X,
    y: CURSOR_TARGET_Y,
    duration: CURSOR_MOVE,
    ease: "back.out(1.3)", // spring(stiffness:80, damping:18) — calm settle
  },
  CURSOR_AT,
);

// (c) Click depression — cursor + CTA both compress, then recover
tl.to(".cursor", { scale: 0.85, duration: 0.08, ease: "power2.out" }, CLICK_AT);
tl.to(".cursor", { scale: 1, duration: 0.18, ease: "back.out(1.6)" }, CLICK_AT + 0.08);

tl.to(".cta", { scale: 0.95, duration: 0.08, ease: "power2.out" }, CLICK_AT);
tl.to(".cta", { scale: 1, duration: 0.18, ease: "back.out(1.6)" }, CLICK_AT + 0.08);

// (d) Ripple — single ring expands and fades. Keyframes give the 0 → 0.7 → 0 opacity envelope.
tl.to(
  ".ripple",
  {
    duration: 0.7,
    keyframes: {
      "0%": { scale: 0.3, opacity: 0 },
      "20%": { opacity: 0.7 },
      "100%": { scale: 5.0, opacity: 0 },
      easeEach: "power2.out",
    },
  },
  CLICK_AT,
);
```

For multiple staggered rings, repeat the ripple tween at `CLICK_AT + 0.05` and `CLICK_AT + 0.10` on `.ripple-2` / `.ripple-3` elements. One ring usually reads enough.

## Phase 3: Collapse (Core Glue, Part B)

This is the single most important tween in the blueprint. **The orbit must keep advancing while the radius shrinks** — otherwise the icons "snap" inward in a way that doesn't read as collapse. So orbit angle and collapse radius are computed in the _same_ `onUpdate` that runs continuously from t=0 to the end of Phase 3.

```js
// Pre-compute the spring-like ease curve so we can call it as a pure function inside onUpdate.
const COLLAPSE_EASE = gsap.parseEase("back.out(1.6)"); // spring(stiffness:150, damping:15)
const ORBIT_END = DEMO_AT; // stop the engine once icons are gone

// Master orbit + collapse engine — single onUpdate writes x/y/scale/opacity for all icons.
tl.to(
  { tick: 0 },
  {
    tick: 1, // unused; this is just a clock
    duration: ORBIT_END, // covers Phase 1 + Phase 3
    ease: "none",
    onUpdate: () => {
      const t = tl.time();
      const collapseLinear = Math.max(0, Math.min(1, (t - CLICK_AT) / COLLAPSE_DUR));
      const collapseEased = COLLAPSE_EASE(collapseLinear);
      const radiusFactor = 1 - collapseEased; // 1 → 0 over Phase 3
      const collapseScale = 1 - collapseEased * 0.5; // 1 → 0.5

      // Two-segment opacity envelope: 1 at 0, 0.5 at 0.8, 0 at 1 — matches the Remotion source.
      const o = collapseEased;
      const collapseOpacity =
        o < 0.8
          ? 1 - o * 0.625 // 1 → 0.5 over [0, 0.8]
          : (0.5 * (1 - o)) / 0.2; // 0.5 → 0 over [0.8, 1]

      ICONS.forEach(({ sel, initialAngle, entryDelay }) => {
        const localT = Math.max(0, t - entryDelay); // local time since this icon entered
        const angle = initialAngle + localT * ORBIT_SPEED;
        const x = Math.cos(angle) * RADIUS_X * radiusFactor;
        const y = Math.sin(angle) * RADIUS_Y * radiusFactor;

        gsap.set(`${sel}.icon-pos`, { x, y });
        gsap.set(`${sel} .icon-collapse`, { scale: collapseScale, opacity: collapseOpacity });
      });
    },
  },
  0,
);
```

### Why one `onUpdate` and not per-icon tweens

[center-outward-expansion](../rules/center-outward-expansion.md) prefers per-element tweens for _static_ targets — GSAP batches them cheaply. Here the target itself is a function of two simultaneously evolving variables (orbit angle, collapse driver), so a single `onUpdate` that reads both and writes all icons is the simpler model. Six `gsap.set()` calls per frame are still very cheap; the compositor batches the resulting transform writes.

### Why `gsap.parseEase` instead of a proxy tween

A proxy tween (`tl.to(collapseProxy, { v: 1, ease: 'back.out(1.6)' })`) and `gsap.parseEase('back.out(1.6)')(progress)` produce _identical_ values for the same progress fraction. `parseEase` is preferred when the eased value is consumed inside another tween's `onUpdate` — one fewer engine tween, and the timing is anchored to `tl.time()` rather than to a sibling tween that could drift after seek.

## Phase 4: Demo Appears

The demo springs out of the collapse point with scale overshoot. It overlaps the tail of Phase 3 by ~0.10 s so the click reads as energy transferring into the demo.

```js
tl.fromTo(
  ".demo",
  { scale: 0, opacity: 0 },
  {
    scale: 1,
    opacity: 1,
    duration: DEMO_DUR,
    ease: "back.out(1.6)", // spring(stiffness:120, damping:14) — mild overshoot
  },
  DEMO_AT,
);

// Optional: short opacity attack so the demo isn't visible at scale 0
tl.fromTo(".demo", { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "none" }, DEMO_AT);
```

The demo's CSS `left: 50%; top: 50%; margin: …` anchors it to the same viewport-center point the icons collapsed toward. **This match must be exact** — the eye notices a 4 px misalignment between the collapse point and the demo entry point.

## Phase 5: Demo Floats (Breathing)

Form 1 from [sine-wave-loop](../rules/sine-wave-loop.md). Single yoyo tween with finite repeat — the simplest and cheapest idle.

```js
const HALF_CYCLE = 1.1; // half a breath cycle in seconds
const remaining = TOTAL - IDLE_START; // = 2.55 s
const halfCycles = Math.max(0, Math.floor(remaining / HALF_CYCLE) - 1);

tl.fromTo(
  ".demo",
  { y: 0, rotation: 0 },
  {
    y: -8,
    rotation: 1, // ±8 px float, ±1° tilt — subtle
    duration: HALF_CYCLE,
    ease: "sine.inOut",
    yoyo: true,
    repeat: halfCycles,
  },
  IDLE_START,
);
```

**Do not** add `repeat: -1` — HyperFrames forbids infinite repeats. The `Math.floor(remaining / HALF_CYCLE) - 1` formula guarantees the breath ends _before_ the composition ends, so the last visible frame doesn't catch the demo mid-cycle.

If you want a multiplicative breath onto an already-scaled demo (e.g. the demo lands at scale 1.05 instead of 1 because of the spring overshoot you preserved), use Form 2 from sine-wave-loop instead. The simple yoyo above assumes the demo settled at scale 1.

## Final Setup

```js
window.__timelines["main"] = tl;
```

The composition root's `data-duration` must be ≥ `TOTAL` (here 6.5 s). Anything less and the breath repeats stop early.

## Inter-Phase State Handoff

```
Phase 1 → Phase 2:
  Last icon entry begins at entryDelay = 0.50 and finishes at 0.50 + ENTRY_DUR = 1.05.
  CURSOR_AT (1.50) ≥ 1.05 + 0.30 — gives the eye time to see the orbit stabilize before
  the cursor enters.

Phase 2 → Phase 3:
  Cursor settles at CURSOR_AT + CURSOR_MOVE = 2.00.
  CLICK_AT (2.20) = settle + 0.20 — the brief pause before the click reads as the
  user "deciding" to click.

Phase 3 → Phase 4:
  Collapse completes at CLICK_AT + COLLAPSE_DUR = 3.05.
  DEMO_AT (2.95) = collapse end − 0.10 — intentional overlap so the click's energy
  visibly flows into the demo emerging. Any larger overlap and the icons appear to
  pass through the demo; any smaller and the moment feels broken.

Phase 4 → Phase 5:
  Demo entry ends at DEMO_AT + DEMO_DUR = 3.75.
  IDLE_START (3.95) = entry end + 0.20 — the spring tail dissipates within ~6 frames
  before the breath takes over.
```

## Critical Constraints

- **Orbit speed is constant before and during collapse** — only the radius shrinks. Slowing the orbit during collapse breaks the "snappy contraction" feel; speeding it up looks like the icons spin into a drain.
- **Collapse ease is snappier than entry ease** — `back.out(1.6)` for collapse vs `back.out(1.4)` for entry. The collapse should feel decisive, the entry should feel arriving.
- **Demo origin matches the collapse center exactly** — CSS `left: 50%; top: 50%; margin: -H/2 0 0 -W/2` on the demo aligns with the icons' viewport-center collapse point. Mismatch reads as a teleport.
- **Cursor `z-index: 999`** — above everything during move and click. The cursor must always be visible; it cannot be occluded by an icon passing in front during the orbit.
- **Ripple `z-index: 6`** — above the CTA but below the cursor.
- **CTA visibly depresses during the click** — the 0.95-scale tween on `.cta` is the causal trigger; without it, the collapse feels uncaused.
- **Three nested wrappers per icon** — `.icon-pos` (orbit x/y), `.icon-collapse` (collapse scale/opacity), `.icon-entry` (3D flip). Tweening the same property on the same element from two sources is undefined behavior in GSAP.
- **Icons fade during collapse, not pop-vanish** — the two-segment opacity envelope `[1, 0.5, 0]` is what gives the inward motion its "energy converging" feel.
- **One master onUpdate, gated by `tl.time()`** — both orbit angle and collapse driver are pure functions of `tl.time()`. No `Math.random()`, no `Date.now()`, no `performance.now()`.
- **Single paused timeline** — all five phases on one `gsap.timeline({ paused: true })`, registered to `window.__timelines[data-composition-id]`.
- **GSAP transform aliases only** — `x`, `y`, `scale`, `rotation`, `rotateX`, `rotateY`, `z`, `opacity`. Never `left`/`top`/`width`/`height`.
- **No infinite repeats** — Phase 5's `repeat` is computed from `TOTAL - IDLE_START`.

## Spring → GSAP Ease Cheatsheet (this blueprint)

| Source spring                                                      | This blueprint uses                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `spring({ stiffness: 100–120, damping: 14 })` — icon 3D flip entry | `back.out(1.4)` over 0.55 s                                               |
| `spring({ stiffness: 80, damping: 18 })` — cursor move             | `back.out(1.3)` over 0.50 s                                               |
| `spring({ stiffness: 150, damping: 15 })` — collapse driver        | `back.out(1.6)` over 0.85 s (called via `gsap.parseEase` inside onUpdate) |
| `spring({ stiffness: 120, damping: 14 })` — demo entry             | `back.out(1.6)` over 0.80 s                                               |
| `Math.sin(t / period)` continuous float                            | `sine.inOut` yoyo with finite `repeat`                                    |

See [hyperframes-animation/SKILL.md](../SKILL.md) for the full spring → ease mapping table.

## Golden Sample

- [cta-orbit-collapse.html](../examples/cta-orbit-collapse.html) — Six genre icons (music, gaming, education, sports, vlog, podcast) orbit a "Drop a video link · Get free clips" CTA input; cursor enters and clicks the white button; one ripple expands; icons collapse inward; a video demo card springs out from the collapse point and floats. Single paused GSAP timeline drives all five phases over 6.5 seconds. Demonstrates the three-wrapper icon anatomy and the `gsap.parseEase` pattern for spring-shaped collapse driven from inside a master `onUpdate`.
