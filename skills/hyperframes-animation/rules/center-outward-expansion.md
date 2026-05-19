---
name: center-outward-expansion
description: Elements start clustered at screen center and expand outward to final positions, driven by per-element GSAP x/y tweens synchronized to a shared driver (e.g. a counter). Position element at its target via CSS, then tween GSAP `x` / `y` from the inverse-lerped offset to 0.
metadata:
  tags: expansion, scatter, center, reveal, layout, sync, gsap
  adapter: gsap
---

# Center-Outward Expansion

Elements begin at a shared center point and radiate outward to their final layout positions. The expansion can sync to another animation (e.g. a counting number growing) so they read as one coordinated reveal.

## HyperFrames vs. Remotion

The Remotion source set each element's `left` and `top` based on `centerX + (targetX - centerX) * expansionProgress` — recomputed every frame. `left`/`top` work in Remotion because every render frame is independent.

HyperFrames forbids tweening `left` / `top` (layout-property allowlist violation). Instead:

1. Set each element's **target position** in CSS once (`left: targetX; top: targetY`).
2. GSAP tweens the element's **transform `x` / `y` offset** from the _inverse-lerped_ starting offset to 0.

```
Remotion: position = lerp(center, target, progress)      // updates left/top per frame
HyperFrames: CSS left = target                            // baked once
             GSAP tweens x: (center - target)*(1-startP) → 0
```

When the GSAP `x/y` reaches 0, the element sits at its target. When it equals `(center - target) * (1 - startP)`, the element is at the `startP` fraction between center and target.

## Core Concept

Each element has:

- `targetX`, `targetY`: final layout coordinates (in viewport space)
- `centerX`, `centerY`: shared cluster center (typically viewport center, offset by element size)
- `progress`: 0 at start, 1 at final position. A `startOffset` (e.g. 0.4) means elements begin already 40% spread out, not exactly at center — prevents the initial cluttered mess.

```
Position at progress p   = center + (target - center) * p
                         = target - (target - center) * (1 - p)
                         = target + (center - target) * (1 - p)

GSAP x offset from target = (center - target) * (1 - p)

At progress = startOffset (e.g. 0.4): GSAP x = (center - target) * 0.6
At progress = 1.0:                    GSAP x = 0
```

## Basic Pattern

```html
<div class="stage">
  <!-- All four icons get their TARGET position via CSS — set once -->
  <div class="icon icon-1" style="left: 115px; top: 195px;"></div>
  <div class="icon icon-2" style="left: 1632px; top: 216px;"></div>
  <div class="icon icon-3" style="left: 77px; top: 734px;"></div>
  <div class="icon icon-4" style="left: 1690px; top: 702px;"></div>
</div>

<style>
  .icon {
    position: absolute;
    width: 180px;
    height: 180px;
    /* GSAP x/y offset shifts each icon from its target toward center */
  }
</style>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // ============================================================
  // CONSTANTS
  // ============================================================
  const W = 1920,
    H = 1080;
  const ICON_SIZE = 180;
  const CENTER_X = W / 2 - ICON_SIZE / 2; // 870 — icon-center aligns to viewport center
  const CENTER_Y = H / 2 - ICON_SIZE / 2; // 450
  const START_OFFSET = 0.4; // icons start 40% of the way out

  const ICONS = [
    { sel: ".icon-1", targetX: 115, targetY: 195 },
    { sel: ".icon-2", targetX: 1632, targetY: 216 },
    { sel: ".icon-3", targetX: 77, targetY: 734 },
    { sel: ".icon-4", targetX: 1690, targetY: 702 },
  ];

  const COUNT_AT = 0.47;
  const COUNT_DUR = 1.0;

  // ============================================================
  // INITIAL POSITIONS — GSAP set() before the timeline runs
  // ============================================================
  ICONS.forEach(({ sel, targetX, targetY }) => {
    const startOffsetX = (CENTER_X - targetX) * (1 - START_OFFSET);
    const startOffsetY = (CENTER_Y - targetY) * (1 - START_OFFSET);
    gsap.set(sel, { x: startOffsetX, y: startOffsetY });
  });

  // ============================================================
  // EXPANSION TWEENS — each icon tweens its x/y to 0 in lockstep
  // ============================================================
  ICONS.forEach(({ sel }) => {
    tl.to(
      sel,
      { x: 0, y: 0, duration: COUNT_DUR, ease: "power2.out" }, // ease ≈ Remotion's 1 - (1-x)^2.5
      COUNT_AT,
    );
  });

  window.__timelines["main"] = tl;
</script>
```

