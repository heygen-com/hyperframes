# Media treatment recipes

These are optional tested seeds, not the complete capability surface. Read the
shared policy and choose one relevant section through `media-treatments.md`.
Agents may modify or combine a seed with compatible canonical controls after
inspecting the media, or assemble a bespoke payload from
`hyperframes media-treatment --capabilities --json` when no seed fits.

## Natural Portrait

Use for a talking head, interview, presenter, or people-focused photo whose
intended result is natural, polished, and restrained.

Do not use when the face is incidental or tiny, the source is intentionally
neon/monochrome/strongly stylized, or the requested result is beauty retouching.
This treatment changes the whole frame; it is not a face mask or skin-smoothing
effect.

Inspect face exposure, highlight retention, shadow detail, white balance, and
whether the existing look is intentional. Signalstats do not detect faces or
creative intent.

### Base payload

Start here, then tune only when the sampled frames justify it:

```json
{ "preset": "skin-soft", "intensity": 0.6 }
```

`skin-soft` is a global tonal/color preset whose vibrance math is reduced for
skin-like colors. It does not blur, retouch, segment, or track a face.

### Bounded tuning

Adjustment values are absolute values in the final payload, not deltas added to
the preset. Keep changes inside these conservative ranges unless the user asks
for a stylized result:

| Property    | Natural Portrait range |
| ----------- | ---------------------- |
| intensity   | 0.45 to 0.75           |
| exposure    | -0.06 to 0.14          |
| contrast    | -0.05 to 0.08          |
| highlights  | -0.18 to -0.04         |
| shadows     | 0.04 to 0.18           |
| whites      | -0.10 to 0.04          |
| blacks      | -0.06 to 0.06          |
| temperature | -0.05 to 0.10          |
| tint        | -0.03 to 0.05          |
| vibrance    | 0 to 0.06              |
| saturation  | -0.04 to 0.06          |

Leave grain, blur, and pixelate at zero. A vignette is optional at `0` to
`0.05` only when it improves subject focus without looking like an effect.

Manual controls must stay inside their schema section; they are never
top-level keys. A tuned Natural Portrait payload looks like this:

```json
{
  "preset": "skin-soft",
  "intensity": 0.58,
  "adjust": {
    "highlights": -0.08,
    "shadows": 0.08,
    "temperature": 0.02,
    "vibrance": 0.02
  },
  "details": { "vignette": 0.03 }
}
```

Use the same nested shape in `grade-compare` candidate files. `adjust` owns
tonal/color controls, `details` owns vignette/grain, and `effects` owns blur,
pixelate, chroma bleed, and the advanced treatment primitives below.

During the common comparison, reject any result that makes skin implausible,
loses highlight detail, flattens or desaturates dark skin, or casts clothing and
background colors accidentally.

## Product Polish

Use for photographed or filmed physical products when the goal is clean,
accurate, dimensional presentation. Protect product color, material texture,
label readability, specular highlights, and intentional lighting.

Do not use this treatment for literal app/site screenshots or screen captures;
follow UI Fidelity below. Do not neutralize a lifestyle scene's deliberate
ambient color, and do not infer exact brand-color correction without a neutral
reference or known product color.

Inspect the product separately from its background. Check white balance, label
legibility, surface texture, highlight clipping, shadow detail, white point,
and black point. Statistics cannot identify a white package, metallic
highlight, amber glass, or intentional warm light.

### Base payload

Compare this restrained correction against the untouched source:

```json
{
  "intensity": 0.7,
  "adjust": {
    "exposure": 0.01,
    "contrast": 0.06,
    "highlights": -0.1,
    "shadows": 0.04,
    "whites": 0.02,
    "blacks": -0.03,
    "vibrance": 0.03,
    "saturation": 0.02
  }
}
```

This is a comparison starting point, not an instruction to change an already
finished source. If the original has accurate color, clean endpoints, and good
texture, leave the pixels unchanged and polish through framing or motion.

### Bounded tuning

| Property    | Product Polish range |
| ----------- | -------------------- |
| intensity   | 0.45 to 0.8          |
| exposure    | -0.08 to 0.1         |
| contrast    | 0 to 0.1             |
| highlights  | -0.16 to 0           |
| shadows     | 0 to 0.12            |
| whites      | -0.08 to 0.05        |
| blacks      | -0.06 to 0.04        |
| temperature | -0.05 to 0.05        |
| tint        | -0.03 to 0.03        |
| vibrance    | 0 to 0.06            |
| saturation  | -0.04 to 0.05        |

