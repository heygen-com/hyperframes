---
name: coordinate-target-zoom
description: Zoom into a specific non-centered element by combining scale with counter-translation — target ends at viewport center after the zoom completes.
metadata:
  tags: camera, zoom, scale, translate, target, off-center, focus
---

# Coordinate Target Zoom

A simple `scale > 1` on a wrapper pushes off-center content OFF the visible canvas. To zoom _into_ a specific non-centered element, apply scale AND an inverse translation in lockstep so the target lands at viewport center.

## How It Works

Two nested wrappers, separated concerns:

1. **Outer wrapper** applies `scale` (the zoom)
2. **Inner wrapper** applies `translate(x, y)` (the counter-shift)

The translate is the **negation** of the target's offset from center. The inner translate moves the target back to the outer's transform-origin BEFORE the outer scale fires, so the scale around center maps the target to 0.

```
T = -offset
```

Derivation (outer scales the inner-translated content):

1. Inner translate moves target by T in pre-scale units → target at `offset + T`
2. Outer scale S (around center 0,0) maps that to `S × (offset + T)`
3. For target to land at viewport center: `S × (offset + T) = 0` → **`T = -offset`**

Note: the formula does NOT depend on S. The translate amount is the same whether you zoom 1.5×, 2×, or 3× — as long as the OUTER is the scale and the INNER is the translate, and scale uses `transform-origin: 50% 50%`.

## HTML

```html
<div
  class="scene"
  id="zoom-scene"
  data-composition-id="zoom-scene"
  data-start="0"
  data-duration="5"
  data-track-index="0"
>
  <div class="zoom-outer" id="zoom-outer">
    <div class="zoom-inner" id="zoom-inner">
      <div class="content">
        <!-- Several layout elements; one is the "target" -->
        <div class="card other">
          <div class="label">PLAN A</div>
          <div class="price">$0</div>
        </div>
        <div class="card other">
          <div class="label">PLAN B</div>
          <div class="price">$19</div>
        </div>
        <div class="card target" id="target-card">
          <div class="label">HEYGENVERSE PRO</div>
          <div class="price">$49</div>
          <div class="tag">SCALES WITH YOU</div>
        </div>
        <div class="card other">
          <div class="label">PLAN D</div>
          <div class="price">$199</div>
        </div>
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
}
.zoom-outer {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  transform-origin: 50% 50%;
  will-change: transform;
}
.zoom-inner {
  display: grid;
  place-items: center;
  will-change: transform;
}
.content {
  display: flex;
  gap: 48px;
}
.card {
  width: 360px;
  padding: 48px 32px;
  border-radius: 24px;
  background: rgba(20, 24, 56, 0.75);
  border: 1px solid rgba(167, 139, 250, 0.18);
  text-align: center;
  font-family: "Inter", sans-serif;
}
.card.target {
  background: linear-gradient(160deg, rgba(167, 139, 250, 0.4) 0%, rgba(20, 24, 56, 0.85) 70%);
  border: 2px solid rgba(167, 139, 250, 0.6);
  box-shadow: 0 24px 80px rgba(167, 139, 250, 0.3);
}
.label {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 6px;
  text-transform: uppercase;
  color: #cdb8ff;
}
.price {
  font-size: 96px;
  font-weight: 900;
  color: #f5f6fb;
  margin: 16px 0;
  font-variant-numeric: tabular-nums;
}
.tag {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 4px;
  color: #a78bfa;
  opacity: 0;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Target is the 3rd card. Cards are 360px wide + 48px gap = 408px center-to-center.
  // 4 cards span: total width 4*360 + 3*48 = 1584px, centered at viewport center.
  // Card 3 (target) is at index 2 (0-indexed). Its center offset from layout center:
  //   index_offset = 2 - (4 - 1) / 2 = 2 - 1.5 = +0.5
  //   x_offset = 0.5 * 408 = 204px to the right of center
  const TARGET_OFFSET_X = 204;
  const TARGET_OFFSET_Y = 0;
  const ZOOM_SCALE = 2.0;

  // Counter-translation = -offset (inner translate cancels target offset BEFORE outer scales)
  const counterX = -TARGET_OFFSET_X;
  const counterY = -TARGET_OFFSET_Y;

  // Phase 1 — cards reveal (0 → 0.8s)
  tl.from(".card", { opacity: 0, y: 32, stagger: 0.1, duration: 0.6, ease: "power3.out" }, 0.2);

  // Phase 2 — pause to let viewer scan the layout (rest at 1.2s)

  // Phase 3 — zoom into target (1.5s → 3.0s)
  tl.to(
    "#zoom-outer",
    {
      scale: ZOOM_SCALE,
      duration: 1.5,
      ease: "power3.inOut",
    },
    1.5,
  );
  tl.to(
    "#zoom-inner",
    {
      x: counterX,
      y: counterY,
      duration: 1.5,
      ease: "power3.inOut",
    },
    1.5,
  );

  // Phase 4 — target "tag" reveals inside the zoomed-in target (3.0s → 3.5s)
  tl.to(".target .tag", { opacity: 1, duration: 0.5, ease: "power2.out" }, 3.0);

  // Phase 5 — climax dwell (3.5 → 5.0s) — viewer reads $49 + SCALES WITH YOU
  // (no additional motion; the zoomed-in state holds for ~1.5s)

  window.__timelines["zoom-scene"] = tl;
</script>
```

