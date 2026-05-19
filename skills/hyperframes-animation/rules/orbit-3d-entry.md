---
name: orbit-3d-entry
description: Elements flip in from 3D space (rotateX + rotateY + translateZ) then settle into continuous elliptical orbit around a focal point. Two nested wrappers — `.icon-pos` carries the orbit x/y from a master onUpdate; `.icon-entry` carries the 3D-flip from a per-icon fromTo tween.
metadata:
  tags: orbit, 3d, flip, ellipse, circular, icon, entry, gsap
  adapter: gsap
---

# Orbit with 3D Entry

Elements flip in from 3D space — `rotateX(90°) → 0°` plus `translateZ(-100) → 0` plus `scale(0) → 1` — then settle into a continuous elliptical orbit around a focal point. The 3D flip is the _entry signature_; the orbit is the _ambient motion that keeps the scene alive_.

## HyperFrames vs. Remotion

The Remotion source computed everything every frame inside the icon's render function:

```tsx
const entryProgress = spring({ frame: frame - delay, fps, config });
const rotateX = interpolate(entryProgress, [0, 1], [90, 0]);

const effectiveFrame = Math.max(0, frame - delay);
const angle = initialAngle + effectiveFrame * orbitSpeed;
const orbitX = Math.cos(angle) * radiusX;
```

HyperFrames is seek-driven on a paused timeline, so the same orbit and entry are split across two GSAP mechanisms:

| Concern                           | HyperFrames mechanism                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 3D flip entry (one-shot per icon) | Per-icon `tl.fromTo(".icon-entry", …, ease: "back.out(1.4)")` on a nested entry wrapper                         |
| Continuous orbit (every frame)    | Single master `tl.to({ tick: 0 }, … onUpdate)` that reads `tl.time()` and writes `x` / `y` to every `.icon-pos` |

The orbit and the entry never collide because they target different wrappers (`.icon-pos` vs `.icon-entry`).

## Two-Wrapper Anatomy

```html
<div class="icon-pos">
  <!-- outer: GSAP writes x/y here (orbit) -->
  <div class="icon-entry">
    <!-- inner: GSAP writes rotateX/Y/Z/scale/opacity (entry) -->
    <svg class="icon-svg">…</svg>
  </div>
</div>
```

```css
.icon-pos {
  position: absolute;
  left: 50%; /* baseline at viewport center */
  top: 50%;
  width: 120px;
  height: 120px;
  margin: -60px 0 0 -60px; /* recenter the box */
  perspective: 800px; /* enables the 3D flip on the inner wrapper */
  will-change: transform;
}
.icon-entry {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  transform-style: preserve-3d;
  will-change: transform, opacity;
}
```

`perspective` lives on `.icon-pos`, not on `.icon-entry` itself — the inner wrapper inherits the perspective space from its parent so the 3D flip has visible depth.

## Phase 1 — 3D Flip Entry (Per-Icon Tween)

```js
const ICONS = [
  { sel: ".icon-music", initialAngle: (0 * Math.PI) / 3, entryDelay: 0.0 },
  { sel: ".icon-gaming", initialAngle: (1 * Math.PI) / 3, entryDelay: 0.1 },
  { sel: ".icon-education", initialAngle: (2 * Math.PI) / 3, entryDelay: 0.2 },
  { sel: ".icon-sports", initialAngle: (3 * Math.PI) / 3, entryDelay: 0.3 },
  { sel: ".icon-vlog", initialAngle: (4 * Math.PI) / 3, entryDelay: 0.4 },
  { sel: ".icon-podcast", initialAngle: (5 * Math.PI) / 3, entryDelay: 0.5 },
];

const ENTRY_DUR = 0.55;

ICONS.forEach(({ sel, entryDelay }) => {
  tl.fromTo(
    `${sel} .icon-entry`,
    { rotateX: 90, rotateY: -45, z: -100, scale: 0, opacity: 0 },
    {
      rotateX: 0,
      rotateY: 0,
      z: 0,
      scale: 1,
      opacity: 1,
      duration: ENTRY_DUR,
      ease: "back.out(1.4)", // spring(stiffness:100-120, damping:14) — mild overshoot
    },
    entryDelay,
  );
});
```

Stagger delays (`0.10 s = 3 frames at 30fps`) cascade the entries. With 6 icons that's a 0.50 s window — short enough that the _last_ icon lands while the _first_ is still settling, so the eye reads a continuous wave.

### Why `back.out(1.4)` and not a stiffer ease

