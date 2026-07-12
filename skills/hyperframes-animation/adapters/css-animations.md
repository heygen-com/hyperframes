---
name: hyperframes-css-animations
description: CSS animation adapter patterns for HyperFrames. Use when authoring CSS keyframes, animation-delay based timing, animation-fill-mode, animation-play-state, or CSS-only motion that HyperFrames must seek deterministically during preview and rendering.
---

# CSS Animations for HyperFrames

HyperFrames can seek CSS keyframe animations through its `css` runtime adapter. Use this for simple repeated motifs, background motion, shimmer, glow, masks, and non-sequenced decoration.

For scene choreography, GSAP is usually clearer. CSS animations work best when the motion belongs to one element and has a fixed duration.

## Contract

- Put the animated element in the DOM before runtime initialization finishes.
- Give timed elements a `data-start` value so local animation time matches the clip.
- Use finite `animation-duration` and `animation-iteration-count` because the negative-delay fallback cannot represent unbounded duration in environments without WAAPI-backed CSS animations.
- Prefer `animation-fill-mode: both` so seeked states hold before and after active motion.
- Avoid wall-clock JavaScript, hover-triggered state, and class toggles that depend on user events.

The adapter discovers elements with computed `animation-name`, seeks their browser `Animation` handles when available, and falls back to pausing with negative `animation-delay`.

## Basic Pattern

```html
<div
  id="pulse-ring"
  class="clip pulse-ring"
  data-start="0"
  data-duration="4"
  data-track-index="2"
></div>

<style>
  .pulse-ring {
    width: 280px;
    height: 280px;
    border: 4px solid rgba(255, 255, 255, 0.7);
    border-radius: 50%;
    animation-name: pulse-ring;
    animation-duration: 1200ms;
    animation-timing-function: cubic-bezier(0.2, 0, 0, 1);
    animation-iteration-count: 3;
    animation-fill-mode: both;
  }

  @keyframes pulse-ring {
    from {
      opacity: 0;
      transform: scale(0.82);
    }
    35% {
      opacity: 1;
    }
    to {
      opacity: 0;
      transform: scale(1.18);
    }
  }
</style>
```

## Stagger Pattern

Use CSS custom properties to avoid duplicating keyframes:

```html
<div class="clip dots" data-start="1" data-duration="3" data-track-index="3">
  <span style="--i: 0"></span>
  <span style="--i: 1"></span>
  <span style="--i: 2"></span>
</div>

<style>
  .dots span {
    display: inline-block;
    width: 18px;
    height: 18px;
    margin-right: 10px;
    border-radius: 50%;
    background: currentColor;
    animation: dot-pop 900ms ease-out both;
    animation-delay: calc(var(--i) * 120ms);
  }

  @keyframes dot-pop {
    from {
      opacity: 0;
      transform: translateY(18px) scale(0.75);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
</style>
```

## Good Uses

- Decorative loops with a known repeat count.
- Mask, glow, shimmer, grain, and subtle parallax layers.
- Simple one-element entrances where a full JS timeline would be excessive.

## Avoid

- Infinite CSS animations unless you have verified the browser exposes seekable WAAPI-backed CSS animation handles. Prefer a finite iteration count covering the visible duration. If you do use `infinite`, add `data-duration` to the root element — see Composition Duration below.
- Animating layout properties like `top`, `left`, `width`, or `height` when transforms work.
- Relying on hover, focus, scroll, or media queries to trigger render-critical motion.
- Changing animation classes after startup unless another deterministic timeline controls that change.

## Composition Duration

The render engine needs to know the composition's total length. GSAP timelines report this automatically; CSS-only compositions have no timeline object, so the runtime infers duration from the longest running animation's computed end time (`animation-delay` + `animation-duration` × finite `animation-iteration-count`, per element with `data-start` added as an offset). `data-duration` on the root element is optional whenever every CSS animation on the page is finite — you don't need to add it just because the composition is CSS-driven.

`animation-iteration-count: infinite` (or any unresolved/unbounded animation) has no finite end time, so it cannot be auto-inferred. If the composition's only animation is infinite, you **must** add `data-duration="<seconds>"` to the root `[data-composition-id]` element with your intended total length — `npx hyperframes lint` errors on this case (`root_composition_missing_duration_source`) precisely because there is nothing for the runtime to infer.

```html
<div
  data-composition-id="root"
  data-start="0"
  data-duration="6"
  data-width="1920"
  data-height="1080"
>
  <div class="clip spinner" data-start="0" style="animation: spin 1s linear infinite"></div>
</div>
```

## Validation

After editing CSS animation compositions:

```bash
npx hyperframes lint
npx hyperframes check
```

## Credits And References

- HyperFrames adapter source: `packages/core/src/runtime/adapters/css.ts`.
- Duration auto-inference: `packages/core/src/runtime/init.ts` (`resolveAdapterDurationFloorSeconds`), `getInferredDurationSeconds` in the adapter above.
- MDN CSS animation documentation: https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/animation
- MDN `animation-fill-mode`: https://developer.mozilla.org/en-US/docs/Web/CSS/animation-fill-mode
