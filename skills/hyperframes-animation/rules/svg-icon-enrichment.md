---
name: svg-icon-enrichment
description: Animate internal SVG elements (rotating hands, oscillating blades, pulsing dots, dash-flow lines) to make icons feel alive. Each icon gets a signature motion that communicates its meaning, driven by GSAP yoyo tweens or a shared `onUpdate` ticker.
metadata:
  tags: svg, icon, animation, internal, micro-animation, enrichment, gsap
  adapter: gsap
---

# SVG Icon Enrichment

Transforms static SVG icons into living elements by animating their internal parts. A clock hand rotates, scissors open/close, a recording dot pulses, a cutting line flows. Each icon becomes a tiny self-contained motion vignette.

## HyperFrames vs. Remotion

The Remotion source drove every internal animation from `frame` directly inside each component's render. Continuous motion came "for free" because each frame is independently computed.

HyperFrames is seek-driven on a paused timeline. Continuous internal motion requires one of:

| Approach                                            | When to use                                                                                                                                                                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shared "scene-ticker" `onUpdate`**                | **Primary form** when the scene has ≥2 sine motions or any dynamic dashoffset flow. One `onUpdate` reads `tl.time()`, anchors each motion to its icon's entry time, and writes all DOM mutations together. Minimizes per-frame overhead.                |
| **Finite GSAP yoyo**                                | Symmetric oscillation (scissor open/close, pulse) when it's the _only_ continuous motion in the scene. Cheap, declarative. `repeat: -1` is forbidden — compute from `data-duration`.                                                                    |
| **Linear `tl.to({rotation: N*360}, ease: 'none')`** | Continuous one-direction rotation (clock hand, loader). The total degrees are baked into the tween's `to` value. Use even alongside a shared onUpdate — GSAP handles the linear interpolation more cleanly than re-deriving rotation inside the ticker. |

## Core Concept

Target individual elements (`<line>`, `<circle>`, `<path>`, `<g>`) inside the SVG by giving each a class. Apply GSAP transforms via the same allowed aliases as elsewhere (`rotation`, `scale`, etc.), with `transform-origin` in the **SVG coordinate system** (viewBox units, not CSS pixels).

```html
<svg viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="9" stroke="#fff" fill="none" />
  <line
    class="clock-hand"
    x1="12"
    y1="12"
    x2="12"
    y2="6"
    stroke="#edcb50"
    stroke-width="2"
    stroke-linecap="round"
    style="transform-origin: 12px 12px;"
  />
</svg>
```

```js
// Clock hand rotates linearly across the scene.
tl.to(
  ".clock-hand",
  {
    rotation: 720, // two full rotations over the scene
    duration: 3.5,
    ease: "none",
  },
  0,
);
```

## Signature Motion Patterns

### Rotation — clocks, dials, loaders

```js
const SCENE_DUR = 3.5;
const ROTATION_DEGS_PER_SEC = 120;
const totalDegs = ROTATION_DEGS_PER_SEC * SCENE_DUR;

tl.to(".clock-hand", { rotation: totalDegs, duration: SCENE_DUR, ease: "none" }, 0);
```

`ease: "none"` keeps the rotation perfectly linear — the hand never slows. `power2.out` would feel like the hand is "tired" near the end.

### Oscillation — scissors, toggles, wings

