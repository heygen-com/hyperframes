# HDR video passthrough with cached overlays

Experimental, opt-in. Off by default; with the flag off the render takes the
layered HDR composite exactly as before.

| Layer  | Name                                                                |
| ------ | ------------------------------------------------------------------- |
| CLI    | `--experimental-hdr-passthrough` (also forwarded to Docker renders) |
| Env    | `HF_EXPERIMENTAL_HDR_PASSTHROUGH=true`                              |
| Config | `EngineConfig.experimentalHdrPassthrough` (default `false`)         |

## Why

The layered HDR path composites every frame in Node: seek, inject the decoded
video frame, screenshot each DOM layer as a transparent PNG, blend into
`rgb48le`, pipe to the encoder. For the common case of one full-frame HDR
video under overlays that only change now and then (captions, lower thirds,
titles), almost all of that work repeats. The passthrough renders each
distinct overlay once and lets one ffmpeg run composite those overlays onto
the source video while it encodes.

## Flow

```
capture_hdr_layered stage (renderOrchestrator)
  └─ flag on and HDR content: attemptHdrPassthrough            index.ts
       ├─ checkPassthroughEligibility                           eligibility.ts
       │    render / video gates, in-page layout gates, animation gates,
       │    analyzeOverlayTiming → frames where the overlay can change,
       │    hf-seek listeners on window (DevTools listener lookup)
       ├─ planOverlayStates → candidate states                  planner.ts
       ├─ captureOverlayStates → one PNG per distinct overlay   overlayCapture.ts
       │    probe each candidate (seek + overlayFingerprint.ts),
       │    screenshot only unseen fingerprints, merge identical neighbours,
       │    re-probe each candidate's ends and every 0.5 s inside it
       └─ compositeAndEncode → videoOnlyPath                    ffmpegComposite.ts
     completed → assemble muxes audio as usual
     fallback  → (extract deferred video frames) → runCaptureHdrStage
```

Fallback rules:

- An ineligible composition logs `[Render] HDR passthrough off: <reason> (<detail>)`
  at info level and takes the layered path.
