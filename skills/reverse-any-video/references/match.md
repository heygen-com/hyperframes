# Matching what is drawn

Where earlier rebuilds lost points on drawn layers, and what fixed it.

## Timing

- Graphics change on exact frames. An element that is fully there on frame 241 is set there, not faded in; tween only what you saw move over several frames. A camera that lands in one frame is a `set`, not a tween.
- Captions: take each group's first and last frame from the caption band's pixels, every frame (`npx hyperframes measure events <video> --roi <band>`, or a frame difference over the band). The words come from `npx hyperframes transcribe`, which can mishear names; the switch times come from the pixels, since captions often lead or trail the voice. Switch hard unless the original fades.
- A blur flash, a dissolve or a wipe at a cut is part of the cut: rebuild it over its measured frames.

## Size, type and position

- Size text from its ink, not by eye: crop the line in a source frame and the same line in a snapshot of yours, compare the ink boxes' height and width, and scale size, then `letter-spacing`, until both agree within a few pixels. A substitute font usually sets wider; compare numerals too. Then compare the ink's darkness for weight, and look for an outline or shadow.
- Match the family by its traits (geometry, contrast, x-height, terminals) and try two or three candidates at the measured size before choosing. Prefer a bundled font, then a Google Fonts family in `assets/fonts/`. Say in the report which fonts are substitutes.
- Positions come from measured boxes in source pixels; the canvas is the source's size, so they go in as measured.

## Look

- Motion graphics: the backdrop covers most of the frame. Sample a grid of the empty backdrop at several moments and match its gradient and brightness over time.
- Fast moves in the original are motion-blurred; sharp tiles at speed score as wrong. Blur along the move while it is fast (below).
- Dots and pixel textures: measure the lattice (pitch, offset, colour) from a frame and render from that grid.
- Flat graphics that move like footage (a map under a camera, a diagram that scrolls): trace each plate into flat-colour shapes and fit the camera move; it matches far better than redrawing from outside data.

## Every large word, through its life

Look at a strip of consecutive frames over its box from the frame it appears to the frame it leaves (`measure frames --range a,b --roi <its box> --max 16`). Read how it arrives (pop, scale, fade, type-on, word by word, wipe), how it changes while on screen (a fill sweeping across, a sheen, a counter, a colour change: direction and duration) and how it leaves. Then zoom in at full size and name what the letters are made of: solid, gradient, glass, outline, glow, knockout.

## Recipes a seeked timeline reproduces

- **Fill that sweeps across the letters:** two copies of the word; the lit one on top, `clip-path: inset(0 100% 0 0)` tweened to `inset(0 0 0 0)` over the measured time and direction.
- **Gradient type:** `background: linear-gradient(<direction>, <both end colours>)` with `background-clip: text` and a transparent fill.
- **Glass type over footage** (the letters show the footage behind them bent, with a dark rim and a light edge): a second copy of the shot inside the letters, clipped by an SVG `<clipPath>` holding the `<text>`, bent by `feTurbulence` (`baseFrequency` about 0.02, fixed seed) into `feDisplacementMap` (scale 40–60); a darker copy of the text multiplied over it at 15–35%, a 2–3 px dark stroke, a light top edge. It sits in the shot's camera group.
- **Outline type:** `-webkit-text-stroke` at the measured width, transparent fill.
- **Directional motion blur:** an SVG `<feGaussianBlur stdDeviation="0 0">` on the moving wrapper, its `stdDeviation` tweened (`"24 0"` smears horizontally); CSS `blur()` is symmetric and wrong.
- **Ghost trail:** 2–4 clones behind the element along the move, opacity about 0.5, 0.3, 0.15.
- **Glow:** stacked `text-shadow` or `drop-shadow`, tweening radius and alpha.
- **Masks and wipes:** `clip-path` or `mask-image` with a tweened stop.
- **Flash:** a full-frame layer for exactly the measured frames.
- **Grain:** SVG `feTurbulence` with a fixed seed, stepped per frame for moving grain. Grain lowers SSIM whatever you do: match its look, not its pixels.
