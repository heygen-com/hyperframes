---
name: dynamic-content-sequencing
description: Auto-calculate a flat timeline of start/end seconds from script content length and per-item config. Each phrase's duration = `totalChars * charSpeed + hold`. No hardcoded windows — change the script, the timeline reshapes itself. Sequencing lives in one master `onUpdate` reading `tl.time()`.
metadata:
  tags: timeline, sequencing, dynamic, duration, gsap
  adapter: gsap
---

# Dynamic Content Sequencing

Pre-compute a timeline so scenes with longer text naturally get more screen time. No `data-start` / `data-duration` per phrase, no hand-tuned tween offsets — change the script, the boundaries shift automatically.

## HyperFrames vs. Remotion

The Remotion source used `useMemo` to reduce the script into a `[{ startFrame, endFrame, ... }]` array, then did `timeline.find(p => frame >= p.startFrame && frame < p.endFrame)` inside the render function every frame.

HyperFrames has no React lifecycle, so the `useMemo` becomes a plain `const` at script setup. The per-frame `find` moves into a GSAP `onUpdate` that reads `tl.time()`:

```
Remotion: const timeline = useMemo(() => SCRIPT.reduce(...), []);
          const current = timeline.find(p => frame ∈ [p.startFrame, p.endFrame));

HyperFrames: const TIMELINE = SCRIPT.reduce(...);        // setup, runs once
             onUpdate: () => {
               const current = TIMELINE.find(p => tl.time() ∈ [p.startTime, p.endTime));
               // ...write DOM
             };
```

Frames become seconds: `frames / fps`. Everything else is mechanical.

## Core Concept

1. Define a flat data array — content + per-item timing config.
2. Reduce into a timeline with absolute `startTime` / `endTime` (seconds).
3. The master `onUpdate` finds the active entry from `tl.time()` and renders it.

## Basic Pattern

```js
// 1. Script — content + per-item timing
const SCRIPT = [
  { textMain: "Build video with ", textAccent: "HTML", charSpeed: 0.083, hold: 1.0 },
  { textMain: "Seek ", textAccent: "any frame", charSpeed: 0.083, hold: 1.0 },
  { textMain: "Render to ", textAccent: "MP4", charSpeed: 0.083, hold: 2.0 },
];

// 2. Reduce into a flat timeline with absolute seconds. Runs once at setup.
let acc = 0;
const TIMELINE = SCRIPT.map((item) => {
  const totalChars = item.textMain.length + item.textAccent.length;
  const typingDuration = totalChars * item.charSpeed;
  const totalDuration = typingDuration + item.hold;
  const start = acc;
  const end = start + totalDuration;
  acc = end;
  return { ...item, startTime: start, endTime: end, typingDuration };
});
const TOTAL = TIMELINE[TIMELINE.length - 1].endTime;

// 3. Master clock tween — onUpdate finds the active entry and renders.
tl.to(
  { tick: 0 },
  {
    tick: 1,
    duration: TOTAL,
    ease: "none",
    onUpdate: () => {
      const t = tl.time();
      const phrase = TIMELINE.find((p) => t >= p.startTime && t < p.endTime);
      if (!phrase) {
        // Fallback: before first phrase or after last
        renderEmpty();
        return;
      }
      const activeT = t - phrase.startTime;
      renderPhrase(phrase, activeT);
    },
  },
  0,
);
```

### `data-duration` and `TOTAL`

The composition root's `data-duration` should be **exactly `TOTAL`** (or a fixed buffer above it). Less truncates the last phrase's hold; more triggers the fallback branch at the end and the user sees a blank stage with a blinking cursor.

```html
<div id="root" data-composition-id="main" data-start="0" data-duration="7.5"></div>
```

In a real composition compute `data-duration` at build/preview time from the script — easier said than done since it's static HTML. The practical pattern: compute `TOTAL` once, hard-code it into both the `data-duration` attribute and the tween's `duration`. The lint will catch a mismatch.

## Relative Time is Non-Negotiable

`activeT = tl.time() - phrase.startTime` is the _local_ time within the phrase. Pass this to whatever character-slicing logic you use — never `tl.time()` itself.

If you forget the subtraction:

