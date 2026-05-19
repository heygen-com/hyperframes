---
id: takeover-ticker-displace
role: takeover
duration_seconds: [5, 8]
phases: 4
visual_arc: text-assembly → ticker-cycle → hero-displacement → idle
uses_rules: [vertical-spring-ticker, reactive-displacement, sine-wave-loop]
element_roles:
  text_group: Combined typewriter + ticker that builds textual context, then gets displaced as a unit
  hero: Visual element (logo, icon, product) that enters from off-screen and takes over by pushing text away
when_to_use:
  - Text cycles through multiple options before a hero takes over
  - Hero feels like it has physical "weight" — it pushes content aside
  - Transition from text to visual should be a physical collision, not a fade
when_not_to_use:
  - Text and hero coexist throughout — see brand-reveal-assemble-zoom
  - Camera zoom required (this uses entry translation)
  - Multiple hero elements enter simultaneously
  - Text should exit voluntarily (fade / slide)
triggers:
  [rolling text then logo, push text away, slot machine, text cycles, logo enters forcefully]
---

# Takeover · Ticker Displace (HyperFrames)

Text builds context (typewriter + ticker) → hero enters from off-screen → hero physically pushes text out → hero settles into breathing.

This blueprint is the HyperFrames port of the Remotion `content-displace-reveal` choreography. Same four-phase arc; one paused GSAP timeline; the displacement maps to [reactive-displacement](../rules/reactive-displacement.md) and the breathing uses the multiplicative form of [sine-wave-loop](../rules/sine-wave-loop.md) (because the hero lands at a non-1 scale).

## When to Use

- Scene has a text-building phase with cycling/rolling words
- A visual hero element should dramatically replace the text
- The transition should feel physical (collision/push), not smooth (fade/zoom)
- Final state is the hero element alone with subtle idle motion

## Phase Pipeline

All boundaries are in **seconds**.

| Phase | Time window (s)                 | What Happens                                       | Skill Reference                                                      |
| ----- | ------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------- |
| 1     | `0 – typeEnd`                   | Static text reveals via typewriter (smooth slice)  | Simple typewriter — continuous `Math.floor(progress)` slice          |
| 2     | `ticker1 – ticker2 – tickerEnd` | Accent word cycles via vertical ticker             | [vertical-spring-ticker](../rules/vertical-spring-ticker.md)         |
| 3     | `displaceStart – displaceEnd`   | Hero enters off-screen, physically pushes text out | [reactive-displacement](../rules/reactive-displacement.md)           |
| 4     | `idleStart – end`               | Hero breathes                                      | [sine-wave-loop](../rules/sine-wave-loop.md) Form 2 (multiplicative) |

## Layout Strategy

Unlike shared-flex layouts (see [brand-reveal-assemble-zoom](brand-reveal-assemble-zoom.md)), this pattern uses **absolute stacking** — text group and hero occupy the same centered space; `z-index` controls layering during the overlap window.

```html
<div
  class="stage"
  style="position: absolute; inset: 0;
     display: flex; align-items: center; justify-content: center;
     overflow: hidden;"
>
  <!-- Text group: typewriter + ticker, displaced as a single unit -->
  <div
    class="text-group"
    style="position: absolute; display: flex;
       flex-direction: row; align-items: center; gap: 20px;"
  >
    <div class="typewriter">
      <span class="typewriter-text"></span>
    </div>
    <div class="ticker-window">
      <div class="ticker-stack">
        <div class="ticker-item">audience</div>
        <div class="ticker-item">topic</div>
        <div class="ticker-item">market</div>
      </div>
    </div>
  </div>

  <!-- Hero: enters off-screen, ends up centered. z-index above text during overlap. -->
  <div
    class="hero"
    style="position: absolute; z-index: 20;
       width: 400px; height: 400px;
       display: flex; align-items: center; justify-content: center;"
  >
    <!-- logo / icon -->
  </div>
</div>
```

The text group is a flex row containing typewriter (static) and ticker (rolling) side by side. They animate together as a unit during Phase 3 — both inherit the `text-group` parent's transform.

## Phase 1: Typewriter Text Reveal

Continuous per-character typing using the **smooth slice** variation from [discrete-text-sequence](../rules/discrete-text-sequence.md). The displayed text is a _function_ of progress, not a lookup table.

