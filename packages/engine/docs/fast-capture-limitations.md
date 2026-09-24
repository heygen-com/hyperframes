# Fast-capture (`drawElementImage`) gates and limitations

`canvas.drawElementImage(element, x, y)` reads DOM paint records directly into
a canvas, skipping the full compositor + `Page.captureScreenshot` GPU→CPU
readback IPC that the baseline capture path pays on every frame. On a
hardware GPU this is measurably faster (~46% in the original eval); on a
software rasterizer (SwiftShader — see Limitation 1) it is not.

The technique reads paint records rather than compositing pixels, so it
cannot faithfully reproduce every CSS/compositor feature. Rather than ship
silently-damaged frames, the engine gates ahead of time on the conditions
below and falls back to the platform's baseline capture (screenshot or
BeginFrame, whichever the render already launched with) whenever one applies.
Every fallback is logged with a `[engine] fast capture: falling back to ...`
message naming the trigger; the low-cardinality trigger is also recorded on
the render session (`deGateReason` / `deFallbackTrigger`) for telemetry.

This document is the canonical reference those log lines and source comments
point at. Limitation numbers below are load-bearing — several call sites
across `packages/engine`, `packages/producer`, and CI cite a specific `Lim N`
by number, so an existing number must never be reassigned to a different
limitation.

## Limitation 1 — SwiftShader (software rasterizer)

drawElementImage's entire advantage is skipping the GPU→CPU screenshot
readback. On a software rasterizer (Docker/CI with no GPU — SwiftShader) both
the drawElement and screenshot paths block on identical software
rasterization, so drawElement is parity-or-slower (measured: font-variant
baseline 7822ms vs. fast 7979ms). On a transparent destination it is also
strictly worse: SwiftShader drops compositor-promoted sub-layers on a
transparent canvas (Chromium bug 521434899). The speedup is only real on a
hardware GPU (macOS, ~1.6×), so SwiftShader always routes to the platform
baseline unconditionally — this is the one gate `HF_FORCE_DRAWELEMENT=1`
still overrides, since it exists purely for upstream-Chromium repro work.

Source: `resolveDrawElementCaptureMode` in
`packages/engine/src/services/drawElementService.ts`.

## Limitation 2 — Video composition capture

Two gates that used to force every `<video>`-containing composition to the
screenshot path were removed once Chrome 151 fixed crbug 521861819
(`drawElementImage` dropping compositor-promoted opacity layers mid-fade):
the `<video>` gate itself (a proxy for the word-by-word caption opacity
pattern) and a related stacked-fade gate (≥2 overlapping viewport-scale
opacity-fade targets). Both reproduced on Chrome ≤150 (video+caption-fade
~12 dB; stacked fade 24.5 dB) and both render correctly on 151, the pinned
floor (video+nested-fade repro verified PSNR=inf; a second case went
24.5→47.4 dB with 0 damaged frames).

Removing those gates means a video comp is no longer *forced* to screenshot
for that (now-fixed) reason — but drawElement capturing a **fresh** video
frame each frame still depends on the browser repainting every frame, which
only chrome-headless-shell's per-frame `HeadlessExperimental.beginFrame`
guarantees (Linux). On a free-running (non-BeginFrame) launch the canvas's
paint record can go stale between frames. Because of this, video comps that
initialize before the frame injector is attached (probe sessions) defer the
rest of drawElement init rather than risk capturing black `<video>` boxes as
ground truth (see `deInitDeferred` in `frameCapture.ts`).

`packages/producer/scripts/validate-fast-video.ts` and the manual
`.github/workflows/fast-video-validation.yml` workflow exist to confirm the
BeginFrame-driven Linux path end-to-end (native amd64 Linux only — Docker on
Rosetta hangs, and macOS has no BeginFrame). As of this writing that
validation run has not been re-confirmed since the Chrome 151 gate removal
above, so their own inline comments still describe fast-capture video as
failing "on any platform yet" — treat that specific claim as stale pending a
fresh run, not as evidence the gate removal was wrong.

Sources: `packages/engine/src/services/drawElementService.ts`,
`packages/engine/src/services/frameCapture.ts` (video-comp deferred init),
`packages/producer/src/services/render/stages/compileStage.ts`.

