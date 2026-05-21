---
name: svg-icon-enrichment
description: Animate internal SVG elements (rotating hands, opening blades, pulsing dots, dash flows) to make icons feel alive without replacing them.
metadata:
  tags: svg, icon, animation, internal, micro-animation, pulse, rotation
---

# SVG Icon Enrichment

Treats an SVG icon as a composition of animated PARTS, not an opaque image. Each meaningful internal element (a clock hand, scissor blade, recording dot, data line) gets its own GSAP-driven micro-animation. Distinct from [svg-path-draw](svg-path-draw.md) (which animates the OUTLINE drawing) — enrichment animates INTERNAL PARTS, ideally after the outline has drawn.

## How It Works

The SVG is authored with named `<line>`, `<circle>`, `<path>`, or `<g>` children. The GSAP timeline targets these by selector and applies one of 4 signature motion patterns:

1. **Rotation** — clock hand, gear, loading spinner (`transform: rotate(deg)`)
2. **Oscillation** — scissor blades, wing flap, toggle (`transform: rotate(±sin*amp)` on opposing groups)
3. **Pulse** — recording dot, heart, notification (`scale + opacity` via sin)
4. **Dash flow** — moving dashes along a stroke, like a data stream (`strokeDashoffset` linear)

All run inside the paused GSAP timeline so HF seeks deterministically.

## HTML

```html
<div
  class="scene"
  data-composition-id="enrichment-scene"
  data-start="0"
  data-duration="4"
  data-track-index="0"
>
  <div class="stack">
    <div class="row">
      <!-- Clock icon — minute hand rotates -->
      <svg class="icon-svg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
        <circle cx="60" cy="60" r="50" fill="none" stroke="{accentColor}" stroke-width="6" />
        <line
          class="clock-hand"
          id="hand-min"
          x1="60"
          y1="60"
          x2="60"
          y2="22"
          stroke="{textColor}"
          stroke-width="6"
          stroke-linecap="round"
        />
        <line
          class="clock-hand"
          id="hand-sec"
          x1="60"
          y1="60"
          x2="60"
          y2="30"
          stroke="{recordColor}"
          stroke-width="3"
          stroke-linecap="round"
        />
        <circle cx="60" cy="60" r="6" fill="{textColor}" />
      </svg>

      <!-- Recording dot — pulses -->
      <svg class="icon-svg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
        <circle
          id="rec-ring"
          cx="60"
          cy="60"
          r="50"
          fill="none"
          stroke="{recordColor}"
          stroke-width="4"
        />
        <circle id="rec-dot" cx="60" cy="60" r="22" fill="{recordColor}" />
      </svg>

      <!-- Data stream — dashes flow along the line -->
      <svg class="icon-svg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
        <rect
          x="14"
          y="48"
          width="92"
          height="24"
          rx="12"
          fill="none"
          stroke="{accentColor}"
          stroke-width="4"
        />
        <line
          id="data-flow"
          x1="14"
          y1="60"
          x2="106"
          y2="60"
          stroke="{accentColor}"
          stroke-width="6"
          stroke-linecap="round"
          stroke-dasharray="14 12"
        />
      </svg>
    </div>
    <div class="brand">{brandPhrase}</div>
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
  background: {bgColor};
  font-family: {font};
}
.stack {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 80px;
}
.row {
  display: flex;
  gap: 120px;
}
.icon-svg {
  width: 320px;
  height: 320px;
  filter: drop-shadow(0 12px 32px {shadowColor});
}
.clock-hand {
  /* transform-origin in SVG must be in viewBox units, not pixels */
  transform-origin: 60px 60px;
  transform-box: fill-box;
}
.brand {
  font-size: 64px;
  font-weight: 900;
  letter-spacing: 14px;
  text-transform: uppercase;
  color: {textColor};
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Pattern 1 — Rotation (clock hands)
  // Minute hand: MIN_REVOLUTIONS full rotations over TOTAL_DURATION
  const minState = { deg: 0 };
  tl.to(
    minState,
    {
      deg: 360 * MIN_REVOLUTIONS,
      duration: TOTAL_DURATION,
      ease: "none",
      onUpdate: () => {
        document.getElementById("hand-min").style.transform = `rotate(${minState.deg}deg)`;
      },
    },
    0,
  );

  // Second hand: SEC_REVOLUTIONS full rotations over TOTAL_DURATION (faster)
  const secState = { deg: 0 };
  tl.to(
    secState,
    {
      deg: 360 * SEC_REVOLUTIONS,
      duration: TOTAL_DURATION,
      ease: "none",
      onUpdate: () => {
        document.getElementById("hand-sec").style.transform = `rotate(${secState.deg}deg)`;
      },
    },
    0,
  );

  // Pattern 2 — Pulse (recording dot, ring opacity inverse)
  const pulseState = { p: 0 };
  tl.to(
    pulseState,
    {
      p: Math.PI * 2 * PULSE_CYCLES,
      duration: TOTAL_DURATION,
      ease: "none",
      onUpdate: () => {
        const dotScale = 1 + Math.sin(pulseState.p) * PULSE_DOT_AMP;
        const ringScale = 1 + Math.sin(pulseState.p + Math.PI / 2) * PULSE_RING_AMP;
        const ringOpacity =
          PULSE_RING_OPACITY_BASE + Math.sin(pulseState.p) * PULSE_RING_OPACITY_AMP;
        const dot = document.getElementById("rec-dot");
        const ring = document.getElementById("rec-ring");
        dot.style.transform = `scale(${dotScale})`;
        dot.style.transformOrigin = "60px 60px";
        ring.style.transform = `scale(${ringScale})`;
        ring.style.transformOrigin = "60px 60px";
        ring.style.opacity = String(ringOpacity);
      },
    },
    0,
  );

  // Pattern 3 — Dash flow (data stream)
  const flowState = { offset: 0 };
  tl.to(
    flowState,
    {
      offset: DASH_FLOW_TOTAL_OFFSET, // negative for L→R flow, positive for R→L
      duration: TOTAL_DURATION,
      ease: "none",
      onUpdate: () => {
        document.getElementById("data-flow").style.strokeDashoffset = String(flowState.offset);
      },
    },
    0,
  );

  // Brand fades in early
  tl.from(".brand", { opacity: 0, y: 16, duration: 0.6, ease: "power3.out" }, BRAND_AT);

  window.__timelines["enrichment-scene"] = tl;
</script>
```