Temperature and tint stay at zero unless the frames show a plausible cast.
Leave grain, vignette, blur, and pixelate at zero for catalog/e-commerce media.
For a lifestyle product shot, a vignette up to `0.04` is acceptable only when
it improves focus without changing the product itself.

During the common comparison, reject any result that clips white packaging,
muddies black products, shifts a known brand color, hides texture, or makes
labels harder to read. Report when preserving the original was the deliberate
decision.

## UI Fidelity

Use for literal app, website, dashboard, terminal, slide, or screen-recording
pixels whose colors and readability are part of the product being shown.

The default payload is **none**: do not add `data-color-grading`. Global color
changes affect brand colors, status colors, charts, screenshots, and tiny text
together, so even a tasteful photographic look can make the demonstration less
truthful.

Polish UI footage with crop, scale, pacing, cursor emphasis, surrounding DOM
overlays, or seek-safe motion outside the captured pixels. If the user
explicitly asks for a stylized UI look, preview it against the original and
state that exact UI color is no longer preserved. If a camera filmed a screen,
correct only a demonstrated capture cast or exposure issue and still verify
text and brand colors across representative frames.

## Film Memory

Use when the story explicitly calls for a warm memory, restrained flashback,
personal archive, or film-like recollection. This is not the default meaning of
"cinematic", and it is not scanned-film-stock emulation.

Do not use for literal UI, product catalog media, technical demonstrations, or
footage whose accurate current-day color is important. Use a separate camcorder
treatment for VHS/REC language. Do not add dust, scratches, light leaks, film
burns, or halation unless an owned component is available and the requested
story actually benefits from it.

Check that the source has enough highlight and shadow detail to tolerate a
faded treatment, and confirm nostalgia or temporal separation belongs in the
story. Compare the full moving treatment, not only a still preset card.

### Static pixel base

Start with this owned shader recipe:

```json
{
  "preset": "vintage-wash",
  "intensity": 0.6,
  "details": {
    "vignette": 0.12,
    "grain": 0.12,
    "grainSize": 0.2,
    "grainRoughness": 0.6
  }
}
```

Keep the static values inside these ranges:

| Property       | Film Memory range |
| -------------- | ----------------- |
| intensity      | 0.5 to 0.75       |
| vignette       | 0.08 to 0.16      |
| grain          | 0.08 to 0.16      |
| grainSize      | 0.16 to 0.24      |
| grainRoughness | 0.5 to 0.7        |

The stronger end can flatten dark skin, black clothing, or already-faded
footage. Compare against the source and lower strength when it does.

### Temporal character

Use the existing registered paused GSAP timeline on the same media element:

- author `--hf-color-grading-exposure: 0` in the media element's inline
  `style`;
- move it through a finite irregular sequence within `-0.03` to `0.03`, using
  gentle `sine.inOut` segments around `0.45` to `0.8` seconds;
- for gate weave, keep `x`/`y` within `0.15%` of the shorter composition edge,
  rotation within `0.03` degrees, and scale between `1.005` and `1.01` to
  protect the frame edges;
- return close to the starting exposure and transform at the treatment end.

Do not use randomness, infinite CSS keyframes, timers, or `onUpdate`. Flicker
is a gentle exposure pulse, not a flash. Weave is slight mechanical drift, not
handheld shake.

Also run focused keyframe diagnostics and seek directly to the final-minus-frame
position. Reject brightness pumping, distracting drift, clipped edges, or
skin/detail loss. Report the motion ranges and describe this as an HF
film-memory treatment, not camera-stock emulation. If motion reads as an effect
before it reads as a memory, reduce or remove it.

## Creator Camcorder

Use when the story explicitly calls for a creator-camera recording, consumer
camcorder memory, or restrained digital-video character. This treatment is a
modern camcorder language, not VHS restoration, CRT simulation, surveillance,
or a promise to reproduce a specific camera model.

Do not apply it to literal UI, product catalog media, tiny media tiles, or
already compressed footage that has distracting color bleed. Do not add a REC
HUD merely because the source contains a person talking; the camera-device
language must support the story or the user's requested style.

Check skin, saturated edges, fine text, source compression, and whether the
source already has a deliberate camera look. Reject softened chroma that
damages labels, graphics, or identifying product color. Judge chroma softness
and grain in motion, not one still.

### Static pixel base

