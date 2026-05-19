---
name: ai-tracking-box
description: Animated bounding box with L-shaped corner markers following an oscillating path — simulates AI object detection / tracking.
metadata:
  tags: ai, tracking, bounding-box, detection, corner, yellow, ml
---

# AI Tracking Box

A bounding box with corner markers ("L-brackets") that follows a moving target, simulating real-time AI detection. Position and size oscillate on sine paths to mimic continuous re-computation. Typically rendered in "AI detection yellow" (`#FACC15`) on dark backgrounds with a confidence label.

## How It Works

- Box position `(x, y)` and size `(w, h)` are derived from sine + drift across composition time
- 4 L-bracket corner markers (`<div>` per corner with two-sided borders) sit ON the box
- Optional label tag above the top-left corner showing class name + confidence percent

All driven by GSAP timeline so HF seeks deterministically.

## HTML

```html
<div
  class="scene"
  id="track-scene"
  data-composition-id="track-scene"
  data-start="0"
  data-duration="5"
  data-track-index="0"
>
  <!-- Background — could be a product mockup, hero image, etc. -->
  <div class="bg">
    <div class="bg-content">HEYGENVERSE</div>
    <div class="bg-mascot" id="mascot">🚀</div>
  </div>

  <!-- Tracking box wraps the target -->
  <div class="track-box" id="track-box">
    <div class="corner tl"></div>
    <div class="corner tr"></div>
    <div class="corner bl"></div>
    <div class="corner br"></div>
    <div class="label" id="label">🚀 ROCKET · 98%</div>
  </div>
</div>
```

## CSS

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  background: radial-gradient(ellipse at center, #161a3a 0%, #0b0d1f 70%);
  font-family: "Inter", sans-serif;
  overflow: hidden;
}
.bg {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  gap: 60px;
}
.bg-content {
  position: absolute;
  top: 120px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 80px;
  font-weight: 900;
  color: rgba(167, 139, 250, 0.3);
  letter-spacing: 12px;
  text-transform: uppercase;
}
.bg-mascot {
  position: absolute;
  font-size: 240px;
  line-height: 1;
}

