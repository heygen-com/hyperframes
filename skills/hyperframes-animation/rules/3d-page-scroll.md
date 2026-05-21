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
      <!-- Full {Brand} webpage recreation, taller than card height so
           scrolling matters. Each section is real DOM, not a screenshot. -->
      <section class="page-hero">{heroContents}</section>
      <section class="page-features">{featuresContents}</section>
      <section class="page-target" id="target-section">{targetContents}</section>
      <section class="page-cta">{ctaContents}</section>
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
  /* tilt + perspective set in CSS only if no other transform tween touches
     this element. If GSAP also tweens scale on .tilt-card, set the tilt
     via gsap.set() to avoid matrix overwrites. */
  transform: translate(-50%, -50%) perspective({perspectivePx}) rotateY({tiltYDeg}) rotateX({tiltXDeg});
  transform-style: preserve-3d;
  width: {cardWidth};
  height: {cardHeight};
  border-radius: 24px;
  background: {cardBackgroundColor};
  overflow: hidden; /* clip the scrolling content */
  /* shadow X-offset sign must match tiltY sign (negative tiltY ⇒ positive X) */
  box-shadow: 40px 30px 80px rgba(0, 0, 0, 0.45);
}

.page-content {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  /* height is intrinsic from sections — taller than .tilt-card.height */
}

.page-content section {
  height: {sectionHeight}; /* sections sized so cumulative offset = target distance */
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
    {spotlightDimColor} 100%
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
  // Phase 2 — Scroll to the target section.
  // SCROLL_DISTANCE is measured at design time from the page layout
  // (top of .page-content origin to vertical center of #target-section,
  // accounting for card height).
  tl.to(
    ".page-content",
    {
      y: -SCROLL_DISTANCE,
      duration: SCROLL_DUR,
      ease: "power3.out",
    },
    SCROLL_AT,
  );

  // Phase 3 — Spotlight fades in on the target after scroll settles
  tl.to(
    ".spotlight",
    {
      opacity: 1,
      duration: SPOTLIGHT_FADE_DUR,
      ease: "power1.inOut",
    },
    SPOTLIGHT_AT,
  );

  window.__timelines["page-scroll-scene"] = tl;
</script>
```

### Multi-phase scroll variant

```js
// Scroll to section A → hold → scroll to section B.
// SCROLL_DISTANCE_A and SCROLL_DISTANCE_B are both measured from the
// .page-content origin (NOT delta from previous step).
tl.to(
  ".page-content",
  { y: -SCROLL_DISTANCE_A, duration: SCROLL_DUR, ease: "power3.out" },
  SCROLL_AT_A,
);
tl.to(
  ".page-content",
  { y: -SCROLL_DISTANCE_B, duration: SCROLL_DUR, ease: "power3.out" },
  SCROLL_AT_B,
);
```

GSAP composes successive `y:` tweens additively when targeting the same property — each tween starts from the value left by the previous tween.

## How to Choose Values

- **tiltYDeg** — static Y rotation in CSS (or via `gsap.set()`).
  - Range: -12 to -4 (left-leaning) or 4 to 12 (right-leaning); 0 = no perspective rotation.
  - Effects: bigger magnitude = more dramatic 3D; near 0 collapses to a flat panel.
  - Constraints: shadow X-offset sign must match (negative tiltY ⇒ positive box-shadow X).
- **tiltXDeg** — static X rotation.
  - Range: 0-6
  - Effects: positive tilts the top edge away from the viewer.
- **perspectivePx** — perspective distance.
  - Range: 800-2000 px
  - Effects: smaller = more dramatic foreshortening; larger = nearly orthographic.
- **cardWidth / cardHeight** — card frame size.
  - Constraints: card height < total content height, otherwise scroll has nothing to reveal.
- **sectionHeight** — height of each scrolled section.
  - Constraints: sum of all section heights ≥ cardHeight + SCROLL_DISTANCE so the target section ends up within frame after scroll.
- **SCROLL_AT** — timeline second at which the scroll tween begins.
  - Constraints: must be ≥ end of any prior fade-in tweens on `.page-content`.
- **SCROLL_DUR** — duration of one scroll tween.
  - Range: 0.8-1.8 s
  - Effects: shorter feels like a hard cut; longer feels programmatic.
- **SCROLL_DISTANCE** — pixels to translate `.page-content` upward.
  - Constraints: measured once at design time from the target section's offset; NOT a free tunable.
- **SPOTLIGHT_AT** — timeline second at which the spotlight begins fading in.
  - Constraints: should be ≥ SCROLL_AT + SCROLL_DUR (or slightly earlier for overlapping handoff) so the spotlight reveals the freshly-arrived section.
- **SPOTLIGHT_FADE_DUR** — spotlight opacity fade-in duration.
  - Range: 0.4-0.8 s
- Multi-phase variant — **SCROLL_AT_A / SCROLL_AT_B**: must satisfy `SCROLL_AT_A + SCROLL_DUR ≤ SCROLL_AT_B` so the two scrolls don't fight for the y property.

Ease family — discrete choice:

- `power3.out` — heavy deceleration; reads as a programmatic scroll that "lands". Default.
- `power4.out` — even heavier; reads as a momentum-driven scroll.
- `power2.inOut` — symmetric; reads as a cinematic camera pan rather than UI scroll.

Pick one and use it across all scrolls in the scene — mixing easings within one scene reads as jerky.

## Key Principles

- **Tilt is static**, not animated. The card holds its angle the whole scene.
- **Shadow direction matches tilt**: a left-leaning card casts shadow to the right (positive X shadow offset). Mismatch breaks the 3D illusion.
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

- `/hyperframes-animation` — timeline + ease reference; `y:` tween basics
- `/hyperframes-core` — composition wiring, `data-*` attributes
- `/hyperframes-cli` — `hyperframes lint` to verify the registry key + duration
