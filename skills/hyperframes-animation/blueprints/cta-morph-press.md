---
id: cta-morph-press
role: cta
duration_seconds: [4, 6]
phases: 4
visual_arc: hero-entrance → morph-swap → cursor-approach → press-react
uses_rules: [sine-wave-loop, scale-swap-transition, physics-press-reaction]
element_roles:
  hero: Initial focal element (logo, brand lockup, product) that establishes presence then exits via shrink-fade
  cta: Interactive target (button, card, link) that enters via bouncy scale-swap at the hero's position
  cursor: Pointer that enters from off-screen along a spring path, then performs a physical click
when_to_use:
  - Scene transitions from brand presence to a call-to-action
  - Two elements occupy the same screen position sequentially (morph illusion)
  - Simulated user interaction (cursor click) on the final element
  - Hero should feel "alive" before transforming (breathing idle)
when_not_to_use:
  - Hero and CTA coexist on screen — see brand-reveal-assemble-zoom
  - CTA enters from off-screen — see takeover-ticker-displace
  - No click interaction — use scale-swap-transition alone
  - Multiple CTAs need sequential interaction
triggers:
  [logo morphs into button, CTA animation, cursor clicks button, brand to action, morph transition]
---

# CTA · Morph & Press (HyperFrames)

Hero enters with breathing idle → morphs into CTA via scale-swap → cursor approaches → physics-based click reaction.

This blueprint is the HyperFrames port of the Remotion `morph-press-interact` choreography. Same four-phase "presence → action" arc; one paused GSAP timeline; constituent patterns map to [sine-wave-loop](../rules/sine-wave-loop.md), [scale-swap-transition](../rules/scale-swap-transition.md), and [physics-press-reaction](../rules/physics-press-reaction.md).

## When to Use

- Scene arc moves from brand identity to user action
- Two elements share the same screen center but appear sequentially (morph)
- Final beat is a simulated click interaction with physical feedback
- Hero needs subtle ambient motion before transformation

## Phase Pipeline

All boundaries are in **seconds**.

| Phase | Time window (s)                | What Happens                                                              | Skill Reference                                              |
| ----- | ------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1     | `0.17 – morphAt`               | Hero enters (y rise + fade) + ambient rotation idle                       | [sine-wave-loop](../rules/sine-wave-loop.md) Form 2          |
| 2     | `morphAt – cursorEnter`        | Hero shrinks/fades; CTA pops in with overshoot; text reveals after a beat | [scale-swap-transition](../rules/scale-swap-transition.md)   |
| 3     | `cursorEnter – clickDown`      | Cursor enters from off-screen bottom-right via spring path                | inline spring tween                                          |
| 4     | `clickDown – clickUp + 0.25 s` | Cursor and CTA scale-dip together, then recover                           | [physics-press-reaction](../rules/physics-press-reaction.md) |

## Element Sizing

All dimensions derive from `data-height` (composition height). Proportional sizing keeps the morph illusion consistent across resolutions.

### Hero Element

The hero dominates Phase 1 — it must command the viewport. Text-based heroes use oversized typography.

```
heroFontSize:       data-height × 0.28 – 0.32        (300–340 px at 1080 p)
heroFontWeight:     800                              (ultra-bold)
heroLetterSpacing:  -0.04em                          (tighter tracking at large sizes)
heroIconSize:       heroFontSize × 2.2 – 2.5         (icon proportional to text)
```

Hero elements should fill 60–80% of viewport width. Too small and the morph reads as a UI transition, not a cinematic beat.

### CTA Button

```
ctaFontSize:        data-height × 0.09 – 0.11        (100–120 px at 1080 p)
ctaPaddingV:        ctaFontSize × 0.6 – 0.7          (generous vertical breathing room)
ctaPaddingH:        ctaFontSize × 1.7 – 2.0          (wide horizontal padding for pill shape)
ctaBorderRadius:    ctaPaddingV + ctaFontSize / 2    (fully rounded pill ends)
```

CTA total width should be 30–50% of viewport width. The **CTA must be smaller than the hero** — the morph reads as "condensing" into a focused action element.

```
ctaTotalWidth < heroGroupWidth × 0.7
```

