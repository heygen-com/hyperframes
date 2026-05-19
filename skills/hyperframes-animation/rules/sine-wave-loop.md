---
name: sine-wave-loop
description: Continuous breathing/idle ambient motion using `sine.inOut` ease on a GSAP yoyo tween (preferred) or an `onUpdate` that reads `tl.time()`. Finite repeats only — HyperFrames forbids `repeat: -1`.
metadata:
  tags: idle, loop, breathing, sine, ambient, gsap
  adapter: gsap
---

# Sine Wave Loop (Breathing / Idle)

Keeps elements alive after entrance animations settle. A continuous, subtle floating effect — scale ±4–5%, rotation ±1–4°. Larger amplitudes read as glitches; subtler values (±1°) suit phase-opposed paired motion like split cards.

## HyperFrames vs. Remotion

The Remotion version computed `Math.sin(idleTime / period) * amplitude` inside the render function every frame. That works because Remotion's renderer is frame-pure.

HyperFrames offers two equally valid forms:

| Form                                                | When to use                                                                                             |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **GSAP `yoyo` tween with `sine.inOut`** (preferred) | When you can express the breath as a half-cycle tween between two values. Cleanest, no `onUpdate` cost. |
| **`onUpdate` reading `tl.time()`**                  | When you need multiple offset frequencies stacked, or the breath multiplies onto another live value.    |

**Critical**: HyperFrames forbids `repeat: -1`. Always compute a finite `repeat` count from the remaining `data-duration` after the breath start.

## Form 1 — GSAP yoyo (preferred)

```js
const BREATH_START = 3.7; // seconds — after the previous phase settles
const HALF_CYCLE = 0.75; // seconds — half a full breath cycle
const TOTAL_DUR = 5.0; // matches data-duration on the composition root

// repeat is in half-cycles. yoyo bounces back, so 2 = three visible passes.
const remaining = TOTAL_DUR - BREATH_START; // = 1.3s
const halfCycles = Math.max(0, Math.floor(remaining / HALF_CYCLE) - 1);

tl.fromTo(
  ".hero",
  { scale: 1, rotation: 0 },
  {
    scale: 1.04, // ±4% amplitude
    rotation: 2, // ±2° amplitude
    duration: HALF_CYCLE,
    ease: "sine.inOut", // smooth in and out
    yoyo: true,
    repeat: halfCycles,
  },
  BREATH_START,
);
```

Why this works:

- `sine.inOut` is exactly `(1 - cos(πx)) / 2` — the same shape as half a `Math.sin()` cycle.
- A `fromTo` with `yoyo: true, repeat: 1` gives: `1 → 1.04 → 1` (two passes). Each additional repeat adds another half-cycle.
- `fromTo` ensures the start state is set explicitly, so the breath doesn't depend on whatever state the previous phase left.

## Form 2 — onUpdate reading `tl.time()`

Use when the breath multiplies onto another live value (e.g. a hero scale that combines pop-in + breath).

```js
const BREATH_START = 3.7;
const SCALE_PERIOD = 1.5; // seconds per full cycle
const SCALE_AMP = 0.04;
const ROTATE_AMP = 2;
const FINAL_SCALE = 1.0; // scale the hero settled at after Phase 4

const heroEl = document.querySelector(".hero");

// A dummy clock tween — duration covers from BREATH_START to composition end.
tl.to(
  { tick: 0 },
  {
    tick: 1,
    duration: 5.0 - BREATH_START,
    ease: "none",
    onUpdate: function () {
      const idleTime = Math.max(0, tl.time() - BREATH_START);
      const breathScale = 1 + Math.sin((idleTime / SCALE_PERIOD) * Math.PI * 2) * SCALE_AMP;
      const breathRot = Math.sin((idleTime / SCALE_PERIOD) * Math.PI * 2) * ROTATE_AMP;
      gsap.set(heroEl, {
        scale: FINAL_SCALE * breathScale,
        rotation: breathRot,
      });
    },
  },
  BREATH_START,
);
```

The onUpdate form is more flexible (you can combine multiple frequencies, gate the breath behind a condition) but does work every frame.

## Multiple Offset Frequencies

For more organic, less mechanical motion, combine two frequencies inside an `onUpdate`:

```js
const idleTime = Math.max(0, tl.time() - BREATH_START);
const primary = Math.sin((idleTime / 1.0) * Math.PI * 2) * 0.04;
const secondary = Math.sin((idleTime / 1.67) * Math.PI * 2) * 0.02;
const breathScale = 1 + primary + secondary;
```

Pick periods that are _not_ simple ratios (avoid 1s + 2s — they sync up); 1.0s + 1.67s feels random.

## Conditional Activation (Gate the Breath)

Only breathe **after** the entry/zoom spring energy has dissipated. Otherwise the breath fights the entry tween's final settle.

In Form 1, gate via `BREATH_START` timing alone — the tween simply doesn't fire until that point.

In Form 2, add an explicit gate:

```js
onUpdate: function () {
  if (tl.time() < BREATH_START) return;       // not breathing yet
  // breath math here
}
```

## Phase Alignment: `sin(0) = 0`

Both forms guarantee the breath starts at zero displacement (`sin(0) = 0` and `fromTo(scale: 1, ...)` both start at the rest state). This means there's no visible jump when entering breath from a stable post-entry state.

## Critical Constraints

- **Finite repeat only**: HyperFrames forbids `repeat: -1`. Compute `repeat = floor(remainingTime / halfCycle) - 1`.
- **Start time after settle**: `BREATH_START` must be after the previous phase's springs have rung out — typically 0.1–0.3s after the zoom or entry settles.
- **Amplitude subtlety**: Scale ±0.03–0.05, rotation ±1–4°. Anything larger reads as a glitch. Use the low end (±1°) for phase-opposed paired motion (e.g. split-tilt cards) where two elements rock against each other.
- **`fromTo` over `to`**: For Form 1, `fromTo` makes the start state explicit and prevents state inheritance bugs from previous tweens.
- **GSAP transform aliases only**: `scale`, `rotation`, `x`, `y`. Never tween `transform` directly or use CSS keyframe animations alongside (would conflict per the HF allowlist).
- **No `Math.random` / `Date.now`**: Both forms are pure functions of `tl.time()`.

## Combinations

- Apply after [coordinate-target-zoom](coordinate-target-zoom.md) zoom settles — the standard "land then breathe" pattern.
- Use the onUpdate form (multiplicative) when combining with a static pop value: `scale = popValue * breathScale`.
- Pair with a finite glow yoyo (`filter: drop-shadow(...)`) for a "alive" feel without distraction.

## Examples

- [brand-reveal-assemble-zoom.html](../examples/brand-reveal-assemble-zoom.html) — uses Form 2 (onUpdate) so the breath multiplies onto the hero's pop-in scale.
