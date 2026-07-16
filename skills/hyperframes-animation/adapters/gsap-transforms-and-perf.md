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

`autoAlpha: 0` sets both `opacity: 0` and `visibility: hidden`, which removes the element from hit-testing and accessibility tree at zero alpha — closer to "gone" than plain `opacity: 0`. The registered seekable timeline still interpolates only opacity; visibility changes at the hidden endpoint. Use `autoAlpha` only on non-clip elements or wrappers inside a clip; HyperFrames owns `.clip` visibility. Never duration-tween raw `visibility` or `display`.

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

### Animate transforms, not layout properties

Animate `x`, `y`, `scale`, `rotation`, `opacity`. Never animate `left`, `right`, `top`, `bottom`, `width`, `height`, `margin*`, the text-reflow props `letterSpacing` / `wordSpacing` / `fontSize` — and never `roundProps`.

This is a **render-correctness** rule in HyperFrames, not just a GPU-performance nicety. The renderer seeks frame-by-frame and screenshots each frame, and the browser compositor snaps layout properties to whole device pixels. On a fast tween the per-frame step is several pixels, so the snap is invisible; on a slow tween or a long ease-out tail the value moves less than a pixel per frame — it holds the same pixel for several frames, then jumps a whole one. The result is motion that looks smooth when fast but visibly stutters when slow. Transforms interpolate sub-pixel and stay smooth at any speed. `roundProps` forces the same integer snap onto a transform — don't use it.

"Layout property" is broader than position: anything that triggers **reflow** snaps the same way. `letterSpacing` / `fontSize` are the common trap — a slow "settle" that crawls one of them by a fraction of a pixel per frame dwells on a handful of discrete glyph layouts (visible micro-stutter). The faithful smooth fix depends on which property — **do not reach for `scale` reflexively**:

- **`fontSize`** → animate `scale`. Scaling text up/down is the same visual and stays sub-pixel smooth (no reflow).
- **`letterSpacing` / `wordSpacing`** → uniform `scale` is **not** the same effect (it resizes the glyphs; it does not change the gaps between them). To animate spacing smoothly, split the text into per-character (or per-word) elements and animate each one's `x` — the glyph spread is a transform, sub-pixel smooth and visually identical to a letter-spacing tween. GSAP's `SplitText` does the split. If the spacing change is a minor flourish, hold the final value statically instead.

Unlike positional props, reflow props snap during browser **layout** — upstream of the canvas raster — so they stutter even in html-in-canvas, and the exception below does **not** apply to them.

#### Fixing a flagged animation — preserve the intent

The lint rule tells you a property will stutter; it does **not** tell you the fix, and a fix that merely passes lint can silently change the look. Swapping a `letterSpacing` tighten for a uniform `scale` lints clean but animates a _different thing_ (it resizes the glyphs instead of closing the gaps). Two rules:

1. **Reproduce the same visual** — same start/end state, same trajectory, only sub-pixel-smooth. Use the faithful equivalent (per-glyph `x` for spacing, `scale` for `fontSize`, `x`/`y` for position), not whichever transform is the least code.
2. **Verify against the original, not against the linter.** Render the original and the fixed version and compare the motion at its key moments — the fix should differ only by the removed stutter, not by _where things end up_. Lint-clean-and-smooth is not the bar; faithful-and-smooth is.

If the faithful fix is non-trivial (a per-glyph split, a measured offset), build it or surface the tradeoff — never downgrade to a cheaper, different effect just to satisfy the linter.

**Convert a position animation to a transform** by leaving the element at its resting `left`/`top` in CSS and animating the _offset_ with `x`/`y`:

```javascript
// CSS: #card { left: 1340px; top: 540px }   ← resting position stays in CSS
tl.to("#card", { left: 1340, top: 540, duration: 1 }); // ✗ stutters
tl.fromTo("#card", { x: 640, y: 0 }, { x: 0, y: 0, duration: 1 }); // ✓ x/y = delta from CSS rest (640 = startLeft − 1340)
```

For a parent-relative `left: "100%"` sweep, use `xPercent: 100` only when the element is the full width of its container; otherwise convert to pixels (`x: containerWidth`).

**The one exception:** elements drawn through the html-in-canvas API — those under a `<canvas layoutsubtree>` ancestor, e.g. the `liquid-glass-*` blocks. The canvas rasterizes from sub-pixel `getComputedStyle`, so layout props don't snap there and those elements keep `left`/`top`. Everything the browser lays out (plain DOM) follows the rule.

The `gsap_non_transform_motion` lint rule is the backstop, not the teacher — reach for transforms from the start instead of animating layout props and waiting for lint to reject them.

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
