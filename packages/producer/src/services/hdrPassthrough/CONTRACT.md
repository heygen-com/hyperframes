# HDR video passthrough with cached overlays — dev contract

Internal notes for the engineers building this module in parallel. Line numbers
are against `origin/main` at the skeleton commit; re-grep if they drift.

## What it does

The HDR layered path (`capturePlan.kind === "hdr_layered"`) composites every
frame in Node: seek, inject, screenshot each DOM layer as a transparent PNG,
blend into rgb48le, pipe to a libx265 encoder. For one full-frame HDR video
under overlays that only change at known frames (captions, lower thirds), most
of that work repeats. The passthrough renders each distinct overlay state once
and lets one ffmpeg run composite those states onto the source video.

Opt-in, default off. Flag off = the orchestrator runs `runCaptureHdrStage`
exactly as before.

| Layer  | Name                                                                                         |
| ------ | -------------------------------------------------------------------------------------------- |
| CLI    | `--experimental-hdr-passthrough` (boolean, no default)                                       |
| Env    | `HF_EXPERIMENTAL_HDR_PASSTHROUGH` (the CLI sets it to `"true"` only when the flag is passed) |
| Config | `EngineConfig.experimentalHdrPassthrough` (default `false`)                                  |
| Docker | forwarded as `--experimental-hdr-passthrough`                                                |

## Data flow

```
renderOrchestrator (hdr_layered branch, inside observeRenderStage "capture_hdr_layered")
  └─ cfg.experimentalHdrPassthrough && hasHdrContent
       └─ attemptHdrPassthrough(hdrStageInput)                     index.ts
            ├─ createLazyOverlaySession(input)                     index.ts (implemented)
            ├─ checkPassthroughEligibility({ input, session })     eligibility.ts
            │     ├─ render / video gates (no page)
            │     ├─ session.get() → layout + animation gates
            │     └─ analyzeOverlayTiming({ session, videoId, … })  planner.ts
            │            → OverlayTiming { totalFrames, changeFrames }
            ├─ runHdrPassthrough(input, eligible, session)          index.ts (implemented)
            │     ├─ planOverlayStates({ timing, fps, w, h })       planner.ts  → OverlayPlan (candidates)
            │     ├─ captureOverlayStates({ … })                    overlayCapture.ts → CapturedOverlaySet
            │     │     probe every candidate (seek + overlayFingerprint.ts), capture new fingerprints,
            │     │     merge candidates that render the same overlay → CapturedOverlaySet.plan
            │     ├─ session.close()
            │     └─ compositeAndEncode({ plan: overlays.plan, … }) ffmpegComposite.ts → videoOnlyPath
            └─ finally session.close()
       outcome.kind === "completed" → stage result
       outcome.kind === "fallback"  → resetCaptureAttemptProgress(job); runCaptureHdrStage(hdrStageInput)
assembleStage muxes audio onto videoOnlyPath (unchanged, -c:v copy)
```

Fallback rules (keep these in the final design):

- Ineligible: logged as `[Render] HDR passthrough off: <reason> (<detail>)`, info level.
- Any throw from a stage: warning `HDR passthrough failed; falling back to the layered HDR composite`.
- Abort (`input.abortSignal.aborted` or an `AbortError`): rethrown, never a fallback.
- The overlay session is always closed before `attemptHdrPassthrough` returns.
- The layered encoder writes `videoOnlyPath` with `-y`, so a partial passthrough file is overwritten.

## Interfaces (all in `types.ts`)

