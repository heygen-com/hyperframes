---
name: press-release-spring
description: Tactile button press with linear compression, spring-based elastic recovery, and layered visual feedback (shadow shrink + release burst + background glow).
metadata:
  tags: spring, press, interaction, button, physics, glow, burst, ui
---

# Press-Release Spring Chain

Separates input (linear compression) from output (spring recovery) to create tactile feel. The overshoot is a natural byproduct of the spring config, not manually coded. Pairs with secondary motion (shadow shrink, release burst, background glow) layered on the same trigger frame.

## How It Works

Two distinct phases split at the **release** moment:

1. **Press**: linear ease → compression (`scale: 1 → PRESS_SCALE`, shadow shrinks). Linear, not spring — the dip must read as instant/tactile, not squishy.
2. **Release**: `back.out(${BOUNCE_FACTOR})` spring → elastic pop back to `1.0` (overshoot proportional to `BOUNCE_FACTOR`). Optional burst glow ring expands behind the button; optional background environmental glow fades in.

State continuity is critical: the release tween's start value MUST equal the press tween's end value, or the spring snaps to a different position. GSAP threads this automatically when both tweens target the same property at adjacent positions on the same timeline.

## HTML

```html
<div
  class="scene"
  id="press-scene"
  data-composition-id="press-scene"
  data-start="0"
  data-duration="DURATION"
  data-track-index="0"
>
  <div class="press-stage">
    <div class="bg-glow" id="bg-glow"></div>
    <div class="burst" id="burst"></div>
    <button class="btn" id="btn">{buttonLabel}</button>
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
}
.press-stage {
  position: relative;
  display: grid;
  place-items: center;
}
.btn {
  position: relative;
  z-index: 2;
  /* Visual weight: ≥4% of canvas for the press to read on a 1080p frame */
  width: BTN_WIDTH;
  height: BTN_HEIGHT;
  background: {btnBg};
  border: none;
  border-radius: BTN_RADIUS;
  font-family: {font};
  font-weight: 900;
  font-size: BTN_FONT_SIZE;
  letter-spacing: BTN_LETTER_SPACING;
  color: {btnTextColor};
  text-transform: uppercase;
  /* Anchor compression on the center — see Critical Constraints */
  transform-origin: 50% 50%;
  /* Initial floating shadow — large + diffuse */
  box-shadow: {btnRestShadow};
}
.burst {
  /* Sits BEHIND the button, same footprint */
  position: absolute;
  z-index: 1;
  inset: 0;
  width: BTN_WIDTH;
  height: BTN_HEIGHT;
  background: {burstGradient};
  filter: blur(BURST_BLUR);
  opacity: 0;
  transform: scale(1);
  pointer-events: none;
}
.bg-glow {
  /* Full-stage radial — extends beyond the stage with negative inset */
  position: absolute;
  inset: BG_GLOW_INSET;
  background: {bgGlowGradient};
  opacity: 0;
  pointer-events: none;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Phase 1 — press (linear compression)
  tl.to(
    "#btn",
    {
      scale: PRESS_SCALE,
      boxShadow: "{btnPressedShadow}",
      duration: PRESS_DUR,
      ease: "power1.in",
    },
    PRESS_START,
  );

  // Phase 2 — release (spring back with overshoot)
  // CRITICAL: start scale == end of phase 1 (PRESS_SCALE) to maintain state continuity.
  tl.to(
    "#btn",
    {
      scale: 1,
      boxShadow: "{btnRestShadow}",
      duration: RELEASE_DUR,
      ease: `back.out(${BOUNCE_FACTOR})`,
    },
    RELEASE_START,
  );

  // Phase 3 — burst glow (radial pop behind button), triggered with release
  tl.fromTo(
    "#burst",
    { scale: 1, opacity: 0 },
    {
      scale: BURST_PEAK_SCALE,
      opacity: BURST_PEAK_OPACITY,
      duration: BURST_GROW_DUR,
      ease: "power2.out",
    },
    RELEASE_START,
  );
  // Burst then fades out
  tl.to("#burst", { opacity: 0, duration: BURST_FADE_DUR, ease: "power2.in" }, BURST_FADE_START);

  // Phase 4 — background environmental glow fades in after release
  tl.to(
    "#bg-glow",
    {
      opacity: BG_GLOW_PEAK_OPACITY,
      duration: BG_GLOW_FADE_DUR,
      ease: "power2.out",
    },
    RELEASE_START,
  );

  window.__timelines["press-scene"] = tl;
</script>
```

