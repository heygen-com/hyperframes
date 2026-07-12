# Easing, Stagger, and Function-Based Values

## Easing

Built-in eases: `power1`, `power2`, `power3`, `power4`, `back`, `bounce`, `circ`, `elastic`, `expo`, `sine`, `none`.

Each has `.in`, `.out`, `.inOut` variants.

| Ease                                       | Use for                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `power1.out`, `power2.out`                 | Gentle motion for secondary elements (a caption fade, a small shift). NOT the entrance default. |
| `power3.out` (house default), `power4.out` | The standard long-tail settle. Entrances, title cards, hero reveals.                            |
| `sine.inOut`                               | Long, slow, calm motion. Crossfades, ambient drift.                                             |
| `back.out(1.7)`                            | Overshoot then settle. RARE — explicitly-playful register only, never a default.                |
| `elastic.out(1, 0.3)`                      | Springy bounce. Same playful-only rule; prefer a baked spring (see Spring Eases below).         |
| `expo.inOut`                               | Snappy, dramatic. Quick transitions between hero scenes.                                        |
| `none` (linear)                            | Camera moves with timed counterpoint, mechanical motion.                                        |

Pick `.out` for entrances, `.in` for exits, `.inOut` for symmetric moves and continuous motion.

**Smooth beats bouncy** — the motion doctrine (`rules/spring-pop-entrance.md`, the workflows' `motion-language.md`): entrances default to `power3.out` or the baked critically-damped spring (see Spring Eases below); overshoot eases (`back` / `elastic` / `bounce`) are a rare, explicitly-playful register, never the house style.

## Easing Vocabulary (character & mood)

Easings are tone of voice: a video that only whispers is boring; one that varies between whisper, normal, and punch is engaging. A composition should draw on ~3 easing characters across its beats — but vary **within the smooth families by energy** (`sine` / `power1` calm → `power3` standard → `power4` / `expo` punch); don't reach for overshoot to add variety. Overshoot is a _register_ (explicitly playful), not a spice. One ease everywhere reads flat; bounce everywhere reads cheap — the second failure is worse.

The full palette by character (each family has `.in`, `.out`, `.inOut` variants):

| Family               | Character                                                                    | Typical use                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `power1`–`power4`    | Gentle (1) to aggressive (4) acceleration curves                             | General purpose. **power3 is the house workhorse**; power2 for gentle secondary motion, power4 for dramatic snaps                            |
| `back(N)`            | Overshoot then settle. N controls how far past the target (1=subtle, 4=wild) | RARE — explicitly-playful register only, never a default. Keep N ≤ 2; prefer a baked spring at ζ 0.6–0.7 (physical settle, see Spring Eases) |
| `elastic(amp, freq)` | Spring bounce. amp=magnitude, freq=oscillation speed                         | RARE — same playful-only rule; the baked spring (below) is the physical version                                                              |
| `bounce`             | Ball-drop bouncing                                                           | RARE — physical-comedy register only (something literally dropping)                                                                          |
| `expo`               | Extreme acceleration curve (much steeper than power4)                        | Premium/luxury reveals, dramatic entrances                                                                                                   |
| `sine`               | Smooth, organic, no hard edges                                               | Ambient float, breathing, Ken Burns, anything that loops. `.inOut` for yoyo motion                                                           |
| `circ`               | Circular acceleration (starts very fast, ends very gentle or vice versa)     | Camera moves, scene transitions, orbital motion                                                                                              |
| `steps(N)`           | Discrete N-step jumps, no interpolation                                      | Typing effects, cursor blink, counter ticks, retro/digital aesthetics                                                                        |

**Mood mapping:** Match easing character to the beat's emotional content. Smooth/organic easings (`sine`, `power1`) feel contemplative and drifting. Aggressive deceleration (`power4.out`, `expo.out`) feels snappy and confident. Spring overshoot (`back.out`) feels bouncy and physical — but bouncy is a register, not an emphasis tool; reach for it only on explicitly-playful beats. The storyboard's mood description should guide which character fits — not a formula.

## Defaults

```javascript
const tl = gsap.timeline({
  paused: true,
  defaults: { duration: 0.6, ease: "power3.out" }, // the house settle — smooth beats bouncy
});
```

Or globally:

```javascript
gsap.defaults({ duration: 0.6, ease: "power3.out" });
```

Setting defaults at timeline scope is preferred — it documents the motion language of that composition in one place.

## Spring Eases (baked physics, seek-safe)

The "iOS feel" is a **damped spring's velocity curve**, not a bounce: a fast launch into a long asymptotic settle. Well-made system animations are critically damped or close to it — they barely overshoot, or don't at all. `power3.out` / `expo.out` approximate that curve; when you want the exact one — or a _physical_ overshoot for the rare playful register — bake the spring's closed-form solution into a function ease.

Why not a real-time spring library: an interactive spring is a stateful integrator (velocity accumulates frame to frame), which cannot be seeked deterministically — you'd have to simulate frames 0…N−1 to render frame N. The closed form below is a **pure function of progress** — no state, nothing to desync, seek-safe by construction. This is also why interaction-lib spring solvers are banned in compositions.

```javascript
// springEase — a damped spring's exact position curve as a GSAP ease.
// response         ≈ seconds one oscillation would take (0.3–0.6 for entrances)
// dampingFraction  1.0       = critically damped — smooth settle, NO overshoot (house default)
//                  0.80–0.85 ≈ the iOS system register — ~1–1.5% overshoot, felt not seen
//                  0.60–0.70 = explicitly playful — ~5–10% overshoot (rare; replaces back.out)
function springEase({ response = 0.5, dampingFraction = 1 } = {}) {
  const w = (2 * Math.PI) / response; // undamped natural frequency
  const z = dampingFraction;
  let pos; // x(t): 0 → 1, starting at rest (v0 = 0)
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    pos = (t) => 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
  } else if (z > 1) {
    const wo = w * Math.sqrt(z * z - 1);
    pos = (t) =>
      1 - Math.exp(-z * w * t) * (Math.cosh(wo * t) + ((z * w) / wo) * Math.sinh(wo * t));
  } else {
    pos = (t) => 1 - Math.exp(-w * t) * (1 + w * t);
  }
  // Settle time: last moment the curve sits outside ±0.1% of target.
  // Fixed-step scan, runs once at setup — deterministic (no Math.random / Date.now).
  const EPS = 0.001;
  const rate = z <= 1 ? z * w : (z - Math.sqrt(z * z - 1)) * w; // slowest decay mode
  const SCAN = 12 / rate;
  const N = 4800;
  let T = SCAN;
  for (let i = N; i >= 0; i--) {
    const t = (i / N) * SCAN;
    if (Math.abs(1 - pos(t)) > EPS) {
      T = ((i + 1) / N) * SCAN;
      break;
    }
  }
  const xT = pos(T);
  return {
    duration: T, // use as the tween's duration — the settle time IS the physics
    ease: (p) => pos(p * T) + p * (1 - xT), // normalized so ease(1) === 1 exactly
  };
}
```

Usage — take **both** the ease and the duration from the helper (the settle time is part of the physics; overriding the duration just re-times the same curve, so tune speed via `response` instead):

```javascript
const settle = springEase({ response: 0.4 }); // critically damped → duration ≈ 0.59s
tl.fromTo(
  "#hero",
  { scale: 0, opacity: 0 },
  { scale: 1, opacity: 1, duration: settle.duration, ease: settle.ease },
  0.2,
);
```

| dampingFraction   | overshoot       | register                                                                                                                                           |
| ----------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1.0 (default)** | none (monotone) | The house settle — the exact curve `power3.out` approximates. Product / enterprise / serious tone.                                                 |
| 0.80–0.85         | ~1–1.5%         | "Alive, not bouncy" — the iOS system default register. The overshoot is felt, not seen.                                                            |
| 0.60–0.70         | ~5–10%          | Explicitly-playful ONLY (same rule as `back.out`, which this replaces — a spring's second-order settle reads physical where `back` reads cartoon). |
| < 0.55            | > 12%           | Don't. Cartoon-wobble territory.                                                                                                                   |

| response  | duration (ζ=1) | feel                                                         |
| --------- | -------------- | ------------------------------------------------------------ |
| 0.25–0.35 | 0.37–0.51s     | tight snap — chips, small UI                                 |
| 0.35–0.50 | 0.51–0.74s     | standard entrance                                            |
| 0.50–0.70 | 0.74–1.03s     | weighted hero landing — check the `t ≤ 0.5s` visibility rule |

Craft notes:

- **ζ=1 vs `power3.out`**: the true spring front-loads harder (~67% vs ~58% travelled at quarter-time) and settles on a longer asymptotic tail; max shape difference ~11%. That long tail is the "premium" read — use it when the settle IS the shot (a wordmark landing, a final lockup).
- **At ζ<1, overshooting curves go on transforms only** — never on `opacity` (it would push past 1) or color. Split opacity onto its own `power2.out` tween at the same timeline position.
- **Doctrine unchanged**: ζ below ~0.8 is still the rare, explicitly-playful exception (`rules/spring-pop-entrance.md`). The default of this section is ζ=1 — real spring physics is not a license for bounce.

## Stagger

```javascript
gsap.fromTo(".item", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.08 });
```

Object form:

```javascript
gsap.fromTo(
  ".item",
  { y: 24, opacity: 0 },
  {
    y: 0,
    opacity: 1,
    stagger: {
      each: 0.08, // delay between each
      from: "center", // "start" | "end" | "center" | "edges" | "random" | index
      amount: 0.6, // total stagger time (overrides each if both set)
      grid: "auto", // for 2D stagger
      axis: "x" | "y",
    },
  },
);
```

Prefer `stagger` over N separate tweens with manual delays — it stays correct when the target count or order changes. Use `fromTo()` rather than `from()` so the start state is explicit (see `gsap-timeline-and-labels.md` → sub-composition entrances).

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
