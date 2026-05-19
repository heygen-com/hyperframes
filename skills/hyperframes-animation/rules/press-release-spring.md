---
name: press-release-spring
description: Tactile button press with linear compression then spring-based elastic recovery, plus layered visual feedback (color shift, shadow depth, release burst, background glow). HyperFrames port — two sequential GSAP tweens replace Remotion's frame-windowed `if/else` press/release split.
metadata:
  tags: spring, press, interaction, button, physics, glow, burst, gsap
  adapter: gsap
---

# Press-Release Spring Chain (HyperFrames)

Separates input (linear compression) from output (spring recovery) to create tactile feel. The overshoot is a natural byproduct of the recovery ease, not manually coded.

## HyperFrames vs. Remotion

The Remotion source split the motion into two frame-windowed branches inside a single render function:

```tsx
// Remotion source — one render, frame-conditional branches
if (frame >= TIMING.pressStart && frame < TIMING.release) {
  buttonScale = interpolate(frame, [pressStart, release], [1.0, 0.86]);
} else if (frame >= TIMING.release) {
  buttonScale = interpolate(releaseSpring, [0, 1], [0.86, 1.0]);
}
```

HyperFrames replaces the `if/else` with **two sequential GSAP tweens on the same property, scheduled at adjacent timeline positions**. The end value of the press tween is the start value of the release tween, so state continuity is automatic — GSAP does not snap, it picks up where the previous tween left off.

```js
// HyperFrames port — two tweens, shared property, sequential positions
tl.to(".btn", { scale: COMPRESSED, duration: PRESS_DUR, ease: "power1.out" }, PRESS_FRAME);
tl.to(
  ".btn",
  { scale: 1.0, duration: RELEASE_DUR, ease: "back.out(2.0)" },
  PRESS_FRAME + PRESS_DUR,
);
```

The eased ease on release (`back.out(2.0)`) is the GSAP analogue of Remotion's `spring({ stiffness: 200, damping: 10 })` — high stiffness, low damping, perceptible overshoot.

## Core Concept

Two distinct phases split at `RELEASE_TIME = PRESS_FRAME + PRESS_DUR`:

1. **Press**: linear interpolation → compression (`scale: 1.0 → COMPRESSED`, e.g. `0.86`)
2. **Release**: spring-shaped recovery → elastic pop back (`scale: COMPRESSED → 1.0`)

State continuity is critical: the release start value **must match** the press end value exactly. With GSAP tweens at adjacent positions targeting the same property, this is automatic.

## Basic Pattern

```html
<div
  class="btn-burst-host"
  style="position: absolute; left: 50%; top: 50%;
     transform: translate(-50%, -50%); width: 300px; height: 300px;"
>
  <!-- Release burst — sits behind the button, expands + fades on release -->
  <div
    class="btn-burst"
    style="position: absolute; inset: 0;
       border-radius: 50%; pointer-events: none;
       background: radial-gradient(circle, rgba(255,13,122,0.6) 0%, rgba(255,255,255,0) 70%);
       filter: blur(60px); transform: scale(0.9); opacity: 0; z-index: 0;"
  ></div>

  <!-- Button face -->
  <div
    class="btn"
    style="position: relative; width: 100%; height: 100%;
       border-radius: 50%; background-color: #E4E9FF;
       display: flex; align-items: center; justify-content: center;
       transform: scale(1); z-index: 1;"
  >
    <!-- icon / label -->
  </div>
</div>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // ── Timing (seconds) ───────────────────────────────────────────
  const PRESS_FRAME = 0.43; // when compression starts
  const PRESS_DUR = 0.47; // linear compression length
  const COMPRESSED = 0.86; // press depth (0.85–0.95 typical)
  const RELEASE_TIME = PRESS_FRAME + PRESS_DUR;
  const RELEASE_DUR = 0.65; // spring recovery length

  // (1) Press — linear compression toward COMPRESSED.
  tl.to(".btn", { scale: COMPRESSED, duration: PRESS_DUR, ease: "power1.out" }, PRESS_FRAME);

  // (2) Release — spring recovery. back.out overshoots above 1.0 then settles.
  // High overshoot factor (1.8–2.0) ≈ Remotion spring(stiffness:200, damping:10).
  tl.to(".btn", { scale: 1.0, duration: RELEASE_DUR, ease: "back.out(2.0)" }, RELEASE_TIME);

  window.__timelines["main"] = tl;
</script>
```

**Anchor**: the button face must be centered (or have `transform-origin: center center` if non-rectangular). Compression toward an off-center anchor reads as wobble, not press.

**Ease on release**: `back.out(1.8)` ≈ subtle pop. `back.out(2.0)` ≈ pronounced pop. `elastic.out(1, 0.3)` adds a second oscillation — usually too much.

## Visual Weight Guide

Element size relative to canvas determines perceived impact. Too small feels insignificant; too large feels cramped.