```js
const FULL_TEXT = "Ask about any";
const TYPE_START_LEN = 3; // start showing 3 chars so the line doesn't pop in empty
const TYPE_DUR = 0.67; // ≈20 frames at 30fps

const textEl = document.querySelector(".typewriter-text");
const typeProxy = { progress: TYPE_START_LEN };

tl.to(
  typeProxy,
  {
    progress: FULL_TEXT.length,
    duration: TYPE_DUR,
    ease: "none",
    onUpdate: () => {
      const len = Math.floor(typeProxy.progress);
      const next = FULL_TEXT.slice(0, len);
      if (textEl.textContent !== next) textEl.textContent = next;
    },
  },
  0,
);
```

## Phase 2: Vertical Ticker

Slot-machine scrolling with one tween per transition. For N items (e.g. 3 words: audience → topic → market), use N-1 tweens that each translate the stack up by one `itemHeight`.

Each `tl.to(.ticker-stack, { y: "-=ITEM_HEIGHT", ease: "back.out(1.4)" })` is a single step in the ticker. See [vertical-spring-ticker](../rules/vertical-spring-ticker.md) for the full pattern.

```js
const ITEM_HEIGHT = 168; // px — fontSize × 1.2, e.g. 140 × 1.2 = 168
const TICKER1_AT = 1.67;
const TICKER2_AT = 3.33;
const STEP_DUR = 0.55;

tl.to(
  ".ticker-stack",
  {
    y: `-=${ITEM_HEIGHT}`,
    duration: STEP_DUR,
    ease: "back.out(1.4)", // spring(stiffness:120, damping:14)
  },
  TICKER1_AT,
);

tl.to(
  ".ticker-stack",
  {
    y: `-=${ITEM_HEIGHT}`,
    duration: STEP_DUR,
    ease: "back.out(1.4)",
  },
  TICKER2_AT,
);
```

Accent words use a distinct `font-weight` (700) and `color` (e.g. accent pink) to visually separate from the typewriter text.

## Phase 3: Reactive Displacement (Core Glue)

Three concurrent tweens at the same timeline position, with carefully-tuned durations. The Remotion source achieved the causal link via a single `spring()` read three times; in GSAP we achieve it with three tweens that **start at the same position** and **end at fractional multiples of the intruder's duration**.

```js
const DISPLACE_AT = 4.6;
const HERO_DUR = 0.85; // matches the heavy spring (mass:1.5) settle
const PUSH_DIST = -150; // text moves THIS direction (negative = left)
const OFFSCREEN_X = 800; // hero starts here

// (1) Hero enters with rotation + scale impact. Lands at scale 1.3 (overshoot).
tl.fromTo(
  ".hero",
  { x: OFFSCREEN_X, scale: 0.5, rotation: -45, opacity: 0 },
  {
    x: 0,
    scale: 1.3,
    rotation: 0,
    opacity: 1,
    duration: HERO_DUR,
    ease: "power2.out", // spring(stiffness:100, damping:20, mass:1.5)
  },
  DISPLACE_AT,
);

// (2) Text group pushed left. Completes at 50% of hero duration.
tl.to(".text-group", { x: PUSH_DIST, duration: HERO_DUR * 0.5, ease: "power2.out" }, DISPLACE_AT);

// (3) Text group fades. Completes at 40% — slightly before the push lands.
tl.to(".text-group", { opacity: 0, duration: HERO_DUR * 0.4, ease: "power2.out" }, DISPLACE_AT);
```

### Why `mass: 1.5` matters in the source

Higher mass in the Remotion spring adds inertia — the hero feels heavy and "lands" rather than zips in. In GSAP this is recreated by using a **longer duration** (`0.85s` vs `0.5s`) with a gentle ease (`power2.out`). The numerical config differs but the perceptual result is identical.

### Why the victim completes at 40–50% of the driver

The eye reads collision as "instant impact, then push residue." If both the hero and text moved over the same duration, the push would feel like a parallel motion — not a consequence of the collision. Shortening the text's timeline to 40–50% makes the push feel like a _reaction_, not a coincidence.

### Directional Logic

Hero enters from positive X → text is displaced in negative X direction (momentum transfer). Reversing this breaks the physical metaphor. For a hero entering from the top, push the text down.

## Phase 4: Breathing

The hero lands at a non-1 scale (`scale: 1.3` from the impact overshoot). The breath must **multiply** onto that final scale; it cannot just yoyo around 1 or it will fight the impact landing.

Use **dual frequencies** on scale and rotation so the breath feels organic, not mechanical. See [sine-wave-loop](../rules/sine-wave-loop.md) Form 2.

