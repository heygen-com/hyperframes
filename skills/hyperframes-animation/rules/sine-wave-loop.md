---
name: sine-wave-loop
description: Continuous breathing / idle ambient motion using trigonometry — keeps elements alive after entry settles. Pairs with virtually every entry rule.
metadata:
  tags: idle, loop, breathing, sine, trigonometry, ambient, post-entry
---

# Sine Wave Loop (Breathing / Idle)

Keeps elements alive after the entry beat finishes. Subtle continuous floating using `Math.sin` driven by a long-running timeline tween.

## How It Works

A long tween advances a `phase` value from 0 → 2π (or 0 → some multiple thereof). On every onUpdate, the phase feeds into `Math.sin()` to produce a small periodic offset added to the element's transform (`scale`, `translateY`, `rotate`).

The trick to a "no jump" transition from entry to idle: at `phase = 0`, `sin(0) = 0` — the offset is zero, so the element starts at its post-entry resting state.

## HTML

```html
<div
  class="scene"
  id="idle-scene"
  data-composition-id="idle-scene"
  data-start="0"
  data-duration="6"
  data-track-index="0"
>
  <div class="stack">
    <div class="hero" id="hero">HEYGENVERSE</div>
    <div class="dot" id="dot"></div>
  </div>
</div>
```

## CSS

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: radial-gradient(ellipse at center, #161a3a 0%, #0b0d1f 70%);
}
.stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 56px;
}
.hero {
  font-family: "Inter", sans-serif;
  font-weight: 900;
  font-size: 180px;
  letter-spacing: 8px;
  color: #f5f6fb;
  text-transform: uppercase;
  /* Element gets its post-entry resting transform; idle only ADDS to it */
  will-change: transform;
}
.dot {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: #a78bfa;
  box-shadow: 0 0 32px rgba(167, 139, 250, 0.7);
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const hero = document.getElementById("hero");
  const dot = document.getElementById("dot");

  // Phase 1 — entry beat (e.g. headline fade-up)
  tl.fromTo(
    hero,
    { opacity: 0, y: 24, scale: 0.96 },
    { opacity: 1, y: 0, scale: 1, duration: 0.9, ease: "power3.out" },
    0,
  );
  tl.fromTo(
    dot,
    { opacity: 0, scale: 0 },
    { opacity: 1, scale: 1, duration: 0.6, ease: "back.out(1.6)" },
    0.4,
  );

  // Phase 2 — idle breathing. Starts at idleStartTime AFTER entry settles.
  // Drive a phase 0 → 2π * cycles via a single tween, write sin() into transforms.
  const idleStartTime = 1.0; // seconds — entry beat done by ~0.9s
  const idleDurationSec = 5.0; // remaining composition time
  const CYCLES = 2.5; // 2.5 full breathing cycles across idle duration

  const phase = { p: 0 };
  tl.to(
    phase,
    {
      p: Math.PI * 2 * CYCLES,
      duration: idleDurationSec,
      ease: "none",
      onUpdate: () => {
        // Hero: scale breathes ±0.012, y bobs ±4px
        const scale = 1 + Math.sin(phase.p) * 0.012;
        const y = Math.sin(phase.p) * 4;
        hero.style.transform = `translateY(${y}px) scale(${scale})`;

        // Dot: out-of-phase scale (offset by π/2) — feels alive vs synced
        const dotScale = 1 + Math.sin(phase.p + Math.PI / 2) * 0.08;
        dot.style.transform = `scale(${dotScale})`;
      },
    },
    idleStartTime,
  );

  window.__timelines["idle-scene"] = tl;
</script>
```

## Variations

### Multiple offset frequencies (organic multi-octave breathing)

Combining frequencies feels more alive than pure sine:

```js
const primary = Math.sin(phase.p) * 0.012; // slow main
const secondary = Math.sin(phase.p * 3.0) * 0.004; // faster overlay
const scale = 1 + primary + secondary;
```

### Conditional activation (only after entry settles)

If entry is interactive or skippable, gate the idle:

```js
const idleActive = entryProgress >= 0.95;
const scale = idleActive ? 1 + Math.sin((time - idleStart) / 0.5) * 0.012 : 1;
```

### Period vs cycle math

For an exact cycle of N seconds:

```js
const divisor = (idleDurationSec * fps) / (Math.PI * 2);
const value = Math.sin(frame / divisor) * amplitude;
```

For HF (`onUpdate` doesn't expose frame directly), use the tween's `phase` value: drive `p: Math.PI * 2 * cyclesWanted` over `duration: idleDurationSec`.

## Key Principles

- **`sin(0) = 0`** — at the moment idle begins, the offset must be zero so there's no visible jump from the entry's settled state to idle. Start the phase tween at `phase = 0`.
- **Amplitude subtlety** — scale `0.012-0.04`, rotation `±1-3°`, translation `±2-6px`. Bigger and idle reads as "still animating" instead of "alive but resting."
- **Cycle duration 1.5-3s per breath** — 2s is a typical comfortable breathing cadence; under 1s feels frantic, over 4s feels lifeless.
- **Different elements at different phases** — offset secondary elements by `Math.PI / 2` (90° offset) so they're not all moving in sync. Synced motion looks mechanical; out-of-phase looks alive.
- **Compose, don't replace** — idle motion ADDS to the element's resting transform, not replace it. If the entry settled at `translateY(0)`, idle should produce `translateY(0 + sin*4)`. Don't overwrite the entry's final translation.
- **❗ Don't use CSS `@keyframes` for the idle loop** — CSS animation runs on the browser's render clock, which is independent of the HF seek clock. HF seeks frame-by-frame and a CSS-driven idle will flicker/desync. Drive idle inside the GSAP timeline.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS `animation`** for idle — must be timeline-driven
- **`will-change: transform`** if the idle compounds with other tweens on the same element
- **Phase tween `ease: 'none'`** — sine itself provides the easing; tweening the phase non-linearly produces non-sinusoidal motion
- **Don't restart the idle tween** — it's a single long tween from start to end of composition idle window

## Combinations

- After [press-release-spring.md](press-release-spring.md) — button idle-breathes after release settles
- After [counting-dynamic-scale.md](counting-dynamic-scale.md) — final number breathes
- After [card-morph-anchor.md](card-morph-anchor.md) — settled card idle-bobs
- After [orbit-3d-entry.md](orbit-3d-entry.md) — center label idle-breathes while items orbit

## Pairs with HF skills

- `/hyperframes-gsap` — `onUpdate` writing transform
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
