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

1. **Phase scale** — a stepwise scale value that advances through phases at trigger times (e.g. `PHASE_1_SCALE` at t=0 → `PHASE_2_SCALE` at PHASE_2_AT → `PHASE_3_SCALE` at PHASE_3_AT)
2. **Drift offset** — a continuous sine-based `translateX` / `translateY` (small amplitude, slow frequency) ADDED to the phase transform

Both run inside the GSAP timeline so HF seeks frame-by-frame deterministically.

## HTML

```html
<div
  class="scene"
  data-composition-id="cam-scene"
  data-start="0"
  data-duration="6"
  data-track-index="0"
>
  <div class="camera" id="camera">
    <div class="content">
      <div class="hero">{Brand}</div>
      <div class="tagline">{tagline}</div>
      <div class="cta">{ctaText}</div>
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
  background: {sceneBgColor};
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
  font-family: {font};
  font-weight: 900;
  font-size: {heroSize};
  letter-spacing: 8px;
  color: {textColor};
  text-transform: uppercase;
}
.tagline {
  font-family: {font};
  font-weight: 600;
  font-size: {taglineSize};
  color: {accentColor};
}
.cta {
  font-family: {monoFont};
  font-weight: 700;
  font-size: {ctaSize};
  letter-spacing: 6px;
  color: {accentColor};
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

  // Three-phase scale plan: pullback → focus → push
  const phase = { scale: PHASE_1_SCALE };

  // Phase 1 — start pulled back
  // (no tween needed for the initial value; set via the phase object)

  // Phase 2 — settle to neutral focus
  tl.to(
    phase,
    {
      scale: PHASE_2_SCALE,
      duration: PHASE_2_DUR,
      ease: PHASE_2_EASE,
    },
    PHASE_2_AT,
  );

  // Phase 3 — slow push-in for the climax
  tl.to(
    phase,
    {
      scale: PHASE_3_SCALE,
      duration: PHASE_3_DUR,
      ease: PHASE_3_EASE,
    },
    PHASE_3_AT,
  );

  // Drift driver — continuous sine motion overlaid on the phase scale
  const drift = { p: 0 };

  tl.to(
    drift,
    {
      p: Math.PI * 2 * DRIFT_CYCLES,
      duration: TOTAL_DURATION,
      ease: "none",
      onUpdate: () => {
        const dx = Math.sin(drift.p) * DRIFT_AMP_X;
        const dy = Math.sin(drift.p * DRIFT_FREQ_RATIO) * DRIFT_AMP_Y;
        camera.style.transform = `scale(${phase.scale}) translate(${dx}px, ${dy}px)`;
      },
    },
    0,
  );

  // Content reveals (entry beats inside the camera frame)
  tl.from(".hero", { opacity: 0, y: 32, scale: 0.96, duration: 0.9, ease: "power3.out" }, HERO_AT);
  tl.from(".tagline", { opacity: 0, y: 16, duration: 0.7, ease: "power3.out" }, TAGLINE_AT);
  tl.from(".cta", { opacity: 0, y: 8, duration: 0.7, ease: "power3.out" }, CTA_AT);

  window.__timelines["cam-scene"] = tl;
</script>
```

## How to Choose Values

- **PHASE_1_SCALE / PHASE_2_SCALE / PHASE_3_SCALE** — three-step zoom values
  - Range: PHASE_1 0.88–0.96; PHASE_2 0.98–1.02; PHASE_3 1.04–1.15
  - Effects: tighter spread = subtler camera; wider = more cinematic
  - Constraints: at PHASE_1_SCALE < 1, `.scene` MUST have `overflow: hidden` or the inner content's edges leak outside the frame

- **PHASE_2_AT / PHASE_2_DUR** — when the focus phase starts and how long it takes
  - Range: PHASE_2_AT 0.3–1.0 s; PHASE_2_DUR 1.0–1.8 s
  - Effects: longer DUR = slower settle, more cinematic

- **PHASE_3_AT / PHASE_3_DUR** — when the push phase starts and how long it takes
  - Range: PHASE_3_AT 2.0–4.0 s; PHASE_3_DUR 1.0–2.0 s
  - Constraints: PHASE_3_AT must be ≥ PHASE_2_AT + PHASE_2_DUR (otherwise focus is preempted)

- **PHASE_2_EASE / PHASE_3_EASE** — ease per transition
  - Discrete choice: `power2.out`, `power3.out`, `power2.inOut`
  - Selection: cinematic feel; spring/back easing on a camera feels uncomfortable. Each later phase should imply more settling than the previous (longer dur OR more out-easing).

- **TOTAL_DURATION** — composition's total runtime (matches `data-duration`)
  - Reference: the drift tween must span the whole composition

