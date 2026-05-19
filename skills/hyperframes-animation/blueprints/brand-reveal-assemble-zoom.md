---
id: brand-reveal-assemble-zoom
role: brand-reveal
duration_seconds: [4, 6]
phases: 5
visual_arc: wide-composition → companion-exit → tight-focus → idle
uses_rules: [discrete-text-sequence, coordinate-target-zoom, sine-wave-loop]
element_roles:
  companion: Supporting element (tagline, slogan, intro text) that provides context then exits
  hero: Focal element (logo, icon, product image) that remains and receives camera focus
when_to_use:
  - Brand / logo / product reveal needs context-then-focus flow
  - Wide-shot → close-up cinematic narrowing
  - Two elements share screen, one dominates the final frame
when_not_to_use:
  - All elements remain throughout (no exit phase)
  - Scene is purely text-based, no visual hero
  - Multiple elements need equal focus
  - Interactive elements required — see cta-morph-press
triggers: [brand reveal, zoom into logo, text leads to, wide to close-up, hero focus]
---

# Brand Reveal · Assemble & Zoom (HyperFrames)

Multiple elements share screen → supporting element exits → layout recenters on hero → camera zooms into hero → idle breathing.

This blueprint is the HyperFrames port of the Remotion `assembly-focus-reveal` choreography. Same five-phase narrative arc; single paused GSAP timeline; the coordinate-zoom and breathing patterns map directly to the corresponding HF rules.

## When to Use

- Scene builds toward a single hero element (logo, icon, product)
- Supporting text appears first to provide context, then yields focus
- Final state is a close-up of the hero with subtle ambient motion
- Need progressive narrowing from wide composition to tight focus

## Phase Pipeline

All boundaries are in **seconds**.

| Phase | Time window (s)         | What Happens                                            | Skill Reference                                              |
| ----- | ----------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| 1     | `0 – textEnd`           | Companion text assembles (discrete sequence with holds) | [discrete-text-sequence](../rules/discrete-text-sequence.md) |
| 2     | `popStart – popEnd`     | Hero element pops in with elastic spring                | inline `back.out(2)` tween                                   |
| 3     | `slideStart – slideEnd` | Companion exits, layout recenters around hero           | See "Phase 3" below                                          |
| 4     | `zoomStart – zoomEnd`   | Camera zooms into hero (scale + counter-translate)      | [coordinate-target-zoom](../rules/coordinate-target-zoom.md) |
| 5     | `idleStart – end`       | Hero breathes (sine yoyo)                               | [sine-wave-loop](../rules/sine-wave-loop.md)                 |

## Initial Layout

Two elements side-by-side in a flex row. Companion uses a fixed-width container to prevent jitter during text assembly (Phase 1) — the container width must be ≥ the maximum rendered text width. If the text overflows, `justify-content: flex-end` pushes the overflow off the _left_ edge of the container, past the viewport edge.

Hero text uses a heavier `font-weight` than the companion text — the brand name is the focal element and must read as dominant even before the companion exits.

```html
<div class="zoom-scale">
  <!-- outermost: Phase 4 scale -->
  <div class="zoom-translate">
    <!-- middle: Phase 4 counter-translation -->
    <div class="recenter-shift">
      <!-- inner: Phase 3 recenter offset -->
      <div class="layout-row">
        <div class="companion">
          <!-- fixed width, right-aligned text -->
          <span class="companion-text">J</span>
        </div>
        <div class="brand-group">
          <span class="brand-text">GWISpark</span>
          <div class="hero">
            <!-- the icon/logo — Phase 2 pop target -->
            <img src="./assets/logo.png" />
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

```css
.layout-row {
  display: flex;
  align-items: center;
}
.companion {
  width: 600px; /* MUST be ≥ max rendered text width */
  display: flex;
  justify-content: flex-end;
  margin-right: 30px;
  font-weight: 400;
  white-space: nowrap;
}
.brand-group {
  display: flex;
  align-items: center;
  gap: 20px;
}
.brand-text {
  font-weight: 700;
}
.hero {
  display: flex;
  align-items: center;
  justify-content: center;
  transform: scale(0);
}
```

Validate at design time: `companionWidth + gap + brandTextWidth + heroGap + heroSize < viewportWidth`. Overflow doesn't error — it just clips, often invisibly until the zoom phase makes it obvious.

## Phase 1: Companion Text Assembly

Use [discrete-text-sequence](../rules/discrete-text-sequence.md) for non-linear text typing with intentional holds. Keep the companion in a fixed-width right-aligned container so the layout doesn't shift as characters arrive.

```js
const SEQUENCE = [
  { t: 0.0, text: "J" },
  { t: 0.07, text: "Jus" },
  { t: 0.13, text: "Just" },
  { t: 0.27, text: "Just" }, // hold ~0.13s for pacing
  { t: 0.4, text: "Just a" },
  { t: 0.53, text: "Just as" },
  { t: 0.67, text: "Just ask" },
];

