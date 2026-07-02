---
name: stat-bars-and-fills
description: Data-viz primitives that pair a number with a graphic — growth bars (CSS scaleY stagger), a progress fill (bar or ring), and a partial star-rating wipe. Seek-safe, deterministic.
metadata:
  tags: data, stats, chart, bars, progress, ring, stars, rating, infographic, number
---

# Stat Bars & Fills

The graphics that give a stat **visual weight** beside its number: a small bar chart, a progress bar/ring filling to a percentage, or a star row filling to a fractional rating. Pair these with [counting-dynamic-scale.md](counting-dynamic-scale.md) (the number) for a complete stat scene.

**Layout blueprint — pick ONE and hold it across all stats:**

- **Single-focus** — one centered frame, the number is the hero, a ring or bar sits under/around it. Cleanest for a sequential reveal (stat 1 → stat 2 → stat 3 in the same frame).
- **Split-frame** — big number on the left, paired graphic on the right. Better when stats are shown together or each needs a distinct visual.

Don't mix blueprints between stats in one piece — that reads as inconsistent.

## 1 — Growth Bars (CSS `scaleY` stagger)

Bars grow from the baseline with a stagger; the last bar is the accent.

```css
.bars {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  height: 280px;
}
.bar {
  width: 48px;
  background: #3a4a64;
  transform: scaleY(0);
  transform-origin: bottom center; /* grow UP from the baseline, not from center */
}
.bar:last-child {
  background: #ffc300;
} /* accent the final/current bar */
```

```js
// Heights are authored in CSS (e.g. inline height per bar); GSAP only reveals scaleY 0→1.
tl.to(".bar", { scaleY: 1, duration: 0.7, ease: "power3.out", stagger: 0.08 }, 0.3);
```

> Use `scaleY` (a transform), never animate `height` — height tweens are forbidden by the runtime. Set each bar's final height in CSS, scale from 0.

## 2 — Progress Fill

**Bar form** — `scaleX` from a left origin:

```css
.track {
  width: 520px;
  height: 16px;
  background: #1b263b;
  border-radius: 8px;
  overflow: hidden;
}
/* width:100% is REQUIRED — an absolutely-positioned fill with no width is 0px, and scaleX of 0 is
   still 0 → the bar renders invisible (and no lint/inspect check catches a zero-width scaled element). */
.fill {
  width: 100%;
  height: 100%;
  background: #ffc300;
  transform: scaleX(0);
  transform-origin: left center;
}
```

```js
const PCT = 0.92; // 92%
tl.to(".fill", { scaleX: PCT, duration: 1.0, ease: "power2.out" }, 0.3);
```

**Ring form** — measured stroke draw (delegates to [svg-path-draw.md](svg-path-draw.md)):

```js
const ring = document.querySelector("#ring");
const LEN = ring.getTotalLength(); // measure, don't hard-code the circumference
ring.style.strokeDasharray = LEN;
ring.style.strokeDashoffset = LEN; // empty
// rotate the <circle> -90deg in CSS so the fill starts at 12 o'clock
tl.to(ring, { strokeDashoffset: LEN * (1 - 0.92), duration: 1.1, ease: "power2.out" }, 0.3);
```

## 3 — Star-Rating Fill (fractional)

A gold star row revealed left-to-right to a fractional value (e.g. 4.6 / 5) via a clip wipe over a gold layer sitting on a gray layer.

```html
<div class="stars">
  <div class="stars-gray">★★★★★</div>
  <div class="stars-gold" id="goldStars">★★★★★</div>
</div>
```

```css
.stars {
  position: relative;
  font-size: 64px;
  letter-spacing: 8px;
}
.stars-gray {
  color: #2b3548;
}
.stars-gold {
  position: absolute;
  inset: 0;
  color: #ffc300;
  width: 100%;
  clip-path: inset(0 100% 0 0);
}
```

```js
const RATING = 4.6,
  MAX = 5;
tl.to(
  "#goldStars",
  { clipPath: `inset(0 ${100 - (RATING / MAX) * 100}% 0 0)`, duration: 1.0, ease: "power2.out" },
  0.3,
);
```

## How to Choose Values

- **Bar count** — 4–6 reads as "a trend" without clutter; the last bar is the current/accent value.
- **Fill duration** — 0.8–1.2s, matched to the paired count-up so number and graphic land together (share the ease).
- **Accent hue** — exactly one; bars/fill/stars all use the same accent, the rest is muted.
- **Stagger** — 0.06–0.1s on bars; larger feels sluggish, 0 loses the build.

## Key Principles

- **Transforms only** — `scaleY` / `scaleX` / `clipPath`, never `width`/`height` tweens (runtime-forbidden).
- **Match the number's timing** — the fill and the count-up should peak together (same start + ease), so the stat resolves as one beat, not two.
- **Measure, don't hard-code** — ring length via `getTotalLength()`; a hard-coded circumference breaks if the radius changes.
- **One accent hue, consistent blueprint** — see `hyperframes-creative/references/data-in-motion.md`.

## Critical Constraints

- **Timeline paused**; build synchronously; registry key = `data-composition-id`.
- **`onUpdate` (if pairing a counter) must be O(1)** — the runtime seeks frame-by-frame (see [counting-dynamic-scale.md](counting-dynamic-scale.md)).
- **No `height`/`width` tweens, no `repeat: -1`** — transforms + finite repeats only.
- **`transform-origin`** must be `bottom` (bars grow up) / `left` (bars/fills grow right) — default center origin scales from the middle and looks wrong.

## Combinations

- [counting-dynamic-scale.md](counting-dynamic-scale.md) — the number beside the graphic (pair them; same ease/duration)
- [svg-path-draw.md](svg-path-draw.md) — the progress-ring draw mechanics

## Pairs with HF skills

- `/hyperframes-animation` — timeline + transform tweens
- `/hyperframes-creative` — `references/data-in-motion.md` (stat layout + visual weight)
- `/hyperframes-core` — composition wiring; the no-`width`/`height`-tween rule