- A frame the planner called static that renders a different overlay
  (overlay capture's verification probes) logs `HDR passthrough off:
overlay_unverified (...)` and takes the layered path.
- Any other error inside the passthrough logs `HDR passthrough failed; falling back
to the layered HDR composite` and takes the layered path. The layered
  encoder overwrites any partial output.
- An abort is rethrown, never turned into a fallback.
- The overlay browser session is always closed before the layered path starts.

## Eligibility

The passthrough runs only when it can reproduce the layered output:

- mp4 output, HDR (HLG or PQ) in the encoder's transfer, no alpha output, no
  output scaling, no HDR images, no shader transitions, no motion blur, no
  canvas grading or master effects;
- exactly one local, native-HDR, constant-frame-rate video that covers the
  canvas for the whole composition, untransformed, unfiltered, fully opaque,
  with no border radius or clipping ancestor, no blend mode, nothing painted
  under it, `object-fit` that maps it 1:1 (or a same-aspect cover scale), no
  loop, playback-rate change or late start;
- overlays that change only at frames the planner can see: clip windows and
  GSAP tweens or `set()` calls. Anything animating on its own clock declines
  (CSS / Web Animations, canvas, iframes, frame sources, timeline callbacks,
  Lottie and other adapters, three.js / WebGPU, SVG SMIL, animated GIF / WebP /
  APNG / AVIF, `hf-seek` listeners on `window`), as does a run of per-frame
  changes longer than a short transition, or more states than the analysis
  limit. A seek-driven writer none of these name (a setter on a runtime
  global, a wrapped runtime function) is caught by capture's verification
  probes when it changes the overlay on a probed frame.

`PassthroughIneligibleReason` in `types.ts` lists every reason.

## Pixel contract

Overlay capture and the composite agree on one format so the output matches
the layered path:

- Each overlay PNG is 16-bit RGBA at canvas size. RGB is
  `getSrgbToSignalLut(transfer)[srgb8]`, the LUT the layered blend
  (`blitRgba8OverRgb48le`) uses. Alpha is `a8 * 257`, straight, not
  premultiplied.
- The composite seeks the source exactly as the layered frame extraction does
  (`ffmpegSeekSeconds`, negative when every stream starts after 0 and
  `mediaStart` sits inside that lead, so the first frame is held until the
  stream starts), converts it to packed `rgb48le` exactly as that extraction
  does, blends at 16 bits with `maskedmerge` in
  `gbrp16le` (`out = round(signal * a + video * (1 - a))`, the layered blend),
  and converts back to `rgb48le` before the encoder's own frame
  filter. ffmpeg's `overlay` filter blends RGB at 8 bits and is not used.
- The encoder options are the ones the layered stage gives
  `spawnStreamingEncoder` (codec, preset, CRF or bitrate, delivery caps, GOP
  lock, GPU selection, x265 colour parameters, BT.2020 tags); only the raw
  stdin input and `-vf` are replaced by the file inputs and the composite
  graph.

On the generated fixtures the result is bit-identical to the layered render
with ffmpeg 7. `maskedmerge` rounds differently on older ffmpeg (4.2 is 1 LSB
off on about a sixth of partial-alpha samples), which the parity thresholds
absorb; the harness records the ffmpeg version in each report.

## Capture dedup

The planner's states are candidates: a superset of the frames where the
overlay can change (a clip cut claims the frames around it, a `set()` the
frames around its time). Capture seeks to each candidate and reads a
fingerprint of everything the overlay's pixels depend on: DOM attributes and
text (including open shadow roots), normalised inline styles, the CSSOM,
scroll and form state, image and font load state, CSS / Web Animation times,
non-CSS values written by GSAP tweens, and the stacking order. The video's own
nodes and script text are left out. A new fingerprint is captured through the
unchanged layered capture path; a repeated one reuses its PNG; a candidate
whose fingerprint or captured pixels match the state before it is merged into
it. A candidate whose overlay differs in any way starts its own state, so a
one-frame change is never merged away.

The frames between capture frames are the planner's word. When a merged
state closes, each of its candidates is probed again at its first and last
frame and at least every 0.5 s in between. A fingerprint the state has not
seen is screenshotted; pixels that differ from the state's fall back
(`overlay_unverified`) rather than ship a stale overlay. On the caption
fixtures this adds about two probes (about 20 ms each) per cue.

## Video frame extraction

The passthrough reads the source file directly and never uses the decoded
frames the video-extract stage writes for the layered path. With the flag on,
when the gates that need no probe pass (`frameDeferral.ts`), that stage only
probes and defers the decode. The frames are extracted later, into the folder
the frame lookup already uses, only if something needs them: a passthrough
fallback, any capture route other than the HDR layered one, or worker
calibration (sample frames only). A completed passthrough never decodes them.

## Progress

Overlay capture reports in the 25–35% band and keeps the stall watchdog alive
per state. The encode drives `framesRendered` from ffmpeg's frame count and
reports 35–80%.

## Limitations

- After a fallback the progress percentage can sit still until the layered
  path passes the point where the passthrough stopped.
- The stage is still reported as `capture_hdr_layered`, and HDR per-frame perf
  stats are not collected on the passthrough path.
- mp4 only; no alpha, HDR images or shader transitions.
- The fingerprint cannot see inside closed shadow roots.
- Verification samples frames: an undetected driver that changes the overlay
  only between probes (a blip shorter than 0.5 s inside a long candidate,
  away from its ends) is not caught.
- `hf-seek` listeners are read once, after the page loads; one added later
  is left to the verification probes.
- With a warm extraction cache, deferral costs a probe (about 0.3 s) that a
  cache hit would not.

## Validation

The parity harness in `src/hdr-passthrough-harness/` renders a composition
with the flag off and on and compares the outputs, and generates HLG and PQ
caption fixtures plus one negative fixture per fallback class. On 1080p30
caption fixtures from 20 s to 3 min, HLG and PQ, the passthrough output
decodes to the same frames as the layered render, 9-14x faster (a 16 min
render takes about 13 min instead of an estimated 2.4 h); its "Measured"
section has the numbers.
