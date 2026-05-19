---
name: counting-dynamic-scale
description: Counter animation where font size grows with the counting value, creating escalating visual weight.
metadata:
  tags: counter, counting, scale, font-size, number, dynamic, emphasis
---

# Counting with Dynamic Scale

A number counts from A → B while its font size simultaneously grows, creating escalating visual weight that reinforces magnitude.

## How It Works

A single eased timeline drives **two synchronized properties**:

1. The numeric value (rendered as DOM text via `onUpdate`)
2. The font size (tweened from `startSize` → `endSize`)

As the number gets bigger, the text gets larger — visually communicating "this is impressive."

## Easing

Pick by drama desired:

| GSAP ease    | Effect                                        |
| ------------ | --------------------------------------------- |
| `power1.out` | Mild — slight deceleration                    |
| `power2.out` | Default — ease-out, fast start slow end       |
| `power3.out` | Strong — dramatic deceleration ⭐ recommended |
| `expo.out`   | Very dramatic — almost stops at the end       |

`power3.out` matches the opus `easePower: 2.5` recommendation — number rushes up then slows dramatically at the peak.

## HTML

```html
<div
  class="scene"
  id="counter-scene"
  data-composition-id="counter-scene"
  data-start="0"
  data-duration="3"
  data-track-index="0"
>
  <div class="counter-wrap">
    <span class="counter" id="counter">0</span><span class="counter-suffix">+</span>
  </div>
  <div class="counter-label">developers shipped this month</div>
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
  background: #0b0d1f;
}

.counter-wrap {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
  /* Fixed-width container prevents layout shift as digit count changes */
  width: 800px;
  text-align: center;
}

.counter {
  font-family: "Inter", sans-serif;
  font-weight: 900;
  color: #f5f6fb;
  /* MANDATORY — tabular-nums keeps digits the same width */
  font-variant-numeric: tabular-nums;
  /* Initial font-size; GSAP will tween this */
  font-size: 120px;
  letter-spacing: -2px;
  line-height: 1;
}

.counter-suffix {
  font-family: "Inter", sans-serif;
  font-weight: 800;
  color: #a78bfa;
  font-size: 80px;
  opacity: 0;
  transform: translateY(20px);
}

.counter-label {
  margin-top: 24px;
  font-family: "Inter", sans-serif;
  font-size: 24px;
  color: #a7adc6;
  text-align: center;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  const counter = document.getElementById("counter");
  const state = { value: 0, fontSize: 120 };
  const targetValue = 5000;
  const targetFontSize = 240;

  // Synchronized count + font-size tween
  tl.to(
    state,
    {
      value: targetValue,
      fontSize: targetFontSize,
      duration: 2.0,
      ease: "power3.out",
      onUpdate: () => {
        counter.textContent = Math.round(state.value).toLocaleString();
        counter.style.fontSize = `${state.fontSize}px`;
      },
    },
    0,
  );

  // Suffix slides in after count completes
  tl.to(
    ".counter-suffix",
    {
      opacity: 1,
      y: 0,
      duration: 0.4,
      ease: "back.out(1.7)",
    },
    2.0,
  );

  // Label fades in early
  tl.from(
    ".counter-label",
    {
      opacity: 0,
      y: 12,
      duration: 0.5,
      ease: "power2.out",
    },
    0.4,
  );

  window.__timelines["counter-scene"] = tl;
</script>
```

## Variations

### 3D depth entry

Combine with `translateZ` for parallax-style depth on entry:

```js
tl.from(
  ".counter",
  {
    z: -300,
    duration: 0.6,
    ease: "power2.out",
    // requires parent or .counter itself to have perspective set
  },
  0,
);
```

CSS prerequisite:

```css
.counter-wrap {
  perspective: 1000px;
}
.counter {
  transform-style: preserve-3d;
}
```

### Multi-stat coordinated reveal

For 3 stats counting in parallel, share the SAME ease and duration so they finish together — visually a chord, not arpeggio:

```js
["#stat1", "#stat2", "#stat3"].forEach((sel, i) => {
  const obj = { v: 0 };
  tl.to(
    obj,
    {
      v: targets[i],
      duration: 2.0,
      ease: "power3.out",
      onUpdate: () => (document.querySelector(sel).textContent = Math.round(obj.v)),
    },
    0,
  ); // same start position — chord
});
```

## Key Principles

- **Synchronized value + size in ONE tween** so they share an ease and stay coordinated
- **`font-variant-numeric: tabular-nums` is mandatory** — without it "9" → "90" → "100" causes visible jitter as monospace-width breaks
- **Fixed-width container** as belt-and-suspenders (overflow:hidden + width:N) — even with tabular-nums, glyph shape changes can shift baselines
- **Grow in place, don't bounce** — the number should feel weighty, not springy. `power3.out` ends at exact value; `back.out` overshoots and feels cartoonish
- **Start small enough to grow noticeably** (~50% of final size); end large enough to feel decisive but not clip viewport
- **Suffix animates AFTER the count, not during** — gives the number its own beat
- **❗ Label is BIG TEXT, not a page-style tiny caption** — for VIDEO, a 32px paragraph-style caption below a 320px number reads as visual noise (the eye glides past it). Use 56-96px uppercase + tracking for the label so the layout is "two-line big-text" (big number + big label). The label is part of the headline, not a footer.

## Critical Constraints

- **`tabular-nums` mandatory** — required CSS for layout stability
- **Timeline must be paused**: `gsap.timeline({ paused: true })`. Never `tl.play()`
- **Registry key = `data-composition-id`**: `window.__timelines["counter-scene"]` must match scene root
- **`onUpdate` mutates DOM**: HF runtime seeks the timeline frame-by-frame, so `onUpdate` runs on every seek call. Keep `onUpdate` work O(1) — set text + font-size, no DOM creation
- **`Math.round` not `Math.floor`** — half-way through 4999.5 should display "5000" briefly, not "4999"
- **Avoid `back.out` / `elastic.out`** for the counter itself — overshoot makes the number look unstable (it's data, not decoration)

## Combinations

- [svg-path-draw.md](svg-path-draw.md) — for icons drawing in around the number
- [center-outward-expansion.md](center-outward-expansion.md) — for related icons exploding outward synced to count peak

## Pairs with HF skills

- `/hyperframes-gsap` — timeline + `onUpdate` API
- `/hyperframes-core` — composition wiring, `data-*` attributes
- `/hyperframes-cli` — `hyperframes lint` to verify scene
