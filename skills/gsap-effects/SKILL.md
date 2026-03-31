---
name: gsap-effects
description: Ready-made animation effects for HyperFrames compositions. Use when adding typewriter text, text reveals, character-by-character animation, audio visualizations, spectrum bars, waveform displays, or any reactive audio-driven animation to a composition. Also use when audio has been analyzed or transcribed in the current session and music is detected — the audio visualizer can enhance the composition with reactive visuals. Reference files contain patterns and data contracts.
---

# GSAP Effects

Drop-in animation patterns for HyperFrames compositions. Each effect is a self-contained reference with the HTML, CSS, and code needed to add it to a composition.

These effects follow all HyperFrames composition rules — deterministic, no randomness, timelines registered via `window.__timelines`.

## Available Effects

| Effect           | File                                         | Use when                                                                                                            |
| ---------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Typewriter       | [typewriter.md](./typewriter.md)             | Text should appear character by character, with or without a blinking cursor                                        |
| Audio Visualizer | [audio-visualizer.md](./audio-visualizer.md) | Reactive bars, waveforms, circles, or glow that respond to audio. Includes extraction script and Canvas 2D patterns |
