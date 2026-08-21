---
name: multi-phase-camera
description: Sequential camera zoom with 2-3 distinct phases (pull-back / focus / push) plus continuous micro-drift for organic cinematic feel.
metadata:
  tags: camera, zoom, phase, drift, scale, cinematic
---

# Multi-Phase Camera

A camera wrapper around the ENTIRE scene that progresses through discrete zoom phases at scripted triggers, with continuous sine-driven micro-drift overlaid so the camera never feels static between phases. Distinct from a single linear zoom — multi-phase creates cinematic pacing (anticipation → reveal → settle).

## How It Works

The camera is one wrapping `<div>` whose `transform: scale() translate(x, y)` is composed from two channels inside a single `onUpdate` writer:

1. **Phase scale** — a proxy object `{ scale }` stepped through phases at trigger times (`PHASE_1_SCALE` at t=0 → `PHASE_2_SCALE` at `PHASE_2_AT` → `PHASE_3_SCALE` at `PHASE_3_AT`).
2. **Drift offset** — a continuous sine-based `translateX` / `translateY` (small amplitude, slow frequency) ADDED to the phase transform. X and Y run at slightly different frequencies (`DRIFT_FREQ_RATIO ≈ 1.3`) — equal frequencies produce a perfect diagonal that reads mechanical; ~1.3 gives an organic Lissajous.

## Recipe

```html
<div class="camera" id="camera">
  <div class="content">
    <div class="hero">{Brand}</div>
    <div class="tagline">{tagline}</div>
    <div class="cta">{ctaText}</div>
  </div>
</div>
```

```css
.scene {
  overflow: hidden; /* REQUIRED — any phase scale < 1 exposes the content's edges */
  background: {sceneBgColor}; /* background on .scene, NOT .camera — a camera-borne
     background warps/translates with the transform and reveals the outer void */
}
.camera {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  transform-origin: 50% 50%; /* off-center origin creates phase-to-phase drift */
  will-change: transform;
}
```

```js
const camera = document.getElementById("camera");

// Three-phase scale plan: pullback → focus → push.
const phase = { scale: PHASE_1_SCALE }; // Phase 1 is the initial value — no tween

// Phase 2 — settle to neutral focus
tl.to(phase, { scale: PHASE_2_SCALE, duration: PHASE_2_DUR, ease: PHASE_2_EASE }, PHASE_2_AT);

// Phase 3 — slow push-in for the climax
tl.to(phase, { scale: PHASE_3_SCALE, duration: PHASE_3_DUR, ease: PHASE_3_EASE }, PHASE_3_AT);

// Drift driver — continuous sine motion overlaid on the phase scale.
// The ONE writer of camera.style.transform.
const drift = { p: 0 };
tl.to(
  drift,
  {
    p: Math.PI * 2 * DRIFT_CYCLES,
    duration: TOTAL_DURATION, // spans the whole composition
    ease: "none",
    onUpdate: () => {
      const dx = Math.sin(drift.p) * DRIFT_AMP_X;
      const dy = Math.sin(drift.p * DRIFT_FREQ_RATIO) * DRIFT_AMP_Y;
      camera.style.transform = `scale(${phase.scale}) translate(${dx}px, ${dy}px)`;
    },
  },
  0,
);

// Content reveals happen INSIDE the camera frame (hero/tagline/cta beats).
```

## Phase Patterns

| Pattern             | Scale sequence (1 → 2 → 3)        | Feel                            | When to use                   |
| ------------------- | --------------------------------- | ------------------------------- | ----------------------------- |
| **Focus-in**        | back → neutral → slight push      | Approach → settle → slight push | Default product reveal        |
| **Dramatic reveal** | push → neutral → pull             | Wide → focus → settle back      | Hero shot with breathing room |
| **Steady push**     | neutral → slight push → more push | Gradual forward momentum        | Continuous narrative push     |
| **Bookend pull**    | neutral → strong push → neutral   | Settle → push → release         | CTA emphasis then release     |