## Limitation 3 — CSS effects `drawElementImage` cannot reproduce

`detectCssEffectRisk` (`packages/engine/src/services/threeDProjection.ts`)
scans for effects that render differently — or not at all — through the
paint-record path than through the full compositor, and gates to screenshot
if any is found:

- `backdrop-filter` — samples the pixels *behind* the element from the
  compositor backdrop. drawElementImage captures the element subtree in
  isolation with no backdrop, so the filtered region is simply wrong
  (measured 18–49 dB damage across the community eval).
- `filter: blur()` / `filter: drop-shadow()` — render differently through the
  paint-record path than the full compositor (a Chromium inconsistency,
  drop-shadow-on-SVG especially; ~29 dB).
- `mix-blend-mode` (any non-`normal` value) — a compositor blending stage
  drawElementImage's isolated paint record doesn't go through.
  `animation-name` with a nonzero duration — assumed effect-bearing and
  gated conservatively rather than resolved per-property.
- A WebGL context animated only via non-`requestAnimationFrame` means (e.g.
  GSAP-driven uniforms) freezes under seek-based capture: the accelerated-
  canvas composite draws whatever the GL context last rendered, which never
  advances between seeks (~19 dB). Any WebGL context under the composition
  root is therefore treated as a fallback signal, seek-invariant, checked via
  the accel-canvas registry recorded at context creation.

Detection runs four ways, seek-free (computed styles at t0, stylesheet
rules, GSAP tween vars, and the WebGL registry) — deliberately conservative,
since seeking the timeline before the gate decision would corrupt GSAP's
lazily-cached tween start values for every comp entering the drawElement
branch, gated or not. `HF_FAST_CAPTURE_CSSFX=true` bypasses this gate for
R&D only.

## Limitation 4 — CSS 3D rendering contexts

drawElementImage paints CSS 3D rendering contexts incorrectly:
`backface-visibility: hidden` is ignored (mid-flip elements capture their
mirrored backface), siblings of the 3D context can drop out of the paint
record, and the 3D context's own background can be lost. Reproduced on macOS
hardware GPU with real-world flip-card / `rotationX` entrance compositions
(full-stream PSNR 27–46 dB avg, 17 dB min vs. baseline).

Rather than fall back wholesale, the engine rewrites CSS 3D contexts into
WebGL-projected canvases before drawElement capture begins (see
`initThreeDProjection` in `threeDProjection.ts`) — this only gates to
screenshot if that rewrite itself fails to initialize
(`deGateReason: "3d_init_failed"`). Detection for whether the *compile-time*
3D gate even applies runs on pre-CDN-inline HTML specifically to avoid
false-positiving on GSAP's own source, which contains the string
`transformPerspective`. `HF_FAST_CAPTURE_3D=true` bypasses for R&D.

Source: `packages/producer/src/services/render/stages/compileStage.ts`,
`packages/engine/src/services/threeDProjection.ts`.

## Limitation 5 — Supersampled output (`deviceScaleFactor` > 1)

`drawElementImage` reads the canvas at CSS pixels and has no equivalent of
`Page.captureScreenshot`'s clip+scale — it would silently capture at 1x and
drop the requested supersample. Any render requesting `deviceScaleFactor` > 1
falls through to screenshot capture unconditionally
(`deGateReason: "supersampling"`); there is no bypass flag, since there is no
correct way for drawElement to honor the scale factor at all today.

Source: `packages/engine/src/services/frameCapture.ts`
(`initDrawElementOrTransparentBackground`).

## Limitation 6 — Clip-cut boundary frames

A hard scene swap at an authored clip-cut boundary (a `[data-start]` /
`[data-duration]` edge) changes content with no tween driving it. The frames
immediately around each boundary (±1) are captured via screenshot instead of
drawElement so the post-cut frame is captured fresh rather than potentially
reusing a stale paint record, and so later static-hold frames in the new
scene dedup against the correct content. This is a narrow, per-frame
override, not a whole-render fallback — everything outside the boundary
window still captures via drawElement.

