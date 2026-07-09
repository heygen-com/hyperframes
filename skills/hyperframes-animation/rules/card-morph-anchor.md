---
name: card-morph-anchor
description: Container morphs dimensions and border-radius between shots, serving as a visual transition anchor.
metadata:
  tags: morph, anchor, transition, border-radius, container, shape
---

# Card Morph Anchor

A container smoothly transforms its width, height, border-radius, and (optionally) background between two visual states. The morph itself **IS the shot transition** - no separate transition effect needed. The viewer's eye tracks the morphing container as the anchor between shots.

## How It Works

A single anime.js tween animates multiple container properties simultaneously (width / height / border-radius / background). At the same time:

1. **Old content** fades out during the first ~40% of the morph
2. **New content** fades in during the last ~40% of the morph
3. **Optional final fade** - the morph container itself fades to 0, revealing the actual next-shot element rendered behind it

The persistent container provides visual continuity even as content and shape change.

## HTML

```html
<div
  class="scene"
  id="morph-scene"
  data-composition-id="morph-scene"
  data-start="0"
  data-duration="4"
  data-track-index="0"
>
  <!-- The persistent morph container -->
  <div class="morph-card">
    <div class="content-old">
      <h2>{shotOneHeadline}</h2>
      <p>{shotOneSubcopy}</p>
    </div>
    <div class="content-new">
      <img src="{shotTwoIcon}" alt="logo" />
    </div>
  </div>

  <!-- Optional: actual next-shot element behind the morph -->
  <div class="next-shot-anchor">
    <img src="{nextShotAnchor}" alt="anchor" />
  </div>
</div>
```

## CSS (hero-frame layout)

Card starts as a wide rectangle (shot 1 state). All properties present from the start; only opacities differ:

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
}

.morph-card {
  position: relative;
  width: {SHOT_ONE_W}px;
  height: {SHOT_ONE_H}px;
  border-radius: {SHOT_ONE_RADIUS}px;
  background: {surfaceShotOne};
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
  display: grid;
  place-items: center;
}

.content-old,
.content-new {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 32px;
}

.content-old {
  opacity: 1;
}
.content-new {
  opacity: 0;
}

.next-shot-anchor {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  opacity: 0; /* anime.js fades this in as morph card fades out */
  /* Use DOM ORDER for stacking - render .next-shot-anchor BEFORE .morph-card
     in markup so the morph card is naturally on top. Do NOT use z-index: -1
     and then snap it positive mid-fade - that causes a visible pop. */
}
```

## Anime.js Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
<script>
  const tl = anime.createTimeline({ autoplay: false });

  // Named constants - assign in your example only. See "How to Choose Values".
  const HOLD_BEAT; // s - pre-morph dwell on shot 1
  const MORPH_START; // s - usually = HOLD_BEAT
  const MORPH_DUR; // s - full container morph length
  const SHOT_TWO_W; // px - final container width
  const SHOT_TWO_H; // px - final container height
  const SHOT_TWO_RADIUS; // px - ≤ min(SHOT_TWO_W, SHOT_TWO_H) / 2
  const OLD_FADE_FRAC; // 0..0.5 - fraction of MORPH_DUR for old content fade
  const NEW_FADE_FRAC; // 0..0.5 - fraction of MORPH_DUR for new content fade
  const FINAL_FADE_FRAC; // 0..0.3 - optional tail fade for handoff
  // {surfaceShotTwo} is a CSS background token (solid or gradient).

  // Hold shot 1 - let the viewer register the wide banner before morphing.

  // Phase 1 - Morph container properties simultaneously
  tl.add(
    ".morph-card",
    {
      width: SHOT_TWO_W,
      height: SHOT_TWO_H,
      borderRadius: SHOT_TWO_RADIUS,
      background: "{surfaceShotTwo}",
      duration: MORPH_DUR * 1000,
      ease: "inOutCubic",
    },
    MORPH_START * 1000,
  );

  // Phase 2 - Old content fades during the FIRST OLD_FADE_FRAC of the morph
  tl.add(
    ".content-old",
    {
      opacity: 0,
      duration: MORPH_DUR * OLD_FADE_FRAC * 1000,
      ease: "inQuad",
    },
    MORPH_START * 1000,
  );

  // Phase 3 - New content fades in during the LAST NEW_FADE_FRAC of the morph
  tl.add(
    ".content-new",
    {
      opacity: 1,
      duration: MORPH_DUR * NEW_FADE_FRAC * 1000,
      ease: "outQuad",
    },
    (MORPH_START + MORPH_DUR * (1 - NEW_FADE_FRAC)) * 1000,
  );

  // Optional Phase 4 - Final fade: morph container disappears at the very end,
  // revealing the actual next-shot element behind it.
  tl.add(
    ".morph-card",
    {
      opacity: 0,
      duration: MORPH_DUR * FINAL_FADE_FRAC * 1000,
      ease: "inQuad",
    },
    (MORPH_START + MORPH_DUR * (1 - FINAL_FADE_FRAC)) * 1000,
  );

  hyperframesAnime.register("morph-scene", tl);
</script>
```