## Variations

- **Phase trigger by content beat**: align a camera tween's start with a content tween's end (entry completes → push begins) rather than a fixed clock value.
- **Camera shake (panic / impact)**: a brief higher-amplitude, higher-frequency drift tween over a short window — same `drift` mechanism with `SHAKE_AMP` / `SHAKE_CYCLES` / `SHAKE_DUR` at `SHAKE_AT`.
- **Targeted zoom into an off-center element**: combine scale with counter-translation so the target lands at viewport center — divide the measured offset by the current scale before feeding it into the writer:

```js
const tRect = document.querySelector(".cta").getBoundingClientRect();
const offsetX = (STAGE_W / 2 - (tRect.left + tRect.width / 2)) / phase.scale;
const offsetY = (STAGE_H / 2 - (tRect.top + tRect.height / 2)) / phase.scale;
// then in onUpdate: translate(offsetX + dx, offsetY + dy)
```

(Full counter-translate doctrine: [coordinate-target-zoom.md](coordinate-target-zoom.md).)

## Values

| token                       | range                                    | notes                                                                               |
| --------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| PHASE_1 / 2 / 3_SCALE       | 0.88–0.96 / 0.98–1.02 / 1.04–1.15        | tighter spread = subtler camera; scale < 1 REQUIRES `overflow: hidden` on `.scene`  |
| PHASE_2_AT / PHASE_2_DUR    | 0.3–1.0s / 1.0–1.8s                      | longer DUR = slower settle, more cinematic                                          |
| PHASE_3_AT / PHASE_3_DUR    | 2.0–4.0s / 1.0–2.0s                      | PHASE_3_AT ≥ PHASE_2_AT + PHASE_2_DUR or focus is preempted                         |
| PHASE_2_EASE / PHASE_3_EASE | `power2.out` `power3.out` `power2.inOut` | spring/back easing on a camera feels uncomfortable; each later phase settles deeper |
| TOTAL_DURATION              | = `data-duration`                        | the drift tween must span the whole composition                                     |
| DRIFT_CYCLES                | 1–3                                      | 1 = one slow breath; high values read as mechanical wobble                          |
| DRIFT_AMP_X / DRIFT_AMP_Y   | 2–8 px / 1–4 px                          | imperceptible per-frame, visible over time — if it reads as a shake, it's too much  |
| DRIFT_FREQ_RATIO            | 1.2–1.5                                  | 1.0 = perfect diagonal (mechanical); ~1.3 = organic Lissajous                       |
| HERO_AT (etc.)              | after Phase-2 settle lands               | a hero fading in mid-pull-back feels like it's flying away                          |

## Critical Constraints

- **Camera wraps EVERYTHING in the scene** — a per-element camera creates parallax bugs and breaks the "one viewpoint" read.
- **One writer**: phase scale and drift compose inside the single drift `onUpdate`; nothing else touches `camera.style.transform`.
- **`overflow: hidden` on `.scene`** — required whenever any phase scale < 1.
- **`transform-origin: 50% 50%` on `.camera`** — off-center origin creates unpredictable phase-to-phase drift.
- **Scene background on `.scene`, not `.camera`** — otherwise scaling/translating reveals the outer void.
- **Hero reveal starts AFTER the initial pull-back ease lands** — otherwise the headline feels like it's flying away.

## See also

[coordinate-target-zoom.md](coordinate-target-zoom.md) (counter-translate math for the targeted variation) · [orbit-3d-entry.md](orbit-3d-entry.md) (orbit inside a drifting camera) · [counting-dynamic-scale.md](counting-dynamic-scale.md) (climax push synced to counter peak) · [3d-text-depth-layers.md](3d-text-depth-layers.md) (depth-stacked hero under camera moves) · [sine-wave-loop.md](sine-wave-loop.md) (element idle inside the camera).
