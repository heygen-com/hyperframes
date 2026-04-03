# GSAP Plugins

Register each plugin once before use:

```javascript
import gsap from "gsap";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { Flip } from "gsap/Flip";
gsap.registerPlugin(ScrollToPlugin, Flip);
```

## Table of Contents

- [ScrollToPlugin](#scrolltoplugin)
- [ScrollSmoother](#scrollsmoother)
- [Flip](#flip)
- [Draggable + Inertia](#draggable)
- [Observer](#observer)
- [SplitText](#splittext)
- [ScrambleText](#scrambletext)
- [DrawSVG](#drawsvg)
- [MorphSVG](#morphsvg)
- [MotionPath](#motionpath)
- [CustomEase / EasePack](#customeaseeasepak)
- [Physics2D / PhysicsProps](#physics)
- [GSDevTools](#gsdevtools)
- [PixiPlugin](#pixiplugin)

---

## ScrollToPlugin

Animate scroll position (window or scrollable element).

```javascript
gsap.to(window, { scrollTo: { y: "#section", offsetY: 50 }, duration: 1 });
gsap.to(scrollContainer, { scrollTo: { x: "max" }, duration: 1 });
```

## ScrollSmoother

Smooth scroll wrapper. Requires ScrollTrigger + specific DOM structure (`#smooth-wrapper` > `#smooth-content`).

## Flip

FLIP layout transitions: capture state, change DOM, animate from old to new.

```javascript
const state = Flip.getState(".item");
// change DOM (reorder, add/remove, change classes)
Flip.from(state, { duration: 0.5, ease: "power2.inOut" });
```

Options: `absolute`, `nested`, `scale`, `simple`, `duration`, `ease`.

## Draggable

Makes elements draggable/spinnable/throwable.

```javascript
gsap.registerPlugin(Draggable, InertiaPlugin);
Draggable.create(".box", { type: "x,y", bounds: "#container", inertia: true });
Draggable.create(".knob", { type: "rotation" });
```

Types: `"x"`, `"y"`, `"x,y"`, `"rotation"`, `"scroll"`. Options: `bounds`, `inertia`, `edgeResistance`, `cursor`, drag callbacks.

### Inertia (InertiaPlugin)

Momentum after release with Draggable, or track velocity of any property:

```javascript
InertiaPlugin.track(".box", "x");
gsap.to(obj, { inertia: { x: "auto" } });
```

## Observer

Normalized pointer/scroll input across devices. Use for swipe/gesture detection.

```javascript
Observer.create({
  target: "#area",
  onUp: () => {},
  onDown: () => {},
  tolerance: 10,
});
```

## SplitText

Split text into chars, words, lines for per-unit animation.

```javascript
const split = SplitText.create(".heading", { type: "words, chars" });
gsap.from(split.chars, { opacity: 0, y: 20, stagger: 0.03 });
// later: split.revert()
```

Key options: `type` (comma-separated: chars/words/lines), `charsClass`/`wordsClass`/`linesClass`, `aria` ("auto"/"hidden"/"none"), `autoSplit` + `onSplit(self)` for font-safe re-splitting, `mask` (lines/words/chars for reveal effects), `tag`, `ignore`, `smartWrap`, `propIndex`.

Tips: Split only what's animated. For custom fonts, use `autoSplit: true` with `onSplit()`. Avoid `text-wrap: balance`.

## ScrambleText

Scramble/glitch text effect.

```javascript
gsap.to(".text", { scrambleText: { text: "New message", chars: "01", revealDelay: 0.5 } });
```

## DrawSVG

Animate SVG stroke reveal (stroke-dashoffset/dasharray). Element must have `stroke` and `stroke-width`.

```javascript
gsap.from("#path", { drawSVG: 0, duration: 1 }); // nothing to full stroke
gsap.to("#path", { drawSVG: "20% 80%", duration: 1 }); // partial segment
```

`drawSVG` value = visible segment: `"start end"` in % or length. Single value (e.g. `0`) means start is 0.

## MorphSVG

Morph one SVG shape into another. Handles different point counts.

```javascript
MorphSVGPlugin.convertToPath("circle, rect, ellipse, line");
gsap.to("#diamond", { morphSVG: "#lightning", duration: 1 });
// object form: { shape, type: "rotational", shapeIndex, smooth, curveMode }
```

Use `shapeIndex: "log"` to find optimal value. `type: "rotational"` avoids kinks.

## MotionPath

Animate along an SVG path.

```javascript
gsap.to(".dot", {
  motionPath: { path: "#path", align: "#path", alignOrigin: [0.5, 0.5], autoRotate: true },
});
```

## CustomEase/EasePack

Custom curves beyond built-in eases:

```javascript
const ease = CustomEase.create("name", ".17,.67,.83,.67");
// or SVG path data for complex curves
const hop = CustomEase.create("hop", "M0,0 C0,0 0.056,0.442 ...");
```

EasePack adds SlowMo, RoughEase, ExpoScaleEase. CustomWiggle for oscillation. CustomBounce for configurable bounces.

## Physics

### Physics2D

```javascript
gsap.to(".ball", { physics2D: { velocity: 250, angle: 80, gravity: 500 }, duration: 2 });
```

### PhysicsProps

```javascript
gsap.to(".obj", {
  physicsProps: { x: { velocity: 100, end: 300 }, y: { velocity: -50, acceleration: 200 } },
  duration: 2,
});
```

## GSDevTools

Timeline scrubbing UI for development. **Do not ship to production.**

```javascript
GSDevTools.create({ animation: tl });
```

## PixiPlugin

Integrates GSAP with PixiJS display objects.

```javascript
gsap.to(sprite, { pixi: { x: 200, scale: 1.5 }, duration: 1 });
```

## Do Not

- Use a plugin without registering it first.
- Ship GSDevTools to production.
- Forget to revert SplitText instances on unmount.