## Variations

### Subtle press (status save / muted CTA)

Less compression, gentler overshoot, smaller burst. `PRESS_SCALE` toward the high end of its range (~0.96), `BOUNCE_FACTOR` toward the low end (~1.4), `BURST_PEAK_SCALE` and `BURST_PEAK_OPACITY` reduced.

### Dramatic press (hero CTA / "ship it" moment)

Deeper compression, more overshoot, larger burst. `PRESS_SCALE` toward the low end (~0.88), `BOUNCE_FACTOR` toward the high end (~2.5), `BURST_PEAK_SCALE` and `BURST_PEAK_OPACITY` maxed.

### Color shift during press

Darken the button mid-press, return on release. Same timeline positions as the scale tweens — interpolated `backgroundColor` on `#btn`. State continuity rule still applies: the release-color tween's start equals the press-color tween's end.

```js
tl.to("#btn", { backgroundColor: "{btnPressedColor}", duration: PRESS_DUR }, PRESS_START);
tl.to("#btn", { backgroundColor: "{btnRestColor}", duration: RELEASE_DUR }, RELEASE_START);
```

### State change at release (approve / confirm pattern)

When the press signals confirmation, swap the button's resting color to a success token at `RELEASE_START` (instead of returning to `{btnRestColor}`), then pop a checkmark via a separate `back.out(${CHECK_BOUNCE})` tween at the same position. The button is now in its terminal state — no further presses expected.

```js
tl.to("#btn", { backgroundColor: "{successColor}", duration: RELEASE_DUR }, RELEASE_START);
tl.to(
  ".btn-check",
  { scale: 1, duration: CHECK_POP_DUR, ease: `back.out(${CHECK_BOUNCE})` },
  RELEASE_START,
);
```

## How to Choose Values

### Geometry

- **BTN_WIDTH / BTN_HEIGHT** — button footprint.
  - Range: button area ≥ 3-5% of canvas (a 320×68 button at 1080p is ~1% and reads as visually insignificant)
  - Effects: smaller → press barely reads; larger → press dominates the frame
  - Constraints: `BTN_WIDTH × BTN_HEIGHT / (canvasW × canvasH) ≥ 0.03`
- **BTN_RADIUS** — corner radius.
  - Range: `BTN_HEIGHT × 0.15` (sharp/modern) → `BTN_HEIGHT / 2` (pill)
- **BTN_FONT_SIZE / BTN_LETTER_SPACING** — typographic weight.
  - Range: `BTN_FONT_SIZE ≈ BTN_HEIGHT × 0.4-0.5`; letter-spacing 4-10 px reads as "actionable label"

### Press dynamics

- **PRESS_SCALE** — compression depth.
  - Range: 0.88 (dramatic) → 0.92 (default) → 0.96 (subtle)
  - Effects: lower → more tactile / weightier; higher → barely-there acknowledgment
  - Constraints: never <0.85 (button feels broken) or >0.98 (no perceptible dip)
- **PRESS_DUR** — compression duration.
  - Range: 0.10-0.30 s
  - Effects: shorter → snappier / "instant-feeling"; longer → slow squish
  - Constraints: shorter than `RELEASE_DUR` (input is faster than spring recovery)
- **RELEASE_DUR** — spring recovery duration.
  - Range: 0.40-0.90 s
  - Effects: shorter → tight pop; longer → loose, wobbly settle
- **BOUNCE_FACTOR** — `back.out(BOUNCE_FACTOR)` overshoot strength.
  - Range: 1.4 (soft) → 2.0 (firm pop) → 2.8 (cartoony)
  - Effects: low end barely overshoots; high end reads as cartoonish; tune by feel
  - Alternative: switch to `elastic.out(amplitude, period)` for a rubbery oscillation instead of a single overshoot
- **PRESS_START / RELEASE_START** — timeline positions.
  - Constraints: `RELEASE_START = PRESS_START + PRESS_DUR` (state continuity — see Critical Constraints)

### Burst glow

- **BURST_PEAK_SCALE** — radial pop max scale.
  - Range: 3 (subtle) → 6 (default) → 8 (dramatic)
  - Constraints: ≤ ~8 — beyond that the radial gradient pixelates visibly