## How to Choose Values

- **MIN_REVOLUTIONS** — minute-hand revolutions across TOTAL_DURATION
  - Range: 0.5–2.0 (continuous; faster reads as time-lapse)
  - Constraints: avoid integer revolutions if visible end frame matters (lands back at start)

- **SEC_REVOLUTIONS** — second-hand revolutions across TOTAL_DURATION
  - Range: 4–10 (should be visibly faster than the minute hand)
  - Constraints: SEC_REVOLUTIONS > MIN_REVOLUTIONS × 3 for the speed difference to read

- **PULSE_CYCLES** — number of pulse cycles across TOTAL_DURATION
  - Range: 2–4 over a 3–5 s comp
  - Effects: ≥ 5 reads as anxious flicker; ≤ 1 reads as forgotten

- **PULSE_DOT_AMP** — dot scale amplitude
  - Range: 0.05–0.20
  - Effects: 0.05 = breathing; 0.20 = throbbing

- **PULSE_RING_AMP** — ring scale amplitude (typically lower than DOT_AMP)
  - Range: 0.04–0.12
  - Constraints: must be < PULSE_DOT_AMP or ring overshadows dot

- **PULSE_RING_OPACITY_BASE / PULSE_RING_OPACITY_AMP** — ring opacity baseline + sine amplitude
  - Range: BASE 0.4–0.6; AMP 0.3–0.5
  - Constraints: BASE − AMP ≥ 0 and BASE + AMP ≤ 1

- **DASH_FLOW_TOTAL_OFFSET** — total stroke-dashoffset change across TOTAL_DURATION
  - Range: −400 to −100 (negative for L→R) or +100 to +400 (R→L)
  - Effects: |large| = fast flow; |small| = slow drift
  - Constraints: must be an integer multiple of the dash period (dash + gap) or the loop end frame shows a phase jump

