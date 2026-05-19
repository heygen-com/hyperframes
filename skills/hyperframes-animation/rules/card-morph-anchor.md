---
name: card-morph-anchor
description: Container morphs dimensions and border-radius between shots, serving as a visual transition anchor.
metadata:
  tags: morph, anchor, transition, border-radius, container, shape
---

# Card Morph Anchor

A container smoothly transforms its width, height, border-radius, and (optionally) background between two visual states. The morph itself **IS the shot transition** — no separate transition effect needed. The viewer's eye tracks the morphing container as the anchor between shots.

## How It Works

A single GSAP tween animates multiple container properties simultaneously (width / height / border-radius / background). At the same time:

1. **Old content** fades out during the first ~40% of the morph
2. **New content** fades in during the last ~40% of the morph
3. **Optional final fade** — the morph container itself fades to 0, revealing the actual next-shot element rendered behind it

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
      <h2>Hedronverse — wide hero banner</h2>
      <p>full-width feature card content</p>
    </div>
    <div class="content-new">
      <img src="hedronverse-logo.svg" alt="logo" />
    </div>
  </div>

  <!-- Optional: actual next-shot element behind the morph -->
  <div class="next-shot-anchor">
    <img src="hedronverse-avatar.png" alt="avatar" />
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
  width: 800px;
  height: 540px;
  border-radius: 28px;
  background: #1a1a2e;
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
  opacity: 0; /* GSAP fades this in as morph card fades out */
  /* Use DOM ORDER for stacking — render .next-shot-anchor BEFORE .morph-card
     in markup so the morph card is naturally on top. Do NOT use z-index: -1
     and then snap it positive mid-fade — that causes a visible pop. */
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Hold shot 1 — let the viewer register the wide banner.
  // (Implicit: nothing happens 0 → 1s)

  // Phase 1 (1.0 → 2.0s) — Morph container properties simultaneously
  tl.to(
    ".morph-card",
    {
      width: 160,
      height: 160,
      borderRadius: 80,
      background: "linear-gradient(135deg, #6366f1 0%, #ec4899 100%)",
      duration: 1.0,
      ease: "power2.inOut",
    },
    1.0,
  );

  // Phase 2 — Old content fades during the FIRST 40% of the morph (1.0 → 1.4s)
  tl.to(
    ".content-old",
    {
      opacity: 0,
      duration: 0.4,
      ease: "power1.in",
    },
    1.0,
  );

  // Phase 3 — New content fades in during the LAST 40% of the morph (1.6 → 2.0s)
  tl.to(
    ".content-new",
    {
      opacity: 1,
      duration: 0.4,
      ease: "power1.out",
    },
    1.6,
  );

  // Optional Phase 4 — Final fade: morph container disappears at 2.0 → 2.15s,
  // revealing the actual next-shot element behind it
  tl.to(
    ".morph-card",
    {
      opacity: 0,
      duration: 0.15,
      ease: "power1.in",
    },
    2.0,
  );

  window.__timelines["morph-scene"] = tl;
</script>
```

## Key Properties to Morph

| Property           | Example                                                 | Visual effect                |
| ------------------ | ------------------------------------------------------- | ---------------------------- |
| `width` / `height` | 800×540 → 160×160                                       | wide card shrinks to an icon |
| `borderRadius`     | 28px → 80px (half of new size)                          | rectangle becomes a circle   |
| `background`       | `#1a1a2e` → `linear-gradient(135deg, #6366f1, #ec4899)` | container identity shifts    |
| `boxShadow`        | subtle → colored glow                                   | emphasis changes             |

GSAP tweens all of these simultaneously when included in one `tl.to(...)` call.

## Key Principles

- **All target properties in one tween** — they share a single ease and duration so they morph in lockstep
- **Old content fades early, new content fades late** — the container shape change happens between, providing a natural "blink" moment
- **Final fade is optional** — use it when the next shot has a real anchor element to hand off to (e.g. avatar that the icon morphed into "is")
- **Same easing for shape and crossfade** — avoid mixing `power2.inOut` morph with `bounce.out` content, looks unsynchronized
- **❗ If you use `.next-shot-anchor` for handoff, its visuals must be pixel-identical to `.morph-card`'s final state** — same `width` / `height`, same `border-radius`, same `background`, same `box-shadow`, same internal icon dimensions. Any visual delta between the two = visible pop during the crossfade. If you can't match exactly, **drop the handoff** and just hold the morph card at its final state (add a breath if needed for life).

## Critical Constraints

- **`overflow: hidden`** on the morph container — content must clip during shape change, otherwise content overflows the morphing border radius
- **Hold a beat before morphing** — let the viewer register shot 1's content before morphing; instant morph reads as glitchy
- **Timeline must be paused**: `gsap.timeline({ paused: true })`. Never `tl.play()`
- **Registry key = `data-composition-id`**: `window.__timelines["morph-scene"]` must match scene root
- **Use `background` tween, not `background-color`**: gradients need `background` (GSAP supports gradient interpolation when targets are gradients with same number of stops). For solid → solid, `backgroundColor` works.
- **`borderRadius` should be ≤ half the smaller dimension** at end state — otherwise the radius is visually clamped and the morph looks abrupt at the boundary
- **❗ Don't snap `z-index` mid-fade** — if you need `.next-shot-anchor` to appear from behind the morph card, use **DOM order** (render `.next-shot-anchor` BEFORE `.morph-card` so the morph card is naturally on top), then crossfade their opacities. A `tl.set({ zIndex: ... })` call during an active opacity tween causes a visible flicker as the stacking order flips before the opacity transition finishes.

## Variation: Morphing to a target element's position

When shot 2 isn't centered (e.g. the morph card "lands" on a specific icon in a dock, sidebar, or grid), compute the target `top` / `left` from the **target element's element-position**, not its visual center. Common mistake: subtracting `height/2` to get center, then applying that to the morph-card's `top` — but if `.morph-card` uses absolute positioning with `top` + `margin: 0` (no transform-centering), `top` represents the **element top edge**, not the center.

Math template (example: morph card lands on icon at bottom dock):

```
target_element_top = viewport_height − dock_bottom_offset − dock_padding_y − icon_height
                   = 1080 − 60 − 22 − 110 = 888 px
```

Then tween `.morph-card { top: 888 }` so its element-top aligns with the target icon's element-top. If you mistakenly tween to `888 + icon_height/2 = 943` you'll land below; tweening to a "center" value like `top: 933` (off-by-arithmetic) will be even worse.

Always **measure the target element with `getBoundingClientRect()`** before the timeline starts, and use those numbers — don't hand-compute from CSS values, since paddings, borders, and parent transforms compound.

## Combinations

- [scale-swap-transition.md](scale-swap-transition.md) — simpler morph without dimension change (just scale + content swap)
- [sine-wave-loop.md](sine-wave-loop.md) — gentle breathing on the final state (e.g. final small circular icon idles with a breath)

## Pairs with HF skills

- `/hyperframes-gsap` — timeline + multi-property tween reference
- `/hyperframes-core` — composition wiring, `data-*` attributes
- `/hyperframes-cli` — `hyperframes lint` to verify scene structure
