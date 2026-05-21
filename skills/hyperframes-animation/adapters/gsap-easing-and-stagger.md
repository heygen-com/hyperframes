# Easing, Stagger, and Function-Based Values

## Easing

Built-in eases: `power1`, `power2`, `power3`, `power4`, `back`, `bounce`, `circ`, `elastic`, `expo`, `sine`, `none`.

Each has `.in`, `.out`, `.inOut` variants.

| Ease                       | Use for                                                                 |
| -------------------------- | ----------------------------------------------------------------------- |
| `power1.out`, `power2.out` | Standard UI motion. Default for most entrances.                         |
| `power3.out`, `power4.out` | Punchier deceleration. Title cards, hero reveals.                       |
| `sine.inOut`               | Long, slow, calm motion. Crossfades, ambient drift.                     |
| `back.out(1.7)`            | Slight overshoot. Playful entrances. The arg controls overshoot amount. |
| `elastic.out(1, 0.3)`      | Springy bounce. First arg = amplitude, second = period.                 |
| `expo.inOut`               | Snappy, dramatic. Quick transitions between hero scenes.                |
| `none` (linear)            | Camera moves with timed counterpoint, mechanical motion.                |

Pick `.out` for entrances, `.in` for exits, `.inOut` for symmetric moves and continuous motion.

## Defaults

```javascript
const tl = gsap.timeline({
  paused: true,
  defaults: { duration: 0.6, ease: "power2.out" },
});
```

Or globally:

```javascript
gsap.defaults({ duration: 0.6, ease: "power2.out" });
```

Setting defaults at timeline scope is preferred — it documents the motion language of that composition in one place.

## Stagger

```javascript
gsap.from(".item", { y: 24, opacity: 0, duration: 0.5, stagger: 0.08 });
```

Object form:

```javascript
gsap.from(".item", {
  y: 24,
  opacity: 0,
  stagger: {
    each: 0.08, // delay between each
    from: "center", // "start" | "end" | "center" | "edges" | "random" | index
    amount: 0.6, // total stagger time (overrides each if both set)
    grid: "auto", // for 2D stagger
    axis: "x" | "y",
  },
});
```

Prefer `stagger` over N separate tweens with manual delays — it stays correct when the target count or order changes.

## Function-Based Values

Any var can be a function `(index, target, targets) => value`:

```javascript
gsap.to(".item", {
  x: (i, target, targets) => i * 50,
  rotation: (i) => (i % 2 === 0 ? 5 : -5),
  stagger: 0.1,
});
```

Use this for per-element values that depend on index, attributes, or measured size. Cheaper and more idiomatic than building tweens in a loop.

## gsap.matchMedia (preview only)

`matchMedia` runs setup only when a media query matches and auto-reverts when it stops matching. It is useful for **preview** in the browser at different viewport sizes, and for `prefers-reduced-motion`. It is **not** a substitute for rendering at the composition's actual `data-width`/`data-height` — HyperFrames renders at a fixed viewport.

```javascript
let mm = gsap.matchMedia();
mm.add(
  {
    isDesktop: "(min-width: 800px)",
    reduceMotion: "(prefers-reduced-motion: reduce)",
  },
  (context) => {
    const { isDesktop, reduceMotion } = context.conditions;
    gsap.to(".box", {
      rotation: isDesktop ? 360 : 180,
      duration: reduceMotion ? 0 : 2,
    });
  },
);
```
