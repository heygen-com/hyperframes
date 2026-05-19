---
name: physics-press-reaction
description: Physical click simulation — two GSAP scale tweens at down/up timeline positions create a dip-and-recovery without keyframing intermediate values. Synchronize between target and cursor for tactile contact feel.
metadata:
  tags: spring, click, physics, press, interaction, gsap
  adapter: gsap
---

# Physics-Based Press Reaction

Models a click as a brief scale dip followed by recovery. Apply the same dip pattern to both the target (button) and the cursor to sell the physical contact — they compress together.

## HyperFrames vs. Remotion

The Remotion source defined two opposing springs and combined them subtractively:

```
pressScale = 1 − (downSpring × intensity) + (upSpring × intensity)
```

When downSpring reaches 1 with upSpring still 0: scale = 1 − 0.1 + 0 = 0.9 (pressed)
When both reach 1: scale = 1 − 0.1 + 0.1 = 1.0 (recovered)

HyperFrames doesn't need the subtractive math. Two **sequential GSAP scale tweens** produce the same dip-and-recovery:

```
Tween at clickDownAt: scale 1 → 0.9 (fast, power3.out)
Tween at clickUpAt:   scale 0.9 → 1.0 (slightly slower, power2.out)
```

GSAP's overwrite handles the transition between them. The visual result is identical.

```
Remotion: pressScale = 1 − downSpring*0.1 + upSpring*0.1     (frame-pure)
HyperFrames: tl.to(el, { scale: 0.9 }, clickDownAt)
             tl.to(el, { scale: 1.0 }, clickUpAt)             (sequential)
```

## Core Concept

Three states:

```
Before click  (t < clickDownAt):    scale = 1.0   (neutral)
During press  (clickDownAt < t < clickUpAt):  scale tweens 1 → 0.9
After release (t > clickUpAt):       scale tweens 0.9 → 1.0
```

The hold duration (`clickUpAt − clickDownAt`) sets the press feel:

| Hold          | Frames at 30 fps | Feel                             |
| ------------- | ---------------- | -------------------------------- |
| < 0.10 s      | < 3 frames       | Quick tap                        |
| 0.10 – 0.20 s | 3–6 frames       | Snappy click                     |
| 0.27 – 0.40 s | 8–12 frames      | Deliberate click — feels natural |
| > 0.65 s      | > 20 frames      | Long press                       |

## Basic Pattern

```html
<!-- Both target and cursor get the same press treatment. -->
<div class="cta" id="cta">Click me</div>
<div class="cursor" id="cursor">
  <svg><!-- cursor SVG --></svg>
</div>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const CLICK_DOWN_AT = 3.83; // seconds
  const CLICK_UP_AT = 4.17; // = down + 0.34 s = ~10 frames at 30 fps
  const INTENSITY = 0.1; // 0.05 subtle · 0.1 standard · 0.15 heavy

  /* PRESS DOWN — both target and cursor compress together.
     Two tweens with the same start time on different selectors. */
  tl.to(
    ["#cta", "#cursor"],
    {
      scale: 1 - INTENSITY,
      duration: 0.15,
      ease: "power3.out", // spring(stiffness:300, damping:20)
    },
    CLICK_DOWN_AT,
  );

  /* RELEASE — back to scale 1.0. Slightly slower than the press for the
     "bounce back" feel. */
  tl.to(
    ["#cta", "#cursor"],
    {
      scale: 1.0,
      duration: 0.25,
      ease: "power2.out", // spring(stiffness:200, damping:15)
    },
    CLICK_UP_AT,
  );

  window.__timelines["main"] = tl;
</script>
```

### Passing a tween targets array

GSAP `tl.to(["#cta", "#cursor"], { ... })` applies the same vars to both elements. They tween in perfect lockstep — same eased value at every frame. This is what makes the cursor "push into" the button: they compress identically.

If you've separated them for other reasons (different transform alias compositions), express the tween twice with identical timing:

```js
tl.to("#cta", { scale: 0.9, duration: 0.15, ease: "power3.out" }, CLICK_DOWN_AT);
tl.to("#cursor", { scale: 0.9, duration: 0.15, ease: "power3.out" }, CLICK_DOWN_AT);
```

## Variations

### Subtle Tap

```js
const INTENSITY = 0.05; // barely visible — for "ack" feedback on a hover-state button
```

### Heavy Press

```js
const INTENSITY = 0.15;
// Lengthen hold for an emphatic press:
const CLICK_UP_AT = CLICK_DOWN_AT + 0.5;
```

### Inner Glow During Press

Use a CSS class toggle gated by a near-zero-duration GSAP tween on a custom property. The `--press` variable goes from 0 to 1 at down, and from 1 to 0 at up, driving an inset glow:

```css
.cta {
  --press: 0;
  box-shadow: inset 0 0 calc(var(--press) * 80px) rgba(255, 255, 255, 0.4);
}
```

```js
tl.to("#cta", { "--press": 1, duration: 0.05, ease: "power2.out" }, CLICK_DOWN_AT);
tl.to("#cta", { "--press": 0, duration: 0.15, ease: "power2.out" }, CLICK_UP_AT);
```

The inset glow brightens during the hold then fades out — like the button "absorbs" the click.

### Color Tint During Press

Same custom-property pattern but driving an overlay color:

```css
.cta {
  background-color: rgb(230 0 126);
}
.cta::after {
  content: "";
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, calc(var(--press) * 0.18));
  pointer-events: none;
}
```

The button visibly lightens during the hold.

## Critical Constraints

- **Timing order**: `CLICK_UP_AT > CLICK_DOWN_AT`. Reversed values produce an inverted press (scale up first, then down) which reads as a misplay.
- **Same tween config for target and cursor**: Same duration, ease, position parameter. Drift breaks the "they're touching" illusion.
- **Press composes multiplicatively with entrance**: If the target also has an entrance scale (e.g. from [scale-swap-transition](scale-swap-transition.md)), the entrance and press tweens both target `scale`. GSAP overwrite handles the merging: by the time the click arrives, the entrance has settled to scale 1, so press 1 → 0.9 → 1 works cleanly.
- **Cursor scale 1.0 baseline**: `gsap.set("#cursor", { scale: 1 })` before the timeline if the cursor isn't tweened elsewhere. Otherwise its scale starts at GSAP's auto-detected initial value (which can be `null` if no inline transform).
- **Hold duration in frames-equivalent seconds**: 8–12 frames at 30 fps = 0.27–0.40 s. Going below 0.10 s skips perception; above 0.65 s reads as a deliberate "long press."
- **GSAP transform alias only**: `scale`. Never tween `width` / `height` / `transform` directly.
- **No `Math.random` / `Date.now`**: Click timing is hard-coded, deterministic.

## Combinations

- Pair with [scale-swap-transition](scale-swap-transition.md) — the incoming CTA receives the press after the morph settles.
- Cursor path: animate the cursor's `x` / `y` to its target position before `CLICK_DOWN_AT`, then the press tween dips its `scale`. The `x` / `y` and `scale` aliases don't overwrite each other.
- Inner content: text inside the button can also receive the same scale tween via `inherit` (CSS) or a separate tween — usually overkill for short presses.

## Examples

- [cta-morph-press.html](../examples/cta-morph-press.html) — "Find out more" CTA button receives a 0.1-intensity press synchronized with the cursor's scale dip.
