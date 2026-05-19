---
name: discrete-text-sequence
description: Replace entire text states at time thresholds for non-linear typing — typos, bulk additions, holds, backspaces. GSAP onUpdate-driven and seek-safe in HyperFrames.
metadata:
  tags: text, typing, discrete, threshold, non-linear, gsap
  adapter: gsap
---

# Discrete Text Sequence

Instead of character-by-character typing, replace whole string states at time boundaries. Enables non-linear effects: typos, bulk additions, pauses, backspaces, "thinking" rhythms.

## HyperFrames vs. Remotion

The Remotion version used `frame >= entry.frame` inside a render function evaluated per frame. HyperFrames doesn't have per-frame components — every state must be a pure function of `tl.time()`, evaluated inside a GSAP `onUpdate`.

```
Remotion: frame ≥ entry.frame    (frames as integers)
HyperFrames: tl.time() ≥ entry.t (seconds as floats)
```

The change is mechanical: convert frame numbers to seconds (divide by fps), put the reverse-search inside an `onUpdate` callback that fires whenever the timeline scrubs.

## Core Concept

An array of `{ text, t }` entries, sorted by time. The display element shows the latest entry whose `t` is ≤ current timeline time. Repeating the same `text` at multiple `t` values creates pauses.

Two forms are supported and both are seek-safe in HyperFrames:

- **Form A — `tl.set()` per state.** Emit one `tl.set(textEl, { textContent }, entry.t)` per sequence entry. GSAP records each set at an absolute timeline position; on seek (forward or backward), it recomputes which sets have elapsed and applies them in order. Cheap, declarative, and works because `set` writes the property value as a function of time, not an event side effect.
- **Form B — single `onUpdate` driver.** One `tl.fromTo({}, {}, { onUpdate })` runs a `pickDiscrete(tl.time())` lookup on every frame and writes the chosen string. More CPU per frame, but lets you compose the lookup with other per-frame derivations (e.g. cursor color, caret offset).

Prefer Form A when the only output is text content. Prefer Form B when the text choice drives additional per-frame state, or when the sequence is generated from an external source the timeline already references via `onUpdate`.

## Basic Pattern

```html
<div class="discrete-line">
  <span class="discrete-text"></span><span class="discrete-cursor">_</span>
</div>

<style>
  .discrete-line {
    width: 1200px; /* fixed width prevents layout jitter */
    display: flex;
    justify-content: flex-end;
    white-space: nowrap;
    font:
      700 96px/1 Inter,
      system-ui,
      sans-serif;
    color: #fff;
  }
  .discrete-cursor {
    color: #00ff88;
    margin-left: 4px;
    font-weight: 300;
  }
</style>

<script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({ paused: true });

  /* ============================================================
     SEQUENCE — { text, t } entries, sorted ascending.
     Repeat the same text at different t to create pauses.
     ============================================================ */
  const SEQUENCE = [
    { t: 0.0, text: "" },
    { t: 0.5, text: "Tell me how to " },
    { t: 1.2, text: "Tell me how to target parents" },
    { t: 1.4, text: "Tell me how to target parents" }, // ← hold for 0.6s
    { t: 2.0, text: "Tell me how to target parents who" },
    { t: 2.8, text: "Tell me how to target parents who shop online" },
  ];

  // Sort defensively in case the author forgets.
  SEQUENCE.sort((a, b) => a.t - b.t);

  // Pick the latest entry whose t is ≤ now. Linear scan, fine for ≤20 entries.
  function pickDiscrete(now) {
    let chosen = SEQUENCE[0].text;
    for (const entry of SEQUENCE) {
      if (entry.t <= now) chosen = entry.text;
      else break;
    }
    return chosen;
  }

  const textEl = document.querySelector(".discrete-text");

  /* --- Form A: tl.set() per state (preferred for plain text-content swaps) --- */
  for (const entry of SEQUENCE) {
    tl.set(textEl, { textContent: entry.text }, entry.t);
  }

  /* --- Form B: single onUpdate driver (use when you also need per-frame
     derivations alongside the text choice — cursor color, caret position, etc.) ---
  const FIRST_T = SEQUENCE[0].t;
  const LAST_T  = SEQUENCE[SEQUENCE.length - 1].t;

  tl.fromTo({ tick: 0 },
    { tick: 0 },
    {
      tick: 1,
      duration: LAST_T - FIRST_T,
      ease: "none",
      onUpdate: function () {
        const now = tl.time();
        const next = pickDiscrete(now);
        // Avoid touching the DOM if nothing changed (perf + flicker prevention)
        if (textEl.textContent !== next) textEl.textContent = next;
      },
    },
    FIRST_T,
  );
  */

  window.__timelines["main"] = tl;
</script>
```

