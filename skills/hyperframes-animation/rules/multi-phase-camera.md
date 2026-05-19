---
name: multi-phase-camera
description: Sequential camera zoom with 2-3 distinct phases (pull-back / focus / push) plus continuous micro-drift for organic cinematic feel.
metadata:
  tags: camera, zoom, phase, drift, scale, cinematic
---

# Multi-Phase Camera

A camera wrapper around the entire scene that progresses through discrete zoom phases at scripted triggers. Continuous sine-driven micro-drift overlays so the camera never feels static between phases. Distinct from a single linear zoom — multi-phase creates "cinematic pacing" (anticipation → reveal → settle).

## How It Works

The camera is a single wrapping `<div>` whose `transform: scale() translate(x, y)` is driven by:

1. **Phase scale** — a stepwise scale value that advances through phases at trigger times (e.g. `scale: 0.92` at t=0 → `1.0` at t=1.2 → `1.08` at t=2.4)
2. **Drift offset** — a continuous sine-based `translateX` / `translateY` (small amplitude, slow frequency) ADDED to the phase transform

Both run inside the GSAP timeline so HF seeks frame-by-frame deterministically.

## HTML

```html
<div
  class="scene"
  id="cam-scene"
  data-composition-id="cam-scene"
  data-start="0"
  data-duration="6"
  data-track-index="0"
>
  <div class="camera" id="camera">
    <div class="content">
      <div class="hero">HEYGENVERSE</div>
      <div class="tagline">Ship a video. In one prompt.</div>
      <div class="cta">heygenverse.com</div>
    </div>
  </div>
</div>
```