Start with the proven shader payload below, then tune only inside the bounded
ranges when representative frames justify it:

```json
{
  "intensity": 0.72,
  "adjust": {
    "contrast": 0.08,
    "highlights": -0.05,
    "shadows": 0.02,
    "whites": 0.03,
    "blacks": -0.04,
    "temperature": -0.03,
    "tint": -0.015,
    "vibrance": -0.03,
    "saturation": -0.06
  },
  "details": {
    "vignette": 0.06,
    "grain": 0.08,
    "grainSize": 0.18,
    "grainRoughness": 0.58
  },
  "effects": { "chromaBleed": 0.55 }
}
```

| Property       | Creator Camcorder range |
| -------------- | ----------------------- |
| intensity      | 0.55 to 0.8             |
| contrast       | 0.03 to 0.1             |
| highlights     | -0.1 to 0               |
| shadows        | 0 to 0.06               |
| whites         | 0 to 0.05               |
| blacks         | -0.08 to -0.01          |
| temperature    | -0.06 to 0.04           |
| tint           | -0.03 to 0.02           |
| vibrance       | -0.06 to 0.02           |
| saturation     | -0.12 to -0.02          |
| vignette       | 0.03 to 0.1             |
| grain          | 0.04 to 0.12            |
| grainSize      | 0.14 to 0.24            |
| grainRoughness | 0.45 to 0.7             |
| chromaBleed    | 0.35 to 0.7             |

Leave blur and pixelate at zero. Square pixels, scanlines, RGB splitting, and
tracking noise are different visual languages and are not defaults for this
treatment.

### Optional camera HUD

When the narrative benefits from explicit recording-device language, install
the Registry overlay block:

```bash
npx hyperframes add camcorder-hud --no-clipboard
```

Insert the printed `data-composition-src` host over the intended media range.
Edit the displayed date/time/mode/counter in
`compositions/camcorder-hud.html`. The block's paused GSAP timeline derives
its counter and REC blink from composition time, so play, scrub, and render
agree. Keep the HUD finite and scoped to the shot.

The HUD is an optional authored overlay. The pixel payload remains useful
without it, and the HUD alone is not evidence that the footage was treated.

### Optional source-to-camera reveal

Global grading intensity fades only primary correction and LUT output; it does
not fade the independent camcorder effects. For a visible source-to-camera
mode change, use two synchronized media layers and a finite opacity crossfade
from untreated to treated footage. Fade the HUD in on that same paused GSAP
timeline. Do not animate shader state with callbacks or an independent clock.

Also verify HUD placement and framing in each aspect ratio the project supports.
Report whether the HUD was used and describe this as an HF camcorder treatment,
not camera/VHS emulation. If an effect artifact is more noticeable than the
subject, reduce chroma bleed/grain or keep the source unchanged.

## VHS Playback

Use when the story explicitly calls for analog home-video tape, a dated archive,
or a visibly degraded VHS playback. This treatment is not Creator Camcorder,
generic pixelation, CRT display simulation, or a default retro look.

Do not use for literal UI, product catalog media, small text, clean modern
creator footage, or any source whose identifying color/detail must remain exact.
Inspect high-contrast vertical edges, faces, saturated objects, and the bottom
of the frame in motion. Analog damage must support the story without making the
subject hard to read.

### Pixel payload

Start with the complete proven combination, not `tapeDamage` alone:

```json
{
  "intensity": 1,
  "adjust": { "contrast": -0.04, "saturation": -0.08 },
  "details": {
    "grain": 0.16,
    "grainSize": 0.12,
    "grainRoughness": 0.72
  },
  "effects": {
    "tapeDamage": 0.82,
    "tapeTracking": 0.85,
    "tapeNoise": 0.3,
    "tapeSpeed": 0.5,
    "chromaBleed": 0.5,
    "chromaticAberration": 0.18,
    "chromaticAngle": 0,
    "scanlines": 0.35,
    "scanlineCount": 0.17,
    "scanlineSoftness": 1,
    "digitalGlitch": 0.32,
    "digitalGlitchColorSplit": 0,
    "digitalGlitchLineTear": 0.08,
    "digitalGlitchPixelate": 0,
    "digitalGlitchBlockAmount": 0,
    "digitalGlitchBlockDisplacement": 0,
    "digitalGlitchBlockOpacity": 0,
    "digitalGlitchSpeed": 0.5
  }
}
```

