---
name: reactive-displacement
description: Physical collision where an entering element's spring drives the exiting element's displacement — single source of truth makes the motion causally linked.
metadata:
  tags: transition, physics, collision, displacement, spring, causal
---

# Reactive Displacement

Exit animation of element A is mathematically DERIVED from the entry spring of element B. Creates a causal link: "A moves _because_ B hit it." Distinct from [scale-swap-transition](scale-swap-transition.md) (which overlaps but isn't causal) and [card-morph-anchor](card-morph-anchor.md) (which uses one container morphing dimensions).

## How It Works

A single 0→1 driver tween (the "entry spring") feeds two derived motions:

- **Intruder** (B, entering): position interpolated from off-stage to settled
- **Victim** (A, exiting): position interpolated from settled to off-stage in the OPPOSITE direction, but completing at a fraction `VICTIM_FRACTION` of the driver (not 1.0)

The fact that the victim's exit finishes BEFORE the intruder's entry creates the "hit then settle" rhythm. Both motions share the same eased driver, so the impact moment is mathematically synchronized.

## HTML

```html
<div
  class="scene"
  id="collide-scene"
  data-composition-id="collide-scene"
  data-start="0"
  data-duration="3"
  data-track-index="0"
>
  <div class="stage">
    <div class="card victim" id="victim">
      <div class="card-title">{victimHeadline}</div>
      <div class="card-sub">{victimSubline}</div>
    </div>
    <div class="card intruder" id="intruder">
      <div class="card-title">{intruderHeadline}</div>
      <div class="card-sub">{intruderSubline}</div>
    </div>
  </div>
</div>
```

## CSS

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: radial-gradient(ellipse at center, {bgColor} 0%, {bgColorDeep} 70%);
  font-family: {font};
}
.stage {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
}
.card {
  position: absolute;
  /* both at center; transform translates them */
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 64px 80px;
  border-radius: 28px;
  will-change: transform, opacity;
}
.victim {
  background: linear-gradient(160deg, {victimTint} 0%, {bgColorDeep} 70%);
  border: 1px solid {victimTint};
  z-index: 1;
}
.intruder {
  background: linear-gradient(160deg, {intruderTint} 0%, {bgColorDeep} 70%);
  border: 2px solid {intruderBorder};
  box-shadow: 0 28px 96px {intruderTint};
  z-index: 2;
}
.card-title {
  font-size: 200px;
  font-weight: 900;
  color: {textColor};
  line-height: 1;
  letter-spacing: -4px;
}
.card-sub {
  font-size: 36px;
  font-weight: 800;
  letter-spacing: 10px;
  text-transform: uppercase;
  color: {accentColor};
  text-align: center;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Off-stage distances are derived from the stage width.
  const INTRUDER_START_X = STAGE_W; // off-stage right
  const VICTIM_END_X = -STAGE_W; // off-stage left, opposite direction

  // Initial state — victim centered, intruder off-stage right
  gsap.set("#victim", { x: 0, opacity: 1, rotation: 0 });
  gsap.set("#intruder", { x: INTRUDER_START_X, opacity: 0, rotation: -INTRUDER_TILT });

  // Single driver — the entry spring — runs 0→1 over the impact arc
  const driver = { p: 0 };
  tl.to(
    driver,
    {
      p: 1,
      duration: DRIVER_DUR,
      ease: `back.out(${BOUNCE_FACTOR})`, // intruder spring
      onUpdate: () => {
        // Intruder: full 0→1 progress maps to enter (off-stage → center)
        const intruderX = INTRUDER_START_X * (1 - driver.p);
        const intruderOpacity = Math.min(1, driver.p * FADE_IN_SHARPNESS);
        const intruderRot = -INTRUDER_TILT * (1 - driver.p); // settle to 0°
        const intruder = document.getElementById("intruder");
        intruder.style.transform = `translate(-50%, -50%) translateX(${intruderX}px) rotate(${intruderRot}deg)`;
        intruder.style.opacity = String(intruderOpacity);

        // Victim: completes exit at VICTIM_FRACTION of driver (intruder still flying in)
        // so the impact MOMENT is the visual punch — by the time intruder centers,
        // victim is already off-stage.
        const victimP = Math.min(1, driver.p / VICTIM_FRACTION);
        const victimX = VICTIM_END_X * victimP;
        const victimOpacity = 1 - victimP;
        const victim = document.getElementById("victim");
        victim.style.transform = `translate(-50%, -50%) translateX(${victimX}px)`;
        victim.style.opacity = String(victimOpacity);
      },
    },
    DRIVER_AT,
  );

  // Climax dwell — intruder holds at center after settle (no additional motion;
  // composition continues with intruder centered for ≥ DWELL_MIN seconds).

  window.__timelines["collide-scene"] = tl;
</script>
```

## How to Choose Values

- **DRIVER_AT** — when the entry spring begins
  - Range: phase-dependent (typically a few seconds in)
  - Effects: too early skips setup beats; too late stalls the cut
  - Constraints: must allow ≥ DWELL_MIN of climax dwell before composition ends
  - Reference: example schedules the displacement after the prior reading beat resolves

- **DRIVER_DUR** — full intruder entry duration
  - Range: 0.6-1.4 s
  - Effects: short = zippy/punchy impact; long = heavy/landed impact
  - Constraints: tune against `BOUNCE_FACTOR` — higher bounce on long durations reads as floaty
  - Reference: see the corresponding blueprint / example

- **BOUNCE_FACTOR** — `back.out()` coefficient on the intruder spring
  - Range: 1.2-2.0 (discrete choice within `back.out` family)
  - Effects: low ≈ firm settle; high ≈ overshoot/bounce
  - Constraints: ease family stays `back.out` (or upgrade to `elastic.out` if you want oscillation); changing family rewrites the feel
  - Reference: examples typically sit between 1.4 and 1.6

- **VICTIM_FRACTION** — fraction of `DRIVER_DUR` over which the victim completes its exit
  - Range: 0.4-0.5
  - Effects: < 0.4 victim disappears before impact reads; > 0.5 motion feels parallel, not causal
  - Constraints: hard upper limit ~0.6; beyond that the collision metaphor breaks
  - Reference: this rule's pattern uses ~0.5

- **STAGE_W** — stage width in pixels, used to place elements off-stage
  - Range: equal to the composition's `data-width`
  - Effects: smaller values leave the off-stage element partially visible at start
  - Constraints: must be ≥ composition width
  - Reference: examples use the project's render width directly

- **INTRUDER_TILT** — initial rotation (degrees) the intruder rotates from as it settles to 0°
  - Range: 5-15°
  - Effects: low = clean glide; high = visible "spin-and-plant"
  - Constraints: keep sign consistent with entry direction (matches momentum transfer)
  - Reference: ~10° is a typical mid-impact tilt

- **FADE_IN_SHARPNESS** — multiplier controlling how quickly intruder opacity reaches 1
  - Range: 3-8 (intruder reaches opacity 1 at `1/FADE_IN_SHARPNESS` of progress)
  - Effects: low = soft fade alongside motion; high = pops in early and reads as solid
  - Constraints: > 1; below 1 means intruder is still transparent at center
  - Reference: most examples use a sharp early reveal

- **DWELL_MIN** — minimum climax dwell after the intruder settles
  - Range: ≥ 1.0 s
  - Effects: shorter feels rushed and unreadable; longer stalls the comp
  - Constraints: post-impact dwell is where the new content gets read — do not skip
  - Reference: 1.0-1.5 s is typical

## Variations

### Impact rotation on victim

The victim doesn't just slide off — it ALSO rotates from the impact angle:

```js
const victimRot = victimP * -VICTIM_KICK_DEG; // rotates as it slides
victim.style.transform = `translate(-50%, -50%) translateX(${victimX}px) rotate(${victimRot}deg)`;
```

`VICTIM_KICK_DEG` is typically 15-25°; pick magnitude to match the perceived intruder weight.

### Vertical collision

Intruder enters from top, victim displaced downward. Same math with Y instead of X. Visual feels like "weight dropped on it."

### Wobble after settle

After the intruder centers, a damped sine wobble (`±WOBBLE_AMP_DEG` rotation, decaying over `WOBBLE_DUR`) before stillness. Adds "impact aftermath" before climax dwell.

```js
const wobble = { p: 0 };
tl.to(
  wobble,
  {
    p: Math.PI * WOBBLE_CYCLES * 2,
    duration: WOBBLE_DUR,
    ease: "none",
    onUpdate: () => {
      const rot =
        Math.sin(wobble.p) * WOBBLE_AMP_DEG * (1 - wobble.p / (Math.PI * WOBBLE_CYCLES * 2)); // linear decay
      intruder.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
    },
  },
  DRIVER_AT + DRIVER_DUR,
);
```

### Multi-victim ripple

Intruder displaces multiple aligned cards, each victim getting a slightly delayed exit (cascade ripple). Each victim's `victimP` uses a different driver phase offset.

## Key Principles

- **Single driver = single source of truth** — the entry spring drives BOTH motions. Independent tweens for intruder and victim destroy the causal link; they'd just happen to be near each other in time, not collided.
- **Victim completes at a fraction of driver** — by the time the intruder reaches center, the victim is GONE. The "hit" is the moment they overlap; after that the victim is just exiting space the intruder will fill.
- **Directional momentum transfer** — intruder from positive X → victim moves negative X. Same axis. If they move on different axes, it looks like they passed each other, not collided.
- **Intruder z-index ABOVE victim** — during overlap, the intruder should appear in FRONT (it's the "winner" of the collision). Otherwise the victim looks like it tunneled through.
- **Intruder enters with rotation, settles flat** — adds momentum visualization. A small initial tilt → 0° at settle reads as "spinning in then planting."
- **Climax dwell after impact** — the impact is the headline beat. Post-impact dwell is where the new content gets read.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **Single driver, multiple derived values in same onUpdate** — don't tween intruder and victim with separate `tl.to()` calls; use ONE driver and compute both inside its onUpdate
- **`overflow: hidden` on `.scene`** — off-stage motion exceeds the frame
- **`will-change: transform, opacity`** on both cards
- **Intruder z-index > victim z-index** — explicit, not relying on DOM order alone

## Combinations

- [hacker-flip-3d.md](hacker-flip-3d.md) — intruder text reveals via hacker-flip during the entry phase
- [sine-wave-loop.md](sine-wave-loop.md) — idle breathing on intruder during climax dwell
- [vertical-spring-ticker.md](vertical-spring-ticker.md) — intruder is a ticker that "shoves" the previous content out

## Pairs with HF skills

- `/hyperframes-animation` — single driver, multi-value onUpdate
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