- `HdrPassthroughInput = CaptureHdrStageInput`, `HdrPassthroughResult = CaptureHdrStageResult`. The orchestrator builds one input object for both paths.
- `LazyOverlaySession { get(), opened, close() }`: a DOM session set up like the layered `domSession` (screenshot mode, `initializeSession`, `initTransparentBackground(page, { clearCompositionRoot: true })`, the render's video-frame injector).
- `PassthroughEligibility`: `{ eligible: true, video: PassthroughVideo, timing: OverlayTiming }` or `{ eligible: false, reason: PassthroughIneligibleReason, detail? }`.
- `PassthroughVideo { id, srcPath, mediaStart, duration, fps, width, height, fit, transfer, primaries: "bt2020", colorSpace, metadata }`.
- `OverlayTiming { totalFrames, changeFrames }`: sorted, unique, each in `[1, totalFrames)`.
- `OverlayState { index, startFrame, endFrame, captureFrame }`: half-open interval. For a planned candidate `captureFrame = floor((start + end - 1) / 2)`; a merged (captured) state keeps the capture frame of the candidate it started at.
- `OverlayPlan { states, fps, totalFrames, width, height }`: states tile `[0, totalFrames)` with no gaps.
- `CapturedOverlay { state, pngPath, hash }`, `CapturedOverlaySet { overlays, plan, uniqueCount, candidateCount, captureCount, dir, captureMs }`: `plan` is the input plan with candidates merged, one state per run of identical overlay output; `overlays` has one entry per `plan.states`.
- `CompositeRequest { video, plan, overlays, encoder, hdr, outputPath, workDir, abortSignal, onFramesEncoded }` and `CompositeResult { encodeMs, framesEncoded, fileSize }`.
- `buildCompositeArgs(request, concatListPath): string[]` is pure, so it can be unit-tested at the argument level.
- Import types from `./types.js`. `index.ts` exports only `attemptHdrPassthrough` and `createLazyOverlaySession`, and `runHdrPassthrough` is internal.

Pixel contract (overlay capture ↔ composite): each PNG is 16-bit RGBA at canvas
size. RGB is `getSrgbToSignalLut(transfer)[srgb8]`, the same LUT
`blitRgba8OverRgb48le` uses. Alpha is `a8 * 257`, straight (not
premultiplied). The composite blends with `maskedmerge` in `gbrp16le`
(ffmpeg `overlay` blends RGB at 8 bits only), computing
`out = signal * a + video * (1 - a)`, the layered blend
(`alphaBlit.ts:429-486`), within 1 LSB at 16 bit. The video enters and leaves
the blend through packed `rgb48le`, the format the layered path extracts to
and pipes into its encoder: swscale's planar and packed RGB paths round chroma
differently, and only the packed path keeps the video pixels bit-identical to
the layered path where the overlay is transparent.

Capture dedup: the planner's states are candidates, a superset of the frames
where the overlay changes (a clip cut claims `round(t * fps) +/- 1`, a `set()`
the frames around it), about eight per caption cue. Capture seeks to every
candidate and reads a fingerprint of everything the overlay's pixels depend
on (`overlayFingerprint.ts`: DOM with attributes and text, CSSOM, scroll,
form and image state, CSS / Web Animation times, non-CSS values GSAP tweens
write), without the frame injector, which only writes the video's own nodes.
It screenshots only fingerprints it has not captured, through the unchanged
layered capture path, and folds a candidate into the state before it when the
fingerprint or the captured pixels match. A candidate whose overlay differs
in any way starts its own state, so a one-frame change is never merged away;
frames inside one candidate are taken on the planner's word, as before.

Measured on the harness `captions` fixtures (1080p HLG, one cue per 2 s,
before → after): 20 s, 84 candidates → 21 states, 84 → 11 screenshots,
overlay capture 6.8 s → 2.8 s; 60 s, 244 → 61 states, 244 → 31 screenshots,
overlay capture 20.4 s → 9.0 s (stage 45.4 s → 38.7 s, the rest is the
encode). Both outputs stay bit-identical to the layered path.

Progress and stall contract: overlay capture calls `noteStaticDedupActivity(job)`
for each state, which keeps the stall window open without counting as frame
progress, and reports in the 25–35% band. Encode drives `job.framesRendered`
from ffmpeg's encoded-frame count and reports 35–80%. `frameStallRule` only
sees `complete()` once every frame is encoded.

## Stage 2 frame deferral (`frameDeferral.ts`)

The passthrough reads the source file, never the frames Stage 2 decodes for
its video. With the flag on, the orchestrator asks Stage 2 to defer them when
`passthroughDefersFrameExtraction` passes: the eligibility gates known before
any probe (opt-in, not `force-sdr`, mp4, no alpha, no motion blur, no canvas
grading or master effects, exactly one local video that `qualifyVideoLayer`
accepts, no frame window or SDR video-layer passthrough). Stage 2 then probes
as before and, only when every video probes as native HDR, extracts with the
engine's `deferRangeExtraction`: each video gets its metadata and an exact
`totalFrames` with a `deferredRange` and no frames.

The deferred frames are extracted with `extractAllDeferredFrames` (the same
`extractVideoFramesRange` options a full extraction uses for a native HDR
source, into the folder the frame lookup already points at) before the first
route that reads them:

- after a passthrough fallback, inside the `capture_hdr_layered` stage, before
  `runCaptureHdrStage` (`captureHdrWithPassthrough`); ffmpeg progress ticks
  `noteStaticDedupActivity` so the stall rule sees liveness;
- before capture when the plan is anything but `hdr_layered` with HDR content;
- worker calibration reads just its sample frames, the way it does for a
  frame window.

A completed passthrough never extracts them. Stage 2's coverage gate is
applied again after the extraction. With the flag off nothing is deferred and
the scheduling is unchanged.

## Ownership

| File                         | Owner stream      | Notes                                                                           |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------- |
| `types.ts`                   | skeleton (shared) | Change only by agreement. Additive fields are fine.                             |
| `index.ts`                   | integration       | Orchestration, lazy session and fallback already implemented.                   |
| `eligibility.ts`             | eligibility       | `checkPassthroughEligibility`, `DEFAULT_MAX_OVERLAY_STATES`.                    |
| `planner.ts`                 | planner           | `analyzeOverlayTiming` (page) + `planOverlayStates` (pure).                     |
| `overlayCapture.ts`          | capture           | `captureOverlayStates`; needs a 16-bit RGBA PNG encoder (`encodePng` is 8-bit). |
| `ffmpegComposite.ts`         | composite         | `buildCompositeArgs`, `compositeAndEncode`.                                     |
| `renderOrchestrator.ts` hook | skeleton          | Done. Leave it alone unless the contract changes.                               |
| `frameDeferral.ts`           | extraction skip   | Stage 2 deferral gate, lazy extraction, passthrough-or-layered sequencing.      |

Each stream adds `<file>.test.ts` next to its file (`bun:test`, like the
sibling `index.test.ts`). The pure parts (`planOverlayStates`,
`buildCompositeArgs`, LUT mapping) need table tests.

## Existing helpers to reuse (file:line on origin/main)

Routing and orchestration (`packages/producer/src/services/`):

- `renderOrchestrator.ts:3755` `effectiveHdr = resolveEffectiveHdrMode(...)`; `:4044` `hasHdrContent`; `:4779` `useLayeredComposite`; `:4938` `preset = getEncoderPreset(...)`; `:4712` `videoOnlyPath`.
- `renderOrchestrator.ts:5020` hdr_layered branch; `:5072` passthrough hook; `:1251` `resetCaptureAttemptProgress`; `:1270` `frameStallRule`.
- `renderOrchestrator.ts:3595` the existing SDR `videoLayerPassthrough` gate (prior art, `HF_VIDEO_LAYER_PASSTHROUGH`).
- `render/stages/assembleStage.ts:133` `muxVideoWithAudio(videoOnlyPath, …)`. Audio needs no work here.

Layered HDR stage (`packages/producer/src/services/render/stages/`):

- `captureHdrStage.ts:83` `CaptureHdrStageInput`; `:125` `CaptureHdrStageResult`; `:137` `runCaptureHdrStage`.
- `captureHdrStage.ts:213` creates `domSession`; `:231` `initTransparentBackground`; `:269` the HDR `spawnStreamingEncoder` options to mirror exactly (codec, preset, quality, bitrate, `...deliveryEncoder`, `pixelFormat`, `hdr`, `useGpu`).
- `captureHdrSequentialLoop.ts:70` `runSequentialLayeredFrameLoop`; `:221` `job.framesRendered`; `:224` "Layered composite frame" progress.
- `captureHdrFrameShared.ts:144` `seekInjectAndQueryStacking`; `:179` `captureSceneIntoBuffer`; `:245` `applyDomLayerMask`; `:248` `captureAlphaPng`; `:256` `blitRgba8OverRgb48le`.
- `captureHdrResources.ts:69` `planHdrResources`; `:409` `extractHdrVideoFrames`; `:481` `ffmpegSeekSeconds(metadata, mediaStart)`; `:482` the extraction scale/crop filter (`force_original_aspect_ratio=increase,crop`); `:523` `-pix_fmt rgb48le`; `:588` `hdrWindowFfmpegArgs` (fps / start_time / trim logic that sets frame alignment).
- `../../hdrCompositor.ts:458` `shouldUseLayeredComposite`; `:466` `resolveCompositeTransfer`; `:473` `selectDomLayerShowIds`; `:534` `compositeHdrFrame`; `:719` / `:724` / `:737` mask → alpha PNG → blit.
- `../videoLayerPassthroughPlan.ts:25` `inspectVideoLayout` (in-page layout gate, reuse as is); `:97` `planVideoLayerPassthrough`.
- `../shared.ts:47` `CompositionMetadata`; `:320` `reportFrameProgress`; `:442` `noteStaticDedupActivity`.

Engine (`packages/engine/src/`, all exported from `@hyperframes/engine`):

- `config.ts:84` / `:318` / `:374` / `:926` `experimentalHdrPassthrough` field, default, boolean list, env read.
- `utils/alphaBlit.ts:407` `getSrgbToSignalLut` (newly exported, no behaviour change); `:398` the HLG/PQ LUT build; `:429` `blitRgba8OverRgb48le`; `:205` `decodePng`; `:258` `encodePng` (8-bit only); `:295` `decodePngToRgb48le`.
- `services/screenshotService.ts:312` `initTransparentBackground`; `:351` `captureAlphaPng`; `:423` `applyDomLayerMask`; `:582` `removeDomLayerMask`.
- `services/frameCapture.ts:3838` `computeStaticFrameSet(page, fps, ignoredVideoIds)` (newly exported); `:3819` the ineligibility causes; `:4058` the static-frame rule.
- `services/streamingEncoder.ts:234` `buildStreamingArgs`; `:392` `-x265-params`; `:433` the bt2020 colour tags; `:458` `hdrFrameTagsFilter` on the frame; `:470` the existing ffmpeg `overlay` filter graph for the SDR video layer (prior art); `:513` `spawnStreamingEncoder`.
- `services/chunkEncoder.ts:169` `getEncoderPreset`; `:295` `buildEncoderArgs`; `:504` HDR transfer tag; `:881` `muxVideoWithAudio`.
- `utils/hdr.ts:92` `getHdrEncoderColorParams`; `:109` `hdrFrameTagsFilter`; `:34` `detectTransfer`.
- `utils/ffprobe.ts:576` `ffmpegSeekSeconds`; `services/videoFrameExtractor.ts:117` `VideoElement`; `:1290` `buildVideoLayerInput` (SDR only, but shows the seek and tail-pad pattern); `services/videoLayerPassthrough.ts:10` `qualifyVideoLayer`.
- `utils/runFfmpeg.ts:211` `runFfmpeg`.

Core: `packages/core/src/runtime/authoredTiming.ts:27` `resolveAuthoredTimingWindow` (clip `data-start` / `data-duration` windows).

CLI: `packages/cli/src/commands/render.ts:499` arg + help; `render/plan.ts:503` env mapping, `:701` plan field; `render/execute.ts:226` Docker option; `utils/dockerRunArgs.ts:205` Docker forward.

## Known gaps for v1

- After a fallback, `job.progress` is monotonic, so the percentage can sit still until the layered path passes where the passthrough stopped.
- The stage is still observed as `capture_hdr_layered`, and `hdrPerf` is `undefined` on the passthrough path.
- v1 is mp4-only, with no alpha, no HDR images and no shader transitions (see the eligibility gates).
