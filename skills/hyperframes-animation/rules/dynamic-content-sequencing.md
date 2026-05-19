---
name: dynamic-content-sequencing
description: Auto-calculate timeline start/end times from content length + per-item duration config — longer content gets more screen time without hardcoded numbers.
metadata:
  tags: timeline, sequencing, dynamic, duration, content-aware, utility
---

# Dynamic Content Sequencing

A utility pattern (not a motion rule in itself) for scenes that show a SEQUENCE of items (cards, phrases, stats). Each item's duration is calculated from its content length + a per-item config; the sequencer assigns absolute start/end times automatically. Distinct from [discrete-text-sequence](discrete-text-sequence.md) (which is one text element changing states) — this rule swaps between distinct content blocks.

## How It Works

1. Define a content array — each entry has `{ text, speedFactor, hold }` (or arbitrary fields)
2. Pre-compute absolute start times: `start[i] = sum of durations 0..i-1`
3. In onUpdate, find which entry is active (last entry whose `start ≤ time`) and render it

The "dynamic" part: items with longer text get more screen time (formula: `baseDuration + textLength * msPerChar`). No hardcoded `from` / `durationInFrames` per item.

## HTML

```html
<div
  class="scene"
  id="seq-scene"
  data-composition-id="seq-scene"
  data-start="0"
  data-duration="8"
  data-track-index="0"
>
  <div class="display">
    <div class="eyebrow" id="eyebrow">CHAPTER</div>
    <div class="title" id="title"></div>
    <div class="body" id="body"></div>
    <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
  </div>
  <div class="brand">— HEYGENVERSE</div>
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
  background: radial-gradient(ellipse at center, #161a3a 0%, #0b0d1f 70%);
  font-family: "Inter", sans-serif;
}
.display {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  text-align: center;
  max-width: 1400px;
}
.eyebrow {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: 14px;
  color: #cdb8ff;
  text-transform: uppercase;
}
.title {
  font-size: 120px;
  font-weight: 900;
  letter-spacing: -2px;
  line-height: 1;
  color: #f5f6fb;
}
.body {
  font-size: 48px;
  font-weight: 500;
  line-height: 1.4;
  color: #cdb8ff;
  opacity: 0.9;
  min-height: 160px; /* reserve space so layout doesn't jump */
}
.progress-bar {
  width: 600px;
  height: 4px;
  background: rgba(167, 139, 250, 0.15);
  border-radius: 2px;
  margin-top: 16px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #a78bfa 0%, #ec4899 100%);
  width: 0%;
}
.brand {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 32px;
  font-weight: 900;
  letter-spacing: 12px;
  color: #a78bfa;
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Content array — each entry has its own pacing config
  const CONTENT = [
    {
      eyebrow: "CHAPTER 1",
      title: "IDEA",
      body: "A spark. A direction.",
      speedFactor: 1.0,
      hold: 0.6,
    },
    {
      eyebrow: "CHAPTER 2",
      title: "BUILD",
      body: "Prototype. Iterate. Refine.",
      speedFactor: 1.0,
      hold: 0.6,
    },
    {
      eyebrow: "CHAPTER 3",
      title: "SHIP",
      body: "Render. Publish. Share with the world via HEYGENVERSE.",
      speedFactor: 1.0,
      hold: 1.0,
    },
    {
      eyebrow: "OUTRO",
      title: "HEYGENVERSE",
      body: "Video. In one prompt.",
      speedFactor: 1.0,
      hold: 1.5,
    },
  ];

  // Pre-compute absolute start times
  // Duration per entry: base 1.0s + 0.04s per character of body + hold seconds
  const BASE_DURATION = 1.0;
  const MS_PER_CHAR = 0.04;
  let cumulative = 0;
  const TIMELINE = CONTENT.map((entry) => {
    const dur = BASE_DURATION + entry.body.length * MS_PER_CHAR + entry.hold;
    const start = cumulative;
    cumulative += dur;
    return { ...entry, start, end: cumulative };
  });

  // Reverse-search current entry
  function entryAt(time) {
    for (let i = TIMELINE.length - 1; i >= 0; i--) {
      if (time >= TIMELINE[i].start) return TIMELINE[i];
    }
    return TIMELINE[0];
  }

  const eyebrowEl = document.getElementById("eyebrow");
  const titleEl = document.getElementById("title");
  const bodyEl = document.getElementById("body");
  const progressEl = document.getElementById("progress-fill");

  const TOTAL_DURATION = cumulative + 0.5;
  const driver = { t: 0 };
  let lastTitle = "";

  tl.to(
    driver,
    {
      t: TOTAL_DURATION,
      duration: TOTAL_DURATION,
      ease: "none",
      onUpdate: () => {
        const entry = entryAt(driver.t);
        // Only swap content on transitions (avoid per-frame DOM thrash)
        if (entry.title !== lastTitle) {
          eyebrowEl.textContent = entry.eyebrow;
          titleEl.textContent = entry.title;
          bodyEl.textContent = entry.body;
          lastTitle = entry.title;
        }
        // Progress bar fills 0% → 100% as composition advances
        progressEl.style.width = `${(driver.t / TOTAL_DURATION) * 100}%`;
      },
    },
    0,
  );

  window.__timelines["seq-scene"] = tl;
</script>
```

