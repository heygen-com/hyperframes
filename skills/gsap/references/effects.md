# GSAP Effects for HyperFrames

Drop-in animation patterns for HyperFrames compositions. Each effect is self-contained with HTML, CSS, and code.

All effects follow HyperFrames composition rules — deterministic, no randomness, timelines registered via `window.__timelines`.

## Table of Contents

- [Typewriter](#typewriter)
- [Audio Visualizer](#audio-visualizer)

---

## Typewriter

Reveal text character by character using GSAP's TextPlugin.

### Required Plugin

```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/TextPlugin.min.js"></script>
<script>
  gsap.registerPlugin(TextPlugin);
</script>
```

### Basic Typewriter

```js
const text = "Hello, world!";
const cps = 10; // chars per second: 3-5 dramatic, 8-12 conversational, 15-20 energetic
tl.to(
  "#typed-text",
  { text: { value: text }, duration: text.length / cps, ease: "none" },
  startTime,
);
```

### With Blinking Cursor

Three rules:

1. **One cursor visible at a time** — hide previous before showing next.
2. **Cursor must blink when idle** — after typing, during pauses.
3. **No gap between text and cursor** — elements must be flush in HTML.

```html
<span id="typed-text"></span><span id="cursor" class="cursor-blink">|</span>
```

```css
@keyframes blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}
.cursor-blink {
  animation: blink 0.8s step-end infinite;
}
.cursor-solid {
  animation: none;
  opacity: 1;
}
.cursor-hide {
  animation: none;
  opacity: 0;
}
```

Pattern: blink → solid (typing starts) → type → solid → blink (typing done).

```js
tl.call(() => cursor.classList.replace("cursor-blink", "cursor-solid"), [], startTime);
tl.to("#typed-text", { text: { value: text }, duration: dur, ease: "none" }, startTime);
tl.call(() => cursor.classList.replace("cursor-solid", "cursor-blink"), [], startTime + dur);
```

### Backspacing

TextPlugin removes from front — wrong for backspace. Use manual substring removal:

```js
function backspace(tl, selector, word, startTime, cps) {
  const el = document.querySelector(selector);
  const interval = 1 / cps;
  for (let i = word.length - 1; i >= 0; i--) {
    tl.call(
      () => {
        el.textContent = word.slice(0, i);
      },
      [],
      startTime + (word.length - i) * interval,
    );
  }
  return word.length * interval;
}
```

### Spacing with Static Text

When a typewriter word sits next to static text, use `margin-left` on a wrapper span. Don't use flex gap (spaces cursor from text) or trailing space in static text (collapses when dynamic is empty).

```html
<div style="display:flex; align-items:baseline;">
  <span style="font-size:40px; color:#555;">Ship something</span>
  <span style="margin-left:14px;"><span id="word"></span><span id="cursor">|</span></span>
</div>
```

### Word Rotation

Type → hold → backspace → next word. Cursor blinks during every idle moment (holds, after backspace).

```js
words.forEach((word, i) => {
  const typeDur = word.length / 10;
  // Solid while typing
  tl.call(() => cursor.classList.replace("cursor-blink", "cursor-solid"), [], offset);
  tl.to("#typed-text", { text: { value: word }, duration: typeDur, ease: "none" }, offset);
  // Blink during hold
  tl.call(() => cursor.classList.replace("cursor-solid", "cursor-blink"), [], offset + typeDur);
  offset += typeDur + 1.5; // hold

  if (i < words.length - 1) {
    tl.call(() => cursor.classList.replace("cursor-blink", "cursor-solid"), [], offset);
    const clearDur = backspace(tl, el, word, offset, 20);
    tl.call(() => cursor.classList.replace("cursor-solid", "cursor-blink"), [], offset + clearDur);
    offset += clearDur + 0.3;
  }
});
```

### Appending Words

Build a sentence word-by-word into the same element:

```js
let accumulated = "";
words.forEach((word) => {
  const target = accumulated + (accumulated ? " " : "") + word;
  const newChars = target.length - accumulated.length;
  tl.to("#typed-text", { text: { value: target }, duration: newChars / 10, ease: "none" }, offset);
  accumulated = target;
  offset += newChars / 10 + 0.3;
});
```

### Multi-Line Cursor Handoff

When handing off between typewriter lines: hide previous → blink new → pause → solid when typing. Never go hidden→solid (skips idle state).

```js
tl.call(
  () => {
    prevCursor.classList.replace("cursor-blink", "cursor-hide");
    nextCursor.classList.replace("cursor-hide", "cursor-blink");
  },
  [],
  handoffTime,
);

const typeStart = handoffTime + 0.5; // brief blink pause
tl.call(() => nextCursor.classList.replace("cursor-blink", "cursor-solid"), [], typeStart);
tl.to("#next-text", { text: { value: text }, duration: dur, ease: "none" }, typeStart);
tl.call(() => nextCursor.classList.replace("cursor-solid", "cursor-blink"), [], typeStart + dur);
```

### Timing Guide

| CPS   | Feel             | Good for                   |
| ----- | ---------------- | -------------------------- |
| 3-5   | Slow, deliberate | Dramatic reveals, suspense |
| 8-12  | Natural typing   | Dialogue, narration        |
| 15-20 | Fast, energetic  | Tech demos, code           |
| 30+   | Near-instant     | Filling long blocks        |

---

## Audio Visualizer

Pre-extract audio data, drive canvas/DOM rendering from GSAP timeline.

### Extract Audio Data

```bash
python scripts/extract-audio-data.py audio.mp3 -o audio-data.json
python scripts/extract-audio-data.py video.mp4 --fps 30 --bands 16 -o audio-data.json
```

Requires ffmpeg and numpy.

### Data Format

```json
{
  "fps": 30, "totalFrames": 5415,
  "frames": [{ "time": 0.0, "rms": 0.42, "bands": [0.8, 0.6, 0.3, ...] }]
}
```

- **rms** (0-1): overall loudness, normalized across track
- **bands[]** (0-1): frequency magnitudes. Index 0 = bass, higher = treble. Each normalized independently.

### Loading the Data

```js
// Option A: inline (small files, under ~500KB)
const AUDIO_DATA = {
  /* paste audio-data.json contents */
};
setupTimeline(AUDIO_DATA);

// Option B: fetch (large files)
fetch("audio-data.json")
  .then((r) => r.json())
  .then((data) => setupTimeline(data));

function setupTimeline(AUDIO_DATA) {
  // IMPORTANT: all tl.call() setup must be inside this callback
  for (let f = 0; f < AUDIO_DATA.totalFrames; f++) {
    tl.call(() => draw(AUDIO_DATA.frames[f]), [], f / AUDIO_DATA.fps);
  }
}
```

With fetch, wrap all timeline setup inside the callback so `AUDIO_DATA` is available.

### Rendering Approaches

**Canvas 2D** (most common — bars, waveforms, circles, gradients):

```js
for (let f = 0; f < AUDIO_DATA.totalFrames; f++) {
  tl.call(
    () => {
      const frame = AUDIO_DATA.frames[f];
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // draw using frame.rms and frame.bands
    },
    [],
    f / AUDIO_DATA.fps,
  );
}
```

**WebGL / Three.js** — HyperFrames patches `THREE.Clock` for deterministic time. Update uniforms from audio data each frame.

**DOM Elements** — fine for < 20 elements, less performant than Canvas for many.

### Spatial Mapping

- **Horizontal**: bass left, treble right (iterate bands left-to-right)
- **Vertical**: bass bottom, treble top
- **Circular**: bass at 12 o'clock, wrap clockwise; mirror for full circle

### Smoothing

```js
let prev = null;
const smoothing = 0.25; // 0.1-0.2 snappy, 0.3-0.5 flowing
function smooth(f) {
  const raw = AUDIO_DATA.frames[f];
  if (!prev) {
    prev = { rms: raw.rms, bands: [...raw.bands] };
    return prev;
  }
  prev = {
    rms: prev.rms * smoothing + raw.rms * (1 - smoothing),
    bands: raw.bands.map((b, i) => prev.bands[i] * smoothing + b * (1 - smoothing)),
  };
  return prev;
}
```

### Motion Principles

- **Bass drives big moves** — scale, glow, position shifts
- **Treble drives detail** — shimmer, flicker, edge effects
- **RMS drives globals** — background brightness, overall energy
- Pick 2-3 properties to animate. More looks noisy.
- Keep minimums above zero — quiet sections need life.

### Band Count

| Bands | Detail    | Good for                   |
| ----- | --------- | -------------------------- |
| 4     | Low       | Background glow, pulsing   |
| 8     | Medium    | Bar charts, basic spectrum |
| 16    | High      | Detailed EQ (default)      |
| 32    | Very high | Dense radial layouts       |

### Layering

Layer multiple canvases with CSS z-index for depth — a background layer driven by bass/rms and a foreground layer driven by individual bands creates depth without complexity.

```html
<canvas id="bg-layer" style="position:absolute;top:0;left:0;z-index:1;"></canvas>
<canvas id="main-layer" style="position:absolute;top:0;left:0;z-index:2;"></canvas>
```
