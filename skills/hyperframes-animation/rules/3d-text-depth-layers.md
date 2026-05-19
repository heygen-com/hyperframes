---
name: 3d-text-depth-layers
description: Multiple offset text layers create a stacked 3D shadow / extrusion effect on large typography — more impactful than CSS text-shadow because each layer is a full DOM element.
metadata:
  tags: text, 3d, depth, layers, shadow, typography, stacked, extrusion
---

# 3D Text Depth Layers

Renders the same text N times at increasing offsets, with back layers translucent and the front layer fully opaque. Creates a physical "stacked extrusion" depth illusion. Distinct from `text-shadow` (which can't have per-layer hue / opacity / animation) — each layer is a real DOM element.

## How It Works

- N copies of the same text in a single container
- Each copy positioned absolutely with offset `(i * OFFSET_X, i * OFFSET_Y)`
- Back layers (high `i`) use translucent or darkened color
- Front layer (`i = 0`) is full opacity, full brand color
- Optionally: each layer fades in staggered, creating a "building up" depth animation

## HTML

```html
<div
  class="scene"
  id="depth-scene"
  data-composition-id="depth-scene"
  data-start="0"
  data-duration="3"
  data-track-index="0"
>
  <div class="depth-stack">
    <!-- Layers injected by script — 6 copies of HEYGENVERSE -->
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
.depth-stack {
  position: relative;
  /* Container size set by the front layer; back layers stack behind */
}
.depth-text {
  font-family: "Inter", sans-serif;
  font-weight: 900;
  font-size: 200px;
  letter-spacing: -2px;
  line-height: 1;
  color: #f5f6fb;
  text-transform: uppercase;
}
/* Back layers — absolute, stacked behind */
.depth-text.is-back {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}
/* Front layer — relative to define container size */
.depth-text.is-front {
  position: relative;
  z-index: 10;
}
```

## GSAP Timeline + Layer Setup

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};

  const LAYER_COUNT = 6;
  const OFFSET_X = 2;
  const OFFSET_Y = 3;
  const FRONT_COLOR = "#f5f6fb";
  const BACK_HUE = "167, 139, 250"; // RGB triplet matching the brand glow

  const TEXT = "HEYGENVERSE";
  const stack = document.querySelector(".depth-stack");

  // Build layers — back-to-front so the FRONT (i=0) is the LAST appended
  // and `position: relative` defines container size.
  for (let i = LAYER_COUNT - 1; i >= 0; i--) {
    const el = document.createElement("div");
    el.className = "depth-text " + (i === 0 ? "is-front" : "is-back");
    el.textContent = TEXT;
    if (i > 0) {
      const alpha = 0.85 - i * 0.13;
      el.style.color = `rgba(${BACK_HUE}, ${Math.max(alpha, 0.1)})`;
      el.style.transform = `translate(${i * OFFSET_X}px, ${i * OFFSET_Y}px)`;
    } else {
      el.style.color = FRONT_COLOR;
    }
    el.dataset.layer = String(i);
    stack.appendChild(el);
  }

  const tl = gsap.timeline({ paused: true });

  // Layered entry — back layers appear first, building forward
  const allLayers = stack.querySelectorAll(".depth-text");
  allLayers.forEach((el) => {
    const i = Number(el.dataset.layer);
    tl.fromTo(
      el,
      { opacity: 0 },
      {
        opacity: el.classList.contains("is-front") ? 1 : Math.max(0.85 - i * 0.13, 0.1),
        duration: 0.4,
        ease: "power2.out",
      },
      0.1 + (LAYER_COUNT - 1 - i) * 0.06, // back-to-front cascade
    );
  });

  // Optional: depth grows on entry (offset interpolates from 0 → full)
  const depthState = { p: 0 };
  tl.to(
    depthState,
    {
      p: 1,
      duration: 0.5,
      ease: "power2.out",
      onUpdate: () => {
        stack.querySelectorAll(".depth-text.is-back").forEach((el) => {
          const i = Number(el.dataset.layer);
          const x = i * OFFSET_X * depthState.p;
          const y = i * OFFSET_Y * depthState.p;
          el.style.transform = `translate(${x}px, ${y}px)`;
        });
      },
    },
    0.1,
  );

  window.__timelines["depth-scene"] = tl;
</script>
```

## Variations

### Static depth (no animation, single hero shot)

Skip the cascade — render all layers in their final positions from t=0, optionally fade the entire stack in:

```js
tl.from(stack, { opacity: 0, scale: 0.96, duration: 0.6, ease: "power3.out" }, 0);
```

### Dynamic depth pulse

Animate `OFFSET_X` / `OFFSET_Y` based on a heartbeat — depth grows and shrinks rhythmically:

```js
const beat = { p: 0 };
tl.to(
  beat,
  {
    p: Math.PI * 2 * 2, // 2 beats over the duration
    duration: 2.0,
    ease: "none",
    onUpdate: () => {
      const mult = 1 + Math.sin(beat.p) * 0.4;
      stack.querySelectorAll(".is-back").forEach((el) => {
        const i = Number(el.dataset.layer);
        el.style.transform = `translate(${i * OFFSET_X * mult}px, ${i * OFFSET_Y * mult}px)`;
      });
    },
  },
  0.6,
);
```

### Color-shift back layers

Instead of fading to translucent, shift to a different hue — depth reads as "casting a colored shadow":

```js
el.style.color = `hsla(${250 - i * 8}, 80%, ${60 - i * 5}%, 1)`;
```

## Key Principles

- **Layer count 4-6** — fewer than 4 doesn't read as 3D, more than 6 visually clutters on tight kerning
- **Offset 1-3 px per axis** — subtle is dramatic. `OFFSET = 6+` looks like a glitch rather than depth
- **Offset direction implies light direction** — `(+x, +y)` = light from upper-left; `(-x, +y)` = light from upper-right. Pick one and be consistent across the composition
- **Back layers translucent OR darker** — DON'T make them MORE saturated than the front (looks like a halo). Each back layer should be slightly more transparent (`alpha -= 0.13 per layer`) or slightly darker
- **Last (front) layer `position: relative`** to define container size; all others `position: absolute` stack behind
- **Bold/black weight + large size** — 900 weight, 60px+ minimum. Thin text loses the layered illusion
- **❗ Don't apply per-letter animation on top of layers** — character animations (hacker-flip, typewriter) on top of 6-layer depth = chaos. If you need both effects, drop depth to 2-3 layers OR apply layers only to the static post-reveal state

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS `text-shadow`** alongside layered depth — they compound and over-extrude
- **Use `transform: translate()` for offsets, not `top`/`left`** — translate composes cleanly with parent's centering and avoids reflow
- **`pointer-events: none` on back layers** — they're decorative; don't catch hover or selection
- **Set layer color via `rgba()` not opacity** — opacity on the whole element fades the rendered glyph including any shadow; rgba in `color` fades just the glyph

## Combinations

- [counting-dynamic-scale.md](counting-dynamic-scale.md) — render the counter number with depth layers
- [sine-wave-loop.md](sine-wave-loop.md) — idle breathing on the front layer after reveal
- [center-outward-expansion.md](center-outward-expansion.md) — depth-stacked wordmark reveals after burst lands

## Pairs with HF skills

- `/hyperframes-gsap` — staggered fade-ins + onUpdate for dynamic depth
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