## Variations

### Crossfade between items (not hard cut)

Add `overlap` to the find function — return BOTH the previous and next entry during the overlap window, render with crossfade opacity:

```js
function activeEntries(time, overlap = 0.3) {
  const result = [];
  TIMELINE.forEach((e) => {
    if (time >= e.start - overlap && time <= e.end + overlap) result.push(e);
  });
  return result;
}
```

Then render the two adjacent entries with computed opacities based on distance from boundary.

### Per-item motion variation

Each entry has its own motion style. Map `entry.style` to one of the existing rules: chapter 1 uses [3d-text-depth-layers](3d-text-depth-layers.md), chapter 2 uses [hacker-flip-3d](hacker-flip-3d.md), chapter 3 uses [counting-dynamic-scale](counting-dynamic-scale.md). The sequencer just orchestrates timing; per-entry rendering uses the appropriate rule.

### Auto-extend composition duration

If you don't know upfront how long the sequence will be (dynamic content count), bind `data-duration` to the computed `TOTAL_DURATION`. Do this in script BEFORE the timeline registers:

```js
document
  .querySelector("[data-composition-id]")
  .setAttribute("data-duration", String(Math.ceil(TOTAL_DURATION)));
```

(Caveat: HF reads `data-duration` at composition load; setting after init may not take effect — author the duration manually based on a rough TOTAL calc.)

## Key Principles

- **Pre-compute timeline once, not per-frame** — building absolute start/end at script init means onUpdate is O(log n) reverse-search, not O(n²).
- **Per-item duration formula: `base + length × msPerChar + hold`** — longer text needs more reading time. 0.03-0.06s per character is a comfortable read pace for video.
- **Hold time between items 0.5-1.5s** — the "dwell" between content beats. Shorter feels rushed; longer feels lazy.
- **Reserve `min-height` on body element** — content height varies per item; without reservation, layout jumps and downstream elements (progress bar, brand) jitter.
- **DOM update on transition, not every frame** — track `lastTitle` (or whatever key) and only call `textContent =` when it changes. Per-frame textContent assignment causes flicker in HF render.
- **Optional progress indicator** — a thin bar at the bottom showing 0-100% completes the "this is a sequence" framing.
- **❗ Climax dwell ≥1s on final entry** — the outro should have hold ≥1.0 so the final brand/CTA reads.

## Critical Constraints

- **Timeline must be paused**: `gsap.timeline({ paused: true })`
- **Registry key = `data-composition-id`**
- **Pre-compute the TIMELINE array** — don't recompute in onUpdate
- **`min-height` on body** for layout stability
- **DOM swap only on entry transition** — use lastTitle/lastKey guard
- **Sequential only** — for parallel tracks, use a different reduction (this rule is sequential)

## Combinations

- [discrete-text-sequence.md](discrete-text-sequence.md) — per-entry typewriter on the body
- [context-sensitive-cursor.md](context-sensitive-cursor.md) — cursor color per chapter segment
- [vertical-spring-ticker.md](vertical-spring-ticker.md) — animated word transitions between items (instead of hard cut)
- [scale-swap-transition.md](scale-swap-transition.md) — visual morph between entries

## Pairs with HF skills

- `/hyperframes-gsap` — single driver, reverse-search dispatch
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