const textEl = document.querySelector(".companion-text");
function pickDiscrete(now) {
  let chosen = SEQUENCE[0].text;
  for (const e of SEQUENCE) {
    if (e.t <= now) chosen = e.text;
    else break;
  }
  return chosen;
}

tl.to(
  { tick: 0 },
  {
    tick: 1,
    duration: SEQUENCE[SEQUENCE.length - 1].t,
    ease: "none",
    onUpdate: () => {
      const next = pickDiscrete(tl.time());
      if (textEl.textContent !== next) textEl.textContent = next;
    },
  },
  0,
);
```

## Phase 2: Hero Pop-In

Elastic spring. Scale from 0 → 1 with a perceptible overshoot. The Remotion `spring({ stiffness: 200, damping: 12 })` maps to GSAP `back.out(2)` or `elastic.out(1, 0.45)`.

```js
const POP_START = 0.73; // ≈22 frames @ 30fps — after companion's main word lands

tl.fromTo(".hero", { scale: 0 }, { scale: 1, duration: 0.5, ease: "back.out(2)" }, POP_START);
```

`back.out(2)` overshoots ~10% past 1.0 then settles — close to the Remotion spring with stiffness 200, damping 12. For a softer landing use `back.out(1.6)`; for more pronounced bounce use `elastic.out(1, 0.4)`.

## Phase 3: Companion Exit & Recenter (Core Glue)

Three concurrent tweens at the same timeline position. The Remotion source used a single spring read three times; the GSAP idiom is three tweens started at the same position parameter.

```js
const SLIDE_START = 1.5; // seconds
const SLIDE_DUR = 0.7;
const FINAL_RECENTER_OFFSET = -180; // PRE-CALCULATED constant

// (1) Companion slides out + fades.
tl.to(
  ".companion",
  {
    opacity: 0,
    x: -80,
    duration: SLIDE_DUR,
    ease: "power3.out", // spring(stiffness:100, damping:20)
  },
  SLIDE_START,
);

// (2) Container shifts to recenter the hero group.
tl.to(
  ".recenter-shift",
  {
    x: FINAL_RECENTER_OFFSET,
    duration: SLIDE_DUR,
    ease: "power3.out",
  },
  SLIDE_START,
);
```

### Recenter Offset Calculation

When the companion disappears, the brand group must land in the viewport center. The shift compensates for the (companion + gap) space the brand group occupied to the right of center:

```
FINAL_RECENTER_OFFSET ≈ -(companionWidth + gap) / 2
                      = -(600 + 30) / 2 = -315       (theoretical)
                      ≈ -180                          (tuned for visual feel)
```

The tuned value often differs from the theoretical — small visual adjustments matter. Tune by eye, then **bake as a constant**. Do NOT compute dynamically per frame — sub-pixel drift accumulates across the zoom phase (which can be 5×+ magnification) and becomes a visible jitter.

## Phase 4: Camera Zoom Into Hero

Three transforms nested outside → inside:

1. **Outer (`.zoom-scale`)**: handles `scale` for the zoom magnification
2. **Middle (`.zoom-translate`)**: handles `x` / `y` counter-translation so the off-center hero ends at screen center
3. **Inner (`.recenter-shift`)**: already set by Phase 3, stays put during zoom

See [coordinate-target-zoom](../rules/coordinate-target-zoom.md) for the full pattern. Scale **must** wrap translation, never the reverse.

```js
const ZOOM_START = 2.67;
const ZOOM_DUR = 0.9;
const TARGET_SCALE = 5.5;