| Element Shape           | Recommended Area Ratio | Sizing Example (1920×1080) |
| ----------------------- | ---------------------- | -------------------------- |
| Circle / Square         | 3–5% of canvas         | 250–350px diameter         |
| Wide rectangle (button) | 4–7% of canvas         | 600–800 × 120–170          |
| Tall rectangle          | 4–7% of canvas         | 200–300 × 400–600          |

**Why this matters**: a 320×68 button occupies ~1% of a 1920×1080 canvas — visually insignificant. Scale up to at least 4% for the press effect to read clearly on screen.

Formula: `areaRatio = (elementWidth × elementHeight) / (canvasWidth × canvasHeight)`

## Variations

### With Color Transition

Darken or recolor the element during press to reinforce the "pushed in" state. GSAP tweens `backgroundColor` directly (CSSPlugin is bundled by default).

```js
// Color tween parallels the press compression — same start, same duration.
tl.to(".btn", { backgroundColor: "#FF0D7A", duration: PRESS_DUR, ease: "power1.out" }, PRESS_FRAME);
```

For multi-stop color sequences (rest → pressed → activated), chain three tweens or use `keyframes`:

```js
tl.to(
  ".btn",
  {
    keyframes: [
      { backgroundColor: "#E4E9FF", duration: 0 },
      { backgroundColor: "#FF8AB7", duration: PRESS_DUR, ease: "power1.out" },
      { backgroundColor: "#FF0D7A", duration: RELEASE_DUR * 0.5, ease: "power2.out" },
    ],
  },
  PRESS_FRAME,
);
```

### With Shadow Depth

Shadow shrinks during press (element closer to surface), expands on release. Creates a z-axis movement illusion. GSAP **cannot tween `boxShadow` as a single string** — break the components into CSS custom properties and tween those.

```html
<div
  class="btn"
  style="
  --shadow-y: 20px;
  --shadow-blur: 64px;
  --shadow-alpha: 0.5;
  box-shadow: 0 var(--shadow-y) var(--shadow-blur) rgba(255,13,122,var(--shadow-alpha));
"
>
  …
</div>
```

```js
tl.to(
  ".btn",
  {
    "--shadow-y": "4px",
    "--shadow-blur": "14px",
    "--shadow-alpha": 0.2,
    duration: PRESS_DUR,
    ease: "power1.out",
  },
  PRESS_FRAME,
);
tl.to(
  ".btn",
  {
    "--shadow-y": "20px",
    "--shadow-blur": "64px",
    "--shadow-alpha": 0.5,
    duration: RELEASE_DUR,
    ease: "back.out(2.0)",
  },
  RELEASE_TIME,
);
```

| State   | Y Offset | Blur  | Alpha     | Why                     |
| ------- | -------- | ----- | --------- | ----------------------- |
| Rest    | 16–24    | 48–80 | 0.4–0.6   | Floating above surface  |
| Pressed | 3–6      | 10–20 | 0.15–0.25 | Pushed flush to surface |

### With Release Burst

A radial glow expands outward on release, reinforcing the spring pop visually. Without this, the scale overshoot alone may feel underwhelming. The burst sits behind the button (lower `z-index`) and has heavy `filter: blur(…)`.

```js
// Three concurrent tweens at RELEASE_TIME on the burst element.
const BURST_DUR = 0.3; // 18f @60fps
const BURST_PEAK = 0.083; // 5f @60fps — when opacity hits max

// Scale grows continuously across the full burst duration.
tl.fromTo(
  ".btn-burst",
  { scale: 0.9 },
  { scale: 3.8, duration: BURST_DUR, ease: "power2.out" },
  RELEASE_TIME,
);

// Opacity uses keyframes for the [0 → 0.7 → 0] envelope (was a 3-point interpolate).
tl.to(
  ".btn-burst",
  {
    keyframes: [
      { opacity: 0, duration: 0 },
      { opacity: 0.7, duration: BURST_PEAK, ease: "power2.out" },
      { opacity: 0, duration: BURST_DUR - BURST_PEAK, ease: "power2.in" },
    ],
  },
  RELEASE_TIME,
);
```

The burst element shares the button's bounding box but is positioned **behind** (lower z-index) and has heavy blur — the visual feels like a halo erupting, not a second button.

#### Burst Parameter Guide

| Parameter     | Subtle              | Medium              | Dramatic            |
| ------------- | ------------------- | ------------------- | ------------------- |
| `endScale`    | 2.5–3.5             | 4.0–6.0             | 7.0–9.0+            |
| `peakOpacity` | 0.3–0.5             | 0.6–0.8             | 0.85–1.0            |
| `blur`        | 30–50px             | 60–80px             | 100–120px           |
| `BURST_DUR`   | 0.20–0.25s (12–15f) | 0.27–0.33s (16–20f) | 0.33–0.42s (20–25f) |

#### Glow Color Relationship

Glow color should be **darker and more saturated** than the element color — this creates depth rather than a washed-out halo.