- **BRAND_AT** — when the brand phrase fades in
  - Range: 0.3–1.0 s
  - Effects: too early competes with icon entries; too late feels appended

- **Ease family choices**: rotation = `none` (linear motion is the point); pulse driver = `none` (sine handles the curve); reveal of brand = `power3.out`

## Signature Motion Patterns

| Pattern     | Use For                            | Math                                             | Tip                                 |
| ----------- | ---------------------------------- | ------------------------------------------------ | ----------------------------------- |
| Rotation    | Clock, gear, loader, dial          | `transform: rotate(deg)`, linear via sec-counter | `transform-origin` in viewBox units |
| Oscillation | Scissors, wings, toggle            | `rotate(±sin*amp)` on opposing groups            | Opposite signs on the two parts     |
| Pulse       | Recording dot, heart, notification | `scale(1 + sin*amp)` + opacity                   | Ring lags dot by π/2 for ripple     |
| Dash flow   | Cutting line, data stream          | `strokeDashoffset` linear via time               | Negative for L→R, positive for R→L  |

## Variations

### Stroke draw → enrichment chain

Draw the icon outline first (via [svg-path-draw](svg-path-draw.md)), THEN activate enrichment. The internal animation feels like "the icon woke up" after assembly.

```js
// Phase 1: outline draws (0 → OUTLINE_DUR)
tl.fromTo(
  "#icon-outline",
  { strokeDashoffset: 360 },
  { strokeDashoffset: 0, duration: OUTLINE_DUR, ease: "power2.inOut" },
  0,
);
// Phase 2: enrichment starts at OUTLINE_DUR
```

### Per-icon entry stagger

For a row of icons all animating, stagger their entries. Each icon's enrichment starts as it fades in, not synchronized — feels organic.

## Key Principles

- **❗ For rotation around an explicit point inside SVG, use the SVG `transform` attribute, NOT CSS transform** — `el.setAttribute('transform', `rotate(${deg} ${cx} ${cy})`)`. The CSS combination `transform: rotate(...)` + `transform-origin: 60px 60px` + `transform-box: fill-box` interprets the origin in the element's OWN bbox-local coordinates, NOT in viewBox coordinates. For a thin `<line>` (whose bbox is the line's narrow envelope), `60 60` in bbox-local refers to a point OUTSIDE the line, so the hand flies along an off-center arc instead of rotating in place. Same trap for small inner shapes (rec-dot circle whose bbox is the small circle, not the full viewBox).
- **For scaling around a center point inside SVG**, use `el.setAttribute('transform', `translate(${cx} ${cy}) scale(${s}) translate(-${cx} -${cy})`)`. Same reason — avoids the CSS bbox-local origin trap.
- **Run continuous animations inside the timeline** — never CSS `@keyframes` or `requestAnimationFrame`. Both desync from HF's frame-by-frame seek.
- **Amplitudes subtle** — icons are decorative, not headlines. Pulse scale within the ranges above; rotation speeds calibrated against composition length, not absolute time.
- **Multiple parts of the same icon at different phases** — clock minute vs second hand at different speeds, ring vs dot pulse offset by π/2. Pure-sync looks mechanical; phase-offset looks alive.
- **❗ Climax dwell ≥ 1 s** — if the enrichment is the headline beat, the composition must continue ≥ 1 s after the most dramatic moment.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS `animation`** on SVG children — must be timeline-driven
- **`transform-origin` matters per child** — set explicitly per animated element
- **`stroke-linecap: round`** on flowing/dashed lines for clean dash edges
- **Target SVG children by id** — `document.getElementById` is fine; selector chains into `<svg>` work the same as HTML

## Combinations

- [svg-path-draw.md](svg-path-draw.md) — outline draws first, enrichment activates second
- [orbit-3d-entry.md](orbit-3d-entry.md) — orbiting items are enriched icons (clock orbits a brand label)
- [sine-wave-loop.md](sine-wave-loop.md) — entire icon floats while internal parts animate

## Pairs with HF skills

- `/hyperframes-animation` — onUpdate writes transform/opacity per SVG child
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