**Primary form** (used in [hook-counter-burst.html](../examples/hook-counter-burst.html)): drive the sine inside a shared scene-ticker `onUpdate` — see [Shared Scene-Ticker](#shared-scene-ticker-for-multiple-sine-motions) below. This is the recommended form whenever the same scene already has ≥2 other sine motions (record-dot, play pulse, dash flow), because it consolidates all per-frame DOM writes into one onUpdate.

```js
// Inside the shared onUpdate:
const SCISSOR_SPEED = 3.6; // rad/sec
const SCISSOR_AMP = 15; // degrees
const sciT = t - SCISSORS_ENTRY_AT;
const sciAngle = sciT > 0 ? Math.sin(sciT * SCISSOR_SPEED) * SCISSOR_AMP : 0;
gsap.set(".scissor-upper", { rotation: sciAngle });
gsap.set(".scissor-lower", { rotation: -sciAngle });
```

**Alternative form** (per-icon finite yoyo) — declarative, no onUpdate, but can't share frequency state with other motions:

```js
// Two opposing blades, each a finite yoyo. ±15° amplitude.
// Period = 2 × half-cycle. Compute repeat to fill scene duration.
const HALF_CYCLE = 0.43; // seconds for one direction (-15 → +15)
const repeats = Math.max(0, Math.floor(SCENE_DUR / HALF_CYCLE) - 1);

tl.fromTo(
  ".scissor-upper",
  { rotation: -15 },
  { rotation: 15, duration: HALF_CYCLE, ease: "sine.inOut", yoyo: true, repeat: repeats },
  0,
);
tl.fromTo(
  ".scissor-lower",
  { rotation: 15 },
  { rotation: -15, duration: HALF_CYCLE, ease: "sine.inOut", yoyo: true, repeat: repeats },
  0,
);
```

Opposing rotations on the two blades create the open/close illusion. Both elements must have the same pivot (`transform-origin: 12px 12px;`).

Use the shared-onUpdate form when the scene has multiple sine motions; use yoyo when the oscillation is the only continuous motion in the scene.

### Pulse — recording dots, hearts, notifications

```js
// Scale yoyo from 1.0 to 1.15 with sine; opacity to range 0.4–1.0.
tl.fromTo(
  ".record-dot",
  { scale: 1, opacity: 0.7 },
  {
    scale: 1.15,
    opacity: 1.0,
    duration: 0.5,
    ease: "sine.inOut",
    yoyo: true,
    repeat: Math.floor(SCENE_DUR / 0.5) - 1,
  },
  0,
);
```

For phase-offset opacity (the original's `sin(t * 0.15)` for opacity vs `sin(t * 0.10)` for scale), use a shared onUpdate (next section) — yoyo alone can't desync the two channels.

### Dash Flow — cutting lines, data streams

**Primary form** (used in [hook-counter-burst.html](../examples/hook-counter-burst.html)): compute dashoffset dynamically inside the shared onUpdate. This makes the flow speed a pure function of `tl.time()` — no fixed end value, no need to recompute when the scene's total duration changes.

```js
// Inside the shared onUpdate:
const CUTTING_FLOW_SPEED = 15; // units/sec
const cutT = t - SCISSORS_ENTRY_AT;
if (cutT > 0) {
  gsap.set(".cutting-line", {
    attr: { "stroke-dashoffset": -cutT * CUTTING_FLOW_SPEED },
  });
}
```

**Alternative form** (fixed-target tween) — simpler when the flow is the only continuous motion and you know the scene duration up front:

```js
// strokeDashoffset is a CSS-tweenable attribute on stroke-dasharray elements.
// GSAP can tween it via the `attr` plugin (built-in).
tl.to(
  ".cutting-line",
  {
    attr: { "stroke-dashoffset": -100 }, // drift to fixed offset; negative = leftward flow
    duration: 3.5,
    ease: "none",
  },
  0,
);
```

For a dashed line with `stroke-dasharray="4 2"`, tweening `stroke-dashoffset` shifts the pattern along the path. Negative values flow in one direction; positive flow the other.

## Shared Scene-Ticker (for Multiple Sine Motions)

When many icons need `Math.sin(...)` motions at different rates / phases / amplitudes — and/or one of them needs a dynamic dashoffset — consolidate into one `onUpdate`. This is the form used in [hook-counter-burst.html](../examples/hook-counter-burst.html), which drives scissors, record dot, play triangle, and cutting-line dash flow from a single ticker:

```js
const TOTAL = 3.5;

const SCISSORS_ENTRY_AT = 0.3; // when scissors icon enters
const VIDEO_ENTRY_AT = 0.43;
const PLAY_ENTRY_AT = 0.57;

const SCISSOR_SPEED = 3.6; // rad/sec
const SCISSOR_AMP = 15;
const REC_OPACITY_SPEED = 4.5;
const REC_SCALE_SPEED = 3.0;
const REC_OPACITY_AMP = 0.3;
const REC_OPACITY_BASE = 0.7;
const REC_SCALE_AMP = 0.15;
const PLAY_PULSE_SPEED = 2.4;
const PLAY_PULSE_AMP = 0.08;
const CUTTING_FLOW_SPEED = 15; // units/sec for stroke-dashoffset

const scissorUpper = document.querySelector(".scissor-upper");
const scissorLower = document.querySelector(".scissor-lower");
const recordDot = document.querySelector(".record-dot");
const playTri = document.querySelector(".play-tri");
const cuttingLine = document.querySelector(".cutting-line");

tl.to(
  { tick: 0 },
  {
    tick: 1,
    duration: TOTAL,
    ease: "none",
    onUpdate: function () {
      const t = tl.time();

      // Scissors — symmetric oscillation, anchored to entry time
      const sciT = t - SCISSORS_ENTRY_AT;
      const sciAngle = sciT > 0 ? Math.sin(sciT * SCISSOR_SPEED) * SCISSOR_AMP : 0;
      gsap.set(scissorUpper, { rotation: sciAngle });
      gsap.set(scissorLower, { rotation: -sciAngle });

      // Cutting line — dynamic dashoffset (linear flow)
      const cutT = t - SCISSORS_ENTRY_AT;
      if (cutT > 0) {
        gsap.set(cuttingLine, {
          attr: { "stroke-dashoffset": -cutT * CUTTING_FLOW_SPEED },
        });
      }

      // Record dot — phase-offset opacity and scale (different speeds)
      const recT = t - VIDEO_ENTRY_AT;
      if (recT > 0) {
        const recOpacity = Math.sin(recT * REC_OPACITY_SPEED) * REC_OPACITY_AMP + REC_OPACITY_BASE;
        const recScale = 1 + Math.sin(recT * REC_SCALE_SPEED) * REC_SCALE_AMP;
        gsap.set(recordDot, { opacity: recOpacity, scale: recScale });
      }

      // Play triangle — slow scale pulse
      const playT = t - PLAY_ENTRY_AT;
      if (playT > 0) {
        const playScale = 1 + Math.sin(playT * PLAY_PULSE_SPEED) * PLAY_PULSE_AMP;
        gsap.set(playTri, { scale: playScale });
      }
    },
  },
  0,
);
```

The `tick` proxy is just a clock — its value isn't used. The onUpdate fires every time GSAP advances the timeline, which is every render frame during HyperFrames seek.

**Anchor each motion to its icon's entry time** (`t - ENTRY_AT`), gated by `> 0`. This guarantees the motion starts cleanly at phase 0 the moment the icon appears, regardless of the icon's stagger, and avoids visible "in-progress" motion before the icon is visible.

**Mixing tween forms with the shared onUpdate**: continuous one-direction rotations (e.g., a clock hand) are cleaner as a standalone linear `tl.to(..., { rotation: 420, ease: "none" })` because GSAP handles the interpolation. Keep the shared onUpdate for sine-based motions and dynamic dashoffset; keep linear rotations as their own tweens.

## Entry Animation Pairing

Combine internal enrichment with a spring entrance. The internal animation runs from the start of the timeline, but the icon is invisible until the entry tween reveals it.

```html
<div class="icon-entry">
  <svg><!-- enriched SVG --></svg>
</div>
```

```js
// Entry: scale + opacity rise from 0.
tl.fromTo(
  ".icon-entry",
  { scale: 0, opacity: 0, rotation: -180 },
  { scale: 1, opacity: 0.85, rotation: 0, duration: 0.55, ease: "back.out(1.5)" },
  ICON_ENTRY_AT,
);
```

The internal animation tweens (clock hand, scissor angle, etc.) start at timeline position 0 — they're already running when the entry tween makes the icon visible. The user sees a fully-alive icon appear, not a static icon that starts moving after it lands.

## Stroke-Draw Entry

For SVG outlines that should "draw on" during entry, use `strokeDasharray` + `strokeDashoffset` tweened by GSAP:

```html
<circle
  class="clock-ring"
  cx="12"
  cy="12"
  r="9"
  stroke="white"
  stroke-width="2"
  stroke-dasharray="56.5"
  stroke-dashoffset="56.5"
  fill="none"
/>
```

```js
// Tween the offset from 56.5 (invisible) to 0 (fully drawn).
// 56.5 = 2π × 9 ≈ circumference of an r=9 circle.
tl.to(
  ".clock-ring",
  {
    attr: { "stroke-dashoffset": 0 },
    duration: 0.55,
    ease: "power2.out",
  },
  ICON_ENTRY_AT,
);
```

For a square: dasharray ≈ perimeter = 4 × side (or 2(w+h) for rect). Measure your actual path and bake the number in.

## Critical Constraints

- **`transform-origin` in SVG coordinates**: Use viewBox units (e.g., `12px 12px` for a 24-unit viewBox center), not screen pixels.
- **Keep amplitude subtle**: Icons are decorative, not focal. Scale ±5–15%, rotation 5–20°. Bigger looks like a glitch.
- **One ticker for many motions**: If you have ≥3 sine-based internal motions, consolidate into one shared onUpdate. Many independent onUpdates each fire per frame.
- **GSAP transform aliases only on SVG**: `rotation`, `scale`, `x`, `y`. Animate SVG attributes (`x1`, `r`, `stroke-dashoffset`) via the `attr` plugin (built-in to GSAP core).
- **No `Math.random` / `Date.now`**: All internal motion must be a pure function of `tl.time()`.
- **No infinite repeats**: All yoyo / repeat counts are finite, computed from `data-duration`.
- **Per-icon `transform-origin`**: Each animated SVG element needs its own origin. Don't try to share via parent class.

## Combinations

- Pair with [center-outward-expansion](center-outward-expansion.md) — icons enter clustered, expand outward, internal motion runs throughout.
- Pair with [svg-path-draw](svg-path-draw.md) (pending migration) — draw the outline on entry, then the enrichment activates inside.
- Pair with [sine-wave-loop](sine-wave-loop.md) on the icon wrapper — adds gentle floating to whole icons while internal parts animate.

## Examples

- [hook-counter-burst.html](../examples/hook-counter-burst.html) — four enriched icons (clock with rotating hand, scissors oscillating, video with pulsing record dot, play button with pulse scale) entering with stroke-draw + spring scale.
