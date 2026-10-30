# Tier 1 — title-card-fade

## What it tests

The simplest non-trivial Remotion → HyperFrames translation. A single text
element fades in over the first 0.5 s, holds for 2.0 s, and fades out over
the last 0.5 s. No audio, no media, no custom components.

If a translation can't pass T1, it's broken on table-stakes basics:
`AbsoluteFill`, `useCurrentFrame`, `interpolate` with multi-segment input,
and the timing offset between Remotion's frame-based driver and HF's
paused-GSAP driver.

## Translation walk-through

| Remotion                                                      | HyperFrames                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `<AbsoluteFill style={{ backgroundColor: "#0a0a0a" }}>`       | `<body style="background: #0a0a0a">` + a positioned root div                                            |
| `useCurrentFrame()`                                           | dropped — HF seeks the timeline                                                                         |
| `interpolate(frame, [0, 15, 75, 90], [0, 1, 1, 0])` at fps=30 | `gsap.timeline({ paused: true })` with three `.to()` calls at offsets 0s/0.5s/2.5s, each `ease: "none"` |
| `<div style={{ opacity }}>HELLO</div>`                        | static markup; opacity is animated by the timeline                                                      |

The Remotion→HF time conversion is `time = frame / fps`. So
`[0, 15, 75, 90]` at 30 fps becomes `[0, 0.5, 2.5, 3.0]` seconds.

## How to render and evaluate

```bash
# Render Remotion baseline
cd remotion-src && npm install && npm run render
# Renders to remotion-src/out/baseline.mp4

# Render HyperFrames translation
cd ../hf-src && npx hyperframes render --output ../hf.mp4

# Compare with the eval harness (from skill scripts/)
../../../scripts/render_diff.sh ./remotion-src/out/baseline.mp4 ./hf.mp4 ./diff
```

`expected.json` documents the SSIM threshold (0.95) for this fixture; the
calibrated mean against Remotion @ 4.0 with PNG/BT.709 output is 0.974.
