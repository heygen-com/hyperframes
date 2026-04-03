# Audio-Reactive Animation

Drive visuals from music, voice, or sound. Any GSAP-animatable property can respond to pre-extracted audio data.

## Audio Data Format

```js
var AUDIO_DATA = {
  fps: 30,
  totalFrames: 900,
  frames: [{ bands: [0.82, 0.45, 0.31, ...] }, ...]
};
```

- `frames[i].bands[]` — frequency band amplitudes, 0-1. Index 0 = bass, higher = treble.
- Each band normalized independently across the full track.

## Mapping Audio to Visuals

| Audio signal           | Visual property                   | Effect                     |
| ---------------------- | --------------------------------- | -------------------------- |
| Bass (bands[0])        | `scale`                           | Pulse on beat              |
| Treble (bands[12-14])  | `textShadow`, `boxShadow`         | Glow intensity             |
| Overall amplitude      | `opacity`, `y`, `backgroundColor` | Breathe, lift, color shift |
| Mid-range (bands[4-8]) | `borderRadius`, `width`           | Shape morphing             |

Any GSAP-tweenable property works — `clipPath`, `filter`, SVG attributes, CSS custom properties.

## Content, Not Medium

Audio provides **timing and intensity**. The visual vocabulary comes from the narrative.

**Never add:** equalizer bars, spectrum analyzers, waveform displays, musical notes clip art, generic particle systems, rainbow color cycling, strobing white on beats, abstract pulsing orbs.

**Instead:** Let content guide the visual and audio drive its behavior. Bass makes warmth _swell_. Treble sharpens _contrast_. The visual choice comes from "what does this piece feel like?"

## Guidelines

- **Subtlety for text** — 3-6% scale variation, soft glow. Heavy pulsing makes text unreadable.
- **Go bigger on non-text** — backgrounds and shapes can handle 10-30% swings.
- **Match the energy** — corporate = subtle; music video = dramatic.
- **Deterministic** — pre-extracted data, no Web Audio API, no runtime analysis.

## Constraints

- All audio data must be pre-extracted (use `extract-audio-data.py` from the gsap skill's scripts/)
- No `Math.random()` or `Date.now()`
- Audio reactivity runs on the same GSAP timeline as everything else
