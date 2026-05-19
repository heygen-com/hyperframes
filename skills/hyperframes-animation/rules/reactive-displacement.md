---
name: reactive-displacement
description: Physical collision transition where an entering element's tween drives the exiting element's displacement. Expressed in HyperFrames as multiple GSAP tweens started at the same timeline position so the eye reads them as one causal motion.
metadata:
  tags: transition, physics, collision, displacement, gsap, push
  adapter: gsap
---

# Reactive Displacement Transition

Exit animation of Element A is mathematically derived from the entry of Element B. Creates a causal link the eye reads as: "A moves _because_ B hit it."

## HyperFrames vs. Remotion

The Remotion source used a **single spring** instance and read it three times — once for the intruder's position, once for the victim's push, once for the victim's opacity. Because spring is a pure function of frame, all three derivations stay in lockstep without explicit synchronization.

HyperFrames uses **multiple GSAP tweens started at the same timeline position parameter**. They run in parallel, share a start time, and use eases tuned to feel like one spring read at different rates. The "single source of truth" becomes a shared **start time + start state** rather than a shared scalar.

```
Remotion: const s = spring(...);    // one source, three reads
          intruderX = interp(s, [0,1], [800, 0])
          victimX   = interp(s, [0, 0.5], [0, -150])    ← completes at 0.5 of driver
          victimOp  = interp(s, [0, 0.4], [1, 0])       ← completes at 0.4 of driver

HyperFrames: tl.to(intruder, { x: 0,  duration: 0.85, ease: "power2.out" }, t)
             tl.to(victim,   { x: -150, duration: 0.43, ease: "power2.out" }, t)
             tl.to(victim,   { opacity: 0, duration: 0.34, ease: "power2.out" }, t)
                                       └── 0.5 × 0.85 ────────────┘
                                                              └── 0.4 × 0.85 ─┘
```

The shorter victim durations (40–50% of intruder duration) recreate the "immediate impact" feel.

## Core Concept

The intruder's motion is the conceptual driver. Three concurrent tweens at the same timeline position:

1. **Intruder enters**: `x` from off-screen to 0, with overshoot scale + rotation.
2. **Victim pushed**: `x` moves in the direction opposite the intruder's entry (momentum transfer). Duration ≈ 0.4–0.5 × intruder duration so the impact reads as immediate.
3. **Victim fades**: `opacity` → 0, slightly faster than the push (0.4 × intruder duration).

## Basic Pattern

```html
<div
  class="stage"
  style="position: absolute; inset: 0;
     display: flex; align-items: center; justify-content: center;"
>
  <!-- Victim — exiting element. Sits behind intruder. -->
  <div class="victim" style="position: absolute;">
    <!-- e.g. text or icon being replaced -->
  </div>

  <!-- Intruder — entering element. z-index above victim during overlap. -->
  <div
    class="intruder"
    style="position: absolute; z-index: 20;
       transform: translateX(800px) scale(0.5) rotate(-45deg); opacity: 0;"
  >
    <!-- e.g. logo / icon taking over -->
  </div>
</div>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const DISPLACE_AT = 4.6; // seconds — when the collision starts
  const INTRUDE_DUR = 0.85; // matches spring(stiffness:100, damping:20, mass:1.5) settle
  const PUSH_DIST = -150; // px — victim moves THIS direction (negative = left)
  const OFFSCREEN_X = 800; // px — intruder starts here

  // (1) Intruder enters from offscreen-right with rotation + scale impact.
  // power2.out approximates the heavy spring (mass:1.5) — slow settle, no extra bounce.
  // For a perceptibly heavier feel use back.out(1.2), which adds ~10% overshoot.
  tl.fromTo(
    ".intruder",
    { x: OFFSCREEN_X, scale: 0.5, rotation: -45, opacity: 0 },
    {
      x: 0,
      scale: 1.3,
      rotation: 0,
      opacity: 1,
      duration: INTRUDE_DUR,
      ease: "power2.out",
    },
    DISPLACE_AT,
  );

  // (2) Victim pushed. Completes at 50% of intruder duration → immediate impact.
  tl.to(".victim", { x: PUSH_DIST, duration: INTRUDE_DUR * 0.5, ease: "power2.out" }, DISPLACE_AT);

  // (3) Victim fades. Completes at 40% → fades before the push fully lands,
  //     reinforcing that the victim is "knocked out of frame."
  tl.to(".victim", { opacity: 0, duration: INTRUDE_DUR * 0.4, ease: "power2.out" }, DISPLACE_AT);

  window.__timelines["main"] = tl;
</script>
```

