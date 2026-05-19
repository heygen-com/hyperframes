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
  id="burst-scene"
  data-composition-id="burst-scene"
  data-start="0"
  data-duration="3"
  data-track-index="0"
>
  <div class="burst-wrap">
    <div class="burst-item" data-target-x="-360" data-target-y="-180">A</div>
    <div class="burst-item" data-target-x="360" data-target-y="-180">B</div>
    <div class="burst-item" data-target-x="-360" data-target-y="180">C</div>
    <div class="burst-item" data-target-x="360" data-target-y="180">D</div>
    <div class="burst-item" data-target-x="0" data-target-y="-360">E</div>
    <div class="burst-item" data-target-x="0" data-target-y="360">F</div>
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
     We tween translate offsets via GSAP, not left/top. */
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);

  width: 200px;
  height: 200px;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, #a78bfa 0%, #6366f1 100%);
  border-radius: 28px;
  font-family: "Inter", sans-serif;
  font-weight: 900;
  font-size: 96px;
  color: #fff;
  will-change: transform;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const items = document.querySelectorAll(".burst-item");

  // Each element gets its own from→to that lerps center (translate(-50%, -50%))
  // → target offset. We use 'xPercent: -50, yPercent: -50' to bake the
  // self-centering, then animate 'x' and 'y' to the target.
  items.forEach((el, i) => {
    const targetX = Number(el.dataset.targetX);
    const targetY = Number(el.dataset.targetY);
    tl.fromTo(
      el,
      { xPercent: -50, yPercent: -50, x: 0, y: 0, scale: 0.6, opacity: 0 },
      {
        x: targetX,
        y: targetY,
        scale: 1,
        opacity: 1,
        duration: 1.4,
        ease: "power3.out",
      },
      i * 0.04 + 0.2, // 0.04s stagger; offset by 0.2s entry beat
    );
  });

  window.__timelines["burst-scene"] = tl;
</script>
```

## Variations

### Synced expansion (driven by a counter)

If the burst should mirror a counting animation's progress:

```js
// Counter tween defines a state.value 0 → 5000 over 2.0s
const counterState = { value: 0 };
const burstState = { p: 0 };

// Shared tween — same duration, same ease — visually a "chord"
tl.to(
  counterState,
  {
    value: 5000,
    duration: 2.0,
    ease: "power3.out",
    onUpdate: () => (counterEl.textContent = Math.round(counterState.value).toLocaleString()),
  },
  0,
);

tl.to(
  burstState,
  {
    p: 1,
    duration: 2.0,
    ease: "power3.out",
    onUpdate: () =>
      items.forEach((el, i) => {
        const tx = Number(el.dataset.targetX) * burstState.p;
        const ty = Number(el.dataset.targetY) * burstState.p;
        el.style.transform = `translate(-50%, -50%) translate(${tx}px, ${ty}px)`;
      }),
  },
  0,
);
```

### Starting partially-spread

To avoid the initial clustered mess (6+ elements stacked at center), start at 30% spread:

```js
{ x: targetX * 0.3, y: targetY * 0.3, scale: 0.4, opacity: 0 }
```

### Idle micro-float at final position

Pair with `sine-wave-loop` after expansion lands — keeps elements alive instead of frozen.

## Key Principles

- **Driver vs driven** — if the burst stands on its own, use a per-item stagger; if it shadows another animation (counter, audio beat, scroll), share the same eased progress so they read as one beat
- **Stagger by 0.04-0.08s** — too tight and the cluster never separates visually, too loose and the burst feels lazy
- **`power3.out` for the expansion** — out-easing makes them "fling" out then settle (in-easing looks like they're sucked back in mid-air)
- **Element count: 3-8** — fewer feels empty, more causes visual chaos at the center where all the cards overlap mid-expansion
- **❗ Don't put a label below the burst** as the "real headline" — if you do, the eye snaps to the label and ignores the burst. The burst IS the beat. If you must include a label, big block-caps, post-burst reveal, in the same stacked layout

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **Use translate, not left/top** — translating composes cleanly with the centering `translate(-50%, -50%)` trick; mutating `left`/`top` fights the centering and causes pixel jitter
- **`will-change: transform`** on burst items — many simultaneous transforms benefit from compositor hints
- **No `position: absolute` parents inside `burst-wrap` other than items themselves** — sibling absolute elements would steal the centered baseline

## Combinations

- [counting-dynamic-scale.md](counting-dynamic-scale.md) — counter peak drives the burst peak (chord)
- [sine-wave-loop.md](sine-wave-loop.md) — idle motion after the burst lands
- [card-morph-anchor.md](card-morph-anchor.md) — burst out of a morphed card

## Pairs with HF skills

- `/hyperframes-gsap` — timeline + stagger
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