- Phrase 1 (startTime=0) renders correctly.
- Phrase 2 (startTime=2.74) receives `t = 2.74` on its first frame → `charIdx = Math.floor(2.74 / 0.083) = 33` → 33 characters already typed → phrase appears finished instantly.

This is the single most common bug when porting frame-based render code to the seconds-based onUpdate idiom. **`activeT`, not `t`.**

## Find Performance: Linear Scan vs Binary Search

`TIMELINE.find` is O(N). For typical scenes (3–10 phrases) this is fine — the onUpdate fires every animation frame, but a 10-element scan is ~10 ns. If you ever go beyond ~50 phrases, switch to a cached "last hit" pointer:

```js
let lastIdx = 0;
function findPhrase(t) {
  // Most frames the same phrase is still active — try it first.
  if (t >= TIMELINE[lastIdx].startTime && t < TIMELINE[lastIdx].endTime) {
    return TIMELINE[lastIdx];
  }
  // Otherwise scan. (Bidirectional for seek-jump safety.)
  for (let i = 0; i < TIMELINE.length; i++) {
    if (t >= TIMELINE[i].startTime && t < TIMELINE[i].endTime) {
      lastIdx = i;
      return TIMELINE[i];
    }
  }
  return null;
}
```

The bidirectional scan is important for HyperFrames specifically — when the user scrubs the preview backward, the cached `lastIdx` may point past `t`.

## Variations

### Cross-Dissolve Between Phrases

Default is a hard cut. For a 0.2 s cross-dissolve, broaden the `find` condition so two phrases overlap at the boundary:

```js
const FADE = 0.2;
const phrase = TIMELINE.find((p) => t >= p.startTime - FADE && t < p.endTime);
```

This makes phrase N+1 "active" for the last 0.2 s of phrase N. In `renderPhrase`, compute a cross-fade opacity:

```js
const fadeOpacity = Math.min(1, (t - phrase.startTime + FADE) / FADE);
```

Apply to one of two parallel DOM elements (one per phrase) — you can't cross-fade a single shared element.

### Per-Phrase Hold-Then-Type vs Type-Then-Hold

Source order is `type → hold`. To flip to `hold → type` (a deliberate pause before the line types), add a `delay` field:

```js
{ textMain: "...", textAccent: "...", charSpeed: 0.083, delay: 0.5, hold: 1.0 },
```

Then `totalDuration = delay + typingDuration + hold` and `activeT_for_typing = activeT - phrase.delay`.

### Parallel Tracks

This pattern is sequential by design. For two parallel text rivers (one typing top, one typing bottom), maintain two timelines and two master `onUpdate`s — or one onUpdate that computes both phrases' state from the same `t` and writes to two element pairs.

## Critical Constraints

- **`TIMELINE` is `const` at setup, not inside a tween** — recomputing per frame defeats the purpose.
- **Seconds, not frames** — `charSpeed: 0.083`, not `charSpeed: 2.5`. If you're translating frame values, divide by `fps`.
- **Pass `activeT = tl.time() - phrase.startTime`** to renderers, not raw `tl.time()`.
- **`data-duration` ≥ `TOTAL`** — otherwise the last phrase truncates.
- **Last phrase's `hold` is the closing beat** — typically 1.5–2× the intermediate holds. The eye expects breathing room before the cut to black.
- **Linear scan is fine until ~50 entries** — past that, cache `lastIdx` with bidirectional fallback for seek safety.
- **Hard cuts by default** — if you need cross-dissolves, two DOM elements and overlapping `find` windows; never try to cross-fade `textContent`.
- **No `Math.random` / `Date.now`** — the timeline reduce is deterministic and the find is pure.

## Combinations

- [context-sensitive-cursor](context-sensitive-cursor.md) — the canonical typing renderer that consumes each `phrase` + `activeT`.
- [discrete-text-sequence](discrete-text-sequence.md) — alternative renderer for non-linear typing (typos, pauses); plug into the same dynamic-sequencing harness.
- [vertical-spring-ticker](vertical-spring-ticker.md) — for animated word transitions between phrases instead of hard cuts.

## Examples

- [messaging-multi-phrase.html](../examples/messaging-multi-phrase.html) — three-phrase script sequenced from content length, no hardcoded windows. Master `onUpdate` reads `tl.time()`, finds the active phrase, computes `activeT`, slices characters, and writes both text and cursor color/blink.
