---
name: multi-phase-camera
description: Sequential camera-zoom system with 2-3 phases (pull-back / focus / push) plus continuous micro-drift. Expressed in HyperFrames as a sequence of GSAP scale tweens on a single wrapper plus a finite yoyo drift.
metadata:
  tags: camera, zoom, phase, drift, scale, cinematic, gsap
  adapter: gsap
---

# Multi-Phase Camera

A camera wrapper that progresses through discrete zoom phases — each a separate GSAP scale tween on the same element — plus a continuous-feeling sine drift to prevent static feel between phase changes.

## HyperFrames vs. Remotion

The Remotion source held all phase springs in scope simultaneously and chose `currentScale` via piecewise `if (frame >= phaseN)`. The frame-pure model handled the merging.

HyperFrames uses GSAP's natural sequencing: **chain tweens on the same property** at successive timeline positions. GSAP's overwrite behavior plus the seek-driven runtime handles the rest. For the continuous drift, use a finite yoyo or an `onUpdate` reading `tl.time()`.

```
Remotion: const sN = spring(...); ...   // N springs in scope
          let scale = startScale; if (frame >= phase2) scale = scale2; …
HyperFrames: tl.to(el, { scale: midScale, ease: "power2.out" }, phase1At)
             tl.to(el, { scale: endScale, ease: "power2.out" }, phase2At)
             // GSAP overwrite handles which value wins at each timeline position
```

## Core Concept

Three nested behaviors on one wrapper element:

1. **Scale phases** — sequential `tl.to(.camera, { scale: X })` tweens at specific timeline positions
2. **Continuous drift** — one of three deterministic forms that adds a few pixels of `x` / `y` to the wrapper:
   - **Finite yoyo** (`yoyo: true`, finite `repeat`) — multiple cycles within a longer scene
   - **Single long sine-eased tween** — one drift arc from (0,0) to a small offset over the full scene duration with `ease: "sine.inOut"`; cleanest for short scenes
   - **`onUpdate` reading `tl.time()`** — for incommensurate sine periods or arbitrary curves
3. **Transform origin** — center-center for cinematic feel; top-left for UI-style zoom

## Basic Pattern

```html
<div class="camera">
  <!-- scene content -->
</div>

<style>
  .camera {
    transform-origin: center center;
  }
</style>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // ============================================================
  // PHASE TIMING (seconds)
  // ============================================================
  const TOTAL_DUR = 9.0;
  const PHASE1_AT = 0.0;
  const PHASE1_DUR = 0.8;
  const PHASE2_AT = 3.0;
  const PHASE2_DUR = 1.0;
  const PHASE3_AT = 6.0;
  const PHASE3_DUR = 1.0;

  // Scale values per phase boundary
  const START_SCALE = 0.92;
  const MID_SCALE = 1.0;
  const END_SCALE = 1.08;

  // ============================================================
  // SCALE PHASES — sequenced GSAP tweens
  // ============================================================
  gsap.set(".camera", { scale: START_SCALE });

  tl.to(
    ".camera",
    {
      scale: MID_SCALE,
      duration: PHASE1_DUR,
      ease: "power2.out", // cinematic — low stiffness in Remotion
    },
    PHASE1_AT,
  );

  tl.to(
    ".camera",
    {
      scale: END_SCALE,
      duration: PHASE2_DUR,
      ease: "power3.out", // each phase gets HIGHER damping → smoother settle
    },
    PHASE2_AT,
  );

  // Optional: a third phase that pulls back slightly for "exhale"
  tl.to(
    ".camera",
    {
      scale: MID_SCALE + 0.02,
      duration: PHASE3_DUR,
      ease: "power3.out",
    },
    PHASE3_AT,
  );

  // ============================================================
  // CONTINUOUS DRIFT — two equivalent forms.
  // Both are deterministic and seek-safe. Pick whichever reads
  // cleanest for the scene length.
  // ============================================================

  /* --- Form A: finite yoyo (NOT repeat: -1) ---
     yoyo: true bounces back; finite repeat = TOTAL_DUR / halfCycle - 1.
     Best when you want multiple oscillation cycles within a longer scene. */
  const DRIFT_HALF_CYCLE = 2.5;
  const driftRepeats = Math.max(0, Math.floor(TOTAL_DUR / DRIFT_HALF_CYCLE) - 1);

  tl.to(
    ".camera",
    {
      x: 4,
      y: 2,
      duration: DRIFT_HALF_CYCLE,
      ease: "sine.inOut",
      yoyo: true,
      repeat: driftRepeats,
    },
    0,
  );

  /* --- Form B: single long-duration sine-eased tween ---
     One tween that drifts from (0,0) to a small offset over the full
     scene with `ease: "sine.inOut"`. Cleaner when the scene is short
     (≤ ~4s) and a single drift arc reads better than multiple cycles.
     The brand-reveal-assemble-zoom example uses this form for its
     overall camera pan; hook-counter-burst uses it for both .bg and
     .camera micro-pan.

  tl.to(".camera", {
    x: 3,
    y: 1.6,
    duration: TOTAL_DUR,
    ease: "sine.inOut",
  }, 0);
  */

  window.__timelines["main"] = tl;
</script>
```

