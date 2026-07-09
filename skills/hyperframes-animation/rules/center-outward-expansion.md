---
name: center-outward-expansion
description: Elements start clustered at screen center and expand outward to their final positions, driven by a shared progress value.
metadata:
  tags: expansion, scatter, center, reveal, layout, sync, burst
---

# Center-Outward Expansion

Elements begin at a shared center point and radiate outward to their final positions. The expansion can be the entry beat itself, or **driven by another animation's progress** (e.g. a counting number growing) for coordinated motion.

## How It Works

Each element has a `targetX/Y` (its final layout position) and a shared `centerX/Y`. A `progress` value (0→1) interpolates each element between center and target:

```js
const x = centerX + (targetX - centerX) * progress;
const y = centerY + (targetY - centerY) * progress;
```

When `progress = 0` all elements overlap at the center; when `progress = 1` they're at their final spots.

## HTML

```html
<div
  class="scene"
  data-composition-id="burst-scene"
  data-start="0"
  data-duration="3"
  data-track-index="0"
>
  <div class="burst-wrap">
    <div class="burst-item" data-target-x="-360" data-target-y="-180">{itemA}</div>
    <div class="burst-item" data-target-x="360" data-target-y="-180">{itemB}</div>
    <div class="burst-item" data-target-x="-360" data-target-y="180">{itemC}</div>
    <div class="burst-item" data-target-x="360" data-target-y="180">{itemD}</div>
    <div class="burst-item" data-target-x="0" data-target-y="-360">{itemE}</div>
    <div class="burst-item" data-target-x="0" data-target-y="360">{itemF}</div>
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
  background: {bgColor};
}
.burst-wrap {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
}
.burst-item {
  position: absolute;
  /* Items start at the wrap center via the absolute + 50% trick.
     Anime.js tweens translate offsets, not left/top. */
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);

  width: {itemSize};
  height: {itemSize};
  display: grid;
  place-items: center;
  background: {itemBgColor};
  border-radius: 28px;
  font-family: {font};
  font-weight: 900;
  font-size: 96px;
  color: {textColor};
  will-change: transform;
}
```

## Anime.js Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/animejs@4.5.0/dist/bundles/anime.umd.min.js"></script>
<script>
  const tl = anime.createTimeline({ autoplay: false });

  const items = document.querySelectorAll(".burst-item");

  // Each element gets explicit from/to values that lerp center (translate(-50%, -50%))
  // to target offset. Static CSS handles self-centering; translateX/translateY animate
  // toward the target.
  items.forEach((el, i) => {
    const targetX = Number(el.dataset.targetX);
    const targetY = Number(el.dataset.targetY);
    tl.add(
      el,
      {
        translateX: [0, targetX],
        translateY: [0, targetY],
        scale: [0.6, 1],
        opacity: [0, 1],
        duration: EXPAND_DUR * 1000,
        ease: EXPAND_EASE,
      },
      (i * STAGGER + ENTRY_AT) * 1000, // stagger; ENTRY_AT offsets the burst beat
    );
  });

  hyperframesAnime.register("burst-scene", tl);
</script>
```

## How to Choose Values

- **ITEM_COUNT**: number of elements in the burst
  - Range: 3–8
  - Effects: 3 = sparse; 8 = busy. > 8 causes visual chaos where cards overlap mid-expansion
  - Constraints: at low counts, prefer wider angular spread (target positions further apart)

- **EXPAND_DUR**: duration of each item's center → target tween
  - Range: 1.0–1.8 s
  - Effects: shorter = snappy burst; longer = floats outward
  - Constraints: if driven by a counter, must equal the counter's duration (chord)

- **EXPAND_EASE**: shared ease across all items
  - Discrete choice: `outCubic`, `outQuart`, `outExpo`
  - Selection: `outQuart` is the default, fling out then settle. `outCubic` is gentler. `outExpo` makes them stop dramatically. Avoid `in` easings (they read as items being sucked back in mid-air).
  - Constraint: if driven by another animation, must be identical to the driver's ease

- **STAGGER**: gap between successive items' start times
  - Range: 0.04–0.08 s
  - Effects: < 0.04 = simultaneous chord; > 0.08 feels lazy / arpeggiated
  - Constraints: ITEM_COUNT × STAGGER must be < EXPAND_DUR or the last items still moving when others have landed reads as ragged

- **ENTRY_AT**: offset applied to the whole burst start
  - Range: 0 – 0.5 s
  - Effects: > 0 gives a beat of compositional quiet before the burst

- **START_PROGRESS**: fraction of the center→target path where items begin (for partially-spread variant)
  - Range: 0 (exact center) – 0.5
  - Effects: 0 = full cluster, dramatic spread; 0.3 = avoids initial pile-up at center

## Variations

### Synced expansion (driven by a counter)

If the burst should mirror a counting animation's progress:

```js
// Counter tween defines a state.value 0 → TARGET over COUNT_DUR
const counterState = { value: 0 };
const burstState = { p: 0 };

