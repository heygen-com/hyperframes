---
name: gsap-effects
description: Typewriter text, audio visualizer, and drop-in animation effects for HyperFrames compositions. Use for character-by-character reveals, spectrum bars, waveforms, or audio-reactive visuals.
---

# GSAP Effects

Drop-in animation patterns for HyperFrames compositions. Each effect is a self-contained reference with the HTML, CSS, and code needed to add it to a composition.

These effects follow all HyperFrames composition rules — deterministic, no randomness, timelines registered via `window.__timelines`.

## Available Effects

| Effect           | File                                         | Use when                                                                                                            |
| ---------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Typewriter       | [typewriter.md](./typewriter.md)             | Text should appear character by character, with or without a blinking cursor                                        |
| Audio Visualizer | [audio-visualizer.md](./audio-visualizer.md) | Reactive bars, waveforms, circles, or glow that respond to audio. Includes extraction script and Canvas 2D patterns |
