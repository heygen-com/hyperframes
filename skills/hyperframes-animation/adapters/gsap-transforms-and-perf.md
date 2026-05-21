# Transforms and Performance

## Transform Aliases

Prefer GSAP's transform aliases over raw `transform` strings:

| GSAP property               | Equivalent            |
| --------------------------- | --------------------- |
| `x`, `y`, `z`               | `translateX/Y/Z` (px) |
| `xPercent`, `yPercent`      | `translateX/Y` in `%` |
| `scale`, `scaleX`, `scaleY` | `scale`               |
| `rotation`                  | `rotate` (deg)        |
| `rotationX`, `rotationY`    | 3D rotate             |
| `skewX`, `skewY`            | `skew`                |
| `transformOrigin`           | `transform-origin`    |

Aliases let GSAP track and interpolate each axis independently, which prevents accidental overwrites between separate tweens on the same element.

## autoAlpha

Prefer `autoAlpha` over `opacity` for show/hide:

```javascript
gsap.to(".panel", { autoAlpha: 0, duration: 0.4 });
```

`autoAlpha: 0` sets both `opacity: 0` and `visibility: hidden`, which removes the element from hit-testing and accessibility tree at zero alpha — closer to "gone" than plain `opacity: 0`.

## clearProps

Removes inline styles set by GSAP when the tween completes:

```javascript
gsap.to(".item", { x: 100, rotation: 45, clearProps: "all" });
gsap.to(".item", { x: 100, rotation: 45, clearProps: "rotation,x" });
```

Useful at the end of an animation segment to hand the element back to CSS.

## CSS Variables

```javascript
gsap.to(".chart", { "--hue": 180, duration: 1 });
```

Animate any custom property. Works for color, length, number — anything CSS will interpolate.

## Relative and Directional Values

- Relative: `"+=20"`, `"-=10"`, `"*=2"`.
- Directional rotation: `"360_cw"`, `"-170_short"`, `"90_ccw"` — controls which way the angle takes when going between two values.

## SVG Specifics

- `svgOrigin` sets transform origin in the SVG's global coordinate space (not the element's local box). **Do not** combine `svgOrigin` with `transformOrigin` on the same element — pick one.
- Animate SVG transform attributes via the same alias names (`x`, `y`, `rotation`) — GSAP handles the SVG-specific quirks.

## Performance Rules

### Prefer transforms and opacity

Animating `x`, `y`, `scale`, `rotation`, `opacity` stays on the GPU compositor. Avoid `width`, `height`, `top`, `left`, `margin`, `padding` when transforms achieve the same effect.

### will-change (sparingly)

```css
.title {
  will-change: transform;
}
```

Only on elements that _actually_ animate. Applied everywhere it becomes useless and burns memory.

### gsap.quickTo for frequent updates (preview-only)

For high-frequency updates driven by **events** — pointer move, scroll, audio scrub — `quickTo` reuses the same tween instead of creating a new one each frame:

```javascript
const xTo = gsap.quickTo("#cursor", "x", { duration: 0.4, ease: "power3" });
const yTo = gsap.quickTo("#cursor", "y", { duration: 0.4, ease: "power3" });

container.addEventListener("mousemove", (e) => {
  xTo(e.pageX);
  yTo(e.pageY);
});
```

> **Render mode has no input events.** The renderer seeks frame-by-frame; `mousemove`, `scroll`, etc. never fire. `quickTo`'s main use case applies in **live preview** in the browser only. For audio-reactive motion in renders, pre-extract audio data and drive the timeline declaratively (see `../rules/gsap-effects.md`).

### Stagger beats N tweens

One tween with `stagger` beats N tweens with manual delays for both readability and runtime cost.

### Cleanup

In live preview, pause or `kill()` off-screen animations. Render mode is unaffected (the renderer drives time directly).