```js
const IDLE_START = DISPLACE_AT + 2.0; // = 6.6 — well after hero settles
const TOTAL = 7.5; // matches data-duration
const HERO_FINAL_SCALE = 1.3;
const HERO_FINAL_ROTATION = 0;
const SCALE_PERIOD = 1.0; // seconds per scale cycle (30 frames @ 30fps)
const ROTATE_PERIOD = 1.33; // seconds per rotation cycle (40 frames @ 30fps)
const SCALE_AMP = 0.05;
const ROTATE_AMP = 3;

const heroEl = document.querySelector(".hero");

tl.to(
  { tick: 0 },
  {
    tick: 1,
    duration: TOTAL - IDLE_START,
    ease: "none",
    onUpdate: function () {
      const idleTime = Math.max(0, tl.time() - IDLE_START);
      const omegaS = (idleTime / SCALE_PERIOD) * Math.PI * 2;
      const omegaR = (idleTime / ROTATE_PERIOD) * Math.PI * 2;
      gsap.set(heroEl, {
        scale: HERO_FINAL_SCALE * (1 + Math.sin(omegaS) * SCALE_AMP),
        rotation: HERO_FINAL_ROTATION + Math.sin(omegaR) * ROTATE_AMP,
      });
    },
  },
  IDLE_START,
);
```

**Why two periods?** Synchronized scale + rotation reads as a single "tilt-pulse" beat and feels mechanical. Different periods (1.0s vs 1.33s — not a simple ratio) keep the scale and rotation cycles interfering rather than locking, producing organic motion.

## Inter-Phase State Handoff

```
Phase 1 → Phase 2:
  Typewriter completes at typeEnd.
  TICKER1_AT ≥ typeEnd + ~1.0s (gives the eye time to read the static text).

Phase 2 → Phase 3:
  Last ticker step ends at ticker2 + STEP_DUR.
  DISPLACE_AT ≥ ticker2_end + ~0.8s (lets the final ticker word settle and read).

Phase 3 → Phase 4:
  Hero entry ends at DISPLACE_AT + HERO_DUR.
  IDLE_START ≥ entry_end + ~1.1s (spring tail dissipates; ~33 frames at 30fps).
  Breathing onUpdate is gated by IDLE_START — it doesn't start before then because
  the dummy tick tween itself is scheduled at IDLE_START.
```

## Critical Constraints

- **Three concurrent tweens, same timeline position**: This is the causal link. Drift the start times and the displacement feels like two separate animations playing in parallel, not collision-and-reaction.
- **Victim duration < driver duration**: Push completes at 40–50% × driver duration. Anything ≥ 70% loses the "impact" feel.
- **Z-index layering**: Hero `z-index: 20`, text-group no z-index (defaults to 0). Without this, the text's fading edges peek through the hero.
- **Hero lands at non-1 scale**: The impact overshoots to scale 1.3. The breathing must **multiply** onto this; using Form 1 (`fromTo` yoyo with `scale: 1`) would overwrite the 1.3 and undo the impact.
- **Ticker height triangle**: Container height, item height, and translateY all use the same pixel value (e.g. 168 px). Mismatch = items half-visible at rest.
- **Directional consistency**: Hero entry direction and text push direction must transfer momentum (positive X intrusion → negative X push, or vice versa).
- **Dual breathing periods**: Use unequal periods (1.0s, 1.33s) for scale vs rotation. Equal or simple-ratio periods sync up and look mechanical.
- **Single paused timeline**: All four phases on one `gsap.timeline({ paused: true })`, registered to `window.__timelines[data-composition-id]`.
- **GSAP transform aliases only**: `x`, `y`, `scale`, `rotation`. Never `left`/`top`/`width`/`height`.

## Spring → GSAP Ease Cheatsheet (this blueprint)

| Source spring                                                                  | This blueprint uses                            |
| ------------------------------------------------------------------------------ | ---------------------------------------------- |
| `spring({ stiffness: 120, damping: 14 })` — ticker step                        | `back.out(1.4)`                                |
| `spring({ stiffness: 100, damping: 20, mass: 1.5 })` — heavy hero impact       | `power2.out` over **longer** duration (~0.85s) |
| `Math.sin(t / period)` continuous breath, scale and rotation different periods | Two `Math.sin()` calls in one `onUpdate`       |

See [hyperframes-animation/SKILL.md](../SKILL.md) for the full spring → ease mapping table.

## Golden Sample

- [takeover-ticker-displace.html](../examples/takeover-ticker-displace.html) — "Ask about any" typewriter + "audience/topic/market" ticker → logo enters from off-screen right with rotation + scale impact → text pushed left and fades → logo breathes with dual-frequency sine. Single paused GSAP timeline drives all four phases.
