---
name: audio-reactive
description: Drive any visual element in a HyperFrames composition from audio data — captions, backgrounds, shapes, overlays, anything GSAP can animate. Use when a composition should respond to music, voice, or sound.
trigger: Use when a composition involves music, beat-synced animation, audio visualization, or any visual element that should react to sound.
---

# Audio-Reactive Animation

When audio data is available (extracted via `extract-audio-data.py` or loaded from `audio-data.json`), any visual element in the composition can be driven by the music — captions, backgrounds, shapes, overlays, anything GSAP can animate.

## Audio Data Format

```js
var AUDIO_DATA = {
  fps: 30,           // frame rate of the analysis
  totalFrames: 900,  // total analyzed frames
  frames: [
    { bands: [0.82, 0.45, 0.31, ...] },  // per-frame frequency band amplitudes
    // ...
  ]
};
```

- `frames[i].bands[]` — frequency band amplitudes, normalized 0–1. Index 0 = bass, higher indices = mids and treble.
- `fps` — frame rate of the analysis (matches composition frame rate)
- `totalFrames` — total number of analyzed frames

## Mapping Audio to Visuals

Map frequency bands and amplitude to any GSAP-animatable property. The creative choice is yours — these are common mappings:

| Audio signal           | Visual property                   | Effect                     |
| ---------------------- | --------------------------------- | -------------------------- |
| Bass (bands[0])        | `scale`                           | Pulse on beat              |
| Treble (bands[12–14])  | `textShadow`, `boxShadow`         | Glow intensity             |
| Overall amplitude      | `opacity`, `y`, `backgroundColor` | Breathe, lift, color shift |
| Beat onset             | `scale`, `color`, `rotation`      | Flash or pop on hits       |
| Mid-range (bands[4–8]) | `borderRadius`, `width`, `height` | Shape morphing             |

These are starting points. Any property GSAP can tween is fair game — `clipPath`, `filter`, `backgroundPosition`, SVG attributes, custom CSS properties.

## Guidelines

- **Subtlety for text.** Captions and readable text should stay in the 3–6% scale variation range with soft glow. Heavy pulsing makes text unreadable.
- **Go bigger on non-text elements.** Backgrounds, shapes, and decorative elements can handle 10–30% scale swings, full color shifts, and dramatic transforms.
- **Match the energy.** A corporate explainer needs subtle reactivity. A music video can go hard.
- **Deterministic.** Audio data is pre-extracted — no Web Audio API, no `AnalyserNode`, no runtime mic input. The data is static JSON, the animation is repeatable.

## Constraints

- All audio data must be pre-extracted — no runtime audio analysis
- No `Math.random()` or `Date.now()` — deterministic rendering applies
- Audio reactivity runs on the same GSAP timeline as everything else
