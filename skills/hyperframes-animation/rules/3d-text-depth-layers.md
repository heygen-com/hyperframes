---
name: 3d-text-depth-layers
description: Multiple offset text layers create a stacked 3D shadow/depth illusion on large typography. More impactful than CSS `text-shadow` because each layer is a full DOM element with independent color, opacity, and (optional) animation. JS generates the layers at composition build time.
metadata:
  tags: text, 3d, depth, layers, shadow, typography, stacked
  adapter: gsap
---

# 3D Text Depth Layers

Renders the same text multiple times at increasing pixel offsets to create a physical "stacked" extrusion. The back layers use translucent versions of the front color; the accumulated offset reads as 3D depth.

## HyperFrames vs. Remotion

Identical pattern. Both versions generate N copies of the same text at offsets `(i * dx, i * dy)` with decreasing opacity. The Remotion source used JSX `Array.map(...)` inline in the render; HyperFrames builds the layers once at composition setup time with `document.createElement` and lets GSAP tween the parent wrapper for entry/breath effects.

```
Remotion: {[...Array(N)].map((_, i) => <div style={{ top: i*dy, ... }}>text</div>)}
HyperFrames: for (let i = 0; i < N; i++) { wrapper.appendChild(layerEl(i)); }
```

The HyperFrames build runs synchronously before the timeline registers; no per-frame layer reconstruction needed.

## Core Concept

N stacked elements containing the same text:

- Last layer (`i === N-1`) is `position: relative` — defines container size and is the **front** (full opacity, accent color).
- All other layers (`i < N-1`) are `position: absolute`, offset by `(i * dx, i * dy)` from the relative anchor, with **decreasing** opacity moving toward the back.
- Offset direction implies the light source. `(left: -i*1px, top: +i*2px)` reads as "extruded backward and downward" — light coming from upper-right.

```
Layer 4 (front, alpha 1.0)  ←── visible text
Layer 3 (alpha 0.4)         ←── shifted -1x, +2y
Layer 2 (alpha 0.3)         ←── shifted -2x, +4y
Layer 1 (alpha 0.2)         ←── shifted -3x, +6y
Layer 0 (back, alpha 0.1)   ←── shifted -4x, +8y
```

## Basic Pattern

```html
<div class="depth-stack" data-text="97%"></div>

<style>
  .depth-stack {
    position: relative;
    display: inline-block;
    font-size: 380px;
    font-weight: 900;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .depth-stack .depth-layer {
    color: rgba(34, 197, 94, var(--alpha)); /* same hue, varying alpha */
  }
  .depth-stack .depth-layer.front {
    color: #22c55e; /* front uses full color, no rgba */
    position: relative;
  }
  .depth-stack .depth-layer.back {
    position: absolute;
    top: var(--top);
    left: var(--left);
  }
</style>

<script>
  /* Build N layers once at composition setup time. */
  const LAYER_COUNT = 5;
  const OFFSET_X = 1;
  const OFFSET_Y = 2;

  document.querySelectorAll(".depth-stack").forEach((stack) => {
    const text = stack.dataset.text;
    for (let i = 0; i < LAYER_COUNT; i++) {
      const layer = document.createElement("div");
      layer.className = "depth-layer " + (i === LAYER_COUNT - 1 ? "front" : "back");
      layer.textContent = text;
      if (i < LAYER_COUNT - 1) {
        const alpha = 0.1 * (LAYER_COUNT - i); // 0.5 → 0.1 across back layers
        layer.style.setProperty("--alpha", alpha);
        layer.style.setProperty("--top", i * OFFSET_Y + "px");
        layer.style.setProperty("--left", -i * OFFSET_X + "px");
      }
      stack.appendChild(layer);
    }
  });
</script>
```

The container `.depth-stack` can then receive normal GSAP entry tweens — `scale`, `opacity`, `rotation` — and the whole stack moves as one unit.

## Parameters

| Parameter     | Recommended                                  | Effect                                                      |
| ------------- | -------------------------------------------- | ----------------------------------------------------------- |
| `LAYER_COUNT` | 4–6                                          | More layers = deeper extrusion (5 is the visual sweet spot) |
| `OFFSET_X`    | 1–2 px                                       | Horizontal extrusion direction                              |
| `OFFSET_Y`    | 2–3 px                                       | Vertical extrusion direction                                |
| Front color   | Full opacity brand color                     | The visible text                                            |
| Back layers   | Same hue, decreasing alpha (`0.1 × (N - i)`) | Depth trail                                                 |

