---
name: cursor-click-ripple
description: Animated mouse cursor moves to a target, clicks with scale depression on both cursor and target, and emits an expanding ripple from the click point. Move via `back.out(1.3)` GSAP tween; depression via two short tweens (down + recover); ripple via a single `keyframes` tween for the attack/decay envelope.
metadata:
  tags: cursor, click, ripple, interaction, mouse, button, gsap
  adapter: gsap
---

# Cursor Click Ripple

An animated cursor moves to a target element, performs a click (the cursor and the target both visibly depress), and emits one or more expanding ripple rings from the click point. The whole sequence is the user's "action" that drives the next phase of the scene — collapse, swap, navigate, etc.

## HyperFrames vs. Remotion

The Remotion source rendered the cursor conditionally with `{frame >= delay && …}` and computed every transform every frame:

```tsx
const moveProgress = spring({ frame: frame - moveDelay, fps, config });
const cursorX = interpolate(moveProgress, [0, 1], [startX, targetX]);
const isClicking = frame >= clickFrame && frame < clickFrame + clickDuration;
const cursorScale = isClicking ? depressedScale : 1;

{
  frame >= delay + clickDelay && <RippleRing scale={rippleScale} opacity={rippleOpacity} />;
}
```

HyperFrames forbids conditional DOM ("render the cursor only after frame N") and per-frame `frame` reads. So:

| Concern                           | HyperFrames mechanism                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------- |
| Cursor visibility                 | Element exists in DOM from t=0 with `opacity: 0`; revealed by an `opacity: 1` tween at `CURSOR_AT` |
| Move from off-screen to target    | Single `tl.to(".cursor", { x, y, ease: "back.out(1.3)" })`                                         |
| Click depression (down + recover) | Two short sequential tweens — `scale: 1 → 0.85` then `scale: 0.85 → 1`                             |
| Concurrent target depression      | Same two-tween pattern on `.cta-button` at the same timeline position                              |
| Ripple attack-decay-rest envelope | Single `keyframes` tween (or three sequential tweens) for the `0 → peak → 0` opacity arc           |

## Element HTML

```html
<!-- Cursor — sits in DOM at off-screen position with opacity: 0 -->
<div
  class="cursor"
  style="position: absolute; left: 0; top: 0;
     z-index: 999; pointer-events: none; opacity: 0;
     will-change: transform, opacity;"
>
  <svg width="28" height="28" viewBox="0 0 24 24">
    <path d="M5 3L19 12L12 13L9 20L5 3Z" fill="#fff" stroke="#0A0A0F" stroke-width="1.5" />
  </svg>
</div>

<!-- Ripple ring — centered on the click target, hidden until click -->
<div
  class="ripple"
  style="position: absolute; left: 50%; top: 50%;
     width: 120px; height: 120px; margin: -60px 0 0 -60px;
     border: 2px solid rgba(255, 255, 255, 0.7); border-radius: 50%;
     opacity: 0; pointer-events: none; z-index: 6;
     will-change: transform, opacity;"
></div>
```

`pointer-events: none` on both — they're decorative; nothing in the composition should react to them. `z-index: 999` on the cursor keeps it above every other layer; `z-index: 6` on the ripple sits it above the click target but below the cursor.

## Phase 1 — Move

```js
const W = 1920,
  H = 1080;
const CURSOR_START_X = W + 100; // off-screen right
const CURSOR_START_Y = H * 0.85; // bottom-right approach
const CURSOR_TARGET_X = W / 2 + 60; // slightly past CTA center so the arrow visibly overlaps
const CURSOR_TARGET_Y = H / 2;

const CURSOR_AT = 1.5; // when the cursor enters
const CURSOR_MOVE = 0.5; // duration of the slide

// Bake the start position via gsap.set, not via fromTo, so the cursor is at
// CURSOR_START_X / Y from t=0 even though it's invisible.
gsap.set(".cursor", { x: CURSOR_START_X, y: CURSOR_START_Y, opacity: 0 });

// Fade in (very short)
tl.to(".cursor", { opacity: 1, duration: 0.1, ease: "none" }, CURSOR_AT);

// Slide to target
tl.to(
  ".cursor",
  {
    x: CURSOR_TARGET_X,
    y: CURSOR_TARGET_Y,
    duration: CURSOR_MOVE,
    ease: "back.out(1.3)", // spring(stiffness:80, damping:18) — calm settle
  },
  CURSOR_AT,
);
```

