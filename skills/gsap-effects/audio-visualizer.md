# Audio Visualizer

Reactive audio visualizations for HyperFrames compositions. Pre-extracts amplitude and frequency data from an audio file, then drives rendering from the GSAP timeline.

## Why Pre-Extraction

HyperFrames renders frame-by-frame in headless Chrome — there's no audio playing during rendering, so the Web Audio API's real-time `AnalyserNode` won't work. Instead, extract all audio data before the composition runs and bake it as a static JSON array. The composition reads the array by frame index. This is fully deterministic and seekable.

## Step 1: Extract Audio Data

```bash
python skills/gsap-effects/scripts/extract-audio-data.py audio.mp3 -o audio-data.json
python skills/gsap-effects/scripts/extract-audio-data.py video.mp4 --fps 30 --bands 16 -o audio-data.json
```

Requires ffmpeg and numpy (`pip install numpy`).

| Flag      | Default         | Description                                              |
| --------- | --------------- | -------------------------------------------------------- |
| `--fps`   | 30              | Must match the composition/render FPS                    |
| `--bands` | 16              | Number of frequency bands (more = finer spectrum detail) |
| `-o`      | audio-data.json | Output path                                              |

The script uses a 4096-sample FFT window (not the per-frame sample count) to ensure each frequency band maps to distinct FFT bins. Bands are logarithmically spaced from 30Hz to 16kHz — the useful range for music. Each band is normalized independently across the full track so treble activity is visible even when bass is louder in absolute terms.

## Step 2: Understanding the Data

```json
{
  "duration": 180.5,
  "fps": 30,
  "bands": 16,
  "totalFrames": 5415,
  "frames": [
    { "time": 0.0, "rms": 0.0, "bands": [0.0, 0.0, 0.0, ...] },
    { "time": 0.0333, "rms": 0.42, "bands": [0.8, 0.6, 0.3, ...] }
  ]
}
```

**`rms`** (0-1) — overall loudness of this frame, normalized across the full track. 0 is silence, 1 is the loudest moment in the entire audio. Use this for anything that should respond to overall energy: scaling, pulsing, glow intensity, opacity, movement speed.

**`bands`** (array of 0-1 values) — frequency magnitudes. Each value is normalized independently for that band across the full track, so a 0.8 in treble means "this is 80% of the loudest this treble band gets anywhere in the audio" — not that treble is as loud as bass in absolute terms. This is what makes all frequency ranges visually active.

- Index 0 = lowest bass (~30Hz). Index `n-1` = highest treble (~16kHz).
- Low indices (0-3) react to kick drums, bass lines, sub-bass rumble.
- Mid indices (4-9) react to vocals, guitars, synths, most melodic content.
- High indices (10-15) react to hi-hats, cymbals, sibilance, brightness.

## Loading the Data

Embed the data in the composition so it's available when the timeline runs.

```js
// Option A: inline (small files, under ~500KB)
const AUDIO_DATA = {
  /* paste audio-data.json contents */
};
setupTimeline(AUDIO_DATA);

// Option B: fetch (large files)
fetch("audio-data.json")
  .then((r) => r.json())
  .then((data) => {
    setupTimeline(data);
  });

function setupTimeline(AUDIO_DATA) {
  // Register tl.call() draws here — AUDIO_DATA is guaranteed to be loaded
  for (let f = 0; f < AUDIO_DATA.totalFrames; f++) {
    tl.call(
      () => {
        draw(AUDIO_DATA.frames[f]);
      },
      [],
      f / AUDIO_DATA.fps,
    );
  }
}
```

With fetch, wrap all timeline setup inside the callback so `AUDIO_DATA` is available when the `for` loop reads `totalFrames`. The fetch completes before the renderer's first seek because it waits for `window.__hf` readiness.

## Step 3: Drive Rendering from the Timeline

Register a `tl.call()` at every frame interval. Each call reads the pre-computed data and renders. This is deterministic and seekable — scrubbing in the studio works because each frame's draw is tied to a specific timeline position.

## Rendering Approaches

The data is framework-agnostic. Here's how to wire it up in each approach.

### Canvas 2D

Best for: bars, waveforms, circles, gradients, particles. Most common choice.

```js
const canvas = document.querySelector("#viz-canvas");
const ctx = canvas.getContext("2d");

for (let f = 0; f < AUDIO_DATA.totalFrames; f++) {
  tl.call(
    () => {
      const frame = AUDIO_DATA.frames[f];
      if (!frame) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // read frame.rms and frame.bands, draw whatever you want
    },
    [],
    f / AUDIO_DATA.fps,
  );
}
```

### WebGL / Three.js

HyperFrames has a Three.js adapter that patches `THREE.Clock` for deterministic time. Create your scene normally, then update uniforms or object properties from the audio data each frame.