## Variations

### Reverse-Direction Push (Intruder from Left)

If the intruder enters from off-screen-left, the victim must be pushed _right_ (positive X). Momentum direction must match — reversing breaks the physical metaphor.

```js
const OFFSCREEN_X = -800; // intruder starts at left
const PUSH_DIST = 150; // victim shoved right
```

### Vertical Collision

For an intruder dropping from above, swap `x` for `y`:

```js
tl.fromTo(
  ".intruder",
  { y: -600, scale: 0.5, rotation: 0, opacity: 0 },
  { y: 0, scale: 1.0, rotation: 0, opacity: 1, duration: INTRUDE_DUR, ease: "power2.out" },
  DISPLACE_AT,
);
tl.to(".victim", { y: 100, duration: INTRUDE_DUR * 0.5, ease: "power2.out" }, DISPLACE_AT);
```

### Rotation on Impact (Drop the Mic)

A small finish-rotation makes the impact feel like a landing. Apply during the intruder's last 30% of motion:

```js
tl.to(
  ".intruder",
  {
    rotation: 5, // 5° tilt at the moment of impact
    duration: INTRUDE_DUR * 0.3,
    ease: "power2.out",
  },
  DISPLACE_AT + INTRUDE_DUR * 0.7,
);
// Followed by a settle back to 0° via the breathing phase.
```

## Critical Constraints

- **Three concurrent tweens, same timeline position**: This is what creates the "single spring" feeling. Drift the start times and the causal link breaks.
- **Victim duration < intruder duration**: Push completes at 40–50% so the impact lands before the intruder finishes settling.
- **Z-index layering**: Intruder above victim (`z-index: 20`) during overlap. Otherwise the victim's still-fading edge peeks through the intruder.
- **Directional consistency**: Intruder from positive X → victim moves negative X. Intruder from negative X → victim moves positive X. Vertical: down → push down; up → push up.
- **GSAP transform aliases only**: `x`, `y`, `scale`, `rotation`. Never `left` / `top` / `width` / `height` — banned by the HF allowlist.
- **Single paused timeline**: Hosts all three tweens; HyperFrames seeks it deterministically.
- **No `Math.random()` / `Date.now()`**: All motion derived from `tl.time()` via the tween durations.

## Spring → GSAP Ease Mapping (this rule)

| Source                                               | Feel                          | GSAP ease                |
| ---------------------------------------------------- | ----------------------------- | ------------------------ |
| `spring({ stiffness: 100, damping: 20, mass: 1.5 })` | Heavy, slow settle, no bounce | `power2.out` over ~0.85s |
| Same, but with perceptible weight on impact          | Slight overshoot on landing   | `back.out(1.2)`          |
| Aggressive impact                                    | Fast in, hard stop            | `power3.out` over ~0.55s |

`mass: 1.5` in Remotion adds inertia — the heavier feel. In GSAP, the same feel comes from a **longer duration** with a gentler ease (`power2.out`), not from a different spring config. The math is different; the result reads the same.

## Combinations

- After the displacement settles, apply [sine-wave-loop](sine-wave-loop.md) for idle breathing — the multiplicative `onUpdate` form is correct here because the intruder lands at a non-1 scale (e.g. 1.3) and the breath should multiply onto that.
- Pair with [vertical-spring-ticker](vertical-spring-ticker.md) — the ticker is the victim that gets displaced.
- Combine with [hacker-flip-3d](hacker-flip-3d.md) — the intruder carries decoded text.

## Examples

- [takeover-ticker-displace.html](../examples/takeover-ticker-displace.html) — typewriter + ticker get displaced by a logo entering from off-screen right.