### Why `back.out(1.3)` and not `power2.out`

`back.out(1.3)` gives a small overshoot at the end — the cursor visibly overshoots the target by ~5 px then settles. This reads as physical inertia, the same way a real mouse cursor _almost_ always overshoots its target on a long move. `power2.out` lands without overshoot and feels robotic.

For a _very_ short move (< 0.25 s) prefer `power2.out` — short throws don't have time to feel inertial.

## Phase 2 — Click Depression (Cursor + Target)

Two tweens per element: a quick compression, then a spring recovery. The cursor and the target run identical tween shapes at the _same_ timeline position so the eye reads them as one event.

```js
const CLICK_AT = 2.2; // moment of impact

// Cursor: scale down → recover
tl.to(".cursor", { scale: 0.85, duration: 0.08, ease: "power2.out" }, CLICK_AT);
tl.to(".cursor", { scale: 1, duration: 0.18, ease: "back.out(1.6)" }, CLICK_AT + 0.08);

// CTA button: scale down → recover (same shape, slightly milder)
tl.to(".cta-button", { scale: 0.95, duration: 0.08, ease: "power2.out" }, CLICK_AT);
tl.to(".cta-button", { scale: 1, duration: 0.18, ease: "back.out(1.6)" }, CLICK_AT + 0.08);
```

### Why the cursor compresses _more_ than the target

`0.85` cursor vs `0.95` target. The cursor is a small element (28 px) — at scale 0.85 the compression is ~4 px, plenty visible. The target (a 240 px button) at scale 0.85 would compress by ~36 px, which looks like the button is being crushed rather than tapped. Make the depression proportional to the element's visual weight: smaller compression on larger elements.

### Optional: button highlight glow

The Remotion source pulsed a `boxShadow` glow on the button during the click window. In HyperFrames:

```js
tl.fromTo(
  ".cta-button",
  { boxShadow: "0 0 0 rgba(255,255,255,0)" },
  { boxShadow: "0 0 40px rgba(255,255,255,0.7)", duration: 0.2, ease: "power2.out" },
  CLICK_AT,
);
tl.to(
  ".cta-button",
  { boxShadow: "0 0 0 rgba(255,255,255,0)", duration: 0.4, ease: "power2.in" },
  CLICK_AT + 0.2,
);
```

`boxShadow` is a CSS _string_ property — GSAP tweens between two string values by parsing the lengths and colors. This works without any plugins. If you need crisper control over the easing of just the alpha, switch to a CSS custom property (`--glow`) and use a numeric tween instead.

## Phase 3 — Ripple

A single ring expands from `scale: 0.3` to `scale: 5.0` while opacity follows an attack-decay envelope: `0 → 0.7 (at 20% of duration) → 0`. GSAP `keyframes` is the cleanest expression — one tween, no proxies:

```js
tl.to(
  ".ripple",
  {
    duration: 0.7,
    keyframes: {
      "0%": { scale: 0.3, opacity: 0 }, // attack from
      "20%": { opacity: 0.7 }, // peak opacity at 20% of tween
      "100%": { scale: 5.0, opacity: 0 }, // expanded and faded
      easeEach: "power2.out",
    },
  },
  CLICK_AT,
);
```

`easeEach` applies the same ease to each segment. The visual result is: the ring pops in opacity-wise fast (over the first 0.14 s), then expands while fading over the remaining 0.56 s — exactly matching the Remotion source's `interpolate(rippleProgress, [0, 0.2, 1], [0, 0.8, 0])`.

### Alternative: three sequential tweens

If you find the `keyframes` form opaque, the same envelope can be written as three explicit tweens (works without modification on older GSAP versions too):

```js
gsap.set(".ripple", { scale: 0.3, opacity: 0 });

// Scale: 0.3 → 5.0 over the whole 0.7 s
tl.to(".ripple", { scale: 5.0, duration: 0.7, ease: "power2.out" }, CLICK_AT);
// Opacity attack: 0 → 0.7 over 0.14 s
tl.to(".ripple", { opacity: 0.7, duration: 0.14, ease: "none" }, CLICK_AT);
// Opacity decay: 0.7 → 0 over 0.56 s
tl.to(".ripple", { opacity: 0, duration: 0.56, ease: "power2.in" }, CLICK_AT + 0.14);
```