| Property              | VHS Playback range |
| --------------------- | ------------------ |
| intensity             | 0.75 to 1          |
| contrast              | -0.1 to 0          |
| saturation            | -0.16 to 0         |
| grain                 | 0.08 to 0.18       |
| grainSize             | 0.08 to 0.18       |
| grainRoughness        | 0.55 to 0.8        |
| tapeDamage            | 0.65 to 0.9        |
| tapeTracking          | 0.5 to 0.9         |
| tapeNoise             | 0.15 to 0.45       |
| tapeSpeed             | 0.35 to 0.65       |
| chromaBleed           | 0.35 to 0.65       |
| chromaticAberration   | 0.08 to 0.22       |
| scanlines             | 0.2 to 0.4         |
| scanlineCount         | 0.14 to 0.2        |
| digitalGlitch         | 0.2 to 0.4         |
| digitalGlitchLineTear | 0.04 to 0.1        |

`tapeDamage` owns deterministic horizontal line jitter, slow time-base wobble,
bottom-edge head switching, luma bandwidth loss, restrained ghosting, noise,
and sparse dropouts. Its subordinate tracking/noise/speed controls add bounded
moving tape tears and control their signal character without introducing a new
clock. `chromaBleed` separately reduces horizontal chroma detail. The restrained
scanline and chromatic settings supply the remaining tape-playback character.
The digital stage is used only for rare horizontal row tears: keep its color
split, pixelation, block displacement, block opacity, and corruption values at
zero. Leave blur, CRT curvature, generic pixelation, and a camera HUD off.

These values are an original HyperFrames recipe calibrated on the same public
Orange Cat source used for the external visual reference. They are not copied
shader code or a claim of pixel-identical output from the external reference. The scanline count is
mapped to the reference's approximately 127-cycle primary line pattern; the HF
tracking math stays bounded in media pixels and uses the composition clock.

The shader damage evolves from the existing deterministic media time, so it
needs no CSS loop or private timeline. Global grading intensity does not fade
tape damage or other independent effects. If the story requires a finite
source-to-tape reveal, crossfade synchronized untreated and treated media layers
on the host's paused GSAP timeline. During the common workflow, inspect dense
consecutive frames and reject hard edge tearing, face
smearing, frozen noise, square blocks, blank borders, or a bottom disturbance
that competes with the subject.

## 8mm Home Movie

Use for personal archive, family-memory, childhood, travel-memory, or explicit
small-gauge home-movie language. This is stronger and more materially film-like
than Film Memory, but it is still an owned HyperFrames treatment rather than a
claim to reproduce a named film stock, camera, or laboratory process.

Do not use for literal UI, technical demonstrations, catalog products, clean
interviews, or footage where dust/scratches would imply false provenance. Check
skin, highlights, dark clothing, and frame edges before applying it.

### Pixel payload

```json
{
  "preset": "vintage-wash",
  "intensity": 0.72,
  "details": {
    "vignette": 0.28,
    "vignetteMidpoint": 0.54,
    "vignetteFeather": 0.72,
    "grain": 0.34,
    "grainSize": 0.18,
    "grainRoughness": 0.72
  },
  "effects": { "filmArtifacts": 0.62 }
}
```

| Property       | 8mm Home Movie range |
| -------------- | -------------------- |
| intensity      | 0.6 to 0.8           |
| vignette       | 0.18 to 0.34         |
| grain          | 0.22 to 0.42         |
| grainSize      | 0.12 to 0.24         |
| grainRoughness | 0.6 to 0.8           |
| filmArtifacts  | 0.35 to 0.7          |

`filmArtifacts` owns only deterministic sparse dust and short scratches. The
existing preset/details own color, vignette, and grain; the host's paused GSAP
timeline owns optional gate weave. Keep weave within `0.15%` of the shorter
composition edge, rotation within `0.03` degrees, and scale between `1.005` and
`1.015`. Use finite `sine.inOut` segments around `0.6` to `1` second, return
near the starting transform, and never use randomness, timers, `onUpdate`, or
an infinite CSS animation.

Reject a result when dust is constantly visible, scratches persist unnaturally,
the frame pumps, weave exposes an edge, highlights turn muddy, or the material
artifacts are more noticeable than the memory. For a subtler nostalgic result,
use Film Memory instead.

## Editorial Halftone

Use for print/editorial transitions, poster frames, comic/newsprint language,
stylized product or portrait beats, and graphic sequences where visible ink
screening is the point. This is a real four-angle CMYK raster treatment, not a
dotted DOM overlay.