// Shared tween: same duration, same ease, visually a "chord"
tl.add(
  counterState,
  {
    value: COUNT_TARGET,
    duration: COUNT_DUR * 1000,
    ease: COUNT_EASE,
    onUpdate: () => (counterEl.textContent = Math.round(counterState.value).toLocaleString()),
  },
  0,
);

tl.add(
  burstState,
  {
    p: 1,
    duration: COUNT_DUR * 1000,
    ease: COUNT_EASE,
    onUpdate: () =>
      items.forEach((el) => {
        const tx = Number(el.dataset.targetX) * burstState.p;
        const ty = Number(el.dataset.targetY) * burstState.p;
        el.style.transform = `translate(-50%, -50%) translate(${tx}px, ${ty}px)`;
      }),
  },
  0,
);
```

### Starting partially-spread

To avoid the initial clustered mess (6+ elements stacked at center), start at `START_PROGRESS`:

```js
{ translateX: targetX * START_PROGRESS, translateY: targetY * START_PROGRESS, scale: 0.4, opacity: 0 }
```

### Idle micro-float at final position

Pair with `sine-wave-loop` after expansion lands, keeps elements alive instead of frozen.

## Key Principles

- **Driver vs driven**: if the burst stands on its own, use a per-item stagger; if it shadows another animation (counter, audio beat), share the same eased progress so they read as one beat
- **Stagger inside the 0.04-0.08 s band**: too tight and the cluster never separates visually, too loose and the burst feels lazy
- **Out-easing for the expansion**: out-easing makes items "fling" out then settle. In-easing looks like they're sucked back in mid-air
- **Element count: 3-8**: fewer feels empty, more causes visual chaos at the center where cards overlap mid-expansion
- **❗ Don't put a label below the burst as the "real headline"**: if you do, the eye snaps to the label and ignores the burst. The burst IS the beat. If a label is needed, use big block-caps and reveal it post-burst, in the same stacked layout.

## Critical Constraints

- **Timeline must be paused**: `anime.createTimeline({ autoplay: false })`
- **Registration id = `data-composition-id`**: call `hyperframesAnime.register("<id>", tl)` with the same id as the scene root.
- **One property owner per registered instance**: do not animate the same CSS property on the same element from two independently registered anime.js timelines; keep render-critical ownership in one timeline or split properties.
- **Use translate, not left/top**: translating composes cleanly with the centering `translate(-50%, -50%)` trick; mutating `left`/`top` fights the centering and causes pixel jitter
- **`will-change: transform`** on burst items, many simultaneous transforms benefit from compositor hints
- **No `position: absolute` parents inside `burst-wrap` other than items themselves**, sibling absolute elements would steal the centered baseline

## Combinations

- [counting-dynamic-scale.md](counting-dynamic-scale.md): counter peak drives the burst peak (chord)
- [sine-wave-loop.md](sine-wave-loop.md): idle motion after the burst lands
- [card-morph-anchor.md](card-morph-anchor.md): burst out of a morphed card

## Pairs with HF skills

- `/hyperframes-animation`, timeline + stagger
- `/hyperframes-core`, composition wiring
- `/hyperframes-cli`, `hyperframes lint`