Either form is correct. Pick whichever your team finds more readable.

### Multiple Staggered Rings

For a richer click impact, stack 2–3 rings with phase-offset triggers:

```html
<div class="ripple ripple-1" style="…"></div>
<div class="ripple ripple-2" style="…"></div>
<div class="ripple ripple-3" style="…"></div>
```

```js
[".ripple-1", ".ripple-2", ".ripple-3"].forEach((sel, i) => {
  tl.to(
    sel,
    {
      duration: 0.7,
      keyframes: {
        "0%": { scale: 0.3, opacity: 0 },
        "20%": { opacity: 0.5 }, // lower per-ring peak
        "100%": { scale: 5.0, opacity: 0 },
        easeEach: "power2.out",
      },
    },
    CLICK_AT + i * 0.06,
  ); // 60ms stagger between rings
});
```

Lower per-ring peak opacity (0.5 instead of 0.7) keeps the _aggregate_ brightness similar to one strong ring.

## Phase Timing Reference

```
Phase 1 (move):       CURSOR_AT             → CURSOR_AT + CURSOR_MOVE
Phase 2 (depress):    CLICK_AT              → CLICK_AT + 0.26  (0.08 down + 0.18 up)
Phase 3 (ripple):     CLICK_AT              → CLICK_AT + 0.70
```

Constraints between the phases:

- `CLICK_AT ≥ CURSOR_AT + CURSOR_MOVE + 0.10` — let the cursor visibly settle for ~3 frames before it depresses.
- `CLICK_AT` overlaps Phase 3 — the ripple starts the exact moment the click compresses; the eye reads them as one event.

## Tips

- **Cursor size 24–32 px** — large enough to read at 1920×1080, small enough that the depression doesn't dominate the frame.
- **Light fill + dark stroke on the cursor** — `fill: #fff; stroke: #0A0A0F` works on both light and dark backgrounds. Reversing this (dark fill) makes the cursor disappear over dark UI.
- **Add a `drop-shadow` filter** on the cursor for extra visibility over busy backgrounds: `filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5))`.
- **Cursor offset past target center** — `CURSOR_TARGET_X = CENTER_X + 60` places the cursor _tip_ near the button, not its bounding-box center. The asymmetry reads as "the user clicked the button," not "the cursor stopped at the button's geometric centroid."
- **Ripple max scale 4–6×** — too small and it doesn't feel like a click; too large and it dominates the click target.
- **One ring usually reads enough**, multiples are for emphasis (CTA presses, important decision points).

## Critical Constraints

- **Element exists in DOM from t=0**: Set initial position + `opacity: 0` via `gsap.set` before the timeline runs. No conditional rendering.
- **`pointer-events: none`** on cursor and ripple: decorative, must not interfere with anything else in the scene.
- **`z-index: 999` on the cursor**: always on top. Any element that occludes the cursor during its move (an orbiting icon passing in front, a video element drawn on top) breaks the action's readability.
- **Click depression on cursor _and_ target at the same timeline position**: the causal link. Skipping the target depression makes the click feel uncaused; skipping the cursor depression makes the cursor feel detached.
- **Depression scale proportional to element size**: cursor 0.85, button 0.95. A flat depression value across elements of different sizes looks wrong.
- **GSAP transform aliases only**: `x`, `y`, `scale`, `opacity`. Never `left`/`top`/`width`/`height`. For the ripple's _visual_ radius use `scale`, not a `width`/`height` tween.
- **Ripple duration < ~1.0 s**: longer and the click feels like an explosion; shorter and the ring isn't visible long enough to register.
- **No `Math.random` / `Date.now`**: all motion is a pure function of `tl.time()`.
- **No infinite repeats**: rings have explicit `duration`.

## Combinations

- [cta-orbit-collapse](../blueprints/cta-orbit-collapse.md) — the click drives the orbit-to-collapse pivot.
- [orbit-3d-entry](orbit-3d-entry.md) — orbiting icons must clear the cursor's z-index (cursor stays above).
- [center-outward-expansion](center-outward-expansion.md) — alternative "burst from click point" effect; the ripple is one form of expansion.

## Examples

- [cta-orbit-collapse.html](../examples/cta-orbit-collapse.html) — cursor enters bottom-right, slides to the "Get free clips" button, depresses both cursor and button, and emits a single white ripple that triggers the icon collapse.