If the CTA is larger than the hero, the morph feels like an expansion, not a transformation. Visually wrong.

### Cursor

```
cursorSize:         ctaFontSize × 1.0 – 1.2          (110–130 px at 1080 p)
```

Use inline SVG with `viewBox` for resolution-independent rendering. Add a drop-shadow filter (`stdDeviation: 3`, `floodOpacity: 0.3`) for depth.

## Layout

Hero and CTA share the same screen center sequentially. Both are absolutely positioned and centered via flex. Cursor is positioned independently — its motion path lands offset from center (where a human would naturally aim).

```html
<div
  class="stage"
  style="position: absolute; inset: 0;
     display: flex; align-items: center; justify-content: center;
     background: #fff;"
>
  <!-- Phase 1+2: Hero (will exit during morph) -->
  <div class="hero" id="hero">
    <h1 class="hero-text">GWI</h1>
    <h1 class="hero-text">Spark</h1>
    <div class="hero-logo">
      <svg class="logo-svg">...</svg>
    </div>
  </div>

  <!-- Phase 2+: CTA (initially scale 0, pops in during morph) -->
  <div class="cta" id="cta" style="position: absolute; z-index: 10;">
    <span class="cta-text">Find out more</span>
  </div>

  <!-- Phase 3+: Cursor (initially opacity 0, hard-cuts in) -->
  <div class="cursor" id="cursor" style="position: absolute; z-index: 100; opacity: 0;">
    <svg class="cursor-svg">...</svg>
  </div>
</div>
```

## Phase 1: Hero Entrance + Breathing Idle

Two layered animations on the hero:

1. **Spring entrance** — `opacity` 0 → 1 and `y` from `+40 px` to 0
2. **Breathing rotation** on the logo only — sine yoyo or onUpdate, ±4° amplitude

The breathing rotation runs continuously from `t = 0`; it's invisible until the entrance fades the hero in.

```js
const INTRO_START = 0.17; // seconds (~5 frames at 30 fps)

tl.fromTo(
  ".hero",
  { opacity: 0, y: 40 },
  { opacity: 1, y: 0, duration: 0.47, ease: "power3.out" }, // spring(120, 14)
  INTRO_START,
);

// Subtle breathing rotation on the logo. ±4° over ~6.3 s period.
// For a 5.5 s composition this is just under one cycle — barely perceptible
// but enough to feel alive. Use Form 2 (onUpdate) since it reads tl.time().
const logoEl = document.querySelector(".hero-logo");
tl.to(
  { tick: 0 },
  {
    tick: 1,
    duration: 5.5,
    ease: "none",
    onUpdate: function () {
      const t = tl.time();
      gsap.set(logoEl, { rotation: Math.sin(t * 1.0) * 4 });
    },
  },
  0,
);
```

