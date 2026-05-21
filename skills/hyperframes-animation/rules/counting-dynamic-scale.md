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
2. The font size (tweened from `START_SIZE` → `END_SIZE`)

As the number gets bigger, the text gets larger — visually communicating "this is impressive."

## Easing

Pick by drama desired (the choice is discrete; coefficient is implicit):

| GSAP ease    | Effect                                        |
| ------------ | --------------------------------------------- |
| `power1.out` | Mild — slight deceleration                    |
| `power2.out` | Default — ease-out, fast start slow end       |
| `power3.out` | Strong — dramatic deceleration ⭐ recommended |
| `expo.out`   | Very dramatic — almost stops at the end       |

`power3.out` matches the polynomial `1 - (1-x)^k` family at k ≈ 2.5 — number rushes up then slows dramatically at the peak.

## HTML

```html
<div
  class="scene"
  data-composition-id="counter-scene"
  data-start="0"
  data-duration="3"
  data-track-index="0"
>
  <div class="counter-wrap">
    <span class="counter" id="counter">0</span><span class="counter-suffix">{suffix}</span>
  </div>
  <div class="counter-label">{label}</div>
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

.counter-wrap {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
  /* Fixed-width container prevents layout shift as digit count changes */
  width: {counterContainerWidth};
  text-align: center;
}

.counter {
  font-family: {font};
  font-weight: 900;
  color: {textColor};
  /* MANDATORY — tabular-nums keeps digits the same width */
  font-variant-numeric: tabular-nums;
  /* Initial font-size; GSAP will tween this */
  font-size: {startSize};
  letter-spacing: -2px;
  line-height: 1;
}

.counter-suffix {
  font-family: {font};
  font-weight: 800;
  color: {accentColor};
  font-size: {suffixSize};
  opacity: 0;
  transform: translateY(20px);
}

.counter-label {
  margin-top: 24px;
  font-family: {font};
  font-size: {labelSize};
  color: {mutedTextColor};
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
  const state = { value: 0, fontSize: START_SIZE };

  // Synchronized count + font-size tween
  tl.to(
    state,
    {
      value: TARGET_VALUE,
      fontSize: END_SIZE,
      duration: COUNT_DUR,
      ease: COUNT_EASE,
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
      duration: SUFFIX_DUR,
      ease: `back.out(${SUFFIX_BOUNCE_FACTOR})`,
    },
    COUNT_DUR,
  );

  // Label fades in early
  tl.from(
    ".counter-label",
    {
      opacity: 0,
      y: 12,
      duration: LABEL_DUR,
      ease: "power2.out",
    },
    LABEL_AT,
  );

  window.__timelines["counter-scene"] = tl;
</script>
```

## How to Choose Values

- **TARGET_VALUE** — the number the counter lands on
  - Effects: 2–3 digits reads best at hero size; 4+ digits requires wider container
  - Constraints: must fit horizontally at END_SIZE inside the container

- **START_SIZE / END_SIZE** — initial and final font size
  - Range: START_SIZE ≈ 40–60 % of END_SIZE
  - Effects: smaller START_SIZE = more dramatic growth; larger = subtler
  - Constraints: END_SIZE × digit count must fit the container width without clipping

- **COUNT_DUR** — count + scale tween duration
  - Range: 1.2–2.5 s
  - Effects: shorter = aggressive; longer = settled, gives reading time
  - Constraints: must allow the eye to read the digits scrolling past; below ~0.8 s reads as a flash

- **COUNT_EASE** — shared ease for value AND font-size
  - Discrete choice: `power2.out`, `power3.out`, `expo.out` (see table above)
  - Constraint: avoid `back.out` / `elastic.out` — overshoot reads as unstable data

- **SUFFIX_DUR** — duration of the suffix slide-in
  - Range: 0.3–0.6 s
  - Effects: shorter = snap; longer = floats
  - Constraints: must fire after the count lands (started at COUNT_DUR), not during

- **SUFFIX_BOUNCE_FACTOR** — back.out coefficient on the suffix entry
  - Range: 1.4–2.0
  - Effects: 1.4 = small overshoot; 2.0 = bouncy

- **LABEL_AT / LABEL_DUR** — when and how long the label fades in
  - Range: LABEL_AT < COUNT_DUR / 2 (label arrives before count peaks); LABEL_DUR 0.4–0.7 s

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
      v: TARGETS[i],
      duration: COUNT_DUR,
      ease: COUNT_EASE,
      onUpdate: () => (document.querySelector(sel).textContent = Math.round(obj.v)),
    },
    0,
  ); // same start position — chord
});
```

## Key Principles

- **Synchronized value + size in ONE tween** so they share an ease and stay coordinated
- **`font-variant-numeric: tabular-nums` is mandatory** — without it digit-count transitions (e.g. 9 → 10 → 100) cause visible jitter as glyph widths change
- **Fixed-width container** as belt-and-suspenders — even with tabular-nums, glyph shape changes can shift baselines
- **Grow in place, don't bounce** — the number should feel weighty, not springy. `power3.out` ends at exact value; `back.out` overshoots and feels cartoonish
- **Start small enough to grow noticeably** (~50 % of final size); end large enough to feel decisive but not clip viewport
- **Suffix animates AFTER the count, not during** — gives the number its own beat
- **❗ Label is BIG TEXT, not a page-style tiny caption** — for VIDEO, a small paragraph-style caption below a hero-size number reads as visual noise. Use display-size, uppercase, tracked label so the layout is "two-line big-text"; the label is part of the headline, not a footer.

## Critical Constraints

- **`tabular-nums` mandatory** — required CSS for layout stability
- **Timeline must be paused**: `gsap.timeline({ paused: true })`. Never `tl.play()`
- **Registry key = `data-composition-id`**: `window.__timelines["counter-scene"]` must match scene root
- **`onUpdate` mutates DOM**: HF runtime seeks the timeline frame-by-frame, so `onUpdate` runs on every seek call. Keep `onUpdate` work O(1) — set text + font-size, no DOM creation
- **`Math.round` not `Math.floor`** — half-way through the final integer should display the final value briefly, not the previous one
- **Avoid `back.out` / `elastic.out`** for the counter itself — overshoot makes the number look unstable (it's data, not decoration)

## Combinations

- [svg-path-draw.md](svg-path-draw.md) — icons drawing in around the number
- [center-outward-expansion.md](center-outward-expansion.md) — related icons exploding outward synced to count peak

## Pairs with HF skills

- `/hyperframes-animation` — timeline + `onUpdate` API
- `/hyperframes-core` — composition wiring, `data-*` attributes
- `/hyperframes-cli` — `hyperframes lint` to verify scene