## Variations

### Dynamic target lookup via `getBoundingClientRect`

When the target's exact position isn't known at author time (e.g. flex layout, variable font width), measure at runtime BEFORE the timeline plays:

```js
const target = document.getElementById("target-card");
const viewport = { x: 1920 / 2, y: 1080 / 2 };
const rect = target.getBoundingClientRect();
const targetCenterX = rect.left + rect.width / 2;
const targetCenterY = rect.top + rect.height / 2;
const offsetX = targetCenterX - viewport.x;
const offsetY = targetCenterY - viewport.y;
```

But beware: HF compositions render at a fixed canvas size; `getBoundingClientRect` only works after `DOMContentLoaded` and may be off if fonts are still loading.

### Zoom out (target → wide view)

Reverse the phases — start at zoomed-in, then `scale: 1` + `x: 0, y: 0` to pull back. The "reveal" beat is the panorama.

### Multi-target zoom sequence

Chain multiple zooms: target A (1.5-2.5s) → pause → target B (3-4s) → pull back (4.5-5s). Each segment needs its own counter-translation pair.

## Key Principles

- **Transform order — outer scales, inner translates** — DO NOT put scale and translate on the SAME element. The transform math becomes tangled (`translate * scale` ≠ `scale * translate` in CSS transform composition). Nested wrappers cleanly separate concerns.
- **Counter-translate = -offset** — independent of scale. Derive from: outer scale around center maps `(offset + T)` to `S × (offset + T)`. Setting that to zero gives `T = -offset`. A common wrong intuition is `T = -offset × (S - 1)` — it happens to give the same answer at S=2 but is wrong for any other S.
- **`transform-origin: 50% 50%` on outer wrapper** — non-center origin causes unpredictable inner offset; always center.
- **`overflow: hidden` on `.scene` REQUIRED** — at zoom > 1, the outer-scaled content can leak beyond the 1920×1080 frame.
- **Tween scale and counter-translate together** — they MUST share `duration` and `ease`. Otherwise the target drifts mid-zoom (visible "wandering"). Easiest: pass identical params to both tweens at the same time position.
- **❗ Climax dwell ≥1s after zoom completes** — see SKILL universal constraints. If zoom ends at t=3.0 in a 3.5s comp, viewer barely sees the target; aim for 1.5-2s post-zoom dwell.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS `transition` on `.zoom-outer` or `.zoom-inner`** — competes with GSAP
- **`will-change: transform`** on both wrappers — the transforms update every frame during the zoom phase
- **`transform-origin: 50% 50%` on `.zoom-outer`** — center-based scaling is what the counter-translate math assumes
- **Target offset values are fixed constants** — don't recompute every frame in onUpdate; bake to constants at author time or compute once before play

## Combinations

- [multi-phase-camera.md](multi-phase-camera.md) — multi-phase camera that includes a coordinate-target-zoom phase
- [sine-wave-loop.md](sine-wave-loop.md) — idle breathing on the target AFTER zoom settles
- [discrete-text-sequence.md](discrete-text-sequence.md) — text assembly in the target BEFORE zoom completes

## Pairs with HF skills

- `/hyperframes-gsap` — two coordinated tweens
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