## CSS

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: radial-gradient(ellipse at center, #161a3a 0%, #0b0d1f 70%);
}
.camera {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  transform-origin: 50% 50%;
  will-change: transform;
}
.content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  text-align: center;
}
.hero {
  font-family: "Inter", sans-serif;
  font-weight: 900;
  font-size: 200px;
  letter-spacing: 8px;
  color: #f5f6fb;
  text-transform: uppercase;
}
.tagline {
  font-family: "Inter", sans-serif;
  font-weight: 600;
  font-size: 56px;
  color: #cdb8ff;
}
.cta {
  font-family: "JetBrains Mono", monospace;
  font-weight: 700;
  font-size: 40px;
  letter-spacing: 6px;
  color: #a78bfa;
  text-transform: uppercase;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const camera = document.getElementById("camera");

  // Three-phase scale plan: pullback (0.92) → focus (1.0) → push (1.08)
  const phase = { scale: 0.92 };

  // Phase 1 — start pulled back
  // (no tween needed for the initial value; set via the phase object)

  // Phase 2 — settle to neutral focus
  tl.to(
    phase,
    {
      scale: 1.0,
      duration: 1.2,
      ease: "power3.out",
    },
    0.5,
  );

  // Phase 3 — slow push-in for the climax
  tl.to(
    phase,
    {
      scale: 1.08,
      duration: 1.6,
      ease: "power2.inOut",
    },
    3.0,
  );

  // Drift driver — continuous sine motion overlaid on the phase scale
  const drift = { p: 0 };
  const TOTAL_DURATION = 6.0;
  const DRIFT_CYCLES = 1.8; // how many drift cycles across composition
  const DRIFT_AMP_X = 6; // px
  const DRIFT_AMP_Y = 3; // px

  tl.to(
    drift,
    {
      p: Math.PI * 2 * DRIFT_CYCLES,
      duration: TOTAL_DURATION,
      ease: "none",
      onUpdate: () => {
        const dx = Math.sin(drift.p) * DRIFT_AMP_X;
        const dy = Math.sin(drift.p * 1.3) * DRIFT_AMP_Y; // slightly different frequency
        camera.style.transform = `scale(${phase.scale}) translate(${dx}px, ${dy}px)`;
      },
    },
    0,
  );

  // Content reveals (entry beats inside the camera frame)
  tl.from(".hero", { opacity: 0, y: 32, scale: 0.96, duration: 0.9, ease: "power3.out" }, 0.6);
  tl.from(".tagline", { opacity: 0, y: 16, duration: 0.7, ease: "power3.out" }, 1.4);
  tl.from(".cta", { opacity: 0, y: 8, duration: 0.7, ease: "power3.out" }, 3.2);

  window.__timelines["cam-scene"] = tl;
</script>
```

## Phase Patterns

| Pattern             | Scale Sequence      | Feel                            | When to use                   |
| ------------------- | ------------------- | ------------------------------- | ----------------------------- |
| **Focus-in**        | `0.92 → 1.0 → 1.08` | Approach → settle → slight push | Default product reveal        |
| **Dramatic reveal** | `1.1 → 1.0 → 0.95`  | Wide → focus → settle back      | Hero shot with breathing room |
| **Steady push**     | `1.0 → 1.03 → 1.06` | Gradual forward momentum        | Continuous narrative push     |
| **Bookend pull**    | `1.0 → 1.15 → 1.0`  | Settle → push → release         | CTA emphasis then release     |

## Variations

### Phase trigger by content beat (not time)

If your composition has content phases (e.g. orbit-3d-entry's flip-in completes, then orbit starts), trigger camera phases to those beats by aligning the camera tween start time with the content tween's end time.

### Camera shake (panic / impact)

For a brief shake instead of drift, replace the drift tween with a higher-amplitude, higher-frequency one over a short window:

```js
tl.to(
  drift,
  {
    p: Math.PI * 2 * 8, // 8 cycles in short burst
    duration: 0.6,
    ease: "none",
    onUpdate: () => {
      const dx = Math.sin(drift.p) * 24;
      const dy = Math.sin(drift.p * 1.7) * 18;
      camera.style.transform = `scale(${phase.scale}) translate(${dx}px, ${dy}px)`;
    },
  },
  2.0,
);
```

### Targeted zoom into off-center element

If the climax should zoom into a non-centered element, combine scale with counter-translation. Compute the offset so the target ends at viewport center after scale:

```js
const target = document.querySelector(".cta");
const targetCenter = target.getBoundingClientRect();
const viewportCenter = { x: 1920 / 2, y: 1080 / 2 };
const offsetX = (viewportCenter.x - (targetCenter.left + targetCenter.width / 2)) / phase.scale;
const offsetY = (viewportCenter.y - (targetCenter.top + targetCenter.height / 2)) / phase.scale;
// then in onUpdate: translate(offsetX + dx, offsetY + dy)
```

## Key Principles

- **Drift is imperceptible per-frame, visible over time** — `DRIFT_AMP_X` 2-6px, `DRIFT_AMP_Y` 1-3px, 1-2 cycles per composition duration. If drift is visible as a discrete shake, it's too much
- **Drift X and Y at slightly different frequencies** — multiplying one by ~1.3 prevents the camera from moving on a perfect diagonal, which reads as mechanical. Different frequencies = organic
- **Phase springs softer than UI springs** — `power2.inOut` or `power3.out` for cinematic feel; spring/back easing on a camera feels uncomfortable
- **Each later phase settles "deeper"** — phase 2 ease should imply more settling than phase 1 (longer duration OR more out-easing). Wakes up → settles → settles deeper
- **Camera wraps EVERYTHING in the scene** — applying camera per-element creates parallax bugs and breaks "this is one viewpoint"
- **❗ overflow: hidden on .scene** — phases that pull back (`scale < 1`) reveal edges of the inner content. Without `overflow: hidden`, those edges leak outside the 1920×1080 frame and HF renders them as visible content
- **❗ Hero reveal start AFTER initial pullback ease lands** — if the camera is still pulling back when the headline fades in, the headline feels like it's flying away

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS `transition` on `.camera`** — competes with the GSAP transform
- **`transform-origin: 50% 50%`** on camera — off-center origin creates unpredictable phase-to-phase drift
- **`will-change: transform`** on `.camera` — the camera transform updates every frame
- **`overflow: hidden` on `.scene`** — required when any phase scale < 1
- **Scene background on `.scene`, not `.camera`** — if background is on camera, scaling/translating it reveals the outer void

## Combinations

- [orbit-3d-entry.md](orbit-3d-entry.md) — orbit motion inside a slowly drifting camera
- [counting-dynamic-scale.md](counting-dynamic-scale.md) — climax phase 3 push-in synced to counter peak
- [3d-text-depth-layers.md](3d-text-depth-layers.md) — depth-stacked hero with cinematic camera moves
- [sine-wave-loop.md](sine-wave-loop.md) — element idle inside the camera (compound motion)

## Pairs with HF skills

- `/hyperframes-gsap` — multi-phase tween + drift onUpdate
- `/hyperframes-core` — composition wiring, scene wrapper
- `/hyperframes-cli` — `hyperframes lint`
