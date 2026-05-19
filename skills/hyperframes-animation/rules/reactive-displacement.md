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
- **Victim** (A, exiting): position interpolated from settled to off-stage in the OPPOSITE direction, but completing at ~0.4-0.5 of the driver (not 1.0)

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
      <div class="card-title">$199</div>
      <div class="card-sub">ENTERPRISE</div>
    </div>
    <div class="card intruder" id="intruder">
      <div class="card-title">FREE</div>
      <div class="card-sub">FOR HEYGENVERSE BETA</div>
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
  background: radial-gradient(ellipse at center, #161a3a 0%, #0b0d1f 70%);
  font-family: "Inter", sans-serif;
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
  background: linear-gradient(160deg, rgba(245, 196, 81, 0.4) 0%, rgba(20, 24, 56, 0.85) 70%);
  border: 1px solid rgba(245, 196, 81, 0.4);
  z-index: 1;
}
.intruder {
  background: linear-gradient(160deg, rgba(167, 139, 250, 0.5) 0%, rgba(20, 24, 56, 0.85) 70%);
  border: 2px solid rgba(167, 139, 250, 0.7);
  box-shadow: 0 28px 96px rgba(167, 139, 250, 0.4);
  z-index: 2;
}
.card-title {
  font-size: 200px;
  font-weight: 900;
  color: #f5f6fb;
  line-height: 1;
  letter-spacing: -4px;
}
.card-sub {
  font-size: 36px;
  font-weight: 800;
  letter-spacing: 10px;
  text-transform: uppercase;
  color: #cdb8ff;
  text-align: center;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const STAGE_W = 1920;
  const INTRUDER_START_X = STAGE_W; // off-stage right
  const VICTIM_END_X = -STAGE_W; // off-stage left

  // Initial state — victim centered, intruder off-stage right
  gsap.set("#victim", { x: 0, opacity: 1, rotation: 0 });
  gsap.set("#intruder", { x: INTRUDER_START_X, opacity: 0, rotation: -10 });

  // Single driver — the entry spring — runs 0→1 over the impact arc
  const driver = { p: 0 };
  tl.to(
    driver,
    {
      p: 1,
      duration: 1.2,
      ease: "back.out(1.6)", // intruder spring
      onUpdate: () => {
        // Intruder: full 0→1 progress maps to enter (off-stage right → center)
        const intruderX = INTRUDER_START_X * (1 - driver.p);
        const intruderOpacity = Math.min(1, driver.p * 5); // fade in fast (first 20%)
        const intruderRot = -10 * (1 - driver.p); // settle to 0° rotation
        const intruder = document.getElementById("intruder");
        intruder.style.transform = `translate(-50%, -50%) translateX(${intruderX}px) rotate(${intruderRot}deg)`;
        intruder.style.opacity = String(intruderOpacity);

        // Victim: completes exit at ~0.5 of driver (intruder still flying in)
        // so the impact MOMENT is the visual punch — by the time intruder centers,
        // victim is already off-stage.
        const victimP = Math.min(1, driver.p / 0.5);
        const victimX = VICTIM_END_X * victimP;
        const victimOpacity = 1 - victimP; // fade in opposite direction
        const victim = document.getElementById("victim");
        victim.style.transform = `translate(-50%, -50%) translateX(${victimX}px)`;
        victim.style.opacity = String(victimOpacity);
      },
    },
    0.4,
  );

  // Climax dwell — intruder holds at center after settle (≥1s post-impact)
  // (no additional motion; the comp continues from 1.6s to 3.0s with intruder at center)

  window.__timelines["collide-scene"] = tl;
</script>
```

## Variations

### Impact rotation on victim

The victim doesn't just slide off — it ALSO rotates from the impact angle:

```js
const victimRot = victimP * -20; // rotates -20° as it slides
victim.style.transform = `translate(-50%, -50%) translateX(${victimX}px) rotate(${victimRot}deg)`;
```

### Vertical collision

Intruder enters from top, victim displaced downward. Same math with Y instead of X. Visual feels like "weight dropped on it."

### Wobble after settle

After the intruder centers, idle-wobble (sin-driven ±2° rotation) for 0.5s before stillness. Adds "impact aftermath" before climax dwell.

```js
const wobble = { p: 0 };
tl.to(
  wobble,
  {
    p: Math.PI * 4,
    duration: 0.5,
    ease: "none",
    onUpdate: () => {
      const rot = Math.sin(wobble.p) * 2 * (1 - wobble.p / (Math.PI * 4)); // decay
      intruder.style.transform = `translate(-50%, -50%) rotate(${rot}deg)`;
    },
  },
  1.6,
);
```

### Multi-victim ripple

Intruder displaces 3+ aligned cards, each victim getting a slightly delayed exit (cascade ripple). Each victim's `victimP` uses a different driver phase offset.

## Key Principles

- **Single driver = single source of truth** — the entry spring drives BOTH motions. Independent tweens for intruder and victim destroy the causal link; they'd just happen to be near each other in time, not collided.
- **Victim completes at ~0.4-0.5 of driver** — by the time the intruder reaches center, the victim is GONE. The "hit" is the moment they overlap; after that the victim is just exiting space the intruder will fill.
- **Directional momentum transfer** — intruder from positive X → victim moves negative X. Same axis. If they move on different axes, it looks like they passed each other, not collided.
- **Intruder z-index ABOVE victim** — during overlap (0.1-0.2s), the intruder should appear in FRONT (it's the "winner" of the collision). Otherwise the victim looks like it tunneled through.
- **Intruder enters with rotation, settles flat** — adds momentum visualization. -10° tilt → 0° at settle reads as "spinning in then planting."
- **❗ Climax dwell ≥1s after intruder settles** — the impact is the headline beat. Post-impact dwell is where the new content gets read.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **Single driver, multiple derived values in same onUpdate** — don't tween intruder and victim with separate `tl.to()` calls; use ONE driver and compute both inside its onUpdate
- **`overflow: hidden` on `.scene`** — off-stage motion exceeds the 1920px frame
- **`will-change: transform, opacity`** on both cards
- **z-index intruder=2, victim=1** — explicit, not relying on DOM order alone

## Combinations

- [hacker-flip-3d.md](hacker-flip-3d.md) — intruder text reveals via hacker-flip during the entry phase
- [sine-wave-loop.md](sine-wave-loop.md) — idle breathing on intruder during climax dwell
- [vertical-spring-ticker.md](vertical-spring-ticker.md) — intruder is a ticker that "shoves" the previous content out

## Pairs with HF skills

- `/hyperframes-gsap` — single driver, multi-value onUpdate
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