Do not use on literal UI, dense text, tiny labels, footage that must remain
photorealistic, or a long talking-head segment unless the user explicitly asks
for strong print stylization. Preserve text/captions as ungraded DOM above the
media whenever they must stay readable.

### Pixel payload

```json
{
  "intensity": 1,
  "adjust": { "contrast": 0.04, "saturation": 0.04 },
  "effects": { "halftone": 0.94, "halftoneSize": 0.36 }
}
```

| Property     | Editorial Halftone range |
| ------------ | ------------------------ |
| intensity    | 0.8 to 1                 |
| contrast     | -0.02 to 0.08            |
| saturation   | -0.04 to 0.08            |
| halftone     | 0.75 to 1                |
| halftoneSize | 0.15 to 0.55             |

The shader uses fixed C/M/Y/K screen angles of 15/75/0/45 degrees, separate ink
coverage, a warm paper base, and resolution-aware dot-cell sizing. Keep those
screen semantics fixed; tune only amount and size unless a future visual proof
justifies a broader schema. Judge the result at final output resolution because
browser zoom can misrepresent the screen. Reject unstable moire, unreadable
subjects, clipped ink detail, excessive dot size, or any treatment that looks
like a transparent dot texture laid over unchanged footage.

## Two-Ink Editorial Print

Use for poster frames, editorial portraits, music/social cutaways, zine
graphics, and bold print-led transitions where two visible spot inks are more
appropriate than photographic color. This is a fixed original HyperFrames
vermilion/teal treatment, not a claim to emulate a named printer, ink set, or
commercial print process.

Do not use for literal UI, brand-color-critical products, small labels, natural
talking heads, or media that must remain photorealistic. Keep captions and
graphics as normal DOM above the treated media.

### Pixel payload

```json
{
  "intensity": 1,
  "adjust": { "contrast": 0.08, "highlights": -0.06, "shadows": 0.04 },
  "effects": { "twoInkPrint": 1, "twoInkPrintSize": 0.42 }
}
```

| Property        | Two-Ink range |
| --------------- | ------------- |
| intensity       | 0.8 to 1      |
| contrast        | 0.02 to 0.1   |
| highlights      | -0.1 to 0     |
| shadows         | 0 to 0.08     |
| twoInkPrint     | 0.8 to 1      |
| twoInkPrintSize | 0.18 to 0.55  |

The shader maps warm midtones to vermilion, deep/cool shadows to teal, and
shared dark coverage to a dark overprint on warm paper. It uses separate
15/75-degree screens, a subtle fixed registration offset, deterministic paper
texture, and resolution-aware dot sizing. Do not combine it with `halftone` or
a duotone LUT: that re-separates the result and defeats the two-ink contract.

Judge it at output resolution and across multiple frames. Reject missing second
ink, crushed faces, unstable moire, illegible silhouettes, or a result that
reads as a red tint with dots rather than two screened inks.

## Monochrome Screen Print

Use for graphic portrait beats, posterized social inserts, newspaper-like
screens, or a finite transition into visible monochrome cells. Keep captions
and typography as normal DOM above the treated media.

```json
{
  "intensity": 1,
  "effects": {
    "monoScreen": 1,
    "monoScreenSize": 0.35,
    "monoScreenAngle": 0.25,
    "monoScreenSpread": 0.3,
    "monoScreenShape": 0,
    "monoScreenInvert": 0
  },
  "palette": ["#111319", "#f2ecdc"]
}
```

Use `monoScreenShape` `0..4` for circle, square, diamond, triangle, or line.
Keep cell size within `0.15..0.55` and spread within `0.15..0.55`. Reject faces
that lose their silhouette, unstable moire, or cells too small to survive the
final encoded resolution.

## Engraved Illustration

Use for editorial portraits, historical/technical illustration, title-card
cutaways, or a source-to-line-art reveal. It is not routine correction and
should not be applied to literal UI or brand-color-critical product footage.

```json
{
  "intensity": 1,
  "effects": {
    "engraving": 1,
    "engravingSpacing": 0.4118,
    "engravingMinThickness": 0.2,
    "engravingMaxThickness": 0.4571,
    "engravingAngle": 0.25,
    "engravingContrast": 0.4667,
    "engravingSharpness": 0.59,
    "engravingWave": 0.2,
    "engravingWaveFrequency": 0.2222
  },
  "palette": ["#101216", "#f3eddf"]
}
```

