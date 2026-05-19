---
name: press-release-spring
description: Tactile button press with linear compression, spring-based elastic recovery, and layered visual feedback (shadow shrink + release burst + background glow).
metadata:
  tags: spring, press, interaction, button, physics, glow, burst, ui
---

# Press-Release Spring Chain

Separates input (linear compression) from output (spring recovery) to create tactile feel. The overshoot is a natural byproduct of spring config, not manually coded. Pairs with secondary motion (shadow, burst, background glow) layered on the same trigger frame.

## How It Works

Two distinct phases split at the **release** moment:

1. **Press** (~0 → 0.3s): Linear ease → compression (`scale 1.0 → ~0.92`, shadow shrinks)
2. **Release** (~0.3 → 1.1s): `back.out(2.0)` spring → elastic pop back to 1.0 (overshoot ~1.04), shadow expands, optional **burst glow** ring expands behind the button, optional **background glow** fades in.

State continuity is critical: the release start value MUST match the press end value exactly, or the spring snaps to a different position.

## HTML

```html
<div
  class="scene"
  id="press-scene"
  data-composition-id="press-scene"
  data-start="0"
  data-duration="2"
  data-track-index="0"
>
  <div class="press-stage">
    <div class="bg-glow" id="bg-glow"></div>
    <div class="burst" id="burst"></div>
    <button class="btn" id="btn">SHIP IT</button>
  </div>
</div>
```