- **DRIFT_CYCLES** — number of sine cycles across TOTAL_DURATION
  - Range: 1–3
  - Effects: 1 = one slow breath; 3 = noticeably busier
  - Constraints: high values read as mechanical wobble rather than organic drift

- **DRIFT_AMP_X / DRIFT_AMP_Y** — peak drift offset in pixels
  - Range: DRIFT_AMP_X 2–8 px; DRIFT_AMP_Y 1–4 px
  - Effects: per-frame imperceptible, visible over time. If drift is a discrete shake, it's too much.

- **DRIFT_FREQ_RATIO** — multiplier on the Y-axis sine frequency
  - Range: 1.2–1.5
  - Effects: 1.0 = perfect diagonal (reads mechanical); ~1.3 = organic Lissajous

- **HERO_AT / TAGLINE_AT / CTA_AT** — content reveal beats
  - Constraints: HERO_AT should land AFTER PHASE_1 settles via PHASE_2 (otherwise the hero feels like it's flying away while camera is still pulling back)

## Phase Patterns

| Pattern             | Scale Sequence (Phase 1 → 2 → 3)  | Feel                            | When to use                   |
| ------------------- | --------------------------------- | ------------------------------- | ----------------------------- |
| **Focus-in**        | back → neutral → slight push      | Approach → settle → slight push | Default product reveal        |
| **Dramatic reveal** | push → neutral → pull             | Wide → focus → settle back      | Hero shot with breathing room |
| **Steady push**     | neutral → slight push → more push | Gradual forward momentum        | Continuous narrative push     |
| **Bookend pull**    | neutral → strong push → neutral   | Settle → push → release         | CTA emphasis then release     |

## Variations

### Phase trigger by content beat (not time)

If the composition has content phases (e.g. an entry completes, then orbit starts), align the camera tween start time with the content tween's end time rather than using a fixed clock value.

### Camera shake (panic / impact)

For a brief shake instead of drift, replace the drift tween with a higher-amplitude, higher-frequency one over a short window:

```js
tl.to(
  drift,
  {
    p: Math.PI * 2 * SHAKE_CYCLES,
    duration: SHAKE_DUR,
    ease: "none",
    onUpdate: () => {
      const dx = Math.sin(drift.p) * SHAKE_AMP_X;
      const dy = Math.sin(drift.p * SHAKE_FREQ_RATIO) * SHAKE_AMP_Y;
      camera.style.transform = `scale(${phase.scale}) translate(${dx}px, ${dy}px)`;
    },
  },
  SHAKE_AT,
);
```

### Targeted zoom into off-center element

If the climax should zoom into a non-centered element, combine scale with counter-translation. Compute the offset so the target ends at viewport center after scale:

```js
const target = document.querySelector(".cta");
const tRect = target.getBoundingClientRect();
const viewportCenter = { x: STAGE_W / 2, y: STAGE_H / 2 };
const offsetX = (viewportCenter.x - (tRect.left + tRect.width / 2)) / phase.scale;
const offsetY = (viewportCenter.y - (tRect.top + tRect.height / 2)) / phase.scale;
// then in onUpdate: translate(offsetX + dx, offsetY + dy)
```

## Key Principles

- **Drift is imperceptible per-frame, visible over time** — if drift reads as discrete shake, the amplitude is too high
- **Drift X and Y at slightly different frequencies** — `DRIFT_FREQ_RATIO ≈ 1.3` prevents perfect-diagonal motion, which reads as mechanical
- **Phase springs softer than UI springs** — `power2.inOut` or `power3.out` for cinematic feel; spring/back easing on a camera feels uncomfortable
- **Each later phase settles "deeper"** — phase 2 ease should imply more settling than phase 1 (longer duration OR more out-easing). Wakes up → settles → settles deeper
- **Camera wraps EVERYTHING in the scene** — applying camera per-element creates parallax bugs and breaks "this is one viewpoint"
- **❗ overflow: hidden on .scene** — phases that pull back (`scale < 1`) reveal edges of the inner content. Without `overflow: hidden`, those edges leak outside the stage frame and HF renders them as visible content
- **❗ Hero reveal starts AFTER initial pullback ease lands** — if the camera is still pulling back when the headline fades in, the headline feels like it's flying away

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
- [counting-dynamic-scale.md](counting-dynamic-scale.md) — climax phase push synced to counter peak
- [3d-text-depth-layers.md](3d-text-depth-layers.md) — depth-stacked hero with cinematic camera moves
- [sine-wave-loop.md](sine-wave-loop.md) — element idle inside the camera (compound motion)

## Pairs with HF skills

- `/hyperframes-animation` — multi-phase tween + drift onUpdate
- `/hyperframes-core` — composition wiring, scene wrapper
- `/hyperframes-cli` — `hyperframes lint`
