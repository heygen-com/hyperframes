# Paint — image-to-code compositions

`paint` compiles an image (or one frame of a video) into a standalone
HyperFrames composition whose **generated code repaints the subject in
brushstrokes**. The artifact is the code: the stroke list ships as an editable
data module (`strokes.js`), and the runtime reveals it over the timeline.
Deterministic: same input + seed produces byte-identical output.

## When to reach for it

- A composition needs a painted, hand-marked look derived from a real image
  (a portrait, a logo, a product shot, a frame of footage).
- The brief says "paint this", "make it look brush-painted", or asks for the
  image to draw itself on screen.
- You want the image-to-code thesis artifact: code the user can edit.

## Run it

```bash
node <SKILL_DIR>/scripts/paint.mjs --input photo.jpg --out paint-photo [options]
```

| Option                 | Default        | Meaning                                   |
| ---------------------- | -------------- | ----------------------------------------- |
| `--input <path>`       | required       | source image or video (one frame sampled) |
| `--out <dir>`          | `paint-<name>` | output folder                             |
| `--seed <n>`           | `1337`         | stroke randomness seed                    |
| `--width <px>`         | `1100`         | emitted canvas width                      |
| `--duration <s>`       | `12`           | reveal duration in seconds                |
| `--detail <level>`     | `medium`       | `low` / `medium` / `high` stroke budget   |
| `--video-position <s>` | `0`            | frame sample time for video inputs        |
| `--json`               | off            | machine-readable summary                  |

Requires `ffmpeg`/`ffprobe` on PATH (the same decode path as the rest of
media-use's operations).

## Output

```
paint-photo/
  index.html   standalone composition (contract-correct root, clip, timeline)
  strokes.js   editable stroke data — window.__PAINT_STROKES = [...]
```

The painter runtime is inlined in `index.html`. It reveals strokes in array
order over `--duration` seconds and is **seek-safe by construction**: band
canvases are pure functions of their index, so any seek order lands on
identical pixels. `hyperframes check` passes on the emitted folder as-is.

## Using the output

- **As its own composition**: point `check` / `preview` / `render` at the
  folder, or copy it into a project's `compositions/` and mount it.
- **Inside an existing composition**: mount via
  `data-composition-src` (wrap the emitted root in `<template>` per the
  sub-composition contract), or paste the inline runtime + a `<canvas>` into
  your scene and load `strokes.js` alongside it.
- **Editing the art**: `strokes.js` is plain data. Reorder strokes to change
  the reveal, delete strokes to simplify, tweak `color`/`weight`/`angle` per
  stroke. The runtime never needs to change.

## Tuning

- `--detail high` resolves faces and fine texture (~60k strokes on a busy
  image); `medium` is the balanced default; `low` suits backgrounds.
- Same seed, same image → identical strokes. Change `--seed` for a different
  interpretation of the same subject.
- The reveal order IS the compile order (coarse underpainting first, fine
  detail last). Reversing the array reverses the reveal.
