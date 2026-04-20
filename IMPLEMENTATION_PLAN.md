# HyperFrames Alpha Video Support — Implementation Plan

## Problem

HyperFrames renders HTML-based compositions to video via Puppeteer + FFmpeg.
When a source `<video>` has an alpha channel (transparent background, e.g.
WebM VP9 `yuva420p` or PNG-in-AVI `rgba`), the alpha is **dropped** during
frame extraction because `videoFrameExtractor.ts` uses JPEG output by default
and, even when PNG is forced (via `--format webm` / `--format mov`), FFmpeg
does not explicitly request `-pix_fmt rgba`, so yuv-flavored inputs lose
transparency and RGB PNGs are produced.

The downstream `<img>` injection pipeline (videoFrameInjector ->
screenshotService) is already alpha-capable — it feeds a data URI into an
`<img>` tag which Chrome blends correctly against whatever sits behind it.
**Fixing the extraction stage therefore unlocks alpha for ALL output formats
(mp4 / webm / mov)**: the DOM behind a transparent lion overlay will show
through even when the final container is opaque MP4, because the alpha
compositing happens inside Chrome before the screenshot is taken.

## Chosen Approach: A — FFmpeg pre-extract with RGBA PNG

HF already runs plan A internally. Minimum-touch fix:

1. Add `hasAlpha` detection at two levels:
   - **Explicit opt-in**: `<video data-alpha="true" ...>`.
   - **Auto-detection**: probe the source with ffprobe; if `pix_fmt` is one of
     `rgba`, `rgba64be/le`, `yuva420p`, `yuva444p`, `yuva422p`, `argb`, `bgra`,
     treat it as alpha-bearing.
2. When `hasAlpha` is true, force `format = "png"` in the extraction options
   and add `-pix_fmt rgba` plus `-c:v png` to the FFmpeg invocation for **that
   video only**. Other SDR / opaque videos continue extracting as JPEG at full
   speed — zero regression for existing compositions.
3. Plumb the bit through `VideoElement` so downstream consumers can be taught
   about alpha later if needed (e.g. to short-circuit the opaque MP4 encoder
   flags).

## Why this is the right scope

- The `<img>` injector already decodes PNG data URIs with alpha.
- `screenshotService.getCdpSession` already sets a transparent default
  background (line 113-118 in frameCapture.ts — when `options.format === "png"`).
  But that only matters when the OUTPUT is webm/mov. For opaque MP4 output
  our lion alpha should just blend correctly against the `<img>` of the
  background video already on the page.
- No changes needed in the injector / compositor / encoder paths — alpha is
  purely lost at extract time.

## Touch points (final)

| File                                                    | Change                                                                                                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine/src/utils/ffprobe.ts`                  | Add `pixelFormat` to `VideoMetadata`; parse `pix_fmt` from stream probe.                                                                    |
| `packages/engine/src/services/videoFrameExtractor.ts`   | Parse `data-alpha` attr into `VideoElement.hasAlpha`; auto-detect from probe; force PNG+rgba extraction; add alpha-preserving FFmpeg flags. |
| `packages/producer/src/services/videoFrameExtractor.ts` | Mirror above (producer re-exports engine).                                                                                                  |

## Testing

1. Unit: feed an AVI(rgba) through `extractVideoFramesRange`; assert a frame's PNG bytes include a non-255 alpha pixel.
2. Integration: render a tiny HTML with `<div style="background:red"><video data-alpha="true" src="lion_rgba.avi"></video></div>` at mp4 → the frame where lion overlays red must show red in the transparent regions.
3. VSL: rewire `vsl-hf-reproduction/index.html` lion sources to the RGBA AVIs, re-render, open output.mp4 — lion should no longer have a black box.

## Non-goals

- No new CLI flag — attribute-based API.
- No engine-wide `pix_fmt` override — rgba only applied to the videos that need it.
- No change to the `--format webm` / `--format mov` behaviour (it will still produce transparent output videos — independent axis).
