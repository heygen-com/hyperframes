# Full-Screen Motion Pattern

For full-frame motion (continuous backgrounds, color washes, full-bleed visual states that span multiple clips), prefer a **shared background layer + transparent timed content layers** over stacked opaque scene backgrounds.

## Why

Stacking opaque scene divs means every scene change has to repaint the entire frame, every cross-scene visual continuity has to be faked, and every "global" state (a hue shift, a vignette, a film grain) has to be duplicated on every scene. A shared background layer driven by the seekable timeline gives you one continuous visual surface and makes scenes themselves cheap and transparent.

## Pattern

```html
<style>
  /* The runtime auto-positions root children that carry data-start. The shared
     background deliberately has none, so it gets NO automatic layout and must
     size itself, or #bg is 0px tall and the tween paints nothing. */
  #bg.full-bleed {
    position: absolute;
    inset: 0;
  }
  .clip.transparent {
    background: transparent;
  }
</style>

<div id="root" data-composition-id="main" data-width="1920" data-height="1080" data-duration="20">
  <!-- Shared background — NOT a clip. Always visible. Driven by the timeline. -->
  <div id="bg" class="full-bleed"></div>

  <!-- Timed content layers — transparent backgrounds. -->
  <section
    id="scene1"
    class="clip transparent"
    data-start="0"
    data-duration="6"
    data-track-index="1"
  >
    <!-- content -->
  </section>
  <section
    id="scene2"
    class="clip transparent"
    data-start="6"
    data-duration="14"
    data-track-index="1"
  >
    <!-- content -->
  </section>
</div>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Drive the shared background from the seekable timeline.
  tl.to("#bg", { backgroundColor: "#0a1530", duration: 6, ease: "sine.inOut" }, 0);
  tl.to("#bg", { backgroundColor: "#1a0a30", duration: 14, ease: "sine.inOut" }, 6);

  // Scene-local animations stay transparent on top.
  tl.from("#scene1 h1", { y: 48, opacity: 0, duration: 0.6 }, 0.2);

  window.__timelines["main"] = tl;
</script>
```

## Rules

- **The background is not a clip.** No `data-start` / `data-duration`. It exists for the whole composition.
- **Because it is not a clip, it gets no automatic layout.** The runtime only positions and sizes root children that carry `data-start`. An untimed background must set its own `position: absolute; inset: 0`, or it collapses to zero height and nothing you animate on it is visible. This is the most common way this pattern is copied wrong.
- **Content scenes have transparent backgrounds.** Whatever you put in the shared `#bg` shows through.
- **Drive global state from the shared layer.** Hue shifts, vignettes, grain, film-look filters — animate them once on the shared layer, not per-scene.
- **Do not animate visibility on `.clip` elements.** HyperFrames already shows/hides clips based on `data-start` and `data-duration`. Animating `display` / `visibility` on the clip itself races with the framework's own show/hide. Animate a _child wrapper_ inside the clip instead.
- **Verify intentional overflow with snapshots.** Before adding `data-layout-allow-overflow` to silence an inspect warning, run `npx hyperframes snapshot` and confirm the overflow is what you want.

## When Not to Use This Pattern

If scenes really are visually disjoint — hard cuts between distinct color worlds with no continuity — the stacked-opaque pattern is fine. The shared-background pattern is for compositions where the background **is part of the motion language**, not just backdrop.
