# Zoom-Through (forward) — within-scene text swap

Z-axis velocity-matched cut; **never both texts visible.** Everything GROWS: the outgoing
text accelerates toward camera, a hard swap hides at peak blur, the incoming text keeps
growing into the focal plane. Headlines and short phrases only. Total ≈ 0.4s.
Meaning: progressing deeper into the same thought (Z forward is a reserved vector).

| Phase          | Scale    | Blur     | Opacity           | Ease                                       | Duration |
| -------------- | -------- | -------- | ----------------- | ------------------------------------------ | -------- |
| Exit           | 1 → 1.2  | 0 → 10px | 1 → 0.15          | power3.in (opacity: separate `none` tween) | 0.2s     |
| Cut (`tl.set`) | in: 0.75 | 10px     | out: 0 / in: 0.15 | —                                          | —        |
| Entry          | 0.75 → 1 | 10 → 0px | 0.15 → 1          | expo.out                                   | 0.5s     |

Exit opacity MUST be its own linear tween — `power3.in` holds opacity near 1 too long.
On entry all properties share `expo.out`.

**Z sign:** push (forward) = growing on BOTH sides: exit `1 → 1.2`, entry `0.75 → 1`.
This binds the incoming scene's OWN entrances during the seam window (cut + ~0.5s) —
hold the incoming frame composed, or author its entrance to match the sign.

## Worker version (within-scene wrapper swap)

```js
var EXIT_START = /* when readable text starts leaving */;
var CUT = EXIT_START + 0.2;

// Phase 1: Exit — scale/blur accelerate, opacity fades linearly (separate tween)
tl.to(".text-a-wrapper", {
  scale: 1.2,
  filter: "blur(10px)",   // text-scale: 10px
  duration: 0.2,
  ease: "power3.in",
  overwrite: "auto"
}, EXIT_START);
tl.to(".text-a-wrapper", { opacity: 0.15, duration: 0.2, ease: "none" }, EXIT_START);

// Phase 2: Hard cut — matched properties
tl.set(".text-a-wrapper", { opacity: 0 }, CUT);
tl.set(".text-b-wrapper", { opacity: 0.15, scale: 0.75, filter: "blur(10px)" }, CUT);

// Phase 3: Entry — fast initial velocity, long settle
tl.to(".text-b-wrapper", {
  scale: 1, filter: "blur(0px)", opacity: 1,
  duration: 0.5, ease: "expo.out"
}, CUT);
```

## Registry gsap_template

Injector-stamped onto the two clip wrappers (`__OLD__` / `__NEW__` / `__T__` / `__DUR__`
tokens — token table in `seam-craft`):

```js
tl.to(
  __OLD__,
  { scale: 2.5, opacity: 0, filter: "blur(8px)", duration: __DUR__, ease: "power3.in" },
  __T__,
);
tl.fromTo(
  __NEW__,
  { scale: 0.5, opacity: 0, filter: "blur(8px)" },
  { scale: 1, opacity: 1, filter: "blur(0px)", duration: __DUR__, ease: "power3.out" },
  __T__,
);
```

## Tuning ranges

| Parameter      | Default                        | Range     |
| -------------- | ------------------------------ | --------- |
| Exit scale     | 1.2                            | ±0.1      |
| Entry scale    | 0.75                           | ±0.1      |
| Blur at cut    | 10px text / 18–20px full-frame | —         |
| Opacity at cut | 0.15                           | 0.1–0.2   |
| Exit duration  | 0.2s                           | 0.15–0.3s |
| Entry duration | 0.5s                           | 0.4–0.6s  |

## Anti-patterns

| Don't                                   | Instead                                   |
| --------------------------------------- | ----------------------------------------- |
| Two texts visible during a zoom-through | Hard cut at blur peak, one text at a time |
| 20px blur on text-scale subjects        | 10px text; 18–20px only full-frame        |
| Zoom-through on body text               | Headlines and short phrases only          |
| Gentle entry easing (`power2.out`)      | Mirror the exit: `expo.out`               |
| Mismatched blur/opacity at the swap     | Identical values at the cut frame         |