Why per-element tweens vs one onUpdate? GSAP can run dozens of synchronous tweens in parallel cheaply — the compositor batches the transform writes. An `onUpdate` that loops over all icons would do the same DOM mutations but with a function call overhead.

## Synced Expansion (Counter Drives Icons)

When the expansion should follow another animation's eased progress (e.g. a number counting up with `power2.5.out`), use the **same ease and duration** on all tweens. They'll stay in lockstep:

```js
// Counter — proxy tween, onUpdate updates text + font size
const counterProxy = { p: 0 };
tl.to(
  counterProxy,
  {
    p: 1,
    duration: COUNT_DUR,
    ease: "power2.out",
    onUpdate: () => {
      counterEl.textContent = Math.round(counterProxy.p * 90);
      counterEl.style.fontSize = W * (0.2 + counterProxy.p * 0.22) + "px";
    },
  },
  COUNT_AT,
);

// Icons — separate tween per icon, same start/dur/ease
ICONS.forEach(({ sel }) => {
  tl.to(sel, { x: 0, y: 0, duration: COUNT_DUR, ease: "power2.out" }, COUNT_AT);
});
```

Same `COUNT_AT`, `COUNT_DUR`, `ease: "power2.out"` → the counter's progress and the expansion's progress are mathematically identical at every timeline position. They read as one driven motion.

## Variations

### Staggered Expansion

Each element starts expanding at a slightly different time. Add a per-element offset:

```js
ICONS.forEach(({ sel }, i) => {
  tl.to(
    sel,
    { x: 0, y: 0, duration: COUNT_DUR, ease: "power2.out" },
    COUNT_AT + i * 0.06, // stagger of 60ms each
  );
});
```

Or use GSAP's `stagger` shorthand if all icons share a class:

```js
tl.to(
  ".icon",
  {
    x: 0,
    y: 0,
    duration: COUNT_DUR,
    ease: "power2.out",
    stagger: { each: 0.06, from: "start" },
  },
  COUNT_AT,
);
```

Both forms produce the same result. The shorthand is cleaner when icons share a class and all targets have already been set via `gsap.set()` per-element.

### Two-Layer Wrapper (Expansion + Entry)

When icons also need a pop-in entry tween (scale 0 → 1) separate from the expansion, use two nested elements:

```html
<div class="icon-pos">
  <!-- outer: GSAP tweens x/y for expansion -->
  <div class="icon-entry">
    <!-- inner: GSAP tweens scale/opacity for entry -->
    <svg>...</svg>
  </div>
</div>
```

The expansion tween targets `.icon-pos`; the entry tween targets `.icon-entry`. They never overwrite each other.

## Critical Constraints

- **`left` / `top` set once in CSS or via JS init**: Never tweened — banned by the HF allowlist.
- **GSAP `x` / `y` for the expansion**: Compositor-cheap, no layout reflow.
- **Pre-calculated offsets**: Compute initial `x` / `y` from real layout constants. Don't derive from `getBoundingClientRect()` at tween time.
- **Synced ease for synced expansion**: When expansion follows a counter or another timing source, use **identical** `ease` and `duration` so progress stays mathematically locked.
- **`startOffset = 0.3 – 0.4`**: Icons starting at exactly center cause a visual collision. Starting partially-spread reads as "settling outward" rather than "exploding from a point."
- **3 – 8 elements**: Fewer than 3 doesn't read as expansion. More than 8 clusters at center even with startOffset.
- **Element size offset for center calculation**: If icons are 180 px wide and you want each icon's _center_ at viewport center, `CENTER_X = W/2 - ICON_SIZE/2`. Forgetting this shifts the cluster ~icon-size to the right.

## Combinations

- [counting-dynamic-scale](counting-dynamic-scale.md) — counter drives expansion progress via shared ease + duration.
- [svg-icon-enrichment](svg-icon-enrichment.md) — each expanding element has its own internal motion (rotating, pulsing).
- [sine-wave-loop](sine-wave-loop.md) — after expansion completes, idle floating keeps the icons alive.

## Examples

- [hook-counter-burst.html](../examples/hook-counter-burst.html) — four enriched icons expand outward from center as the counter ticks 0 → 90, all on a shared `power2.out` ease over 1 second.
