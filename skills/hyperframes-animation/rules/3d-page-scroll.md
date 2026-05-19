---
name: 3d-page-scroll
description: Full webpage rendered as a tilted 3D card whose internal content scrolls to reveal specific sections. GSAP tweens the scroll-content's `y`; the card's tilt is static.
metadata:
  tags: 3d, page, scroll, webpage, tilt, perspective, product-demo, gsap
  adapter: gsap
---

# 3D Page Scroll

A webpage (or long content) presented as a tilted 3D card. GSAP-driven `y` translation reveals specific sections while the 3D perspective adds premium depth. Two layers of motion separated cleanly:

- **3D tilt**: static `rotateY` + `rotateX` on the outer card (no animation, just CSS)
- **Scroll**: `y` translation on the inner content (GSAP tween)

## HyperFrames vs. Remotion

Identical pattern. Both use a fixed-perspective outer container, a clipped tilted card, and a scrollable inner content. The only difference is the scroll driver: Remotion's `spring()` becomes a GSAP tween with `power3.out` / `power2.inOut` ease.

## Core Concept

```
.perspective-wrap        perspective: 1200px       fixed CSS
  .page-card             rotateY(-8deg) rotateX(3deg) scale(...)
                         transform-style: preserve-3d
                         overflow: hidden
    .scroll-content      y: 0 → -scrollDistance     GSAP tween
       [full page DOM, taller than visible height]
    .spotlight-overlay   radial-gradient mask        opacity tween in Phase 3
```

## Basic Pattern

```html
<div class="perspective-wrap">
  <div class="page-card">
    <div class="scroll-content">
      <!-- A recreation of your webpage — taller than .page-card. -->
      <header class="page-navbar">…</header>
      <section class="page-hero">…</section>
      <section class="page-features">…</section>
      <section class="page-carousel">…</section>
    </div>
    <div class="spotlight-overlay"></div>
  </div>
</div>

<style>
  .perspective-wrap {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    perspective: 1200px;
  }
  .page-card {
    width: 92%;
    height: 88%;
    overflow: hidden;
    border-radius: 20px;
    background: var(--page-bg, #0a0a0f);
    transform-style: preserve-3d;
    transform: rotateY(-8deg) rotateX(3deg) scale(0.95);
    box-shadow:
      -30px 30px 60px rgba(0, 0, 0, 0.4),
      -15px 15px 30px rgba(0, 0, 0, 0.3),
      0 0 80px rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .scroll-content {
    will-change: transform;
  }
  .spotlight-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    opacity: 0; /* GSAP tween reveals it during Phase 3 */
  }
</style>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // ============================================================
  // ENTRY — card scales up from 0.95
  // ============================================================
  tl.fromTo(".page-card", { scale: 0.95 }, { scale: 1.0, duration: 0.8, ease: "power2.out" }, 0);

  // ============================================================
  // SCROLL — content translates up to reveal a lower section
  // ============================================================
  const SCROLL_START = 3.08;
  const SCROLL_DISTANCE = 280; // px — depends on the page layout

  tl.fromTo(
    ".scroll-content",
    { y: 0 },
    { y: -SCROLL_DISTANCE, duration: 1.0, ease: "power2.inOut" },
    // power2.inOut feels like a programmatic scroll (slow in, slow out).
    // For a more snappy "jump" feel use power3.out.
    SCROLL_START,
  );

  // ============================================================
  // SPOTLIGHT — reveal the radial-gradient mask after scroll
  // ============================================================
  tl.to(
    ".spotlight-overlay",
    {
      opacity: 1,
      duration: 0.5,
      ease: "power2.out",
    },
    SCROLL_START + 0.5,
  );

  window.__timelines["main"] = tl;
</script>
```

## Spotlight Overlay

Draws attention to the post-scroll target by dimming surroundings. Set the radial-gradient center to the _visible_ target's location, which is its absolute position in the inner content **minus** the scroll offset.

```css
.spotlight-overlay {
  background: radial-gradient(
    ellipse 850px 550px at 40% 60%,
    /* center the highlight on the target */ transparent 0%,
    transparent 50%,
    rgba(0, 0, 0, 0.65) 100%
  );
}
```

For multiple successive spotlights (different target per phase), use multiple overlays each with their own GSAP opacity tween. Don't try to animate the gradient stops — only tween the overlay's `opacity` and let CSS hold the static gradient shape.

## Multi-Phase Scroll

Scroll to different sections at different times. Each phase is one tween that animates `y` to the new target offset. GSAP overwrite handles the merging:

```js
tl.to(".scroll-content", { y: -280, duration: 1.0, ease: "power2.inOut" }, 3.08);
tl.to(".scroll-content", { y: -640, duration: 1.0, ease: "power2.inOut" }, 6.5);
tl.to(".scroll-content", { y: -280, duration: 1.0, ease: "power2.inOut" }, 9.2); // back up
```

Don't sum springs like the Remotion source — each tween's _absolute_ target is what GSAP animates to. The math is simpler.

## Tilt Reference

| Tilt                               | rotateY | rotateX | Shadow direction               |
| ---------------------------------- | ------- | ------- | ------------------------------ |
| Left-leaning (default)             | `-8deg` | `3deg`  | Shadow falls **right**         |
| Right-leaning                      | `8deg`  | `3deg`  | Shadow falls **left**          |
| Forward-tilted (catalog page feel) | `0deg`  | `8deg`  | Shadow falls **down**          |
| Floating flat                      | `-4deg` | `2deg`  | Subtle, more "iso" perspective |

`perspective: 1200px` is the standard distance. Lower values (600–800) exaggerate the depth; higher (1500–2000) flatten it.

## Critical Constraints

- **Page must be a DOM recreation, not a screenshot**: Screenshots can't have individually highlighted/animated elements. Recreate the layout with real HTML.
- **`overflow: hidden` on the card**: Scrolling content must clip at card boundaries. Without it, content spills out and the 3D tilt looks wrong.
- **`transform-style: preserve-3d` on the card**: Required so children with their own `translateZ` (for [asr-keyword-glow](asr-keyword-glow.md) 3D pop-outs) participate in the 3D space.
- **Shadow direction matches tilt**: Left-leaning card = shadow falls right (positive X). Mismatched shadow reads as a flat layer with a fake shadow filter.
- **Inner content must be taller than card**: Otherwise there's nothing to scroll. Layout the full page; `overflow: hidden` clips what's off-screen.
- **`y`, not `top` / `margin-top`**: GSAP transform alias. Layout properties are banned by the HF allowlist and would force a reflow each frame.
- **Tilt is static, scroll animates**: Don't animate the tilt — it feels like a UI flip rather than a camera setup. Set tilt in CSS once.
- **Single paused timeline**: Entry + scroll + spotlight all on one `gsap.timeline({ paused: true })`.

## Combinations

- Pair with [asr-keyword-glow](asr-keyword-glow.md) — highlight elements _on_ the scrolled page synced to voiceover words.
- Wrap inside [multi-phase-camera](multi-phase-camera.md) for a subtle camera push _while_ the page scrolls.
- Combine with [coordinate-target-zoom](coordinate-target-zoom.md) on the inner content for "zoom into the feature after the scroll lands."

## Examples

- [demo-page-scroll-spotlight.html](../examples/demo-page-scroll-spotlight.html) — OpusClip landing page as a tilted 3D card, scrolls down 280 px to reveal the video carousel, then a radial spotlight + 3D pop-out highlight the main video.