## CSS

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: #0b0d1f;
}
.press-stage {
  position: relative;
  display: grid;
  place-items: center;
}
.btn {
  position: relative;
  z-index: 2;
  /* Visual weight: ≥4% of canvas for the press to read on a 1080p frame */
  width: 720px;
  height: 160px;
  background: linear-gradient(135deg, #a78bfa 0%, #6366f1 100%);
  border: none;
  border-radius: 28px;
  font-family: "Inter", sans-serif;
  font-weight: 900;
  font-size: 72px;
  letter-spacing: 8px;
  color: #fff;
  text-transform: uppercase;
  cursor: pointer;
  /* Anchor compression on the center — use centerpiece transform-origin */
  transform-origin: 50% 50%;
  /* Initial floating shadow — large + diffuse */
  box-shadow: 0 24px 80px rgba(108, 99, 255, 0.5);
}
.burst {
  /* Sits BEHIND the button, same footprint */
  position: absolute;
  z-index: 1;
  inset: 0;
  width: 720px;
  height: 160px;
  background: radial-gradient(
    ellipse,
    rgba(180, 100, 255, 0.9) 0%,
    rgba(140, 80, 220, 0.4) 40%,
    transparent 70%
  );
  filter: blur(80px);
  opacity: 0;
  transform: scale(1);
  pointer-events: none;
}
.bg-glow {
  /* Full-stage radial */
  position: absolute;
  inset: -400px;
  background: radial-gradient(
    circle,
    rgba(167, 139, 250, 0.25) 0%,
    rgba(99, 102, 241, 0.1) 35%,
    transparent 75%
  );
  opacity: 0;
  pointer-events: none;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Phase 1 — press (linear compression)
  tl.to(
    "#btn",
    {
      scale: 0.92,
      boxShadow: "0 4px 16px rgba(108, 99, 255, 0.25)",
      duration: 0.3,
      ease: "power1.in",
    },
    0.2,
  );

  // Phase 2 — release (spring back with overshoot)
  // CRITICAL: start scale == end of phase 1 (0.92) to maintain state continuity
  tl.to(
    "#btn",
    {
      scale: 1,
      boxShadow: "0 24px 80px rgba(108, 99, 255, 0.5)",
      duration: 0.8,
      ease: "back.out(2)", // overshoot ~1.04 then settle to 1.0
    },
    0.5,
  );

  // Phase 3 — burst glow (radial pop behind button) — same trigger as release
  tl.fromTo(
    "#burst",
    { scale: 1, opacity: 0 },
    {
      scale: 6,
      opacity: 0.8,
      duration: 0.6,
      ease: "power2.out",
    },
    0.5,
  );
  // Burst then fades out
  tl.to("#burst", { opacity: 0, duration: 0.6, ease: "power2.in" }, 1.0);

  // Phase 4 — background environmental glow fades in after release
  tl.to(
    "#bg-glow",
    {
      opacity: 1,
      duration: 0.8,
      ease: "power2.out",
    },
    0.5,
  );

  window.__timelines["press-scene"] = tl;
</script>
```

## Variations

### Subtle press (status save / muted CTA)

| Parameter               | Value           |
| ----------------------- | --------------- |
| Press scale             | 0.96 (vs 0.92)  |
| Release ease            | `back.out(1.4)` |
| Burst end scale         | 3               |
| Burst opacity peak      | 0.4             |
| Background glow opacity | 0.1             |

### Dramatic press (hero CTA / "ship it" moment)

| Parameter               | Value                            |
| ----------------------- | -------------------------------- |
| Press scale             | 0.88                             |
| Release ease            | `back.out(2.5)` (more overshoot) |
| Burst end scale         | 8                                |
| Burst opacity peak      | 1.0                              |
| Background glow opacity | 0.4                              |

### Color shift during press

Darken the button mid-press, return on release:

```js
tl.to("#btn", { backgroundColor: "#4338ca", duration: 0.3 }, 0.2);
tl.to("#btn", { backgroundColor: "#6366f1", duration: 0.4 }, 0.5);
```

## Key Principles

- **State continuity** — release start value MUST exactly match press end value. If press ends at `scale: 0.92`, release MUST start at `scale: 0.92`. With GSAP timeline, the first tween's end value automatically becomes the second tween's start when they target the same property at adjacent times.
- **Visual weight** — button area should be **≥3-5% of canvas**. A 320×68 button at 1080p is ~1% and reads as visually insignificant. Default to 600-800×120-170 for a hero CTA.
- **Spring config for overshoot** — use `back.out(2.0)` for clear pop. `back.out(1.0)` is barely perceptible; `back.out(3.0+)` is cartoonish for a button.
- **Anchor compression on center** — `transform-origin: 50% 50%` (default). Otherwise the button collapses asymmetrically.
- **Burst behind, not in front** — burst element `z-index: 1`, button `z-index: 2`. If burst sits in front, it occludes the button at peak opacity.
- **Glow color darker + more saturated than element** — bright orange element → glow is dark red-orange. Same-color glow looks washed out.
- **❗ Don't tween `boxShadow` and `filter` together on the same element** — they compete in the layout pipeline; pick one. Shadow on the button, blur on a separate burst layer.
- **❗ Climax beats need dwell time** — after the burst peak + subtitle/wordmark reveal, the composition must run for **≥1s more** (≥2s for "dramatic" variants) before ending. A reveal at t=1.0 in a 2s comp = 1s dwell, which reads as "flashed and gone." Default 3s+ for dramatic press chains; 2s minimum only for the most subtle status-toggle variant where there's no wordmark reveal.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS `transition`** on the button — those interpolate independently of HF seek and cause flicker
- **`will-change: transform`** if the button compounds with other animation layers
- **Burst max scale ≤ ~8** — beyond that the radial gradient pixelates visibly
- **Background glow `opacity ≤ 0.45`** — higher and it washes the whole composition

## Combinations

- [sine-wave-loop.md](sine-wave-loop.md) — idle micro-float on the button BEFORE the press (slight breathing, sells "ready")
- [center-outward-expansion.md](center-outward-expansion.md) — burst of badges outward synced to the press release
- [cursor-click-ripple.md](cursor-click-ripple.md) — cursor click that triggers the press

## Pairs with HF skills

- `/hyperframes-gsap` — `back.out` ease + multi-tween coordination
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