// Hero's offset from viewport center AFTER Phase 3 recenter. PRE-CALCULATED.
// = baseHeroOffset + FINAL_RECENTER_OFFSET
// baseHeroOffset = (companionWidth + gap + brandTextWidth + heroGap) / 2
//                = (600 + 30 + 720 + 20) / 2 = 685
//                                       ^^^ measured from real font at design time
// HERO_FINAL_OFFSET_X = 685 + (-180) = 505
const HERO_FINAL_OFFSET_X = 505;
const HERO_FINAL_OFFSET_Y = 0;

// Outer scale
tl.to(
  ".zoom-scale",
  {
    scale: TARGET_SCALE,
    duration: ZOOM_DUR,
    ease: "power2.out", // spring(stiffness:80, damping:20, mass:1.5)
  },
  ZOOM_START,
);

// Middle counter-translation — pulls hero from its offset position to center
tl.to(
  ".zoom-translate",
  {
    x: -HERO_FINAL_OFFSET_X,
    y: -HERO_FINAL_OFFSET_Y,
    duration: ZOOM_DUR,
    ease: "power2.out",
  },
  ZOOM_START,
);

// Brand text exits during the zoom — we don't want it filling the entire frame.
tl.to(
  ".brand-text",
  {
    opacity: 0,
    x: -600,
    duration: ZOOM_DUR * 0.4, // fades early in the zoom
    ease: "power2.out",
  },
  ZOOM_START,
);
```

### Why `baseHeroOffset` doesn't include `heroSize`

```
Total flex width  T = C + G + B + L + S
Icon center         = C + G + B + L + S/2
Layout center       = T / 2

Offset = (C + G + B + L + S/2) − T/2
       = C/2 + G/2 + B/2 + L/2
       = (C + G + B + L) / 2
```

Where C = companionWidth, G = gap, B = brandTextWidth, L = heroGap, S = heroSize. `S` cancels. Including `S` causes the counter-translation to overshoot, landing the icon left of center.

### Measuring `brandTextWidth`

After `document.fonts.ready`, measure the brand text with a hidden DOM probe:

```js
await document.fonts.ready;
const probe = document.createElement("span");
probe.style.cssText =
  "position:absolute; left:-99999px; white-space:pre; " +
  "font:700 140px Inter, system-ui, sans-serif;";
probe.textContent = "GWISpark";
document.body.appendChild(probe);
const brandTextWidth = probe.getBoundingClientRect().width;
probe.remove();
```

Then derive `HERO_FINAL_OFFSET_X` from `brandTextWidth`. Bake it as `const` before the timeline tweens are scheduled — never inside an `onUpdate`.

## Phase 5: Breathing Idle

Use Form 2 (onUpdate) from [sine-wave-loop](../rules/sine-wave-loop.md) so the breath **multiplies** onto the hero's pop-in scale. Form 1 (`fromTo` yoyo) would overwrite the pop scale, undoing it.

```js
const BREATH_START = 3.67; // ≈110 frames @ 30fps — after zoom settles
const HERO_FINAL_SCALE = 1.0; // scale the hero landed at after Phase 2 pop
const SCALE_PERIOD = 1.5; // seconds per full cycle
const SCALE_AMP = 0.04;
const ROTATE_AMP = 2;

const heroEl = document.querySelector(".hero");
const breathDur = 5.0 - BREATH_START; // = 1.33s

