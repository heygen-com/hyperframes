# Alpha-channel preservation for `<video>` extraction

## Problem

When a HyperFrames composition contains a `<video>` with an alpha channel —
WebM VP8/VP9 `yuva420p`, HEVC `yuva444p`, PNG-in-AVI `rgba`, QuickTime ProRes
4444, etc. — the alpha is silently dropped before the frame ever reaches
Chrome. The offending step is the ffmpeg pre-extract:

```
ffmpeg -i alpha.webm -vf fps=30 -q:v ... frame_%05d.jpg
```

1. Default output is **JPEG**, which has no alpha.
2. Even when output is forced to PNG (via `--format webm` / `--format mov`),
   the command omits `-pix_fmt rgba`, so ffmpeg may downconvert yuva → yuv and
   write an opaque RGB PNG.

Downstream the compositor works correctly — `<img>` data URIs preserve alpha,
Chrome's compositor handles blending — so a one-line extract fix unlocks
transparency for **every** output container, including opaque MP4.

## Approach

Added opt-in + auto-detect alpha preservation at the extraction stage. No
new CLI flag, no changes to the renderer / encoder.

1. **New `data-alpha` attribute** on `<video>` elements:
   - `data-alpha="true"` — force RGBA PNG extraction.
   - `data-alpha="false"` — force opaque (overrides auto-detect).
   - Absent / `"auto"` — auto-detect from ffprobe's `pix_fmt`.
2. **Auto-detection** via new `pixelFormatHasAlpha()` util. Flags the
   yuva-family, rgba/argb/bgra/abgr, rgba64, and ya8/ya16 gray-alpha formats.
3. **FFmpeg invocation** is switched to `format=rgba` + `-pix_fmt rgba` for
   alpha-bearing videos, with PNG forced. Other videos stay on JPEG at full
   speed — zero regression for existing compositions.
4. **Readiness wait bypass**: `frameCapture.initializeSession` no longer
   blocks on `video.readyState >= 1` for `data-alpha="true"` elements, since
   Chrome often can't decode the source codec (e.g. PNG-in-AVI) and the
   renderer swaps the `<video>` for an `<img>` before capture anyway.

## Files changed

| File                                                       | Summary                                                                                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine/src/utils/ffprobe.ts`                     | Added `pixelFormat` + `hasAlpha` to `VideoMetadata`; new `pixelFormatHasAlpha()` util.                                                               |
| `packages/engine/src/services/videoFrameExtractor.ts`      | Parse `data-alpha` into `VideoElement.hasAlpha`; force PNG+rgba extraction when alpha is in play; thread `hasAlpha` through `extractAllVideoFrames`. |
| `packages/engine/src/services/videoFrameExtractor.test.ts` | New tests for `data-alpha` parsing.                                                                                                                  |
| `packages/engine/src/services/frameCapture.ts`             | Skip the video-readyState gate for `data-alpha="true"` elements in both screenshot and BeginFrame paths.                                             |
| `packages/engine/src/index.ts`                             | Re-export `pixelFormatHasAlpha`.                                                                                                                     |
| `packages/producer/src/services/htmlCompiler.ts`           | Thread `hasAlpha` through browser-discovered media metadata.                                                                                         |
| `packages/producer/src/services/renderOrchestrator.ts`     | Carry `hasAlpha` into new `VideoElement` entries discovered via DOM probe.                                                                           |

## Usage

```html
<!-- Alpha-preserving video with explicit opt-in -->
<video
  id="lion"
  class="clip"
  data-start="0"
  data-duration="5.92"
  data-track-index="0"
  data-alpha="true"
  muted
  playsinline
  src="assets/lion_rgba.avi"
></video>
```

For well-tagged sources (e.g. WebM with `yuva420p` correctly advertised) the
`data-alpha="true"` attribute is optional — ffprobe auto-detection will set
the flag at extraction time.

## Test results

- **Unit**: `bun run test` for `@hyperframes/engine` — all 4 `parseVideoElements`
  tests pass, including 2 new ones for `data-alpha="true"` / `"false"`.
- **Smoke test**: 800×600 composition with a single PNG-in-AVI lion
  (`data-alpha="true"`) over a red div → `output.mp4` shows the red background
  through every transparent pixel of the lion. No black box, no fringe.
- **Integration**: 97.32 s / 1080p / 30 fps / 2920-frame VSL composition
  (`vsl-hf-reproduction/index.html`) with 13 alpha-tagged lion overlays
  composited on top of ~13 opaque background clips — rendered end-to-end in
  13m4s to a 79.6 MB MP4. Alpha preserved across all lion shots; no regression
  on the opaque background videos.

## Non-goals

- No changes to the `--format webm` / `--format mov` transparent-output path.
  Those already worked; this fix is about alpha on the _input_ side.
- No new CLI flag. The attribute-based API is consistent with existing
  `data-has-audio`, `data-media-start`, etc.
- No engine-wide pix_fmt override — RGBA is applied only to the specific
  videos that opt in or auto-detect as alpha-bearing.
