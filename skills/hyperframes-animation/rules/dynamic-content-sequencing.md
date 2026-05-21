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
  data-duration="{DURATION}"
  data-track-index="0"
>
  <div class="display">
    <div class="eyebrow" id="eyebrow">{eyebrow}</div>
    <div class="title" id="title"></div>
    <div class="body" id="body"></div>
    <div class="progress-bar"><div class="progress-fill" id="progress-fill"></div></div>
  </div>
  <div class="brand">— {Brand}</div>
</div>
```

## CSS

Placeholders: `{font}` is the project sans-serif stack; `{bgColor1}`/`{bgColor2}` make the dark backdrop gradient; `{accentColor}` highlights the eyebrow / brand / progress fill; `{textColor}` is the primary readable foreground.

```css
.scene {
  position: relative;
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: radial-gradient(ellipse at center, {bgColor1} 0%, {bgColor2} 70%);
  font-family: {font};
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
  color: {accentColor};
  text-transform: uppercase;
}
.title {
  font-size: 120px;
  font-weight: 900;
  letter-spacing: -2px;
  line-height: 1;
  color: {textColor};
}
.body {
  font-size: 48px;
  font-weight: 500;
  line-height: 1.4;
  color: {accentColor};
  opacity: 0.9;
  min-height: 160px; /* reserve space so layout doesn't jump */
}
.progress-bar {
  width: 600px;
  height: 4px;
  background: {accentColor}26; /* ~15% alpha */
  border-radius: 2px;
  margin-top: 16px;
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, {accentColor} 0%, {accentColor2} 100%);
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
  color: {accentColor};
}
```

## GSAP Timeline

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  // Content array — N entries, each with its own pacing config.
  // Shape: short eyebrow label, short title, longer body sentence, plus per-entry pacing.
  // The final entry typically uses a larger `hold` (closing beat).
  const CONTENT = [
    {
      eyebrow: "{eyebrow1}",
      title: "{title1}",
      body: "{body1}",
      speedFactor: SPEED_FACTOR,
      hold: HOLD_MID,
    },
    {
      eyebrow: "{eyebrow2}",
      title: "{title2}",
      body: "{body2}",
      speedFactor: SPEED_FACTOR,
      hold: HOLD_MID,
    },
    // …
    {
      eyebrow: "{eyebrowN}",
      title: "{titleN}",
      body: "{bodyN}",
      speedFactor: SPEED_FACTOR,
      hold: HOLD_FINAL,
    },
  ];

  // Pre-compute absolute start times.
  // Duration per entry: BASE_DURATION + body.length * SEC_PER_CHAR + entry.hold seconds.
  // BASE_DURATION, SEC_PER_CHAR documented in How to Choose Values.
  let cumulative = 0;
  const TIMELINE = CONTENT.map((entry) => {
    const dur = BASE_DURATION + entry.body.length * SEC_PER_CHAR + entry.hold;
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

  const TOTAL_DURATION = cumulative + TAIL_PAD;
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
- **Per-item duration formula: `BASE_DURATION + body.length × SEC_PER_CHAR + hold`** — longer text needs more reading time. The formula is the load-bearing teaching of this rule; ranges for each const are in How to Choose Values.
- **Reserve `min-height` on body element** — content height varies per item; without reservation, layout jumps and downstream elements (progress bar, brand) jitter.
- **DOM update on transition, not every frame** — track `lastTitle` (or whatever key) and only call `textContent =` when it changes. Per-frame textContent assignment causes flicker in HF render.
- **Optional progress indicator** — a thin bar at the bottom showing 0-100% completes the "this is a sequence" framing.
- **Climax dwell longer than mid-sequence dwell** — the outro's `hold` (HOLD_FINAL) should exceed the in-sequence `hold` (HOLD_MID) so the final brand/CTA lands.

## How to Choose Values

- **BASE_DURATION** — minimum visible time of an entry regardless of content length
  - Range: 0.6-1.5 s
  - Effects: low end snaps through short entries too fast for the eye; high end stalls on short titles
  - Constraints: ensures even one-word entries have time to read
  - Reference: see `examples/messaging-multi-phrase.html` (and any blueprint that uses this rule)

- **SEC_PER_CHAR** — extra time added per body character
  - Range: 0.03-0.06 s/char (≈ 17-33 chars/sec read pace for video)
  - Effects: low end feels rushed for paragraph-style bodies; high end feels slow when bodies are short
  - Constraints: should be uniform across the sequence so the pace reads as one engine; for languages with wider characters, lean to the high end
  - Reference: see `examples/messaging-multi-phrase.html` (and any blueprint that uses this rule)

- **HOLD_MID** — dwell after the typing of a non-final entry completes
  - Range: 0.5-1.0 s
  - Effects: low end feels rushed; high end feels lazy
  - Constraints: `HOLD_MID < HOLD_FINAL`
  - Reference: see `examples/messaging-multi-phrase.html` (and any blueprint that uses this rule)

- **HOLD_FINAL** — dwell on the last entry (outro / climax)
  - Range: 1.0-2.0 s
  - Effects: low end truncates the closing beat; high end overstays
  - Constraints: must exceed HOLD_MID by a clear margin so the close reads as a beat, not another mid-sequence pause
  - Reference: see `examples/messaging-multi-phrase.html` (and any blueprint that uses this rule)

- **SPEED_FACTOR** — per-entry pacing multiplier
  - Range: 0.5-2.0 (default 1.0)
  - Effects: <1 stretches an entry's body-driven duration (good for high-density passages); >1 compresses it
  - Constraints: discrete choice — use 1.0 unless one entry needs special pacing; if every entry uses the same factor, fold it into SEC_PER_CHAR instead
  - Reference: see `examples/messaging-multi-phrase.html` (and any blueprint that uses this rule)

- **TAIL_PAD** — seconds added to `TOTAL_DURATION` after the last entry's `end`
  - Range: 0.0-1.0 s
  - Effects: 0 ends the driver exactly at the last `hold` completion; >0 leaves a quiet beat (useful before a transition to the next composition)
  - Constraints: if downstream is another composition, prefer 0 and handle the breath at the composition seam
  - Reference: see `examples/messaging-multi-phrase.html` (and any blueprint that uses this rule)

- **CONTENT length (N)** — number of entries in the sequence
  - Range: 3-6 entries
  - Effects: <3 isn't a sequence (use a static scene); >6 drags
  - Constraints: each entry's `title` must fit one line at the chosen `.title` fontSize; bodies should fit within `min-height` after wrapping
  - Reference: see `examples/messaging-multi-phrase.html` (and any blueprint that uses this rule)

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

- `/hyperframes-animation` — single driver, reverse-search dispatch
- `/hyperframes-core` — composition wiring
- `/hyperframes-cli` — `hyperframes lint`