Preserve the calibrated base first. Tune spacing within `0.25..0.6`, contrast
within `0.3..0.65`, and wave within `0..0.35`. Reject squeezed framing, broken
contours, noisy flat backgrounds, or lines that flicker across moving frames.

## Crosshatched Sketch

Use for hand-rendered editorial beats, comic/documentary cutaways, and short
illustrative transformations where multiple line directions should preserve
the subject contour.

```json
{
  "intensity": 1,
  "effects": {
    "crosshatch": 1,
    "crosshatchSpacing": 0.28,
    "crosshatchThickness": 0.25,
    "crosshatchAngle": 0.25,
    "crosshatchContrast": 0.3333,
    "crosshatchEdges": 0.5,
    "crosshatchLineWeight": 0,
    "crosshatchWave": 0.33,
    "crosshatchWaveFrequency": 0.2222
  },
  "palette": ["#101216", "#f3eddf"]
}
```

Tune spacing within `0.18..0.5`, edge detail within `0.3..0.7`, and wave within
`0.1..0.45`. Reject distorted aspect ratio, dense black fill that hides the
subject, or temporal shimmer stronger than the intended sketch language.

## CRT Display

Use when the media is intentionally shown as an older monitor, terminal, game
screen, or broadcast display. Curvature alone is geometry, not a complete CRT
treatment, so pair it with restrained scanlines and only slight channel
separation.

```json
{
  "intensity": 1,
  "effects": {
    "crtCurvature": 0.2,
    "scanlines": 0.35,
    "scanlineCount": 0.17,
    "scanlineSoftness": 1,
    "chromaticAberration": 0.08,
    "chromaticAngle": 0
  }
}
```

Keep curvature within `0.08..0.28`, scanlines within `0.18..0.45`, and channel
separation within `0..0.12`. Reject excessive black corners, unreadable UI,
large color fringes, or applying the display language to ordinary footage when
the user only asked for correction.

## Procedural ASCII

Use for a deliberate terminal, code, data, surveillance, editorial, or
source-to-character reveal. This is a real shader-generated 5x7 glyph field,
not monospace text placed over unchanged footage.

Do not use as routine talking-head polish, on literal UI or dense text, or when
recognizing a face/product precisely matters. Keep captions and graphics as
normal DOM above the treated media.

Choose one of these proven starting points:

```json
{
  "effects": { "ascii": 1, "asciiSize": 0.08, "asciiInvert": 1 },
  "palette": ["#020605", "#38ff78"]
}
```

The first is **Terminal ASCII**: dark field, bright green glyphs, appropriate
for code/data/device language. For a warmer print-like **Editorial ASCII**, use:

```json
{
  "effects": { "ascii": 1, "asciiSize": 0.066, "asciiInvert": 0 },
  "palette": ["#0b0d0d", "#eee9db"]
}
```

Keep `ascii` between `0.75` and `1` for a fully readable treatment and
`asciiSize` between `0.04` and `0.15`. A finite reveal may author
`--hf-color-grading-ascii: 0` inline and tween it to `1` with the registered
paused GSAP timeline. Reject unstable cells, lost silhouette/face structure,
unreadable composition, or a palette that conflicts with the project.

## Ordered Palette Dither

Use for posterized social beats, music/editorial cutaways, pixel-art language,
or a finite source-to-palette reveal. The shader uses a stable 4x4 Bayer
threshold matrix and an explicit dark-to-light palette. Do not describe it as
Floyd-Steinberg, Atkinson, or another sequential error-diffusion process.

Do not use on literal UI, brand-color-critical products, tiny labels, or long
photorealistic sections. Start with one of these original palettes:

```json
{
  "effects": { "dither": 1, "ditherSize": 0.25 },
  "palette": ["#17121a", "#824c50", "#e09873", "#f7ddb1"]
}
```

The four-color option is **Warm Print**. For a louder social/music beat, use
the six-color **Electric Ink** palette:

```json
{
  "effects": { "dither": 1, "ditherSize": 0.4 },
  "palette": ["#080717", "#3c185f", "#7e2278", "#d9339f", "#ff6b66", "#aafae0"]
}
```

HyperFrames also owns these named ramps. The name is an authoring shortcut;
persist the listed colors through the existing `palette` array:

