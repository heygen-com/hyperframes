# Tier 2 — title-image-outro

## What it tests

Three-scene composition. Each scene exercises a different Remotion idiom:

1. **Scene 1 (0–2 s)** — TitleScene with `spring({damping:12, stiffness:100, mass:1})`
   driving a `transform: scale()` on text. Tests the lossy `spring → GSAP ease` translation.
2. **Scene 2 (2–4 s)** — ImageScene that fades in a `staticFile`-loaded image and
   linearly scales it from 0.8 → 1.0. Tests asset paths + linear `interpolate`.
3. **Scene 3 (4–6 s)** — OutroScene with a 1-s linear fade-in. Sanity check after
   the harder scenes.

A silent 6-second WAV plays throughout at `volume={0.5}`. Tests `<Audio>` translation.

If a translation passes T2, the skill correctly handles `<Sequence>` boundaries,
`<Audio>` / `<Img>` / `staticFile`, and the Remotion `spring → GSAP ease` heuristic.

## Translation walk-through

| Remotion                                                            | HyperFrames                                                                                                         |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `<Sequence from={0} durationInFrames={60}>`                         | host `<div data-composition-src="compositions/scene-1.html" data-start="0" data-duration="2" data-track-index="0">` |
| `spring({frame, fps, config: {damping:12, stiffness:100, mass:1}})` | `gsap.to(target, { scale: 1, duration: 0.7, ease: "back.out(1.4)" })`                                               |
| `<Audio src={staticFile("music.wav")} volume={0.5} />`              | `<audio src="assets/music.wav" data-start="0" data-duration="6" data-volume="0.5" data-track-index="1">`            |
| `<Img src={staticFile("square.png")} />`                            | `<img src="../assets/square.png">` inside `compositions/scene-2.html` (with setup.sh copying into both trees)       |
| `interpolate(frame, [0, 15], [0, 1])` at 30 fps                     | `gsap.to(target, { opacity: 1, duration: 0.5, ease: "none" })`                                                      |

The scene crossfading is a HyperFrames idiom, not a Remotion one: at scene boundaries
each scene sub-composition sets its own `gsap.set(scene, { opacity: 0 })` at its local end so the scene disappears at the
right time. Remotion does this implicitly by virtue of `<Sequence>`'s durationInFrames.

## How to render and evaluate

```bash
# 1. Generate the binary assets (PNG + WAV) via ffmpeg
./setup.sh

# 2. Render Remotion baseline
cd remotion-src && npm install && npm run render

# 3. Render HyperFrames translation
cd ../hf-src && npx hyperframes render --output ../hf.mp4

# 4. Compare
../../../scripts/render_diff.sh ./remotion-src/out/baseline.mp4 ./hf.mp4 ./diff
```

## Why threshold 0.95?

Same threshold as T1 (`expected.json` codifies it for the orchestrator). Spring → `back.out(1.4)`
came in cleaner than predicted during calibration — the validated mean is 0.985 against the
0.95 gate. If the translation breaks anything else (spring overshoot wrong, stagger off,
asset path drift), mean SSIM will fall well below 0.95 — that's the failure signal.