Why not scale-breath too? The Remotion source had `idleScale = 1 + sin * 0.01` — ±1 % scale is below the visual threshold for most viewers, and including it complicates the morph exit (the exit tween's `scale: 0.6` has to overwrite the breath). Skip it; rotation alone reads as alive.

## Phase 2: Scale-Swap Morph (Core Transition)

Single trigger `morphAt`. Three tween clusters fire concurrently:

1. **Hero shrinks** (`scale 1 → 0.6`)
2. **Hero opacity** (`1 → 0`) — completes faster than the shrink (~30 % of scale duration) so the fade lands before the shrink finishes
3. **CTA pops in** (`scale 0 → 1`, `opacity 0 → 1`) with `back.out(2)` overshoot

```js
const MORPH_AT = 2.17;
const EXIT_SCALE = 0.6;
const TEXT_REVEAL_AT = 2.33; // morphAt + ~0.17 s

// CTA initial state — set before the timeline runs so it's invisible pre-morph.
gsap.set("#cta", { scale: 0, opacity: 0 });
gsap.set(".cta-text", { opacity: 0, y: 10 });

// (1) Hero shrinks
tl.to("#hero", { scale: EXIT_SCALE, duration: 0.5, ease: "power3.out" }, MORPH_AT);

// (2) Hero fades fast
tl.to(
  "#hero",
  { opacity: 0, duration: 0.15, ease: "power2.out" }, // 30% of shrink dur
  MORPH_AT,
);

// (3) CTA pops in with overshoot
tl.to("#cta", { scale: 1, opacity: 1, duration: 0.45, ease: "back.out(2)" }, MORPH_AT);

// (4) CTA text reveals slightly after the container reaches recognizable scale.
tl.to(".cta-text", { opacity: 1, y: 0, duration: 0.33, ease: "power2.out" }, TEXT_REVEAL_AT);
```

See [scale-swap-transition](../rules/scale-swap-transition.md) for the full pattern and ease mapping.

## Phase 3: Cursor Motion Path

The cursor enters from beyond the viewport's bottom-right and follows a spring path toward a target slightly offset from center (where a human would naturally aim — not dead-center on the button, but a hair right and below).

```js
const CURSOR_ENTER_AT = 2.83;
const W = 1920,
  H = 1080;
const CURSOR_START_X = W + 100;
const CURSOR_START_Y = H + 200;
const CURSOR_TARGET_X = W / 2 + 120; // slightly right of center
const CURSOR_TARGET_Y = H / 2 + 50; // slightly below center

// Cursor initial position (off-screen) + scale 1 (no entrance scale).
gsap.set("#cursor", {
  x: CURSOR_START_X,
  y: CURSOR_START_Y,
  scale: 1,
});

// HARD-CUT opacity. Cursors appear instantly — they don't fade in.
// A near-zero-duration tween creates a step change that scrubs correctly.
tl.fromTo(
  "#cursor",
  { opacity: 0 },
  { opacity: 1, duration: 0.001, ease: "none" },
  CURSOR_ENTER_AT,
);

// Spring-driven approach path.
tl.to(
  "#cursor",
  { x: CURSOR_TARGET_X, y: CURSOR_TARGET_Y, duration: 1.0, ease: "power2.out" }, // spring(stiffness:60, damping:20)
  CURSOR_ENTER_AT,
);
```

**Why hard-cut opacity, not a fade?** Real cursors don't fade in — they instantly appear at their last known position. A fade-in cursor looks like a ghost. Use a `fromTo` with `duration: 0.001` to create a step change rather than a smooth transition.

**Why offset target, not dead-center?** Click targets are typically off-center by 5–10 px when a user clicks — the cursor lands where the eye + hand coordinate to, which has a slight bias toward the visible center of mass of the button. Dead-center lands too perfectly and reads as scripted.

## Phase 4: Physics-Based Press (Core Interaction)

Two scale tweens applied to **both** the CTA and the cursor simultaneously. The synchronized deformation is what sells the contact — the cursor "pushes into" the button.

```js
const CLICK_DOWN_AT = 3.83;
const CLICK_UP_AT = 4.17; // hold ~10 frames at 30 fps
const PRESS_INTENSITY = 0.1; // 0.05 subtle · 0.1 standard · 0.15 heavy

// Press DOWN — both elements compress to 0.9.
tl.to(
  ["#cta", "#cursor"],
  {
    scale: 1 - PRESS_INTENSITY,
    duration: 0.15,
    ease: "power3.out", // spring(stiffness:300, damping:20)
  },
  CLICK_DOWN_AT,
);

// RELEASE — back to 1.0.
tl.to(
  ["#cta", "#cursor"],
  {
    scale: 1.0,
    duration: 0.25,
    ease: "power2.out", // spring(stiffness:200, damping:15)
  },
  CLICK_UP_AT,
);
```

The single targets array `["#cta", "#cursor"]` is what makes this tactile. Don't split into separate per-element tweens with subtly different eases — the slightest desync breaks the "they're touching" illusion.

See [physics-press-reaction](../rules/physics-press-reaction.md) for press intensity recommendations and the optional inner-glow variation.

### Press composes with entrance via GSAP overwrite

By the time the click arrives (`3.83 s`), the CTA's entrance tween settled long ago (`~2.62 s`). The press tween's `scale: 0.9` overwrites cleanly to 0.9, then `scale: 1.0` overwrites back. No math composition needed — GSAP's `overwrite: "auto"` handles it.

## Inter-Phase State Handoff

```
Phase 1 → Phase 2:
  Hero entry spring settles by ~0.64 s. MORPH_AT (2.17 s) is ~1.5 s later —
  plenty of time for the breathing rotation to be visible and read as "alive."

Phase 2 → Phase 3:
  CTA entrance settles by ~2.62 s. CURSOR_ENTER_AT (2.83 s) is ~0.2 s after.
  Text reveal completes by ~2.66 s — well before the cursor arrives.

Phase 3 → Phase 4:
  Cursor path ends at CURSOR_ENTER_AT + 1.0 = 3.83 s.
  CLICK_DOWN_AT = 3.83 s — the press fires at the exact moment the cursor
  lands. This synchronization is intentional: the eye sees the cursor land
  AND the button compress as one event.

Phase 4 → end:
  Release tween ends at CLICK_UP_AT + 0.25 = 4.42 s.
  Composition continues until 5.5 s to let the recoil read clearly.
```

## Critical Constraints

- **Z-index on CTA** above the hero (`z-index: 10`) — hides exit residue during the brief overlap window.
- **Z-index on cursor** above everything (`z-index: 100`) — must visibly sit on top of the CTA during the click.
- **Same transform origin**: Hero and CTA both centered at the viewport center via flex. Different origins reveal the swap as "shrink + pop somewhere else."
- **Synchronized press**: `["#cta", "#cursor"]` as a single GSAP target array, not two separate tweens. Same ease, same duration, same start time.
- **Cursor hard-cut opacity**: `fromTo(... duration: 0.001 ...)` — a near-zero tween creates a step change. Don't fade in cursors.
- **Click timing order**: `CLICK_UP_AT > CLICK_DOWN_AT`, always. Reversed values invert the press (scale up first, then down) which reads as a misplay.
- **GSAP `set()` for initial states**: `gsap.set("#cta", { scale: 0, opacity: 0 })` and `gsap.set("#cursor", { x: …, y: …, scale: 1, opacity: 0 })` before the timeline tweens. This makes pre-phase invisibility explicit and seek-safe.
- **Text reveal after container**: CTA inner text fades in at `MORPH_AT + 0.17 s`, after the container reaches recognizable scale. Otherwise the text pops in at micro-scale during the spring's early frames.
- **Breathing rotation on logo only**: Not on the whole hero — the hero's scale is later overwritten by the morph exit. Limiting breath to the logo prevents conflicts.
- **GSAP transform aliases only**: `scale`, `x`, `y`, `rotation`. Never `width` / `height` / `left` / `top`.
- **No `Math.random` / `Date.now`**: All timing is hard-coded; the breathing onUpdate reads only `tl.time()`.
- **Single paused timeline**: All four phases on one `gsap.timeline({ paused: true })`, registered to `window.__timelines[data-composition-id]`.

## Spring → GSAP Ease Cheatsheet (this blueprint)

| Source spring                                                       | This blueprint uses                          |
| ------------------------------------------------------------------- | -------------------------------------------- |
| `spring({ stiffness: 120, damping: 14 })` — hero entrance           | `power3.out` over 0.47 s                     |
| `spring({ stiffness: 150, damping: 18 })` — hero morph exit         | `power3.out` over 0.5 s                      |
| `spring({ stiffness: 200, damping: 15, mass: 0.6 })` — CTA entrance | `back.out(2)` over 0.45 s                    |
| `spring({ stiffness: 60, damping: 20 })` — cursor path              | `power2.out` over 1.0 s                      |
| `spring({ stiffness: 300, damping: 20 })` — click down              | `power3.out` over 0.15 s                     |
| `spring({ stiffness: 200, damping: 15 })` — click up                | `power2.out` over 0.25 s                     |
| `sin(t / 30) * 4` — logo rotation breath                            | `onUpdate` with `Math.sin(t * 1.0)` (Form 2) |

See [hyperframes-animation/SKILL.md](../SKILL.md) for the full spring → ease mapping table.

## Golden Sample

- [cta-morph-press.html](../examples/cta-morph-press.html) — "GWI Spark" lockup with breathing-rotated star logo → morphs into a pink "Find out more" CTA pill → cursor enters from off-screen bottom-right → physics-based click compresses both cursor and CTA together. Single paused GSAP timeline drives all four phases over 5.5 seconds.