Per the SKILL.md spring → ease table, `stiffness: 100–120, damping: 14` (the Remotion source) maps to `back.out(1.4)` — a 4-frame overshoot at 30 fps. Stiffer eases (`back.out(1.7)+`) snap too hard for an _arrival_ motion; the icons should feel _placed_, not _thrown_.

## Phase 2 — Continuous Orbit (Master onUpdate)

The orbit angle advances every frame from the moment the icon enters. A single master `onUpdate` writes all icons:

```js
const RADIUS_X = 480;
const RADIUS_Y = 280; // ≈ 0.58 × X for perspective flattening
const ORBIT_SPEED = 0.25; // radians per second — full revolution every ~25 s
const ORBIT_END = 3.0; // stop the engine after the orbit is no longer visible

tl.to(
  { tick: 0 },
  {
    tick: 1, // unused; this is just a clock
    duration: ORBIT_END,
    ease: "none",
    onUpdate: () => {
      const t = tl.time();
      ICONS.forEach(({ sel, initialAngle, entryDelay }) => {
        const localT = Math.max(0, t - entryDelay); // each icon's clock starts at its entry
        const angle = initialAngle + localT * ORBIT_SPEED;
        const x = Math.cos(angle) * RADIUS_X;
        const y = Math.sin(angle) * RADIUS_Y;
        gsap.set(`${sel}.icon-pos`, { x, y });
      });
    },
  },
  0,
);
```

### Why `Math.max(0, t - entryDelay)`

Without the clamp, an icon's `angle` would be wrong for `t < entryDelay` — it would already have "rotated" off its initial angle before becoming visible. Clamping at 0 holds every icon at `initialAngle` until its entry begins, so the flip-in starts from a known position.

### Why one onUpdate instead of one tween per icon

GSAP doesn't natively tween two trigonometric outputs from one input. We could express the orbit as a linear angle tween + `modifiers`, but the master `onUpdate` is far simpler and the per-frame cost is trivial (`Math.cos` + `Math.sin` per icon = ~6 floats per icon per frame).

## Elliptical Orbit Parameters

| Parameter      | Effect                                                                     | Typical range              |
| -------------- | -------------------------------------------------------------------------- | -------------------------- |
| `RADIUS_X`     | Horizontal spread                                                          | 400–600 px on a 1920 stage |
| `RADIUS_Y`     | Vertical spread — use `RADIUS_X * 0.5–0.6` for perspective-like flattening | 200–360 px                 |
| `ORBIT_SPEED`  | Radians per **second** — `0.2–0.4` for gentle ambient orbit                | 0.2–0.4 rad/s              |
| `initialAngle` | Starting angle per icon — distribute evenly: `(i / N) * 2π`                | per-icon                   |
| `entryDelay`   | Stagger between icon entries (seconds)                                     | 0.08–0.15 s                |

## Variations

### Collapse to Center (composes with orbit)

Reverse the orbit by scaling the radius from 1 to 0 over a collapse window. The same master `onUpdate` reads a _second_ time-derived value:

```js
const CLICK_AT = 2.2;
const COLLAPSE_DUR = 0.85;
const COLLAPSE_EASE = gsap.parseEase("back.out(1.6)"); // snappier than the entry

tl.to(
  { tick: 0 },
  {
    tick: 1,
    duration: ORBIT_END,
    ease: "none",
    onUpdate: () => {
      const t = tl.time();
      const collapseLinear = Math.max(0, Math.min(1, (t - CLICK_AT) / COLLAPSE_DUR));
      const collapseEased = COLLAPSE_EASE(collapseLinear);
      const radiusFactor = 1 - collapseEased;

      ICONS.forEach(({ sel, initialAngle, entryDelay }) => {
        const localT = Math.max(0, t - entryDelay);
        const angle = initialAngle + localT * ORBIT_SPEED;
        const x = Math.cos(angle) * RADIUS_X * radiusFactor;
        const y = Math.sin(angle) * RADIUS_Y * radiusFactor;
        gsap.set(`${sel}.icon-pos`, { x, y });
      });
    },
  },
  0,
);
```

**The orbit speed is unchanged during collapse — only the radius shrinks.** Slowing the orbit during collapse looks like the icons "freeze and pull"; keeping the speed constant looks like a vortex draining inward, which is the desired "energy converging on the click point" reading.

For collapse scale + opacity on top of the orbit, add a third wrapper:

```html
<div class="icon-pos">
  <!-- orbit x/y -->
  <div class="icon-collapse">
    <!-- collapse scale + opacity (during phase 3 only) -->
    <div class="icon-entry">
      <!-- 3D flip entry (one-shot) -->
      <svg class="icon-svg">…</svg>
    </div>
  </div>
</div>
```

