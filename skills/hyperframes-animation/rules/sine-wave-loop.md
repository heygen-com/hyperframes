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
    <div class="hero" id="hero">{HeroLabel}</div>
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
  background: {bgGradient};
}
.stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: STACK_GAP;
}
.hero {
  font-family: {font};
  font-weight: 900;
  font-size: HERO_FONT_SIZE;
  letter-spacing: HERO_LETTER_SPACING;
  color: {textColor};
  text-transform: uppercase;
  /* Element gets its post-entry resting transform; idle only ADDS to it */
  will-change: transform;
}
.dot {
  width: DOT_SIZE;
  height: DOT_SIZE;
  border-radius: 50%;
  background: {accentColor};
  box-shadow: {accentGlow};
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
    { opacity: 0, y: ENTRY_Y, scale: ENTRY_SCALE },
    { opacity: 1, y: 0, scale: 1, duration: ENTRY_DUR, ease: "power3.out" },
    0,
  );
  tl.fromTo(
    dot,
    { opacity: 0, scale: 0 },
    { opacity: 1, scale: 1, duration: DOT_ENTRY_DUR, ease: `back.out(${BOUNCE_FACTOR})` },
    DOT_ENTRY_START,
  );

  // Phase 2 — idle breathing. Starts at IDLE_START_TIME AFTER entry settles.
  // Drive a phase 0 → 2π * CYCLES via a single tween, write sin() into transforms.

  const phase = { p: 0 };
  tl.to(
    phase,
    {
      p: Math.PI * 2 * CYCLES,
      duration: IDLE_DUR,
      ease: "none",
      onUpdate: () => {
        // Hero: scale breathes ±SCALE_AMP, y bobs ±Y_AMP_PX
        const scale = 1 + Math.sin(phase.p) * SCALE_AMP;
        const y = Math.sin(phase.p) * Y_AMP_PX;
        hero.style.transform = `translateY(${y}px) scale(${scale})`;

        // Dot: out-of-phase scale (offset by π/2) — feels alive vs synced
        const dotScale = 1 + Math.sin(phase.p + Math.PI / 2) * DOT_SCALE_AMP;
        dot.style.transform = `scale(${dotScale})`;
      },
    },
    IDLE_START_TIME,
  );

  window.__timelines["idle-scene"] = tl;
</script>
```

## Variations

### Multiple offset frequencies (organic multi-octave breathing)

Combining frequencies feels more alive than pure sine:

```js
const primary = Math.sin(phase.p) * SCALE_AMP_PRIMARY;
const secondary = Math.sin(phase.p * OCTAVE_RATIO) * SCALE_AMP_SECONDARY; // higher-frequency overlay
const scale = 1 + primary + secondary;
```

### Conditional activation (only after entry settles)

If entry is interactive or skippable, gate the idle:

```js
const idleActive = entryProgress >= GATE_THRESHOLD;
const scale = idleActive ? 1 + Math.sin((time - IDLE_START_TIME) / PERIOD) * SCALE_AMP : 1;
```

### Period vs cycle math

For an exact cycle of N seconds:

```js
const divisor = (idleDurationSec * fps) / (Math.PI * 2);
const value = Math.sin(frame / divisor) * amplitude;
```

For HF (`onUpdate` doesn't expose frame directly), use the tween's `phase` value: drive `p: Math.PI * 2 * cyclesWanted` over `duration: idleDurationSec`.

## How to Choose Values

### Layout / typography

- **STACK_GAP** — vertical gap between hero and dot.
  - Range: 0.2-0.4× `HERO_FONT_SIZE`
- **HERO_FONT_SIZE / HERO_LETTER_SPACING** — typographic emphasis.
  - Range: 100-240 px for full-bleed compositions; spacing 0.04-0.06em
- **DOT_SIZE** — accent indicator size.
  - Range: ~0.15-0.25× `HERO_FONT_SIZE` so the dot reads as accent, not a peer
- **{accentGlow}** — `box-shadow` halo on the dot; typically `0 0 (DOT_SIZE) rgba(accentColor, 0.5-0.7)`

### Entry phase

- **ENTRY_Y / ENTRY_SCALE** — initial state before fade-up.
  - Range: `ENTRY_Y` 16-32 px (subtle rise), `ENTRY_SCALE` 0.94-0.98 (subtle inflation)
- **ENTRY_DUR** — hero fade-up duration.
  - Range: 0.6-1.2s; bigger heroes want a longer settle
- **DOT_ENTRY_START** — when the dot pops in relative to hero.
  - Constraints: typically `≈ 0.4-0.6× ENTRY_DUR` so the dot lands while the hero is still settling, not after
- **DOT_ENTRY_DUR** — dot back-out pop duration.
  - Range: 0.4-0.7s
- **BOUNCE_FACTOR** — `back.out(BOUNCE_FACTOR)` overshoot strength on the dot pop.
  - Range: 1.4 (soft) → 2.0 (firm) → 2.8 (cartoony)

### Idle phase

- **IDLE_START_TIME** — when breathing begins.
  - Constraints: `≥ ENTRY_DUR + small buffer (~0.1s)` so the breath doesn't fight the entry tail. `sin(0) = 0` at this moment, so the offset is exactly the entry's resting state — no jump
- **IDLE_DUR** — breath tween length.
  - Constraints: must equal `TOTAL_DURATION − IDLE_START_TIME` to fill the composition with motion
- **CYCLES** — number of full breath cycles across `IDLE_DUR`.
  - Range: `IDLE_DUR / 3s ≤ CYCLES ≤ IDLE_DUR / 1.5s` (cycle period 1.5-3s reads as natural breathing)
- **SCALE_AMP** — sine amplitude on scale (hero).
  - Range: 0.012-0.04 — see Key Principles for the "alive but resting" sweet spot
- **Y_AMP_PX** — sine amplitude on y translation (hero).
  - Range: 2-6 px
- **DOT_SCALE_AMP** — sine amplitude on dot scale (offset by π/2 for out-of-phase motion).
  - Range: 0.04-0.12 — larger than hero amplitude is fine because the dot is a small accent
- **PERIOD** (conditional-activation variation) — seconds per cycle when using the `(time - IDLE_START_TIME) / PERIOD` form.
  - Range: 1.5-3s
- **GATE_THRESHOLD** (conditional-activation variation) — entryProgress required to start idle.
  - Range: 0.85-1.0; lower gates start idle slightly before entry completes for an overlap

### Multi-octave variation

- **SCALE_AMP_PRIMARY / SCALE_AMP_SECONDARY** — amplitudes of the two stacked sines.
  - Constraints: `SCALE_AMP_PRIMARY > SCALE_AMP_SECONDARY` (secondary is a higher-frequency overlay, not a peer); combined max amplitude should stay within the SCALE_AMP range above
- **OCTAVE_RATIO** — frequency multiplier of secondary relative to primary.
  - Range: 2.0-4.0 (whole-number-ish ratios feel musical/coherent; non-integer ratios feel organic/unpredictable)

### Color tokens

- **{bgGradient}** — typically a dark radial gradient so the lit hero pops
- **{textColor}** — high-contrast against `{bgGradient}`
- **{accentColor}** — single accent reserved for the dot; the glow color in `{accentGlow}` is the same hue

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

- `/hyperframes-animation` — `onUpdate` writing transform
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