The brand-reveal example uses Form A — see [`brand-reveal-assemble-zoom.html`](../examples/brand-reveal-assemble-zoom.html) lines around the `SEQUENCE` loop where it emits `tl.set(textEl, { textContent: entry.text }, entry.t)` per entry.

## Variations

### Fixed-Width Container

Prevents the container from re-flowing as the string length changes. Right-justified content (search-bar style):

```html
<div
  class="discrete-line"
  style="
     width: 1200px;
     display: flex; justify-content: flex-end;
     white-space: nowrap; overflow: hidden;"
>
  <span class="discrete-text"></span>
</div>
```

Or center-justified:

```css
.discrete-line {
  justify-content: center;
}
```

For left-justified that grows from the left, use `justify-content: flex-start` and let `overflow: hidden` clip the right edge as the text gets long.

### Smooth Character Slice (Continuous Typing)

For continuous typing without pauses, use a GSAP tween over the character count instead of a discrete sequence. This is the inverse pattern — the displayed text is a _function_ of progress, not a lookup table:

```js
const FULL_TEXT = "Tell me how to target parents";
const TYPE_START = 0.4;
const TYPE_RATE = 0.08; // seconds per character

tl.to(
  { progress: 0 },
  {
    progress: FULL_TEXT.length,
    duration: FULL_TEXT.length * TYPE_RATE,
    ease: "none",
    onUpdate: function () {
      const len = Math.floor(this.targets()[0].progress);
      textEl.textContent = FULL_TEXT.slice(0, len);
    },
  },
  TYPE_START,
);
```

Pick _discrete sequence_ when timing of words matters (synced to narration, intentional pauses). Pick _smooth slice_ when the typing rhythm itself is the effect.

### Typo + Correction

A real-feeling typo + backspace + retype:

```js
const SEQUENCE = [
  { t: 0.0, text: "" },
  { t: 0.5, text: "Hello" },
  { t: 0.8, text: "Hellos" }, // typo lands
  { t: 1.0, text: "Hellos" }, // brief hold
  { t: 1.1, text: "Hello" }, // delete
  { t: 1.3, text: "Hello," }, // correction
  { t: 1.6, text: "Hello, world" },
];
```

The "thinking pause" comes for free from the holds; the backspace is just a string that's shorter than the previous entry.

## Use Cases

- Narration-synced typing where word boundaries matter more than per-character speed
- Dramatic pacing with intentional holds on key words
- Simulated "thinking" with stop-and-go rhythm
- Typo + correction sequences
- Bulk text additions (whole phrases appearing at once)

## Critical Constraints

- **Pick one form per sequence**: Either N `tl.set()` calls (Form A) _or_ one `tl.fromTo({}, ...)` with `onUpdate` (Form B). Both are seek-safe — GSAP's `tl.set()` is positioned at an absolute timeline time and is re-evaluated on every seek, so it does NOT drift on seek-back the way an event callback (`tl.call`, `onComplete`) would. Don't mix the two forms on the same target element; pick whichever fits the surrounding code.
- **Sort the sequence**: Guarantee ascending `t` order. Otherwise `pickDiscrete` returns whichever entry the author wrote last.
- **Avoid touching the DOM if nothing changed**: The `if (textEl.textContent !== next)` guard prevents flicker and tiny GPU/layout costs on every frame.
- **Fixed-width container**: Without it, the container width changes per entry, causing visible jitter when adjacent elements depend on it.
- **No `Math.random()` / `Date.now()`**: Everything must be a pure function of `tl.time()`.
- **Hold-by-repeat**: To pause on a value, repeat it at a later `t`. Don't add an `endT` field — the next entry's `t` already defines when this one ends.

## Combinations

- Wrap the sequence in [coordinate-target-zoom](coordinate-target-zoom.md) when the text needs to be the zoom target after assembly.
- Combine with [camera-cursor-tracking](camera-cursor-tracking.md) — the camera tracks the implied cursor at the _end_ of each discrete text state.
- Pair with a context-sensitive cursor color (different colored cursor per text segment) by reading the same `now` value in a separate onUpdate.

## Examples

- [concept-demo-decode-pan.html](../examples/concept-demo-decode-pan.html) — search-bar typing uses the smooth-slice variation (continuous rhythm). For the discrete-sequence variant see the patterns in this rule.