| Group       | Palette ID       | Ordered colors                                                   |
| ----------- | ---------------- | ---------------------------------------------------------------- |
| Classic     | `noir`           | `#000000`, `#ffffff`                                             |
| Classic     | `ink-paper`      | `#1a1a2e`, `#f5f5dc`                                             |
| Classic     | `terminal`       | `#001100`, `#00ff00`                                             |
| Classic     | `amber-glow`     | `#1a0f00`, `#ffcc00`                                             |
| Classic     | `handheld-green` | `#0f380f`, `#306230`, `#8bac0f`, `#9bbc0f`                       |
| Mood        | `golden-hour`    | `#1a1205`, `#4a3510`, `#8b6914`, `#d4a017`, `#fff8dc`            |
| Mood        | `deep-sea`       | `#0a1628`, `#1a3a5c`, `#2d6187`, `#5ba4c9`, `#a8dce8`            |
| Mood        | `arctic-night`   | `#0a0a14`, `#1a2a4a`, `#3a5a8a`, `#6a9aca`, `#cae8ff`            |
| Mood        | `synthwave`      | `#120458`, `#7b2cbf`, `#e040fb`, `#ff6ec7`, `#fff59d`            |
| Mood        | `vaporwave`      | `#1a0a2e`, `#3d1a5c`, `#ff71ce`, `#01cdfe`, `#fffb96`            |
| Mood        | `forest`         | `#1a2e1a`, `#2d4a2d`, `#4a7c4a`, `#7ab37a`, `#c8e6c8`            |
| Mono        | `sepia`          | `#1a1610`, `#3d3020`, `#6b5a40`, `#a89070`, `#e8dcc8`            |
| Mono        | `blueprint`      | `#001830`, `#003060`, `#0050a0`, `#0080e0`, `#e0f0ff`            |
| HyperFrames | `warm-print`     | `#17121a`, `#824c50`, `#e09873`, `#f7ddb1`                       |
| HyperFrames | `electric-ink`   | `#080717`, `#3c185f`, `#7e2278`, `#d9339f`, `#ff6b66`, `#aafae0` |

Choose by inspected source and project language, not by palette name alone.
For example, `terminal` fits device/code language, `warm-print` fits editorial
print, and `synthwave` is an intentional stylization rather than generic polish.

`palette` must contain two to six exact `#RRGGBB` colors in authored order. Use
dark-to-light order for this treatment; the runtime validates colors but does
not reorder them, so reversing the array intentionally inverts the mapping.
Keep `dither` between `0.7` and `1` and `ditherSize` between `0.1` and `0.5`.
A finite reveal may author `--hf-color-grading-dither: 0` inline and tween it
to the chosen amount with GSAP. Judge the moving result at output resolution;
reject shimmer, lost subject structure, accidental muddy intermediate colors,
or a palette chosen without regard to the project's design language.

## Cached Error Diffusion

Use exact error diffusion for a deliberate 1-bit Macintosh, newspaper/print,
limited-palette game, or crunchy editorial treatment. It bakes a new image or
MP4 because every processed block depends on error from earlier blocks; it is
not a realtime shader setting.

Choose the algorithm by visible intent:

- `floyd-steinberg`: balanced default with organic fine texture.
- `atkinson`: higher-contrast, more open and distinctly early-Macintosh.
- `jarvis-judice-ninke`: smoother gradients with a wider 12-neighbor field.
- `stucki`: smooth, slightly sharper alternative to JJN.
- `burkes`: compact two-row texture.
- `sierra`, `sierra-lite`, `two-row-sierra`: progressively different
  speed/texture tradeoffs; use only after comparing frames.

Run the exact processor and register its output through the existing media
ledger/cache:

```bash
node <SKILL_DIR>/scripts/dither.mjs \
  --input .media/videos/video_001.mp4 \
  --out .media/generated/video_001.atkinson.mp4 \
  --algorithm atkinson \
  --palette '#17121a,#824c50,#e09873,#f7ddb1' \
  --point-size 3

node <SKILL_DIR>/scripts/resolve.mjs \
  --from .media/generated/video_001.atkinson.mp4 --type video --project .
```

Use the registered output path on a real `<img>` or `<video>`. Keep text,
captions, logos, and interface graphics outside the processed media. For a
finite reveal, overlap the original and processed media with identical framing
and crossfade or wipe them using the registered paused GSAP timeline. Do not
label the realtime Bayer shader as Floyd-Steinberg/Atkinson, and do not process
PQ/HLG footage without an explicit SDR tone-map decision.

## Organic Light Leak

Use for one motivated memory beat, time shift, warm scene handoff, or tactile
transition. It is a finite deterministic CSS/GSAP overlay, not a looping
texture, generic flash, or film-stock emulation.