## Key Properties to Morph

| Property           | Shape of change                                                | Visual effect                |
| ------------------ | -------------------------------------------------------------- | ---------------------------- |
| `width` / `height` | `SHOT_ONE_W × SHOT_ONE_H` → `SHOT_TWO_W × SHOT_TWO_H`          | wide card shrinks to an icon |
| `borderRadius`     | `SHOT_ONE_RADIUS` → `SHOT_TWO_RADIUS` (≤ half of smaller side) | rectangle becomes a circle   |
| `background`       | `{surfaceShotOne}` → `{surfaceShotTwo}` (solid or gradient)    | container identity shifts    |
| `boxShadow`        | base shadow → accent glow token                                | emphasis changes             |

anime.js tweens all of these simultaneously when included in one `tl.add(...)` call.

## How to Choose Values

- **HOLD_BEAT** - pre-morph dwell so the viewer registers shot 1 before it changes
  - Range: 0.6-1.5 s
  - Effects: low end feels rushed / glitchy; high end stalls pacing
  - Constraints: must be ≥ shot 1's content entry settle time
- **MORPH_START** - when the container morph begins
  - Range: equal to `HOLD_BEAT` in the canonical pattern
  - Constraints: must be > any shot-1 entry tween end
- **MORPH_DUR** - full length of the simultaneous container morph
  - Range: 0.6-1.2 s
  - Effects: low end reads as a snap; high end loses momentum
  - Constraints: short morphs (<0.5s) cannot fit both old-fade and new-fade
- **SHOT_TWO_W / SHOT_TWO_H** - final container dimensions
  - Range: 80-400 px when handing off to an icon-sized anchor
  - Constraints: if handing off (`.next-shot-anchor`), MUST match the anchor's dimensions exactly to avoid a visible pop
- **SHOT_TWO_RADIUS** - final corner radius (use to read as circle / pill / soft-rect)
  - Range: 0 to `min(SHOT_TWO_W, SHOT_TWO_H) / 2`
  - Effects: half-of-smaller-side = perfect circle; smaller = soft rect
  - Constraints: > half is visually clamped - wastes the tween
- **OLD_FADE_FRAC** - fraction of `MORPH_DUR` over which shot-1 content fades out, starting at `MORPH_START`
  - Range: 0.3-0.5
  - Effects: low end clips shot 1 too early; high end overlaps with shot 2 content
  - Constraints: `OLD_FADE_FRAC + NEW_FADE_FRAC ≤ 1` (gap between is the "shape-only" moment)
- **NEW_FADE_FRAC** - fraction of `MORPH_DUR` over which shot-2 content fades in, ending at `MORPH_START + MORPH_DUR`
  - Range: 0.3-0.5
  - Effects: symmetric to OLD_FADE_FRAC
- **FINAL_FADE_FRAC** - optional tail fraction during which the morph container itself fades to 0 for handoff
  - Range: 0 (no handoff) or 0.1-0.2
  - Constraints: only use when `.next-shot-anchor` matches the morph's final visual exactly
- **Ease family** - discrete choice
  - Options: `inOutCubic` (canonical, balanced), `inOutQuart` (snappier), `inOutExpo` (most cinematic but can feel sluggish at low durations)
  - Avoid `outBack` / `outElastic` on the morph itself - overshoot fights the dimensional change

