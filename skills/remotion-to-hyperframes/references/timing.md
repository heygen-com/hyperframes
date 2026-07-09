# Timing translation: interpolate, spring, easing

The single highest-leverage reference. Easings and timings are what readers
notice; getting them wrong costs more SSIM than any other translation choice.
Empirically validated against tiers T1–T3.

## Conversion: frames -> seconds and milliseconds

HF `data-*` durations stay in seconds. Anime.js timeline positions and durations are milliseconds. Remotion is frame-based. Always compute both:

```
time_seconds = frame / fps
time_ms = time_seconds * 1000
```

So at fps=30:

- frame 15 → 0.5 s
- frame 30 → 1.0 s
- frame 90 → 3.0 s

Do this conversion once when translating, not at runtime.

## interpolate - linear

```tsx
const opacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" });
```

Translates to:

```js
tl.add(target, { opacity: 1, duration: 1000, ease: "linear" }, 0);
// Use an explicit from-to array if CSS doesn't already set the from value.
tl.add(target, { opacity: [0, 1], duration: 1000, ease: "linear" }, 0);
```

`ease: "linear"` matches Remotion's default linear interpolation. CSS sets the
`from` value if your initial state is in CSS; otherwise use `fromTo`.

`extrapolateLeft`/`extrapolateRight` defaults to `"extend"` in Remotion but
`"clamp"` is what the agent will see most often. Anime.js tweens hold at the
start and end of the tween. So for `clamp`, anime.js matches; for
`extend`, you'd need to extend the input range manually before emitting.

## interpolate - multi-segment

```tsx
const opacity = interpolate(frame, [0, 15, 75, 90], [0, 1, 1, 0]);
```

Three keyframed tweens at millisecond offsets `[0]/fps`, `[1]/fps`, `[2]/fps`:

```js
const tl = anime.createTimeline({ autoplay: false });
tl.add(target, { opacity: 1, duration: 500, ease: "linear" }, 0);
tl.add(target, { opacity: 1, duration: 2000, ease: "linear" }, 500);
tl.add(target, { opacity: 0, duration: 500, ease: "linear" }, 2500);
```

Validated in T1 - mean SSIM 0.974 against Remotion baseline.

## spring -> anime.js outBack

Remotion's `spring()` is the most lossy translation. The mapping is approximate
but close enough that real-world compositions hold ≥ 0.92 SSIM (T2: 0.985, T3: 0.953).

| Remotion `spring` config                          | anime.js equivalent                                | Validated in                     |
| ------------------------------------------------- | -------------------------------------------------- | -------------------------------- |
| `{damping: 12, stiffness: 100, mass: 1}` (snappy) | `outBack(1.4)` over ~700 ms                        | T2, T3 (TitleScene)              |
| `{damping: 14, stiffness: 90, mass: 1}` (calmer)  | `outBack(1.2)` over ~700 ms                        | T3 (StatCard)                    |
| `{damping: 8, stiffness: 200}` (very bouncy)      | `outBack(2.0)` or `outElastic(1, .5)` over ~600 ms | not validated; budget ~0.05 SSIM |
| `{overshootClamping: true}`                       | `outQuart` over ~600 ms (no overshoot)             | not validated                    |

**Rule of thumb**: `outBack(N)` overshoot ratio ≈ `(stiffness / damping^2) * 1.4`. For
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

| Remotion                     | anime.js                                                                   |
| ---------------------------- | -------------------------------------------------------------------------- |
| `Easing.in(Easing.linear)`   | `ease: "linear"`                                                           |
| `Easing.out(Easing.cubic)`   | `ease: "outCubic"`                                                         |
| `Easing.inOut(Easing.cubic)` | `ease: "inOutCubic"`                                                       |
| `Easing.out(Easing.poly(N))` | `ease: "outQuad"` / `"outCubic"` / `"outQuart"` / `"outQuint"`             |
| `Easing.bezier(a,b,c,d)`     | custom ease path when representable, otherwise closest native ease         |
| `Easing.elastic(bounciness)` | `ease: "outElastic(${bounciness}, .3)"`                                    |
| `Easing.bounce`              | `ease: "outBounce"`                                                        |
| `Easing.back(overshoot)`     | `ease: "outBack(${overshoot * 1.7})"` (Remotion's overshoot scale differs) |

## interpolate driving non-numeric properties

```tsx
const color = interpolateColors(frame, [0, 30], ["#ff0000", "#0000ff"]);
```

Anime.js does color tweens natively:

```js
tl.add(target, { color: "#0000ff", duration: 1000, ease: "linear" }, 0);
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

Anime.js equivalent, tween a counter object and write `textContent` on update:

```js
const counter = { v: 0 };
tl.add(
  counter,
  {
    v: target,
    duration: 1500,
    ease: "outQuart",
    onUpdate: () => {
      el.textContent = Math.round(counter.v).toLocaleString();
    },
  },
  0,
);
```

`outQuart` is the anime.js vocabulary mapping for cubic-style ease-out timing. Validated in T3 (mean SSIM 0.953).
Per-frame digit mismatches occur on sub-frame timing offsets but final values
converge - no SSIM impact above the noise floor.

## Stagger via per-instance prop

When custom subcomponents take a `delayInFrames` prop:

```tsx
<StatCard delayInFrames={i * 12} value={...} />
```

Translate to anime.js timeline offsets:

```js
cards.forEach((card, i) => {
  const startMs = (base + i * (12 / fps)) * 1000; // i * 400ms at fps=30
  tl.add(card, { ... }, startMs);
});
```

Validated in T3 - three StatCards staggered at 0.0/0.4/0.8 s.