Source: `computeClipBoundaryFrames` / `computeAuthoredClipBoundaryFrames` in
`packages/engine/src/services/frameCapture.ts`. Opt-out:
`HF_FAST_CAPTURE_BOUNDARY_SS=false`. Regression-guarded by
`packages/producer/de-canary-suite.sh`.

## Limitation 7 — Timeline at-risk predictor

`drawElementImage` can drop mid-tween effects on compositor-incompatible
properties (blend-mode, 3D transforms, `clip-path`, `mask` — `opacity`/
`filter` fades were removed from this set once Chrome 151 fixed crbug
521861819, see Limitation 2). Whether a *given* tween on one of these
properties is actually dropped can't be determined reliably by rendering
(jump-seek behavior differs from sequential playback) or by geometry (size is
a proxy, not the mechanism) — the only deterministic, zero-damage-risk route
is to gate on the *presence* of any such tween, a static fact of the declared
GSAP timeline that is the same on every run.

This is intentionally conservative: comps whose specific at-risk tweens
drawElement would actually have handled correctly still fall back, trading
some fast-capture eligibility for a correctness guarantee. Static comps and
comps using only plain 2D transforms (x/y/scale are not in the at-risk set)
are unaffected. Tune the gate's frame-fraction floor with
`HF_FAST_CAPTURE_INTERVAL_FRACTION` (default `0`, i.e. any at-risk frame
gates the whole comp) or disable with `HF_FAST_CAPTURE_INTERVAL_SS=false`.

Source: `computeTimelineAtRiskFrames` in
`packages/engine/src/services/frameCapture.ts`.

## Operational requirements (not per-composition gates)

These route to fallback the same way as the limitations above, but they are
properties of the render host/environment rather than of the composition
being rendered:

- **Chrome build support** (`deGateReason: "unsupported_chrome"`) —
  `canvas.drawElementImage` is an unlaunched Blink feature only present on
  recent Dev/Canary Chrome (~151+), absent from Stable and from most pinned
  system Chrome installs. Probed with a cheap capability check before any
  other drawElement work; without it, calling the method on an unsupported
  build throws deep inside the capture loop and takes the whole render down.
  Run `hyperframes browser ensure --force` to fetch a supported build, or set
  `HYPERFRAMES_BROWSER_PATH` to one.
- **`ffmpeg` with the `psnr` filter** (`deGateReason: "ffmpeg_no_psnr_filter"`)
  — drawElement's disk-sample self-verification shells to
  `ffmpeg -lavfi psnr`. A host `ffmpeg` missing or built without
  `libpostproc` can't run that filter, so the safety net that catches
  compositor damage would silently fail open; the engine falls back instead
  of shipping unverified frames. Install an `ffmpeg` build with
  `libpostproc`, or set `HYPERFRAMES_FFMPEG_PATH` to one.
- **Explicit render-mode compatibility hints**
  (`deGateReason: "render_mode_hint"`) — an upstream routing decision (e.g. a
  raw `requestAnimationFrame` composition) already forced screenshot capture
  for correctness reasons unrelated to any of the gates above; drawElement
  never overrides that hint.

## Runtime (per-frame) fallback, not a gate

Even once a render is running on the drawElement path, two specific
in-page errors are treated as recoverable and fall back to a per-frame
screenshot rather than aborting the whole render:

- `HF_DE_CANVAS_NOT_INITIALIZED` — the capture canvas wasn't set up yet on
  this frame (seen at frame 0 on some macOS/Chrome combinations). The
  composition root is still present, so a screenshot captures valid content.
- The native `InvalidStateError: No cached paint record for element`
  DOMException `drawElementImage` itself throws.

A third, similarly-named error — `HF_DE_COMPOSITION_ROOT_MISSING` — is
deliberately **not** recoverable: if the composition root itself is missing
(a navigated-away or broken page), there is no valid content left to
screenshot, so that case hard-fails the render instead of silently capturing
blank output.

Source: `isRecoverableDrawElementError` and
`DE_CANVAS_NOT_INITIALIZED_CODE` in
`packages/engine/src/services/drawElementService.ts` and
`packages/engine/src/services/frameCapture.ts`.