tl.to(
  { tick: 0 },
  {
    tick: 1,
    duration: breathDur,
    ease: "none",
    onUpdate: function () {
      const idleTime = Math.max(0, tl.time() - BREATH_START);
      const omega = (idleTime / SCALE_PERIOD) * Math.PI * 2;
      gsap.set(heroEl, {
        scale: HERO_FINAL_SCALE * (1 + Math.sin(omega) * SCALE_AMP),
        rotation: Math.sin(omega) * ROTATE_AMP,
      });
    },
  },
  BREATH_START,
);
```

## Inter-Phase State Handoff

```
Phase 1 → Phase 2:
  Companion's main word ("Just ask") lands at t ≈ 0.67s.
  POP_START ≥ 0.73 leaves a small breath before the hero appears.

Phase 2 → Phase 3:
  Hero pop ends around POP_START + 0.5 = 1.23s.
  SLIDE_START ≥ POP_START + 0.7 = 1.43s (small buffer for the spring to settle).

Phase 3 → Phase 4:
  FINAL_RECENTER_OFFSET (constant) feeds HERO_FINAL_OFFSET_X.
  Both are pre-calculated constants — this is the critical handoff.
  ZOOM_START ≥ SLIDE_START + SLIDE_DUR + 0.3 = 2.50s.

Phase 4 → Phase 5:
  Zoom ends around ZOOM_START + 0.9 = 3.57s.
  BREATH_START ≥ ZOOM_END + 0.1 = 3.67s — gate the breath behind the zoom settle.
```

## Critical Constraints

- **Pre-calculated offset constants**: `FINAL_RECENTER_OFFSET`, `HERO_FINAL_OFFSET_X`, `HERO_FINAL_OFFSET_Y` are constants. Computing them per frame causes sub-pixel drift that becomes a visible jitter when multiplied by the 5×+ zoom scale.
- **Scale wraps translation**: `.zoom-scale` (outer) handles `scale`; `.zoom-translate` (inner) handles `x` / `y`. Reversed nesting causes accelerated movement (translations scale with the outer scale).
- **Companion width ≥ max text width**: The fixed-width container must hold the fully-assembled companion text. Overflow is invisible during assembly but spills past the viewport edge.
- **`baseHeroOffset = (C + G + B + L) / 2`**: `heroSize` cancels out — including it makes the icon land left of center.
- **Breathing form**: Use Form 2 (onUpdate, multiplicative) so the breath layers on top of the hero's existing scale. Form 1 (`fromTo` yoyo) overwrites the pop scale.
- **Breathing activation gate**: `BREATH_START ≥ zoom end + 0.1s`. Activating too early makes the breath fight the zoom spring's tail.
- **Measure text after `document.fonts.ready`**: Otherwise `getBoundingClientRect()` uses fallback font metrics and the hero offset is off by ~10–30 px.
- **GSAP transform aliases only**: `x`, `y`, `scale`, `rotation` on the three nested wrappers. Never tween `width` / `height` / `left` / `top`.
- **Single paused timeline**: All five phases live on one `gsap.timeline({ paused: true })`, registered to `window.__timelines[data-composition-id]`.

## Spring → GSAP Ease Cheatsheet (this blueprint)

| Source spring                                                         | This blueprint uses                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------- |
| `spring({ damping: 12, stiffness: 200 })` — elastic pop               | `back.out(2)` (overshoot ~10%) or `elastic.out(1, 0.45)` |
| `spring({ damping: 20, stiffness: 100 })` — companion exit + recenter | `power3.out`                                             |
| `spring({ damping: 20, stiffness: 80, mass: 1.5 })` — cinematic zoom  | `power2.out` (slower settle)                             |
| `Math.sin(t / period)` continuous breath                              | `sine.inOut` in a finite-yoyo, or onUpdate Math.sin      |

See [hyperframes-animation/SKILL.md](../SKILL.md) for the full spring → ease mapping table.

## Golden Sample

- [brand-reveal-assemble-zoom.html](../examples/brand-reveal-assemble-zoom.html) — "Just ask" assembles beside "GWISpark" + Logo → companion exits → camera zooms 5.5× into logo → logo breathes. Single paused GSAP timeline drives all five phases.