Inside the same master `onUpdate`, write `scale` / `opacity` to `.icon-collapse`. This three-wrapper pattern is what [cta-orbit-collapse](../blueprints/cta-orbit-collapse.md) uses.

### Z-Index by Orbit Y

For depth illusion, icons in the _lower_ half of the orbit (higher screen-Y) should sit _above_ those in the upper half. Add to the master onUpdate:

```js
const zIndex = Math.round((y + RADIUS_Y) * 0.5); // 0 at top, RADIUS_Y at bottom
gsap.set(`${sel}.icon-pos`, { x, y, zIndex });
```

Without this, an icon orbiting in front of the centerpiece during the front half of its loop will get drawn behind it on every screen-Y crossing — a flicker.

### Floating Wobble During Orbit

The Remotion source added `floatY = Math.sin(frame * 0.03 + index) * 5` to give each icon a subtle bob _while_ orbiting. Add to the master onUpdate:

```js
const float = Math.sin(localT * 1.0 + i * 1.3) * 5;
const floatRot = Math.sin(localT * 0.6 + i * 2.0) * 3;
gsap.set(`${sel}.icon-pos`, { x, y: y + float, rotation: floatRot });
```

`+ i * 1.3` phase-offsets each icon's wobble so they don't bob in unison. Keep amplitude small (±3–6 px); larger looks like turbulence.

## Tips

- **Stagger entries by 0.08–0.15 s** for a cascade feel. Larger gaps (0.25 s+) start to read as separate animations.
- **High 3D entry rotation (60–90°)** for a dramatic flip-in. The `rotateY: -45` adds a perspective skew so each icon feels like it's flipping in from the upper-right rather than straight forward.
- **Slow orbit speed (0.2–0.4 rad/s)** — the orbit is _ambient_, not the focal motion. Faster orbits pull attention away from whatever the centerpiece is doing.
- **4–8 elements** work best. Fewer feels empty; more clusters even at 480 px radius.
- **Use `back.out(1.4)` for entry, `back.out(1.6)+` for any subsequent collapse** — collapse should feel snappier than arrival.

## Critical Constraints

- **Two (or three) nested wrappers per icon**: orbit x/y on `.icon-pos`, collapse scale/opacity on `.icon-collapse` (if collapsing), entry 3D rotation on `.icon-entry`. Tweening different properties on the _same_ element from two sources is undefined under GSAP's last-write-wins semantics.
- **`perspective` on `.icon-pos`, not the body**: A scene-wide `perspective` causes every transformed element to share a vanishing point, which distorts the orbit's circular reading.
- **`Math.max(0, t - entryDelay)` clamp**: Without it, icons "rotate" before they're visible and pop into the orbit at the wrong angle.
- **Constant orbit speed, even during collapse**: Only the radius shrinks. The angular velocity is invariant.
- **GSAP transform aliases only**: `x`, `y`, `scale`, `rotation`, `rotateX`, `rotateY`, `z`, `opacity`. Never `left`/`top`/`width`/`height`.
- **No `Math.random` / `Date.now`**: All orbit and entry state is a pure function of `tl.time()`.
- **No infinite repeats**: The master `onUpdate` clock tween has a finite `duration: ORBIT_END`.

## Combinations

- [svg-icon-enrichment](svg-icon-enrichment.md) — give each orbiting icon a signature internal motion (rotating clock hand, pulsing record dot, bouncing notes). The enrichment runs on the SVG _inside_ `.icon-entry` and is independent of the orbit math.
- [center-outward-expansion](center-outward-expansion.md) — alternative entry pattern where icons expand outward from a cluster point rather than flipping in from 3D space. Use one or the other, not both.
- [cursor-click-ripple](cursor-click-ripple.md) — the click that drives the collapse phase in [cta-orbit-collapse](../blueprints/cta-orbit-collapse.md).
- [sine-wave-loop](sine-wave-loop.md) — apply to whatever the orbit surrounds (a central CTA, a logo, the demo that emerges from collapse) so the centerpiece breathes while the icons orbit.

## Examples

- [cta-orbit-collapse.html](../examples/cta-orbit-collapse.html) — six genre icons enter with 3D flip and orbit a central CTA input; on click they collapse inward. Uses the full three-wrapper pattern (`.icon-pos` orbit + `.icon-collapse` scale/opacity + `.icon-entry` 3D flip) so the orbit, collapse, and entry tweens never collide.