.track-box {
  position: absolute;
  /* Position + size set by GSAP onUpdate */
  pointer-events: none;
  will-change: transform, width, height;
}
.corner {
  position: absolute;
  width: 48px;
  height: 48px;
}
.corner.tl {
  top: -8px;
  left: -8px;
  border-top: 6px solid #facc15;
  border-left: 6px solid #facc15;
}
.corner.tr {
  top: -8px;
  right: -8px;
  border-top: 6px solid #facc15;
  border-right: 6px solid #facc15;
}
.corner.bl {
  bottom: -8px;
  left: -8px;
  border-bottom: 6px solid #facc15;
  border-left: 6px solid #facc15;
}
.corner.br {
  bottom: -8px;
  right: -8px;
  border-bottom: 6px solid #facc15;
  border-right: 6px solid #facc15;
}
.label {
  position: absolute;
  top: -56px;
  left: -8px;
  padding: 8px 16px;
  background: #facc15;
  color: #0b0d1f;
  font-family: "JetBrains Mono", monospace;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 2px;
  border-radius: 6px;
  white-space: nowrap;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const box = document.getElementById("track-box");
  const mascot = document.getElementById("mascot");
  const label = document.getElementById("label");

  // Initial state — box invisible, will fade in
  gsap.set(box, { opacity: 0, scale: 0.7 });

  // Phase 1 — box entry (fade in + scale to 1) at 0.5-1.0s
  tl.to(
    box,
    {
      opacity: 1,
      scale: 1,
      duration: 0.5,
      ease: "back.out(1.4)",
    },
    0.5,
  );

  // Phase 2 — continuous "AI tracking" — box and mascot move in lock-step on sine paths
  const SCREEN_CENTER = { x: 960, y: 540 };
  const DRIFT_X = 80,
    DRIFT_Y = 50;
  const SIZE_BASE = 320,
    SIZE_VAR = 30;
  const SPEED = 0.55; // radians per second

  const tracking = { p: 0 };
  tl.to(
    tracking,
    {
      p: Math.PI * 2 * 1.5, // 1.5 cycles over 4s
      duration: 4.0,
      ease: "none",
      onUpdate: () => {
        // Target position (the mascot moves on a wider arc)
        const mx = SCREEN_CENTER.x + Math.cos(tracking.p) * DRIFT_X;
        const my = SCREEN_CENTER.y + Math.sin(tracking.p) * DRIFT_Y;
        mascot.style.position = "absolute";
        mascot.style.left = `${mx - 120}px`; // mascot is 240px wide
        mascot.style.top = `${my - 120}px`;

        // Box size oscillates slightly (size confidence variation)
        const w = SIZE_BASE + Math.sin(tracking.p * 2.3) * SIZE_VAR;
        const h = SIZE_BASE + Math.sin(tracking.p * 2.3 + Math.PI / 2) * SIZE_VAR;

        // Box position centers on mascot
        box.style.width = `${w}px`;
        box.style.height = `${h}px`;
        box.style.left = `${mx - w / 2}px`;
        box.style.top = `${my - h / 2}px`;

        // Confidence label fluctuates 95-99%
        const confidence = Math.round(97 + Math.sin(tracking.p * 4) * 2);
        label.textContent = `🚀 ROCKET · ${confidence}%`;
      },
    },
    1.0,
  );

  window.__timelines["track-scene"] = tl;
</script>
```

## Variations

### Multi-object detection

Multiple boxes at different phases (each tracking its own mascot). Each is its own onUpdate-driven set; offset their phase by `Math.PI / N` so they don't tick synchronously.

### Lost-then-reacquired

The box fades to 30% opacity (~0.5s) then re-snaps to a new position with a "REACQUIRED" label flash:

```js
tl.to(box, { opacity: 0.3, duration: 0.5 }, 2.0);
tl.to(box, { opacity: 1.0, duration: 0.2, ease: "back.out(2)" }, 2.7);
tl.to(label, { textContent: "REACQUIRED · 99%", duration: 0 }, 2.7);
```

### Tracking-then-zoom

After ~3s of tracking, the camera (via [viewport-change](viewport-change.md)) zooms into the tracked box. Combined effect: "the AI found something, now show it."

## Key Principles

- **Yellow color (`#facc15` or `#FCD34D`) on dark bg** — this is the "AI detection" convention. Other colors (red, blue) read as "warning" or "info" not "detection." Match the convention.
- **Box ALWAYS contains the target** — recompute box position EVERY frame from target position; never trail behind. If the box lags, it reads as "broken tracker," not "smart AI."
- **Subtle size variation (5-10% of base)** — too much and the tracker looks confused; just right reads as "real-time recomputation."
- **Corner markers, not full borders** — L-brackets are the genre signature. Full border looks like a generic UI box.
- **Confidence label flickers in a tight range (95-99%)** — outside that range reads as "uncertain"; >99% reads as "fake-precise."
- **No CSS animation for the tracking — use timeline onUpdate** — HF seek-by-frame doesn't sync with CSS animation.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS animation on `.track-box` or `.corner`** — must be timeline-driven
- **`will-change: transform, width, height`** on `.track-box`
- **`pointer-events: none`** on `.track-box` — decorative overlay
- **Box position recomputed per-frame from target** — never tween box position separately from target

## Combinations

- [viewport-change.md](viewport-change.md) — zoom into the tracked box after detection phase
- [multi-phase-camera.md](multi-phase-camera.md) — wide shot during tracking, push-in on lock
- [sine-wave-loop.md](sine-wave-loop.md) — the mascot itself idle-breathes inside the box

## Pairs with HF skills

- `/hyperframes-gsap` — onUpdate writing multi-element positions
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