| Style    | Layers × Offset | Feel                                  |
| -------- | --------------- | ------------------------------------- |
| Subtle   | 4 × (1, 2)      | Light shadow, premium                 |
| Standard | 5 × (1, 2)      | Visible extrusion, attention-grabbing |
| Dramatic | 6 × (2, 3)      | Heavy extrusion, screen-filling       |

## Variations

### Animated Staggered Entry

Stagger layer opacity to "build up" the depth from back to front:

```js
/* Each back layer has --alpha that GSAP tweens from 0 to its final value.
   Front layer tweens its opacity from 0 to 1. */
tl.fromTo(
  ".depth-layer.back",
  { "--alpha": 0 },
  {
    "--alpha": (i) => 0.1 * (LAYER_COUNT - parseInt(i.dataset.idx, 10)),
    duration: 0.4,
    ease: "power2.out",
    stagger: { each: 0.05, from: "end" },
  },
  STAT_AT,
);

tl.fromTo(
  ".depth-layer.front",
  { opacity: 0 },
  { opacity: 1, duration: 0.4, ease: "power2.out" },
  STAT_AT + 0.05 * (LAYER_COUNT - 1),
);
```

Stagger from `end` so the deepest layer arrives first, building up to the front.

### Dynamic Depth (Breathing Extrusion)

Animate offset based on a shared variable for "depth pulsing":

```css
.depth-stack {
  --depth-mul: 1;
}
.depth-layer.back {
  top: calc(var(--top-base) * var(--depth-mul));
  left: calc(var(--left-base) * var(--depth-mul));
}
```

```js
/* Pulse depth via GSAP yoyo on the parent's CSS variable. */
tl.fromTo(
  ".depth-stack",
  { "--depth-mul": 1 },
  {
    "--depth-mul": 1.5,
    duration: 0.8,
    ease: "sine.inOut",
    yoyo: true,
    repeat: Math.floor(IDLE_DUR / 0.8) - 1,
  },
  IDLE_START,
);
```

When `--depth-mul` is 1.5, the back layers spread further from the front — depth visibly increases. Finite yoyo, never `repeat: -1`.

### Glow on Front Layer Only

Apply [asr-keyword-glow](asr-keyword-glow.md)-style text-shadow glow exclusively to the front layer so the back layers stay clean:

```css
.depth-layer.front {
  --glow: 0; /* tween via GSAP */
  text-shadow:
    0 0 calc(var(--glow) * 30px) currentColor,
    0 0 calc(var(--glow) * 60px) currentColor;
}
```

Glowing all layers makes the depth illusion fuzzy. Glowing only the front keeps the extrusion crisp.

## Critical Constraints

- **Last layer is `position: relative`**: Defines container size. Without it, all layers are absolute and the stack has zero height.
- **All other layers are `position: absolute`**: Float behind the relative front layer at their offset positions.
- **Same text, same font metrics**: Mismatched fonts/sizes break the depth illusion. All layers inherit the parent's typography settings.
- **Bold/black weight at large size**: 60 px+ with weight ≥ 700. Lighter fonts at smaller sizes lose the depth effect — the offsets become noise.
- **Offset direction implies light**: `(top: i*+, left: -i)` = extruded down-and-back, light from upper-right. Reverse for other directions but be consistent across the scene.
- **Build layers once at setup**: Don't re-create on every frame. The JS construction runs synchronously before the timeline registers.
- **No `Math.random` / `Date.now`**: Layer count, offsets, alphas are constants.
- **GSAP transforms only on the container**: Tween `.depth-stack` for entry / breath / exit — never tween individual layers' transforms (the offset stack relies on layout, not transforms).

## Combinations

- Pair with [asr-keyword-glow](asr-keyword-glow.md) — glow the front layer when its associated word is spoken.
- Pair with [counting-dynamic-scale](counting-dynamic-scale.md) — the entire depth stack scales up as its numeric value grows.
- Pair with [coordinate-target-zoom](coordinate-target-zoom.md) — the camera zooms into the depth stack for a climax moment.

## Examples

- [metric-video-text-pivot.html](../examples/metric-video-text-pivot.html) — "97%" rendered as a 5-layer green depth stack on the right side of the screen.
