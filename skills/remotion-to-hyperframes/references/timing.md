# Timing translation: interpolate, spring, easing

The single highest-leverage reference. Easings and timings are what readers
notice; getting them wrong costs more SSIM than any other translation choice.
Empirically validated against tiers T1–T3.

## Conversion: frames → seconds

HF's timeline is in seconds. Remotion is frame-based. Always:

```
time_seconds = frame / fps
```

So at fps=30:

- frame 15 → 0.5 s
- frame 30 → 1.0 s
- frame 90 → 3.0 s

Do this conversion once when translating, not at runtime.

## interpolate — linear

```tsx
const opacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" });
```

Translates to:

```js
gsap.to(target, { opacity: 1, duration: 1.0, ease: "none" }, 0);
// fromTo if the property starts at 0 and CSS doesn't already set it
gsap.fromTo(target, { opacity: 0 }, { opacity: 1, duration: 1.0, ease: "none" }, 0);
```

`ease: "none"` matches Remotion's default linear interpolation. CSS sets the
`from` value if your initial state is in CSS; otherwise use `fromTo`.

`extrapolateLeft`/`extrapolateRight` defaults to `"extend"` in Remotion but
`"clamp"` is what the agent will see most often. GSAP doesn't extend — values
hold at the start and end of the tween. So for `clamp`, GSAP matches; for
`extend`, you'd need to extend the input range manually before emitting.

## interpolate — multi-segment

```tsx
const opacity = interpolate(frame, [0, 15, 75, 90], [0, 1, 1, 0]);
```

Three keyframed tweens at offsets `[0]/fps`, `[1]/fps`, `[2]/fps`:

```js
const tl = gsap.timeline({ paused: true });
tl.to(target, { opacity: 1, duration: 0.5, ease: "none" }, 0);
tl.to(target, { opacity: 1, duration: 2.0, ease: "none" }, 0.5);
tl.to(target, { opacity: 0, duration: 0.5, ease: "none" }, 2.5);
```

Validated in T1 — mean SSIM 0.974 against Remotion baseline.

## spring → GSAP back.out

Remotion's `spring()` is the most lossy translation. The mapping is approximate
but close enough that real-world compositions hold ≥ 0.92 SSIM (T2: 0.985, T3: 0.953).

| Remotion `spring` config                          | GSAP equivalent                                      | Validated in                     |
| ------------------------------------------------- | ---------------------------------------------------- | -------------------------------- |
| `{damping: 12, stiffness: 100, mass: 1}` (snappy) | `back.out(1.4)` over ~0.7 s                          | T2, T3 (TitleScene)              |
| `{damping: 14, stiffness: 90, mass: 1}` (calmer)  | `back.out(1.2)` over ~0.7 s                          | T3 (StatCard)                    |
| `{damping: 8, stiffness: 200}` (very bouncy)      | `back.out(2.0)` or `elastic.out(1, 0.5)` over ~0.6 s | not validated; budget ~0.05 SSIM |
| `{overshootClamping: true}`                       | `power3.out` over ~0.6 s (no overshoot)              | not validated                    |

**Rule of thumb**: `back.out(N)` overshoot ratio ≈ `(stiffness / damping^2) * 1.4`. For
`damping:12, stiffness:100` that gives `1.4 * 100/144 = 0.97`, which is close to
the validated 1.4 (the formula is rough; tune by visual). Default duration is
~0.7 s for the typical config.

When the spring's `delay`/`from`/`to` are non-default, scale the duration
proportionally.

## interpolate with custom easing

```tsx
import { Easing } from "remotion";
interpolate(frame, [0, 30], [0, 1], { easing: Easing.out(Easing.cubic) });
```

| Remotion                     | GSAP                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `Easing.in(Easing.linear)`   | `ease: "none"`                                                                         |
| `Easing.out(Easing.cubic)`   | `ease: "power2.out"`                                                                   |
| `Easing.inOut(Easing.cubic)` | `ease: "power2.inOut"`                                                                 |
| `Easing.out(Easing.poly(N))` | `ease: "power<N-1>.out"` (N=2 quad, 3 cubic, 4 quart, 5 quint)                         |
| `Easing.bezier(a,b,c,d)`     | `CustomEase.create("c", "M0,0 C${a},${b} ${c},${d} 1,1")` (requires CustomEase plugin) |
| `Easing.elastic(bounciness)` | `ease: "elastic.out(${bounciness}, 0.3)"`                                              |
| `Easing.bounce`              | `ease: "bounce.out"`                                                                   |
| `Easing.back(s)`             | `ease: "back.in(${s})"`                                                                |
| `Easing.out(Easing.back(s))` | `ease: "back.out(${s})"`                                                               |

GSAP names polynomial eases by degree minus one: `power1` is quadratic,
`power2` cubic, `power3` quartic, and `power4` quintic. For `Easing.poly(N)`
with integer N from 1 through 5, use `power<N-1>` (`power0` is linear). For
other exponents, pass an easing function; an ease-out is `(t) => 1 - (1 - t) ** N`.

Remotion and GSAP use the same back-ease overshoot parameter. Remotion defaults
to `s = 1.70158`; pass that value explicitly to GSAP when porting the default.
Bare `Easing.back` is an ease-in. Its polynomial is `t * t * ((s + 1) * t - s)`;
wrapping it in `Easing.out` reverses the direction without changing `s`.

## interpolate driving non-numeric properties

```tsx
const color = interpolateColors(frame, [0, 30], ["#ff0000", "#0000ff"]);
```

GSAP does color tweens natively:

```js
gsap.to(target, { color: "#0000ff", duration: 1.0, ease: "none" }, 0);
```

Same for `backgroundColor`, `borderColor`. The `from` value is read from CSS
or the inline style.

## Custom count-up / number tweens

When Remotion uses a frame-driven number ramp (`Math.round(value * eased)`):

```tsx
const t = interpolate(frame, [0, 45], [0, 1]);
const eased = 1 - (1 - t) ** 3; // cubic ease-out
const value = Math.round(target * eased);
return <div>{value.toLocaleString()}</div>;
```

GSAP equivalent — tween a counter object, write `textContent` on update:

```js
const counter = { v: 0 };
tl.to(
  counter,
  {
    v: target,
    duration: 1.5,
    ease: "power2.out",
    onUpdate: () => {
      el.textContent = Math.round(counter.v).toLocaleString();
    },
  },
  0,
);
```

`power2.out` matches `1 - (1-t)^3` exactly. At the midpoint, both yield 0.875;
`power3.out` yields 0.9375 because it is quartic. Compare the displayed count
at matching frame times as well as the final value; SSIM alone can miss a
plausible-looking counter that advances too early.

## Stagger via per-instance prop

When custom subcomponents take a `delayInFrames` prop:

```tsx
<StatCard delayInFrames={i * 12} value={...} />
```

Translate to GSAP timeline offsets:

```js
cards.forEach((card, i) => {
  const start = base + i * (12 / fps); // i * 0.4s at fps=30
  tl.to(card, { ... }, start);
});
```

Validated in T3 — three StatCards staggered at 0.0/0.4/0.8 s.