Install the Registry overlay block:

```bash
npx hyperframes add organic-light-leak-overlay --no-clipboard
```

Insert the printed `data-composition-src` host at the intended beat and keep
its duration finite. Its paused timeline owns one rise, peak, and complete
recovery and scales those phases to the placed duration. Inspect the source
before, at the brightest frame, and after recovery. Reject clipped faces, an
unmotivated warm wash, visible black from incorrect blend mode, or a leak that
conceals the subject longer than the transition needs.

## Freeze-Frame Cutout

Use for a social introduction, speaker emphasis, chapter punctuation, sports
or creator beat, or a scrapbook/editorial hold. This requires a real alpha
matte; decoration may not conceal a poor subject edge.

Extract the exact deterministic source frame first, then remove its background:

```bash
ffmpeg -ss <seconds> -i <source-video> -frames:v 1 -y .media/generated/freeze-source.png
npx hyperframes remove-background .media/generated/freeze-source.png \
  -o .media/generated/freeze-cutout.png --json
npx hyperframes add freeze-frame-cutout --no-clipboard
```

Add the transparent result as a direct-root timed media layer and insert the
printed overlay block above the same time range. The block owns the paper,
tape, and flash; the host timeline only animates the real cutout:

```html
<img
  id="hf-freeze-cutout"
  class="clip"
  src="./.media/generated/freeze-cutout.png"
  alt=""
  data-start="6"
  data-duration="3"
  data-track-index="20"
/>
```

```js
tl.fromTo(
  "#hf-freeze-cutout",
  { y: 42, scale: 0.86, rotation: -2 },
  { y: 0, scale: 1, rotation: 0.4, duration: 0.5, ease: "back.out(1.35)" },
  freezeAt,
);
```

Inspect the matte over both light and dark temporary plates before styling it.
Reject missing hair/fingers, background halos, a cutout that changes identity,
overly thick outline, exposed frame edges, or a flash that obscures the reveal.
If the matte is not acceptable, choose another frame or keep the original media.

## Social Flash / Editorial Reveal

Use this treatment for one meaningful high-energy cut, creator reveal, product
beat, or before/after handoff. It is not a default transition for every scene.
Avoid it for calm long-form footage, accessibility-sensitive contexts, already
clipped highlights, literal UI that must remain readable through the cut, or
any request for repeated strobing.

Inspect representative frames on both sides of the cut first. Grade each media
layer for its own subject using the appropriate contract above; the flash is
not a substitute for correction. For people, a restrained `skin-soft` payload
is a safe starting point. For literal UI, preserve the pixels and use only the
authored light/motion layers when they do not obscure required information.

Install the Registry overlay block:

```bash
npx hyperframes add editorial-flash-overlay --no-clipboard
```

Insert the printed `data-composition-src` host so the block's midpoint lands
on the cut. Its own paused timeline drives the finite flash. The host timeline
may coordinate outgoing and incoming media motion without reaching into the
block:

```js
tl.to(
  "#outgoing-media",
  {
    scale: 1.035,
    "--hf-color-grading-exposure": 0.82,
    duration: 0.12,
    ease: "power3.in",
  },
  cutAt - 0.16,
);
tl.fromTo(
  "#incoming-media",
  { scale: 1.1 },
  { scale: 1, duration: 0.42, ease: "power3.out" },
  cutAt,
);
tl.to(
  "#incoming-media",
  {
    "--hf-color-grading-exposure": 0,
    "--hf-color-grading-intensity": 0.58,
    duration: 0.24,
    ease: "power2.out",
  },
  cutAt,
);
```

When the shader steps are used, author
`--hf-color-grading-exposure: 0.72` and
`--hf-color-grading-intensity: 0` inline on the incoming media so a fresh seek
has the correct start state. Set the final intensity to the source-approved
value instead of copying `0.58` blindly. Skip the shader intensity step when
the incoming source should remain ungraded.

Keep the rise between roughly `0.035` and `0.055` seconds and the recovery
between `0.24` and `0.38` seconds. Default to one neutral/warm flash event,
never saturated red, never a looping strobe, and never more than one authored
flash inside a one-second treatment window. Verify frames immediately before,
at, and after the cut, then inspect moving playback and a rendered draft. The
peak must hide the cut; the recovery must reveal a correctly framed source with
no retained prior canvas, clipped face, or unexpected highlight damage.