```
Element: #FF8C00 (bright orange)
Glow core: rgba(180, 60, 0, 0.9)    ← darker, more red
Glow mid:  rgba(160, 70, 10, 0.4)   ← transitional
```

### With Background Glow

A full-screen radial gradient that fades in after release. Creates an environmental light response.

```html
<div
  class="bg-glow"
  style="position: absolute; inset: 0; pointer-events: none;
     background: radial-gradient(circle, #FF0D7A 0%, transparent 65%);
     opacity: 0;"
></div>
```

```js
tl.to(".bg-glow", { opacity: 0.15, duration: 0.25, ease: "power2.out" }, RELEASE_TIME);
```

| Feel     | maxOpacity | spread | Description                 |
| -------- | ---------- | ------ | --------------------------- |
| Subtle   | 0.08–0.15  | 50–65% | Hint of environmental light |
| Medium   | 0.15–0.25  | 65–80% | Noticeable ambient glow     |
| Dramatic | 0.3–0.45   | 80–90% | Screen-filling light wash   |

Note: `spread` controls the gradient's transparent-stop position in CSS. It can't be GSAP-tweened on a `background` string — choose a fixed value at design time and tween only `opacity`.

### With Inset Shadow on Press

While compressed, an inset glow simulates the recessed feel. GSAP cannot tween the inset shadow string directly, so toggle a class via `tl.set()`:

```css
.btn.is-pressed {
  box-shadow: inset 0 0 20px rgba(255, 61, 146, 0.6);
}
```

```js
tl.set(".btn", { className: "+=is-pressed" }, PRESS_FRAME);
tl.set(".btn", { className: "-=is-pressed" }, RELEASE_TIME);
```

## Critical Constraints

- **Anchor / transform-origin**: button centered or `transform-origin: center center` set. Off-anchor compression reads as wobble.
- **State continuity**: press end value = release start value. Adjacent GSAP tweens on the same property handle this automatically; don't leave a gap or both tweens won't pick up the property's running value.
- **Recovery ease**: `back.out(1.8)` minimum for perceptible overshoot. `power3.out` has no overshoot — wrong feel.
- **Burst sits behind**: `z-index: 0` on burst, `z-index: 1` on button face. Otherwise the blurred halo overlays the button and washes it out.
- **Visual weight**: element area ≥ 3% of canvas. Below that, the press is invisible at video resolution.
- **GSAP transform aliases only**: `scale`, `x`, `y`, `rotation`. Never tween `width`, `height`, `left`, `top` — forbidden by the HF allowlist.
- **Shadow tweening via CSS variables**: `boxShadow` as a string is not GSAP-tweenable. Break into `--shadow-y`, `--shadow-blur`, `--shadow-alpha` and tween those.
- **No infinite repeats**: if you add a pulsing glow after the press, use finite `repeat:` count derived from remaining scene duration. Never `repeat: -1`.
- **Single paused timeline**: one `gsap.timeline({ paused: true })`, registered to `window.__timelines[composition-id]`. HyperFrames seeks it.

## Spring → GSAP Ease Mapping (this rule)

| Source `spring({ … })`                                   | Feel                         | GSAP ease               |
| -------------------------------------------------------- | ---------------------------- | ----------------------- |
| `stiffness: 200, damping: 10` (release)                  | Sharp pop, ~10–15% overshoot | `back.out(2.0)`         |
| `stiffness: 200, damping: 15` (checkmark)                | Snappy pop, ~5–8% overshoot  | `back.out(1.6)`         |
| `stiffness: 120, damping: 18, mass: 1` (cursor approach) | Smooth, no overshoot         | `power3.out` over ~0.4s |
| `stiffness: 80, damping: 20` (gentle settle)             | Calm, no overshoot           | `power2.out` over ~0.5s |

`mass` in Remotion shifts duration. In GSAP, scale `duration` proportionally — `mass: 1.5` → ~1.2× duration, `mass: 0.5` → ~0.85× duration.

## Combinations

- Combine with [physics-press-reaction](physics-press-reaction.md) for synchronized cursor + element press _(rule pending migration)_.
- Apply to buttons after `scale-swap-transition` for interactive CTA reveals _(rule pending migration)_.
- Pair with [coordinate-target-zoom](coordinate-target-zoom.md) — camera can zoom into the button just before the press for emphasis.
- Use inside the [workflow-approve-press](../blueprints/workflow-approve-press.md) blueprint Phase 4.

## Examples

- [scene-2-button-press.html](../examples/scene-2-button-press.html) — hero paper-plane button with cursor approach, linear compression, spring release, color transition (neutral → magenta), release burst, and background glow. _(pending migration)_
- [workflow-approve-press.html](../examples/workflow-approve-press.html) — Approve button at the climax of an editor workflow scene: depression + return (linear, no overshoot — see blueprint note), color shift to success green, checkmark pop with `back.out(1.6)`. Demonstrates the "tactile but not bouncy" variant.
