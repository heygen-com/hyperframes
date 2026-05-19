---
name: viewport-change
description: Virtual camera — simulate zoom / pan / focus-lock by transforming a wrapper around all scene content. Camera moves right → world translates left.
metadata:
  tags: viewport, camera, zoom, pan, focus-lock, virtual-camera
---

# Viewport Change (Virtual Camera)

Simulates camera effects (zoom / pan / focus-lock on a moving element) by transforming a wrapper around ALL scene content. The "world" moves opposite to the perceived camera. Distinct from [multi-phase-camera](multi-phase-camera.md) (which is 2-3 discrete phases + drift) — viewport-change is a single continuous zoom/pan, often used for focus-lock following a moving element.

## How It Works

Camera intent → world transform:

- Camera **pans right** → world `translateX(-distance)`
- Camera **zooms in** → world `scale(>1)`
- Camera **follows element X** → world `translateX(viewportCenter - elementWorldX)` updated per-frame

The wrapper holds the camera transform; the elements inside are positioned in "world space" unchanged.

## HTML

```html
<div
  class="scene"
  id="viewport-scene"
  data-composition-id="viewport-scene"
  data-start="0"
  data-duration="5"
  data-track-index="0"
>
  <div class="world" id="world">
    <div class="content">
      <div class="hero" id="hero">HEYGENVERSE</div>
      <div class="tagline">Ship a video in one prompt.</div>
      <div class="cta-row">
        <div class="cta" id="cta">heygenverse.com/start</div>
      </div>
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
  font-family: "Inter", sans-serif;
}
.world {
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
  font-size: 200px;
  font-weight: 900;
  letter-spacing: 8px;
  text-transform: uppercase;
  color: #f5f6fb;
}
.tagline {
  font-size: 56px;
  font-weight: 600;
  color: #cdb8ff;
}
.cta {
  display: inline-block;
  padding: 24px 48px;
  font-family: "JetBrains Mono", monospace;
  font-size: 36px;
  font-weight: 700;
  letter-spacing: 6px;
  color: #a78bfa;
  text-transform: uppercase;
  background: rgba(167, 139, 250, 0.12);
  border: 1px solid rgba(167, 139, 250, 0.4);
  border-radius: 99px;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const world = document.getElementById("world");

  // Camera state: world transform = composite of scale + translate
  const cam = { scale: 1, x: 0, y: 0 };

  function applyCamera() {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`;
  }
  applyCamera();

  // Phase 1 — content reveal at neutral camera (0 → 1.5s)
  tl.from(".hero", { opacity: 0, y: 32, duration: 0.9, ease: "power3.out" }, 0.3);
  tl.from(".tagline", { opacity: 0, y: 16, duration: 0.7, ease: "power3.out" }, 1.0);

  // Phase 2 — zoom in on CTA (1.8 → 3.5s)
  // Single element with transform: `translate(x, y) scale(S)` applies scale FIRST
  // then translate (right-to-left matrix composition). A target at offset is
  // mapped to (S × offset + (x, y)). To land it at viewport center:
  //   x = -offset × S        ← derived from S × offset + x = 0
  // Note: this is DIFFERENT from coordinate-target-zoom (nested wrappers where
  // formula is T = -offset, independent of S). The CSS transform order matters.
  const targetOffsetY = 120; // CTA is 120px below center
  const targetScale = 1.6;
  const counterY = -targetOffsetY * targetScale;

  tl.to(
    cam,
    {
      scale: targetScale,
      y: counterY,
      duration: 1.7,
      ease: "power3.inOut",
      onUpdate: applyCamera,
    },
    1.8,
  );

  // Phase 3 — CTA reveals/dwells (3.5 → 5.0s)
  tl.from("#cta", { opacity: 0, scale: 0.9, duration: 0.6, ease: "back.out(1.6)" }, 3.6);

  window.__timelines["viewport-scene"] = tl;
</script>
```

## Scale Value Guide

| Effect      | Scale       | Feel                                |
| ----------- | ----------- | ----------------------------------- |
| Subtle      | 1.02 - 1.05 | Barely perceptible — "professional" |
| Medium      | 1.05 - 1.15 | "Ta-da" emphasis                    |
| Noticeable  | 1.15 - 1.30 | Focus on region                     |
| Dramatic    | 1.5 - 2.5   | Element fills screen                |
| Full-screen | 3.0+        | Element covers viewport             |

| Perception threshold | Result               |
| -------------------- | -------------------- |
| < 5%                 | Imperceptible        |
| 10-15%               | Comfortable emphasis |
| > 30%                | Cinematic / dramatic |

## Variations

### Focus-lock (camera follows moving cursor/character)

For an element moving across the world, keep it at fixed screen X. Compute world offset per-frame:

```js
const focusEl = document.querySelector(".moving-cursor");
const targetScreenX = 1920 * 0.6; // 60% from left
const focusUpdate = { p: 0 };
tl.to(
  focusUpdate,
  {
    p: 1,
    duration: 3.0,
    ease: "power2.inOut",
    onUpdate: () => {
      const rect = focusEl.getBoundingClientRect();
      const focusWorldX = rect.left + rect.width / 2;
      cam.x = targetScreenX - focusWorldX;
      applyCamera();
    },
  },
  0.5,
);
```

### Composite scale (multi-phase)

Multiply two scale tweens for compound effects:

```js
const scaleUp = { v: 1 };
const scaleDown = { v: 1 };
function applyCompositeCamera() {
  cam.scale = scaleUp.v * scaleDown.v;
  applyCamera();
}
tl.to(scaleUp, { v: 1.15, duration: 1.5, onUpdate: applyCompositeCamera }, 0.5);
tl.to(scaleDown, { v: 0.9, duration: 1.0, onUpdate: applyCompositeCamera }, 2.0);
```

### Camera mode transition (centered → follow)

Crossfade between two camera modes via a 0→1 weight tween. At weight 0, mode A; at weight 1, mode B; intermediate is interpolated.

## Key Principles

- **World moves opposite to perceived camera** — pan camera right = `translateX(-x)` on the world wrapper. Get this sign right, otherwise everything moves the wrong way.
- **`overflow: hidden` on `.scene` REQUIRED** — at any non-1.0 scale the world transform reveals edges or pushes content off-frame.
- **`transform-origin: 50% 50%`** on the world wrapper — centered scaling is what the math assumes.
- **Background on `.scene`, NOT on `.world`** — if background is on the world, transforming the world warps/translates the background.
- **Single source of truth via `cam` object + `applyCamera()`** — when scale and translate both change, write them in ONE place. Otherwise the transform string composition order is unpredictable.
- **Subtle continuous motion > big sudden zoom** — for a feel-natural product video, use 1.05-1.15× zoom over 2-3s. Big > 1.3× zooms read as dramatic narrative moments, save them.
- **❗ Climax dwell ≥1s** — after the zoom settles, the comp must continue for ≥1s so the viewer can read the focal point.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS `transition` on `.world`** — competes with GSAP
- **`will-change: transform`** on `.world`
- **`overflow: hidden` on `.scene`**
- **`transform-origin: 50% 50%` on `.world`**
- **Background on `.scene`** — never on `.world`

## Combinations

- [multi-phase-camera.md](multi-phase-camera.md) — viewport-change inside one phase of a multi-phase camera
- [coordinate-target-zoom.md](coordinate-target-zoom.md) — alternative for off-center zoom (nested wrappers vs single)
- [sine-wave-loop.md](sine-wave-loop.md) — idle micro-drift after viewport settles

## Pairs with HF skills

- `/hyperframes-gsap` — single tween writing composite transform
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