CSS-side placeholders (`SHOT_ONE_W`, `SHOT_ONE_H`, `SHOT_ONE_RADIUS`, `{surfaceShotOne}`, `{surfaceShotTwo}`) take real values in the example. Pick `{surfaceShotOne}` and `{surfaceShotTwo}` so the gradient/solid stops counts match (anime.js can interpolate background gradients only when stop counts agree).

## Key Principles

- **All target properties in one tween** - they share a single ease and duration so they morph in lockstep
- **Old content fades early, new content fades late** - the container shape change happens between, providing a natural "blink" moment
- **Final fade is optional** - use it when the next shot has a real anchor element to hand off to (e.g. avatar that the icon morphed into "is")
- **Same easing for shape and crossfade** - avoid mixing `inOutCubic` morph with `outBounce` content, looks unsynchronized
- **❗ If you use `.next-shot-anchor` for handoff, its visuals must be pixel-identical to `.morph-card`'s final state** - same `width` / `height`, same `border-radius`, same `background`, same `box-shadow`, same internal icon dimensions. Any visual delta between the two = visible pop during the crossfade. If you can't match exactly, **drop the handoff** and just hold the morph card at its final state (add a breath if needed for life).

## Critical Constraints

- **`overflow: hidden`** on the morph container - content must clip during shape change, otherwise content overflows the morphing border radius
- **Hold a beat before morphing** - let the viewer register shot 1's content before morphing; instant morph reads as glitchy
- **Timeline must be paused**: `anime.createTimeline({ autoplay: false })`. Never `tl.play()`
- **Registration id = `data-composition-id`**: call `hyperframesAnime.register("<id>", tl)` with the same id as the scene root.
- **One property owner per registered instance**: do not animate the same CSS property on the same element from two independently registered anime.js timelines; keep render-critical ownership in one timeline or split properties.
- **Use `background` tween, not `background-color`**: gradients need `background` (anime.js supports gradient interpolation when targets are gradients with same number of stops). For solid → solid, `backgroundColor` works.
- **`borderRadius` should be ≤ half the smaller dimension** at end state - otherwise the radius is visually clamped and the morph looks abrupt at the boundary
- **Don't snap `z-index` mid-fade**: if you need `.next-shot-anchor` to appear from behind the morph card, use **DOM order** (render `.next-shot-anchor` BEFORE `.morph-card` so the morph card is naturally on top), then crossfade their opacities. A zero-duration stack-order step during an active opacity tween causes a visible flicker as the stacking order flips before the opacity transition finishes.

## Variation: Morphing to a target element's position

When shot 2 isn't centered (e.g. the morph card "lands" on a specific icon in a dock, sidebar, or grid), compute the target `top` / `left` from the **target element's element-position**, not its visual center. Common mistake: subtracting `height/2` to get center, then applying that to the morph-card's `top` - but if `.morph-card` uses absolute positioning with `top` + `margin: 0` (no transform-centering), `top` represents the **element top edge**, not the center.

Math template (example: morph card lands on icon at bottom dock):

```
target_element_top = viewport_height − dock_bottom_offset − dock_padding_y − icon_height
                   = 1080 − 60 − 22 − 110 = 888 px
```

Then tween `.morph-card { top: 888 }` so its element-top aligns with the target icon's element-top. If you mistakenly tween to `888 + icon_height/2 = 943` you'll land below; tweening to a "center" value like `top: 933` (off-by-arithmetic) will be even worse.

Always **measure the target element with `getBoundingClientRect()`** before the timeline starts, and use those numbers - don't hand-compute from CSS values, since paddings, borders, and parent transforms compound.

## Combinations

- [scale-swap-transition.md](scale-swap-transition.md) - simpler morph without dimension change (just scale + content swap)
- [sine-wave-loop.md](sine-wave-loop.md) - gentle breathing on the final state (e.g. final small circular icon idles with a breath)

## Pairs with HF skills

- `/hyperframes-animation` - timeline + multi-property tween reference
- `/hyperframes-core` - composition wiring, `data-*` attributes
- `/hyperframes-cli` - `hyperframes lint` to verify scene structure
