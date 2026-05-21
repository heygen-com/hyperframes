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
    <!-- Layers injected by script — LAYER_COUNT copies of {label} -->
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
.depth-stack {
  position: relative;
  /* Container size set by the front layer; back layers stack behind */
}
.depth-text {
  font-family: {font};
  font-weight: 900;
  font-size: HERO_FONT_SIZE;
  letter-spacing: HERO_LETTER_SPACING;
  line-height: 1;
  color: {frontColor};
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

  const TEXT = "{label}";
  const stack = document.querySelector(".depth-stack");

  // Build layers — back-to-front so the FRONT (i=0) is the LAST appended
  // and `position: relative` defines container size.
  for (let i = LAYER_COUNT - 1; i >= 0; i--) {
    const el = document.createElement("div");
    el.className = "depth-text " + (i === 0 ? "is-front" : "is-back");
    el.textContent = TEXT;
    if (i > 0) {
      const alpha = Math.max(BACK_ALPHA_MAX - i * BACK_ALPHA_STEP, BACK_ALPHA_MIN);
      el.style.color = `rgba({backHueRGB}, ${alpha})`;
      el.style.transform = `translate(${i * OFFSET_X}px, ${i * OFFSET_Y}px)`;
    } else {
      el.style.color = "{frontColor}";
    }
    el.dataset.layer = String(i);
    stack.appendChild(el);
  }

  const tl = gsap.timeline({ paused: true });

  // Layered entry — back layers appear first, building forward
  const allLayers = stack.querySelectorAll(".depth-text");
  allLayers.forEach((el) => {
    const i = Number(el.dataset.layer);
    const finalAlpha = el.classList.contains("is-front")
      ? 1
      : Math.max(BACK_ALPHA_MAX - i * BACK_ALPHA_STEP, BACK_ALPHA_MIN);
    tl.fromTo(
      el,
      { opacity: 0 },
      {
        opacity: finalAlpha,
        duration: LAYER_FADE_DUR,
        ease: "power2.out",
      },
      LAYER_CASCADE_START + (LAYER_COUNT - 1 - i) * LAYER_CASCADE_STEP,
    );
  });

  // Optional: depth grows on entry (offset interpolates from 0 → full)
  const depthState = { p: 0 };
  tl.to(
    depthState,
    {
      p: 1,
      duration: DEPTH_GROW_DUR,
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
    DEPTH_GROW_START,
  );

  window.__timelines["depth-scene"] = tl;
</script>
```

## Variations

### Static depth (no animation, single hero shot)

Skip the cascade — render all layers in their final positions from t=0, optionally fade the entire stack in:

```js
tl.from(
  stack,
  { opacity: 0, scale: STATIC_ENTRY_SCALE, duration: STATIC_ENTRY_DUR, ease: "power3.out" },
  0,
);
```

### Dynamic depth pulse

Animate `OFFSET_X` / `OFFSET_Y` based on a heartbeat — depth grows and shrinks rhythmically:

```js
const beat = { p: 0 };
tl.to(
  beat,
  {
    p: Math.PI * 2 * BEAT_CYCLES,
    duration: BEAT_DUR,
    ease: "none",
    onUpdate: () => {
      const mult = 1 + Math.sin(beat.p) * BEAT_AMP;
      stack.querySelectorAll(".is-back").forEach((el) => {
        const i = Number(el.dataset.layer);
        el.style.transform = `translate(${i * OFFSET_X * mult}px, ${i * OFFSET_Y * mult}px)`;
      });
    },
  },
  BEAT_START,
);
```

### Color-shift back layers

Instead of fading to translucent, shift to a different hue — depth reads as "casting a colored shadow":

```js
el.style.color = `hsla(${HUE_BASE - i * HUE_STEP}, ${SAT_PCT}%, ${LIGHT_BASE - i * LIGHT_STEP}%, 1)`;
```

## How to Choose Values

### Layer geometry

- **LAYER_COUNT** — number of stacked copies (back layers + 1 front).
  - Range: 4-6. Below 4 the depth doesn't read as 3D; above 6 the stack visually clutters on tight kerning
  - Effects: low end reads as subtle shadow; high end reads as chunky extrusion
- **OFFSET_X / OFFSET_Y** — per-layer translation offset, in px.
  - Range: 1-3 px each. Above 4 px reads as a glitch / chromatic aberration rather than depth
  - Effects: offset direction implies light direction. `(+x, +y)` = light from upper-left; `(-x, +y)` = light from upper-right. Pick one and keep it consistent across the composition
  - Constraints: same sign convention throughout the composition

### Back-layer color falloff

- **BACK_ALPHA_MAX** — alpha of the back layer nearest the front.
  - Range: 0.6-0.85. Lower than 0.5 makes even the nearest back layer disappear; higher than 0.9 fights the front layer for dominance
- **BACK_ALPHA_STEP** — alpha decrement per layer further back.
  - Range: 0.08-0.15. Smaller steps read as a soft gradient; larger steps read as discrete plates
  - Constraints: choose so `BACK_ALPHA_MAX − (LAYER_COUNT − 2) × BACK_ALPHA_STEP ≥ BACK_ALPHA_MIN`
- **BACK_ALPHA_MIN** — floor below which back layers stop fading.
  - Range: 0.1-0.2. Below 0.1 the deepest layer disappears entirely on dark backgrounds

### Typography

- **HERO_FONT_SIZE** — front-layer font size, in px.
  - Range: 60 px minimum to read as layered; 200-340 px for full-bleed hero shots. Thin text loses the layered illusion
- **HERO_LETTER_SPACING** — letter spacing.
  - Range: −0.03em (tight) to 0 (normal). Negative spacing tightens the stack so the offsets read as depth instead of as repetition
- **{font}** — typeface; pick a black/900 weight family with strong horizontal strokes
- **{frontColor}** — front-layer color; the brand or accent color
- **{backHueRGB}** — RGB triplet for back layers (e.g. matched to a brand glow). Used inside `rgba({backHueRGB}, ${alpha})`

### Cascade entry (default form)

- **LAYER_CASCADE_START** — timeline offset where the cascade begins.
  - Constraints: ≥ 0; if another beat precedes, ≥ that beat's end
- **LAYER_CASCADE_STEP** — delay between each layer's fade-in.
  - Range: 0.04-0.10 s. Smaller feels almost-simultaneous; larger feels stepped and mechanical
- **LAYER_FADE_DUR** — duration of each individual layer's fade-in.
  - Range: 0.3-0.6 s

### Depth-grow tween

- **DEPTH_GROW_START** — when the offset growth begins.
  - Constraints: typically `≈ LAYER_CASCADE_START`; align so the first layer's fade and the depth growth start together
- **DEPTH_GROW_DUR** — duration over which offsets interpolate from 0 to full.
  - Range: 0.4-0.8 s. Roughly match `LAYER_FADE_DUR × LAYER_COUNT / 2` so depth lands as the last layer fades in

### Static-depth variation

- **STATIC_ENTRY_SCALE** — initial scale before the whole stack fades in.
  - Range: 0.94-0.98 — subtle inflation; larger reads as a separate "pop" effect
- **STATIC_ENTRY_DUR** — fade-in duration for the whole stack.
  - Range: 0.5-0.8 s

### Dynamic-pulse variation

- **BEAT_CYCLES** — number of full beat cycles across `BEAT_DUR`.
  - Range: `BEAT_DUR / 1.5s ≤ BEAT_CYCLES ≤ BEAT_DUR / 0.7s` (one beat per 0.7-1.5 s reads as a heartbeat)
- **BEAT_DUR** — pulse tween duration.
  - Constraints: tied to the visible window of the depth stack
- **BEAT_AMP** — fractional amplitude of the offset pulse.
  - Range: 0.2-0.6. Smaller is a gentle breathing depth; larger reads as a kick-drum thump
- **BEAT_START** — when the pulse begins.
  - Constraints: `≥ DEPTH_GROW_START + DEPTH_GROW_DUR` so the pulse modulates a fully-grown stack

### Color-shift variation

- **HUE_BASE / HUE_STEP** — base hue (front layer) and per-layer hue rotation.
  - Range: `HUE_STEP` 4-12°. Larger steps cycle further around the color wheel and read as glitch
- **SAT_PCT** — fixed saturation for all layers.
  - Range: 60-85%
- **LIGHT_BASE / LIGHT_STEP** — base lightness and per-layer darkening.
  - Range: `LIGHT_STEP` 3-8 percentage points so back layers darken into the background

## Key Principles

- **Layer count 4-6** — fewer than 4 doesn't read as 3D, more than 6 visually clutters on tight kerning
- **Offset 1-3 px per axis** — subtle is dramatic. `OFFSET = 6+` looks like a glitch rather than depth
- **Offset direction implies light direction** — `(+x, +y)` = light from upper-left; `(-x, +y)` = light from upper-right. Pick one and be consistent across the composition
- **Back layers translucent OR darker** — DON'T make them MORE saturated than the front (looks like a halo). Each back layer should be slightly more transparent (`alpha -= BACK_ALPHA_STEP per layer`) or slightly darker
- **Last (front) layer `position: relative`** to define container size; all others `position: absolute` stack behind
- **Bold/black weight + large size** — 900 weight, 60 px+ minimum. Thin text loses the layered illusion
- **Don't apply per-letter animation on top of layers** — character animations (hacker-flip, typewriter) on top of 6-layer depth = chaos. If you need both effects, drop depth to 2-3 layers OR apply layers only to the static post-reveal state

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

- `/hyperframes-animation` — staggered fade-ins + onUpdate for dynamic depth
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