- **BURST_PEAK_OPACITY** — burst max opacity.
  - Range: 0.4 (subtle) → 0.8 (default) → 1.0 (dramatic)
- **BURST_GROW_DUR / BURST_FADE_DUR** — grow vs. fade timing.
  - Range: 0.4-0.7 s each; default grow ≈ fade
- **BURST_BLUR** — gaussian blur on the burst layer.
  - Range: 40-100 px; smaller reads as a hard ring, larger as ambient haze

### Background glow

- **BG_GLOW_PEAK_OPACITY** — peak environmental glow.
  - Range: 0.1 (subtle) → 0.25 (default) → 0.45 (dramatic)
  - Constraints: ≤ 0.45 — higher washes the whole composition
- **BG_GLOW_FADE_DUR** — fade-in duration.
  - Range: 0.6-1.0 s
- **BG_GLOW_INSET** — negative inset so the radial extends past the stage edges.
  - Range: typically `-300` to `-500` px on a 1920×1080 canvas

### Optional "approve" variation

- **CHECK_BOUNCE** — checkmark pop overshoot.
  - Range: 1.4-2.0; firmer than the button's main `BOUNCE_FACTOR` to read as a punctuating "stamp"
- **CHECK_POP_DUR** — checkmark scale-up duration.
  - Range: 0.3-0.6 s

### Tokens

- **{btnBg} / {btnRestColor} / {btnPressedColor}** — primary button surface; pressed darker than rest
- **{btnRestShadow} / {btnPressedShadow}** — rest shadow is large + diffuse; pressed is small + tight (the button "sinks toward the surface")
- **{burstGradient}** — radial; saturated near center, fading to transparent (color should be darker + more saturated than `{btnBg}` — same-color glow looks washed out)
- **{bgGlowGradient}** — full-stage radial, low-opacity tint of `{btnBg}`'s hue family
- **{successColor}** — confirmation green / brand-success for the approve variation

## Key Principles

- **State continuity** — release start value MUST exactly match press end value. With a GSAP timeline, the first tween's end value automatically becomes the second tween's start when they target the same property at adjacent times.
- **Visual weight** — button area should be **≥3-5% of canvas**. Smaller and the press reads as visually insignificant.
- **Linear press, spring release** — the compression is `power1.in/out`, the recovery is `back.out`. Both spring → squishy; both linear → mechanical / no overshoot punch.
- **Anchor compression on center** — `transform-origin: 50% 50%` (default). Otherwise the button collapses asymmetrically.
- **Burst behind, not in front** — burst `z-index: 1`, button `z-index: 2`. If burst sits in front, it occludes the button at peak opacity.
- **Glow color darker + more saturated than element** — bright surface → dark, saturated glow. Same-color glow looks washed out.
- **Don't tween `boxShadow` and `filter` together on the same element** — they compete in the layout pipeline; pick one. Shadow on the button, blur on a separate burst layer.
- **Climax beats need dwell time** — after the burst peak + label/wordmark reveal, the composition must run for **≥1s more** (≥2s for "dramatic" variants) before ending. A reveal at `t=DURATION−0.2s` reads as "flashed and gone."

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **No CSS `transition`** on the button — those interpolate independently of HF seek and cause flicker
- **`will-change: transform`** if the button compounds with other animation layers
- **`RELEASE_START = PRESS_START + PRESS_DUR`** — adjacency on the same property is what makes state continuity automatic; gap or overlap breaks it
- **Burst max scale ≤ ~8** — beyond that the radial gradient pixelates visibly
- **Background glow `opacity ≤ 0.45`** — higher and it washes the whole composition
- **GSAP transform aliases only**: `x`, `y`, `scale`, `rotation`. Never tween `width` / `height` / `left` / `top`.

## Combinations

- [sine-wave-loop.md](sine-wave-loop.md) — idle micro-float on the button BEFORE the press (slight breathing, sells "ready")
- [center-outward-expansion.md](center-outward-expansion.md) — burst of badges outward synced to the press release
- [cursor-click-ripple.md](cursor-click-ripple.md) — cursor click that triggers the press

## Pairs with HF skills

- `/hyperframes-animation` — `back.out` ease + multi-tween coordination
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
