---
name: 3d-page-scroll
description: Full webpage rendered as tilted 3D card that scrolls to reveal specific sections.
metadata:
  tags: 3d, page, scroll, webpage, tilt, product-demo, perspective
---

# 3D Page Scroll

A webpage (or long content) presented as a tilted 3D card. Spring-eased scroll reveals specific sections while the static 3D perspective adds physical depth.

## How It Works

Two independent transforms combine:

1. **3D tilt** — Static `rotateY` + `rotateX` with `perspective` on the card. The angle does **not** change during the scene.
2. **Scroll** — The content inside the card translates vertically (`translateY` / `y` in GSAP) within a clipped container, driven by a GSAP tween. Spring-like deceleration via `ease: "power3.out"` or `"power4.out"`.

Optional layer:

3. **Spotlight overlay** — A radial-gradient mask dims everything except a focal region after the scroll lands. Use to draw attention to one section.

For multi-step scrolling (scroll → pause → scroll), use multiple `tl.to(".page-content", { y: -<distance>, ... }, <position>)` calls at different timeline positions.

## HTML

```html
<div
  class="scene"
  id="page-scroll-scene"
  data-composition-id="page-scroll-scene"
  data-start="0"
  data-duration="5"
  data-track-index="0"
>
  <div class="tilt-card">
    <div class="page-content">
      <!-- Full webpage recreation, taller than card.height so scrolling matters -->
      <section class="page-hero">Hedronverse — hero section</section>
      <section class="page-features">Features section</section>
      <section class="page-pricing" id="target-section">Pricing section (scroll target)</section>
      <section class="page-cta">CTA section</section>
    </div>

    <div class="spotlight"></div>
  </div>
</div>
```

## CSS (hero-frame layout)

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
}

.tilt-card {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%) perspective(1500px) rotateY(-8deg) rotateX(3deg);
  transform-style: preserve-3d;
  width: 1400px;
  height: 800px;
  border-radius: 24px;
  background: #0e1130;
  overflow: hidden; /* clip the scrolling content */
  box-shadow: 40px 30px 80px rgba(0, 0, 0, 0.45); /* shadow falls toward right because card leans left */
}

.page-content {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  /* height is intrinsic from sections — taller than .tilt-card.height */
}

.page-content section {
  height: 800px; /* example: each section is one card-height */
  padding: 64px;
  /* section-specific styling … */
}

.spotlight {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0;
  background: radial-gradient(
    ellipse 60% 35% at 50% 50%,
    transparent 50%,
    rgba(0, 0, 0, 0.75) 100%
  );
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Phase 1 — Card enters (optional, can skip if card is in from t=0)
  // Phase 2 — Scroll to the target section
  // Target section #target-section is offset 1600px down (sections 2 + 3).
  // To bring it into view centered, scroll content up by 1600px.
  tl.to(
    ".page-content",
    {
      y: -1600,
      duration: 1.5,
      ease: "power3.out",
    },
    1.0,
  );

  // Phase 3 — Spotlight fades in on the target after scroll settles
  tl.to(
    ".spotlight",
    {
      opacity: 1,
      duration: 0.6,
      ease: "power1.inOut",
    },
    2.4,
  );

  window.__timelines["page-scroll-scene"] = tl;
</script>
```

### Multi-phase scroll variant

```js
// Scroll to section A → hold → scroll to section B
tl.to(".page-content", { y: -800, duration: 1.0, ease: "power3.out" }, 0.5);
tl.to(".page-content", { y: -2000, duration: 1.2, ease: "power3.out" }, 2.5);
```

GSAP composes successive `y:` tweens additively when targeting the same property — each tween starts from the value left by the previous tween.

## Key Principles

- **Tilt is static**, not animated. The card holds its angle the whole scene.
- **Shadow direction matches tilt**: left-leaning card (`rotateY: -8deg`) casts shadow to the right (positive X shadow offset). Mismatch breaks the 3D illusion.
- **Page content is real HTML**, not a screenshot. Screenshots can't be individually highlighted or scrolled-to with precision.
- **Use real layout for distances**: scroll target distance comes from the actual cumulative section heights, not estimated pixel values.
- **Spotlight as overlay**, not inside the page-content — overlay sits above scrolling content and stays fixed relative to the card.

## Critical Constraints

- **`overflow: hidden` on `.tilt-card`** — scrolling content must clip at card boundaries, otherwise it leaks past the rounded corners
- **`transform-style: preserve-3d`** on `.tilt-card` — required for any 3D children (or for combining `perspective` with rotations cleanly)
- **Timeline must be paused**: `gsap.timeline({ paused: true })`. Never `tl.play()` — HF seeks frame-by-frame
- **Registry key = `data-composition-id`**: `window.__timelines["page-scroll-scene"]` must match scene root's `data-composition-id`
- **Finite scroll distance** — compute from actual content geometry; don't use arbitrary values that may overshoot the content end
- **Same easing across multi-phase scroll** — mixing `power3.out` and `power1.inOut` looks jerky; pick one for the scene

## Combinations

- [asr-keyword-glow.md](asr-keyword-glow.md) — highlight elements on the page synced to voiceover word timestamps
- [multi-phase-camera.md](multi-phase-camera.md) — overall camera zoom while the page scrolls (zoom-in to target section as it lands)
- [cursor-click-ripple.md](cursor-click-ripple.md) — cursor lands on a UI element within the scrolled-into-view section

## Pairs with HF skills

- `/hyperframes-gsap` — timeline + ease reference; `y:` tween basics
- `/hyperframes-core` — composition wiring, `data-*` attributes
- `/hyperframes-cli` — `hyperframes lint` to verify the registry key + duration