### Why two tweens on `.camera` can co-exist

GSAP `transform` writes are combined: `x`, `y`, and `scale` are independent properties of the same matrix. A tween targeting `scale` doesn't reset `x` (and vice versa). The drift tween and the phase tween animate orthogonal aliases — both apply.

If two tweens target the **same** property at overlapping times, GSAP's overwrite rules apply (`overwrite: "auto"` resolves it). Within this pattern, each phase tween starts when the previous phase has completed, so no overlap occurs on `scale`.

## Phase Patterns

| Pattern              | Scale sequence     | Feel                            | When to use                           |
| -------------------- | ------------------ | ------------------------------- | ------------------------------------- |
| **Focus-in**         | 0.92 → 1.00 → 1.08 | Approach → settle → slight push | Product demo, brand reveal            |
| **Dramatic reveal**  | 1.10 → 1.00 → 0.95 | Wide → focus → settle back      | Tension build, story open             |
| **Steady push**      | 1.00 → 1.03 → 1.06 | Gradual forward momentum        | Hype scenes, energy-building          |
| **Pull-out then in** | 1.05 → 0.92 → 1.00 | Quick recoil, then approach     | Comedy beat, "wait, let's start over" |

## Drift Configuration

Drift must be imperceptible on any single frame but visible over time.

| Parameter           | Recommended Range |
| ------------------- | ----------------- |
| Drift X amplitude   | 2–5 px            |
| Drift Y amplitude   | 1–3 px            |
| Half-cycle duration | 2–4 seconds       |

Or pick the single long-tween form when the scene is short enough that one drift arc suffices:

```js
tl.to(
  ".camera",
  {
    x: 3,
    y: 1.6,
    duration: TOTAL_DUR,
    ease: "sine.inOut",
  },
  0,
);
```

`sine.inOut` over the full duration produces one half-cycle of motion — the camera eases out to the offset and (because there's no return) holds it. This reads as a slow drift in the same direction, which is often what you want for a 2–4 second hook scene. If you want oscillation (forward then back), use Form A (yoyo) instead.

The same effect via `onUpdate` (smoother if you need exact sine, or multiple incommensurate periods):

```js
tl.to(
  { tick: 0 },
  {
    tick: 1,
    duration: TOTAL_DUR,
    ease: "none",
    onUpdate: function () {
      const t = tl.time();
      const driftX = Math.sin(t * 0.6) * 3; // ~1.7s period
      const driftY = Math.cos(t * 0.45) * 2; // ~2.3s period — incommensurate
      gsap.set(".camera", { x: driftX, y: driftY });
    },
  },
  0,
);
```

The `onUpdate` form lets you use non-simple-ratio periods (0.6 vs 0.45 are roughly 4:3) for more organic motion — see [sine-wave-loop](sine-wave-loop.md).

## Critical Constraints

- **Wrap once, animate many**: The `.camera` wrapper holds all child content. Don't apply phase scale per element — apply to the wrapper.
- **`transform-origin: center center`**: For cinematic feel. `top left` produces a UI-style zoom that anchors the upper-left.
- **No infinite repeats**: Compute drift repeats from `TOTAL_DUR / halfCycle - 1`. `repeat: -1` is forbidden.
- **Phase damping increases**: Each successive phase should have a higher-damping ease (`power2.out` → `power3.out` → `power3.inOut`) so later phases settle more gently. Otherwise late phases feel jittery.
- **Phase springs lower than UI springs**: For "camera" feel use `power2.out` / `power3.out`. `back.out` adds overshoot that reads as a UI bounce.
- **GSAP transform aliases only**: `scale`, `x`, `y`. Never `transform` directly or layout properties (`width`/`height`).
- **Single paused timeline**: All phase + drift tweens on one timeline; HF seeks it.

## Combinations

- Wrap [coordinate-target-zoom](coordinate-target-zoom.md) inside a multi-phase camera for "zoom into element while overall scene also pushes forward."
- Layer with [sine-wave-loop](sine-wave-loop.md) on a child element for hero-only breathing while the camera moves.

## Examples

- [demo-page-scroll-spotlight.html](../examples/demo-page-scroll-spotlight.html) — uses the simple form: single page-entry scale tween (0.95 → 1.0) rather than the full multi-phase chain. The full multi-phase pattern is overkill for a 9-second product showcase but useful for longer narrative scenes.
