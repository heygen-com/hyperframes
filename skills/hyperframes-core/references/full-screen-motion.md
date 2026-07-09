# Full-Screen Motion Pattern

For full-frame motion (continuous backgrounds, color washes, full-bleed visual states that span multiple clips), prefer a **shared background layer + transparent timed content layers** over stacked opaque scene backgrounds.

## Why

Stacking opaque scene divs means every scene change has to repaint the entire frame, every cross-scene visual continuity has to be faked, and every "global" state (a hue shift, a vignette, a film grain) has to be duplicated on every scene. A shared background layer driven by the seekable timeline gives you one continuous visual surface and makes scenes themselves cheap and transparent.

## Pattern

```html
<div id="root" data-composition-id="main" data-width="1920" data-height="1080" data-duration="20">
  <!-- Shared background - NOT a clip. Always visible. Driven by the timeline. -->
  <div id="bg" class="full-bleed"></div>

  <!-- Timed content layers: transparent backgrounds. -->
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
  const tl = anime.createTimeline({ autoplay: false });

  // Drive the shared background from the seekable timeline.
  tl.add("#bg", { backgroundColor: "#0a1530", duration: 6000, ease: "inOutSine" }, 0);
  tl.add("#bg", { backgroundColor: "#1a0a30", duration: 14000, ease: "inOutSine" }, 6000);

  // Scene-local animations stay transparent on top.
  tl.add(
    "#scene1 h1",
    { translateY: [48, 0], opacity: [0, 1], duration: 600, ease: "outQuart" },
    200,
  );

  hyperframesAnime.register("main", tl, { labels: { intro: 0, scene2: 6 } });
</script>
```

## Rules

- **The background is not a clip.** No `data-start` / `data-duration` / `data-track-index`. It exists for the whole composition.
- **Content scenes have transparent backgrounds.** Whatever you put in the shared `#bg` shows through.
- **Drive global state from the shared layer.** Hue shifts, vignettes, grain, film-look filters: animate them once on the shared layer, not per-scene.
- **Do not animate visibility on `.clip` elements.** HyperFrames already shows/hides clips based on `data-start` and `data-duration`. Animating `display` / `visibility` on the clip itself races with the framework's own show/hide. Animate a _child wrapper_ inside the clip instead.
- **Verify intentional overflow with snapshots.** Before adding `data-layout-allow-overflow` to silence an inspect warning, run `npx hyperframes snapshot` and confirm the overflow is what you want.

## When Not to Use This Pattern

If scenes really are visually disjoint, with hard cuts between distinct color worlds and no continuity, the stacked-opaque pattern is fine. The shared-background pattern is for compositions where the background **is part of the motion language**, not just backdrop.