```js
// In your Three.js setup:
const uniforms = { uBass: { value: 0 }, uMid: { value: 0 }, uRms: { value: 0 } };

for (let f = 0; f < AUDIO_DATA.totalFrames; f++) {
  tl.call(
    () => {
      const frame = AUDIO_DATA.frames[f];
      if (!frame) return;
      uniforms.uBass.value = Math.max(frame.bands[0], frame.bands[1], frame.bands[2]);
      uniforms.uMid.value = Math.max(frame.bands[6], frame.bands[7], frame.bands[8]);
      uniforms.uRms.value = frame.rms;
    },
    [],
    f / AUDIO_DATA.fps,
  );
}
```

### DOM Elements

For simpler visualizations (a few bars, a pulsing element), you can animate DOM elements directly. Less performant than Canvas for many elements, but fine for under ~20.

```js
const bars = document.querySelectorAll(".bar");
for (let f = 0; f < AUDIO_DATA.totalFrames; f++) {
  tl.call(
    () => {
      const frame = AUDIO_DATA.frames[f];
      if (!frame) return;
      bars.forEach((bar, i) => {
        bar.style.height = frame.bands[i] * 100 + "%";
      });
    },
    [],
    f / AUDIO_DATA.fps,
  );
}
```

## Spatial Mapping

When laying out frequency data spatially, follow these conventions so visualizations read naturally:

- **Horizontal layouts**: low frequencies (bass) on the left, high frequencies (treble) on the right. Iterate the bands array left-to-right.
- **Vertical layouts**: low frequencies at the bottom, high frequencies at the top.
- **Circular layouts**: bass starts at the top (12 o'clock) and wraps clockwise. Mirror the bands array for a full circle.

## Motion Principles

### Smoothing

Raw per-frame data changes abruptly. Blend with the previous frame for fluid motion:

```js
let prev = null;
const smoothing = 0.25; // 0 = no smoothing, higher = more lag

function smooth(f) {
  const raw = AUDIO_DATA.frames[f];
  if (!raw) return prev;
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

Lower smoothing (0.1-0.2) feels snappy and responsive — good for percussive music. Higher smoothing (0.3-0.5) feels languid and flowing — good for ambient or orchestral.

### Value Mapping

Audio data is 0-1 but visual properties need different ranges. Map with intention:

- **Scale/size**: multiply by a max value. A bar's height = `bands[i] * maxHeight`. Don't let elements disappear at 0 — add a minimum: `minHeight + bands[i] * (maxHeight - minHeight)`.
- **Opacity**: low values should still be slightly visible. `0.15 + bands[i] * 0.85` keeps elements present during quiet moments.
- **Color intensity**: shift between a muted base and a vivid peak. Interpolate HSL lightness or RGB channels based on the value.
- **Position/offset**: use rms to drive drift or wobble. Small movements (5-20px) feel organic; large movements look chaotic.

### What Makes It Feel Good

- **Bass drives the big moves.** Scale, position shifts, and glow should react to low bands. Bass is what makes a visualization feel like it's "hitting."
- **Treble drives the detail.** Small particle movements, edge shimmer, opacity flicker. Treble adds texture without dominating.
- **RMS drives global properties.** Background brightness, overall scale, color warmth. It's the "energy level" of the whole frame.
- **Don't animate everything at once.** Pick 2-3 visual properties to tie to the audio. More than that looks noisy.
- **Quiet sections should still have life.** A completely static frame during a soft passage looks broken. Keep minimum values above zero.

## Band Count Guide

| Bands | Detail level | Good for                                    |
| ----- | ------------ | ------------------------------------------- |
| 4     | Low          | Simple pulsing, background glow             |
| 8     | Medium       | Bar visualizations, basic spectrum          |
| 16    | High         | Detailed EQ, circular visualizers (default) |
| 32    | Very high    | Smooth curves, dense radial layouts         |

More bands = larger JSON file. 16 is a good default.

## Layering

Layer multiple canvases with CSS z-index for depth:

```html
<canvas id="bg-layer" style="position:absolute;top:0;left:0;z-index:1;"></canvas>
<canvas id="main-layer" style="position:absolute;top:0;left:0;z-index:2;"></canvas>
```

A background layer driven by bass/rms and a foreground layer driven by individual bands creates depth without complexity.

## HyperFrames Integration Notes

- The `<canvas>` element needs `data-start`, `data-duration`, and `data-track-index` like any other clip
- Set canvas `width`/`height` attributes to match the composition dimensions (1920x1080)
- The extraction script FPS must match the render FPS (default: 30)
- For large audio files, the JSON can be several MB — load via `fetch` rather than inlining
- Each canvas in the composition needs its own `data-track-index` — don't put multiple canvases on the same track
