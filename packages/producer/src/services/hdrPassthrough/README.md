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
       ├─ each overlay page (analysis, then capture), with      overlayPages.ts
       │    the render's capture options but private memos and
       │    no shared reference-background read, watched from
       │    the moment it opens:
       │    scripts by exact text as V8 compiles them           scriptOrigins.ts
       │    analysis page: registrations while it loads         registrationWatch.ts
       │      (debugger pauses)
       │    capture page: no debugger while it loads (scripts   unpausedWatch.ts
       │      replayed once ready, after call counts start),
       │      builtins captured by a new-document script
       │    builtins captured before any page script            mainWorld.ts
       │    images and stylesheets it loads                     ownClock.ts
       │    call counts from load                               pageCodeWatch.ts
       ├─ checkPassthroughEligibility on the analysis page      eligibility.ts
       │    render / video gates, ffmpeg blend self-test         ffmpegBlendCheck.ts
       │    DevTools-only page gates, before any seek or         overlayPageGates.ts
       │    in-page probe: registrations, untrusted compiles,
       │    replaced builtins, what a seek runs that the page    seekReachable.ts
       │    provided (listeners, GSAP callbacks and targets)
       │    in-page layout gates, animation gates,
       │    analyzeOverlayTiming → frames where the overlay can change,
       │    hf-seek listeners on window (DevTools listener lookup),
       │    content gates: DOM snapshot (unreadable content,     overlayPageGates.ts
       │    other videos, element allowlist), CSS allowlist,      ownClock.ts
       │    images by their bytes (SVG parsed as XML,            svgImage.ts
       │    allowlisted); the DevTools-only gates again;
       │    then decline if any page function ran there since
       │    load; close the analysis page
       ├─ planOverlayStates → candidate states                  planner.ts
       ├─ a fresh capture page: the DevTools-only gates before
       │    its first seek, its load census matched to the       loadCensus.ts
       │    analysis page's (every observer by the function its  observerCallbacks.ts
       │    callback runs, from a heap snapshot taken first;
       │    every other count equal; the page unchanged by the
       │    census's own reads), then the layered DOM session's
       │    steps before frame 0 (scene reads, the seek and
       │    stacking query at the video's start)
       ├─ captureOverlayStates → one PNG per distinct overlay   overlayCapture.ts
       │    walk every frame once, in order (seek + fingerprint  overlayFingerprint.ts
       │    in an isolated world, hashed in Node), screenshot    isolatedWorld.ts
       │    only unseen fingerprints, fold candidates that
       │    render the same overlay, decline a frame that
       │    differs from its candidate's first,
       │    hold the video's own layer to the analysis page's
       │    on every probe, hand each settled frame's PNG to
       │    the composite,
       │    then run the page and content gates again and
       │    decline if any page function ran since load          pageCodeWatch.ts
       └─ compositeAndEncode → videoOnlyPath, alongside capture  ffmpegComposite.ts
            ffmpeg composites to raw rgb48le, a few frames
            ahead; the layered encoder (spawnStreamingEncoder,
            the layered options) takes one frame at a time,       encoderPacing.ts
            each once its threads are idle, once its process
            is proven to be the ffmpeg running libx265 (its
            executable, its libx265 thread, no child)
            completed → the render records the reference background the capture page read
     completed → assemble muxes audio as usual
     fallback  → (extract deferred video frames) → runCaptureHdrStage
```

Fallback rules:

- An ineligible composition logs `[Render] HDR passthrough off: <reason> (<detail>)`
  at info level and takes the layered path.
- A frame the planner called static that renders a different overlay
  (overlay capture's verification probes) logs `HDR passthrough off:
overlay_unverified (...)` and takes the layered path. A page callback that
  runs on seeks and was first registered during capture logs
  `HDR passthrough off: seek_callback (...)` the same way, as does any page
  function that ran after the overlay page loaded (see "Page code on seeks"
  below).
  Content the fingerprint cannot read that first appeared during capture logs
  `HDR passthrough off: overlay_unreadable (...)`, content that paints on
  its own clock logs `overlay_non_gsap_animation` (or `video_count` for a
  video) the same way, and a frame where the
  video's own layer is not the one the composite lays logs
  `HDR passthrough off: video_animated (...)`, and an encoder process the
  encode cannot be paced by logs `HDR passthrough off: ffmpeg_unsupported
  (...)`. A decline in capture or in the gates after it stops the composite
  and the encode that run beside capture.
- Any other error inside the passthrough logs `HDR passthrough failed; falling back
to the layered HDR composite` and takes the layered path. The layered
  encoder overwrites any partial output. When the composite or the encoder
  had exited on its own (out of memory, a signal), the error names its exit
  code, signal and stderr tail, also behind a bare `write EPIPE`
  (`processExits`). The error is the first failure, read before anything is
  stopped: the overlay feed failing on the composite's closed input once the
  encode loop stopped it no longer replaces the loop's own error ("the
  composite stopped reading overlays" said nothing). A pacing decline whose
  encoder then exits (its threads go before the process does: on a host out
  of memory) is that failure, the encoder's exit named, not a decline.
- An abort is rethrown, never turned into a fallback.
- Both overlay pages are always closed before the layered path starts, and
  neither changes what the layered DOM session does ("Two pages" below):
  after a fallback the layered path renders exactly as with the flag off.

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
- an ffmpeg whose `maskedmerge` rounds exactly like the layered blend (see
  "ffmpeg" below; `ffmpeg_unsupported` otherwise), and a software libx265
  encode by an ffmpeg process the encode can be paced by: no GPU encode,
  and a process proven to be the ffmpeg running libx265 for this render, not
  a wrapper around one (see "Encoder pacing"; `ffmpeg_unsupported`
  otherwise);
- nothing the page registered while it loaded that runs on seeks or on a
  clock of its own: no animation-frame callback, no timer whose callback is
  a string or a builtin, no observer, no custom element definition, no
  worker, offscreen canvas, worklet, view transition or `window.open`
  (`seek_callback`; see "Registrations" below);
- no script compiled in the page's main world with nothing on the stack and
  no embedding document whose text the renderer did not send (a
  `javascript:` URL, a string timer), and no script in another realm
  (`seek_callback`; see "Page code on seeks");
- no builtin the page replaced with anything but script: a builtin, bound
  function, callable Proxy or WebAssembly export in place of a builtin, a
  getter, or a prototype (`seek_callback`; see "Probes the page cannot
  reach");
- no page code that runs on seeks: GSAP's ticker has no listener but GSAP's
  and the renderer's, nothing plays on GSAP's global timeline outside the
  registered timelines and nothing paused there holds a callback (a
  `gsap.delayedCall`), and any page function that runs after load declines
  (`seek_callback`; see "History-dependent drivers" and "Page code on
  seeks");
- no callback that runs no page script where a seek reaches it: a builtin,
  bound function, callable Proxy or WebAssembly export as an event listener
  or `on*` handler anywhere, a tween target's accessor or Proxy trap, a
  tween value or callback, a setter on a runtime global (`seek_callback`;
  see "Callbacks that run no page script");
- GSAP tweens that write only elements: a tween that writes anything to a
  plain object, a text node, a stylesheet rule or any other non-element
  declines (`seek_callback`); a tween whose vars hold only settings (the
  runtime's filler tweens of `{}`) writes nothing and passes;
- no overlay content the capture fingerprint cannot read: a closed shadow
  root, or an `<iframe>`, `<object>`, `<embed>` or frame anywhere, shadow
  trees included (`overlay_unreadable`; see "Capture dedup" below);
- overlay content from the accepted set only (`ownClock.ts`; see "Content
  allowlists" below): static HTML and SVG elements, the one source video,
  `<audio>`, and the `::before`, `::after` and `::marker` pseudo-elements;
  CSS whose pseudo-elements are static ones and that has no `paint()`; and
  images whose bytes are a single-frame GIF, PNG, WebP, AVIF/HEIF, JPEG, BMP
  or ICO, or an SVG that parses, as XML, to static elements and CSS. Anything
  else declines (`overlay_unsupported`, or `overlay_non_gsap_animation` for
  an animated image), as do a `<video>` besides the source (`video_count`),
  an `<audio controls>`, a `<marquee>` and an indeterminate `<progress>`,
  all read from the DOM snapshot, which pierces every shadow tree;
- overlays that change only at frames the planner can see: clip windows and
  GSAP tweens or `set()` calls. Anything else animating on its own clock
  declines (CSS / Web Animations, including inside open shadow roots, which
  `document.getAnimations()` does not list; Lottie and other adapters;
  three.js / WebGPU; `hf-seek` listeners on `window`; timeline callbacks),
  as does a run of per-frame changes longer than a short transition, or
  more states than the analysis limit;
- a video that holds still on every frame: the gates above sample its layout
  at nine times, and capture checks its layer on every frame it probes
  (`video_animated`; see "Capture dedup" below).

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
- The overlays reach the composite on its stdin, one PNG per output frame
  (`image2pipe` at the output rate), as capture settles each frame: the
  frame's state PNG, decoded by the same PNG decoder as before, so the
  composite's raw frames are byte for byte the ones a playlist of each
  state's PNG held for its frames gives (`ffmpegComposite.integration.test.ts`
  compares the two).
- The composite writes those `rgb48le` frames as raw video to a pipe, and
  the encoder is the layered stage's own: `spawnStreamingEncoder` with the
  options the layered stage gives it (codec, preset, CRF or bitrate,
  delivery caps, GOP lock, GPU selection, HDR transfer, raw `rgb48le`
  input), so its command line, `-vf` frame filter and thread count are the
  layered encoder's byte for byte, and frames reach it through the same
  `writeFrame`. Raw frames carry no side data, as the layered path's do: the
  source's mastering display, content light level and Dolby Vision metadata
  never reach the encoder. The harness compares the stream's side data and
  every side data value on the first frame, not just the types.
- The encoder gets one frame at a time, each once it has gone idle after
  the previous one ("Encoder pacing" below).

On the generated fixtures, including the rational-rate, odd-canvas,
fractional-duration and deep-seek edge cases, the result is bit-identical to
the layered render with ffmpeg 7.0 and with 8.0 (the version the Dockerfiles
and CI pin); the HEVC bitstream is byte-identical to the layered encoder's
for the same frames.

## Encoder pacing

libx265 encodes up to 16 frames at once (`frame-threads`), with its
lookahead and rate control beside the frame encoders on one thread pool.
For identical frames and options its bitstream still depends on when the
frames arrive. On the recorded inputs of a 3 s `control` render that
differed (90 frames), 20 to 40 encodes at a time on a host at load average
140-320, by HEVC bitstream:

| how frames reach the encoder                                 | runs | differ from the rest |
| ------------------------------------------------------------ | ---- | -------------------- |
| the old in-process composite (graph straight into libx265)   | 60   | 0 (1 of 10 earlier)  |
| `yuv420p10le` from a file, as fast as it reads               | 160  | 15                   |
| `rgb48le` on stdin as fast as it reads, layered command line | 60   | 4                    |
| the same, `-x265-params frame-threads=1`                     | 40   | 0 (another stream)   |
| `rgb48le` piped from a separate composite process            | 80   | 0                    |
| one frame every 0.1 s or 0.3 s                               | 40   | 0                    |
| one frame each time the encoder's threads are idle           | 60   | 0                    |

Every paced run, and the majority of every other row, is byte for byte the
flag-off render's bitstream (the old composite's bitstream differed in
bytes but decoded the same). The filter graph's own frames were identical
on every run (80 framemd5s).
The divergence starts at a referenced B-frame whose average QP moves (22.8
to 5.7 in one run, with its intra share up fivefold) and spreads to every
frame after it; the frame types stay the same. Fed as fast as it can
encode, input queues up while earlier frames are in flight, and which work
runs before which on the shared pool is timing. The layered path never
queues: capture hands the encoder one frame at a time, far slower than it
encodes, so each frame finds the encoder idle, and the flag-off bitstream
repeats. The composite used to feed its in-process encoder straight from
the filter graph and was in the first row: 3 of about 20 renders under load
decoded different from flag off across whole frames.

So `compositeAndEncode` reads the composite's raw frames and hands each to
the layered encoder only once none of the encoder process's threads is
running or in uninterruptible wait, three polls in a row 2 ms apart
(`/proc/<pid>/task/<tid>/stat`). Where the thread states cannot be read
(not Linux) eligibility declines with `ffmpeg_unsupported`. A frame that
does not go idle within 120 s fails the attempt, which falls back.

The threads read must be the ones running libx265 for this render.
`HYPERFRAMES_FFMPEG_PATH` can name a wrapper, and a name proves nothing: a
binary named `ffmpeg` that starts the real encoder outside its own process
tree (a delayed double fork, a daemon, `setsid`) is, by the time it is
read, a process with no child, whose threads stay idle while the real
encoder runs; every frame then goes in unpaced, and 2 of 10 such renders
under load decoded different from flag off. A GPU encoder's work does not
show as thread states at all. So `watchEncoder` (`encoderPacing.ts`) proves
the spawned process is the encoder before any frame is paced on it, and
the passthrough declines (`ffmpeg_unsupported`, the layered path takes
over) on anything it cannot prove:

- at eligibility, when GPU encode is selected (`useGpu`, whatever encoder
  the host has) or the codec is not h265;
- before the composite starts, unless, within 2 s (a just-spawned process
  may still be this one's fork, a script exec-ing ffmpeg in place, or an
  ffmpeg mapping its libraries): the executable the process runs
  (`/proc/<pid>/exe`, opened, not looked up by name) is an ELF file that,
  run with `-buildconf` (the same file: device and inode match), reports
  `--enable-libx265`, and holds libx265's own code, its banner in the file
  (a static build) or a mapped `libx265` (a shared one); and the process is
  still this one's child, in its process group and session, with no
  process of its own at any depth (`/proc/<pid>/task/*/children`). A
  script runs its interpreter, a wrapper binary holds no libx265: both
  decline. A symlink to ffmpeg, a renamed copy and a script that execs
  ffmpeg in place run ffmpeg itself and pass;
- after the first frame, unless its idle wait finds ffmpeg's libx265
  encoder thread in the process itself (`enc0:0:libx265`; ffmpeg 7.0 and
  later name it, so an older ffmpeg declines). That wait counts idle polls
  only once the process runs more than one thread (ffmpeg starts its
  pipeline on its first frame) and that thread is among them: on a loaded
  host ffmpeg can sit idle, its first threads up, before it starts the
  encoder's (1 of 16 concurrent renders declined on that before), so it
  declines only once the process has been idle without one for 10 s
  (`LIBX265_THREAD_WAIT_MS`);
- before every frame, unless the process is still the one proven (same
  executable, lineage, no child), and on every poll after the first frame,
  unless that libx265 thread and every thread present once the first frame
  went idle (x265's pool) are still there. A listing that misses one is
  read again (up to three times) before the thread counts as gone, and the
  decline names it: on a loaded host one `/proc` read in a long encode can
  fail for another reason than the thread exiting (1 of 24 concurrent
  renders declined mid-encode on a single listing before);
- when a poll finds no thread states to read: an unread encoder is not an
  idle one.

The wrappers the verify used (C binaries named `ffmpeg`: a double fork, the
same a second into the encode, a daemon in a new session, a child in a new
session, a plain fork, a shell script) all decline and render identical to
flag off through the layered path; ffmpeg itself, a symlink, a renamed
copy and both an ELF and a script that exec ffmpeg in place take the
passthrough and decode identical to flag off
(`encoderPacing.integration.test.ts` runs the same shapes).

A wrapper also leaves its child holding the composite's pipes when the
composite is stopped, which kept the encode from ever settling (the stage
stalled and the render failed instead of falling back). The composite's
pipes are now closed from this side when it stops, so its child ends too.

The pacing itself is unchanged: one frame at a time, each once the encoder
is idle. What changed is what runs beside it. The composite runs a few
frames ahead of the encoder (`readAhead`: up to 4, at most 64 MiB of
frames), so the next frame is ready when the encoder goes idle instead of
being decoded and blended after it; and the composite and encode start as
soon as the capture page has replayed the layered session's prelude, taking
each frame as capture settles it, so capture runs alongside the encode
instead of before it. Nothing reaches the encoder any faster or in any
other pattern than before, so the bitstream is the same; what is left of
the encode is the encoder's own per-frame latency, which grows with the
host's load. Where that latency comes from inside x265 (which race in its
lookahead, frame threads or rate control the pacing avoids) was not pinned
down, so the encoder is never fed faster than one frame per idle.

## ffmpeg

`maskedmerge`'s 16-bit rounding is a property of the ffmpeg build: 7.0 and
8.0 match the layered blend on every sample, 4.2 is 1 LSB off on about a
sixth of the partial-alpha ones, and 5.x / 6.x have not been measured. So
eligibility does not trust a version number. Once per process and ffmpeg
binary (the one `runFfmpeg` resolves, so the one the composite runs), it
blends a 256x64 frame through the composite's own blend filters
(`buildBlendFilters`): every 8-bit alpha, random overlay and video colours,
and the 0 / 65535 extremes, 49152 samples. It compares the result with
`blitRgba8OverRgb48le` on the same pixels and declines with
`ffmpeg_unsupported` unless every sample matches; an ffmpeg that cannot run
the check declines too. The check takes about 0.15 s. On 4.2.7 it logs
`HDR passthrough off: ffmpeg_unsupported (/usr/bin/ffmpeg: maskedmerge misses
the layered blend on 7748 of 49152 samples (up to 1 LSB))`.

## Two pages

Eligibility seeks all over the composition: nine layout samples, the timing
analysis, the probes the gates make. A seek leaves browser state behind
that no later seek undoes, with no page code running at all: a scroller
whose content a `set()` shrinks at 1 s clamps a 1500 px `scrollTop` to 100,
and growing the content back does not restore it; a `loading=lazy` image a
`set()` shows at 1.5 s loads once a seek shows it, and the `decode()`
promise the page took at load then runs its reaction (a bound
`showPopover`), which keeps the popover open. Capture on that page saw the
clamped offset and the open popover on every frame, frames before the
trigger included, and every probe agreed with every other probe, so
nothing declined; the layered render, which seeks in order from load,
shows neither before the trigger. Self-consistency between probes cannot
detect history.

So eligibility runs on an analysis page, and capture on a second page
opened fresh once eligibility passes (the analysis page is closed first,
after any page function that ran on it since load declines with
`seek_callback`). The capture page:

- loads with the same capture options as the layered DOM session
  (`overlayPages.ts`, below), and is watched from outside like the analysis
  page but never paused ("The capture page is never paused"); the
  DevTools-only gates, with its load census against the analysis page's,
  run before its first seek;
- takes the layered DOM session's steps before frame 0
  (`runCaptureHdrStage`): the transparent background, the scene reads
  (`readLayeredScenes`), and the seek, frame injection and stacking query at
  each native HDR start time (`probeHdrExtractionDims`);
- visits every frame once, in ascending order, as the layered loop does: a
  frame is reached from the frame before it, never from a later one, and a
  screenshot only follows the probe of its own frame (`writeOverlayStates`).

Browser state a seek leaves behind is then, at every frame, the state the
layered render has there. A seek-driven reaction that runs on the wall clock
(a decode, a font load) still lands where the fingerprint reads it (image
and font load state, `:popover-open`): a change at a frame the planner
called static declines (`overlay_unverified`).

A render's capture sessions also share state through their options, and
the first session to reach it changes what the later ones do. The page's
reference background is read once per render
(`recordReferenceBackground`), and the read seeks the page to 0; whichever
session asks first runs it and every later session skips it. The overlay
page used to ask first, which took that seek away from the layered DOM
session after a fallback: a page that counts its seeks (`raf-counter`)
showed `n=4` at frame 0 where flag off shows `n=5`. Now the analysis page
never reads it, and the capture page reads it exactly when the layered
session would have (no session has yet, `ReferenceBackgroundRecorder.started`),
keeps the value, and hands it to the render's recorder only once the
passthrough completes, when no layered session runs. The sub-timeline wait
and static-dedup memos are copied for each overlay page: it sees what the
layered session would, and what it adds stays its own.

## History-dependent drivers

The layered path seeks every frame once, in order, and so does capture's
walk; but eligibility's probes, the capture page's extra probe and capture
seeks and its two seeks of a captured frame are seeks the layered path
does not make. A driver whose output depends on the time alone renders the
same either way, which the verification probes check frame by frame. Page
code that keeps state across seeks does not, and its probes can agree with
each other while disagreeing with the layered render: a
`requestAnimationFrame` counter that shows "WAIT" for its first three
callbacks has stopped changing long before capture starts; a film-time
interval that appends a mark fires once per seek that passes its time.

Such drivers are found from outside the page ("Registrations" below), and
any page function that runs after an overlay page loads declines ("Page
code on seeks"). GSAP's own ticker also runs from an animation frame and
renders GSAP's global timeline on its own clock, the seeks it has seen so
far, lag-smoothed: the registered timelines and the roots they hang from
are seeked to film time by the runtime, but anything else that plays there
(a `gsap.delayedCall`, a tween of a plain object, an unregistered timeline,
element target or not) fires on that clock, which capture's out-of-order
seeks do not share with the layered path. So the passthrough declines
(`seek_callback`) any playing child of the global timeline off a registered
timeline's chain, any paused one holding a callback, and any ticker
listener that is not GSAP's or the renderer's. GSAP drops a fired
`delayedCall` from the global timeline, so this is read before
eligibility's first seek as well as after the analysis and after capture.

## Nothing in the page

The passthrough installs nothing in any page it does not open itself. Every
render, flag on or off, SDR or HDR, passthrough taken or not, serves the
virtual-time shim exactly as it is without the feature (`VIRTUAL_TIME_SHIM`
in `fileServer.ts`); the layered path, including after a fallback, renders a
page the passthrough never touched. The passthrough's own overlay pages,
opened only once the render, video and ffmpeg gates have passed (so only
for an HDR render that will attempt it), get no wrapper or global either:
everything below is read through DevTools, from a second session, and from
an isolated world. On the capture page one script DevTools adds to the new
document takes the builtin capture before any page script runs and keeps
it under a random 128-bit name in the global lexical scope, which no page
script can list. What a page can observe is timing: on the analysis page
the debugger pauses while it loads ("Registrations") and reports every
compile, which makes compiling many times slower; the capture page loads
with no debugger ("The capture page is never paused"); on both,
`Runtime.queryObjects` and the census's heap snapshot collect garbage,
which a page that watches its own collection can notice. A `WeakRef` needs
page code to read it, which the page code watch counts. A
`FinalizationRegistry` runs its cleanup with no page script on the stack
once a target is collected: `gc-tenured-remove` handed one a bound
`Element#remove` for a tenured target, so the overlay pages' collections
removed a box the layered render, which never collects it that early,
kept (0/90 frames identical). The census now reads every live registry's
cleanup from the heap snapshot like an observer's callback, and one that
is not the renderer's script declines (`seek_callback`).

## The capture page is never paused

A page can time the analysis page's pauses on a clock the shim does not
replace (`Event#timeStamp` around a `setTimeout` the watch breaks on, the
start times of `performance.mark()` around one) and paint differently when
it was paused. When capture ran on a page watched the same way, it was
paused too and painted that way, while the layered session, never paused,
painted the other: `dbg-timer` decoded 0/90 identical to flag off. Now:

- The capture page loads with no debugger at all. With the debugger
  enabled, V8 reports every compile to DevTools (`Debugger.scriptParsed`),
  which makes compiling many times slower, and a page can time that while
  it loads: `dbg-compile-detect` timed 3000 tiny `eval`s against 3000
  `JSON.parse` calls on `Event#timeStamp`, a ratio of 3.5 in the layered
  session and 40-84 on the capture page as it was, and painted "WATCHED"
  above 15. The analysis page and the capture page both had the debugger,
  so they agreed with each other, and the passthrough shipped the watched
  paint (0/90 frames identical to flag off). Now the capture page's script
  record starts only once the page is ready (`scriptOrigins.ts`,
  `observe()`), after V8's call counts start: `Debugger.enable` replays
  every live script then, and any page code that runs once the debugger is
  on, and so could time it, is counted and declines. What the debugger
  reports before then (the engine enables it for a moment to name the site
  of a page error, in the layered session too) is ignored. The breakpoints are
  deactivated as soon as the debugger is on (`Debugger.setBreakpointsActive`),
  so no breakpoint, instrumentation breakpoint or page `debugger` statement
  pauses the page. A pause that happens anyway declines.
- Its builtins are captured by a new-document script instead of at a
  paused first statement (`unpausedWatch.ts`).
- What it registered while it loaded is not watched there but read once
  it is ready, before its first seek, and matched to the same read of the
  analysis page (`loadCensus.ts`), whose watch saw who registered each of
  its own:
  - every live observer (mutation, resize, intersection, performance,
    reporting), and every live `FinalizationRegistry` by its cleanup, by
    the function its callback runs, from a V8 heap snapshot
    (`observerCallbacks.ts`): Blink holds each script-made observer's
    `V8...Callback`, directly or through its delegate, whether or not any
    script still references the observer, and the callback closure's
    script and position name the function. On either page an observer
    whose callback is a builtin, a bound function or page script declines;
    on the capture page so does one whose renderer function no
    analysis-page observer of the same kind runs (a renderer function the
    page handed to an observer itself). They are matched by function, not
    counted: the runtime makes some of its observers only once a
    wall-clock wait finishes, so the same page holds 5 or 7 of them from
    one load to the next. Blink's own observers (media controls, lazy
    loading) hold a C++ delegate, run no script and are left out; a
    snapshot that holds fewer script-made observers of a kind than
    `Runtime.queryObjects` finds JS objects of it declines;
  - counts that must be equal on both pages, either way: live workers,
    offscreen canvases and view transitions (`Runtime.queryObjects` on
    prototypes the capture took), defined custom elements and customized
    built-ins in the document and its open shadow roots, service worker
    registrations, the shim's pending animation-frame callbacks and
    film-time timers whose callback is page script or no script (read from
    the shim's closure over DevTools; the runtime's own vary load to load
    and are left out), and windows the page opened.

  Anything else declines (`seek_callback`). Before this, the census
  counted observers and allowed the capture page fewer than the analysis
  page held, for the runtime's variance: a page that timed the analysis
  page's pauses and made one `MutationObserver` with a bound builtin
  callback only on the capture page fit inside that slack whenever the
  runtime happened to make fewer of its own there, and took the
  passthrough with 0/90 frames identical (`unp-mo-append`).

- Its video layer must equal the analysis page's at frame 0, on every frame
  (`createVideoLayerGuard`), so a page that lays out its video differently
  when not paused declines (`video_animated`).
- Everything eligibility concluded on the analysis page that capture uses
  is checked again on the capture page: the plan's states by the
  verification probes and per-state pixel consistency, the DevTools-only
  and content gates, the call counts.

The analysis page still pauses. A page that paints differently when paused
then shows the analysis page's paint in the plan and the capture page's in
the PNGs; the capture page's own probes and screenshots are the ones that
reach the output, and they are the unpaused page's, as the layered
session's are.

## Registrations

What a page registers to run on seeks or on its own clock cannot be read
back once registered: nothing reads an observer's callback, the registry's
lifecycle callbacks or a timer's, and wrapping the constructors in the page
changes what the page sees (`String(MutationObserver)`, an error's stack).
`registrationWatch.ts` watches the analysis page's registrations as they
happen, from outside, with the debugger (the capture page is never paused,
and is compared with the analysis page instead: "The capture page is never
paused"):

- every script's first statement pauses until the page's own scripts start.
  At the first one in a document, before any page script has run, the main
  world's builtins are captured (`CAPTURE_SOURCE` in `mainWorld.ts`) and a
  function-call breakpoint goes on each registration builtin, the captured
  originals: the observer constructors, `CustomElementRegistry#define`,
  `Worker`, `SharedWorker`, service worker registration,
  `Worklet#addModule`, `transferControlToOffscreen`, `OffscreenCanvas`,
  `startViewTransition` and `window.open`. Aliases, `Reflect.construct` and
  bound copies all reach the same function;
- at the first statement of the first script that is not the renderer's
  (the shim has run by then), breakpoints go on the shim's
  `requestAnimationFrame`, `setTimeout` and `setInterval` too. Every
  breakpoint goes when the page reports ready: after that a registration
  needs page code to run, which the page code watch counts, or a builtin to
  run from a route the other gates already decline (a listener, a timer or
  an observer registered while the page loaded);
- each pause names its caller from the paused stack, whose script is the
  renderer's only by its exact text (`scriptOrigins.ts`). A registration from
  anything else declines, as does one with no script on the stack (a
  builtin calling it). A page timer passes when its callback is page script
  (it runs on the wall clock while the page loads, and the page code watch
  counts it if it runs later); a string or builtin callback declines.

The pause reads the stack from the debugger: no `Error` is made, so the
page's `Error.prototype.name` and `message` getters and
`Error.prepareStackTrace` never run. A page `debugger` statement pauses too
and is resumed at once. A second document in the page (a navigation the page
makes) declines.

## Page code on seeks

The fingerprint reads what paints through the DOM, the CSSOM and the paint
state it lists ("Capture dedup"). Page code that runs on a seek can change
what paints where it does not read, and can keep state across seeks,
through a setter on `__hfTypegpuTime`, a replaced `__hf.seek`, an accessor
on a GSAP tween target, a custom element reacting to an attribute GSAP
writes. Every probe then fingerprints equal while the pixels differ, and no
screenshot is taken.

So fingerprints stand in for pixels only while no page code runs after the
overlay page loads. `pageCodeWatch.ts` turns on V8's precise call counts
(`Profiler.startPreciseCoverage` with `callCount`, which resets the counts)
once the overlay page is ready, before eligibility's first probe, and reads
them after capture. Any function that ran in a script that is neither the
renderer's nor GSAP's declines the passthrough with `seek_callback`, naming
the first one.

Whose a script is never comes from its URL or from how it was compiled:
`//# sourceURL=` names a script anything, and a `javascript:` URL or a
string timer compiles with nothing on the stack and no embedding document,
exactly as a DevTools evaluation does. `scriptOrigins.ts` records every
script on the overlay page as V8 compiles it (`Debugger.scriptParsed`): on
the analysis page from the moment it opens, on the capture page from when
it is ready, when enabling the debugger replays every script still alive
(see "The capture page is never paused"). A script is the renderer's only
by identity:

- its text is, byte for byte (SHA-256), one the renderer put in the page:
  the file server's injected scripts (`injectedScriptTexts`), the compiler's
  seek reapply (`POSITION_SEEK_REAPPLY_SCRIPT`), and every script the
  renderer sends the page over DevTools (`addScriptToEvaluateOnNewDocument`,
  `Runtime.evaluate`, `Runtime.callFunctionOn`, `evaluateOnCallFrame`),
  recorded as each is sent on every session the page has, from before the
  engine sets the page up (the capture session's `onPageOpened` hook);
- or it was compiled in an isolated world, which page script cannot reach.

A main-world script compiled with nothing on the stack and no embedding
document whose text is not one of those declines at once, run again or
not, as does any script compiled in another frame's main world (another
realm, whose builtins none of the checks reach). GSAP is a published build
(`gsapBuilds.ts`: the core bundle, `CustomEase` and `EasePack`, 3.10.0 and
later, minified or not), by SHA-256 of the script as served or as the
compiler inlines it; a file only named like one is the page's. A script
never seen being compiled is the page's. A script the capture page's
replay reports was compiled before the record started, and the replay
carries no compile stack: it is the renderer's or GSAP's by its text alone
and the page's otherwise, and the "nothing on the stack" decline cannot
apply to it. That is not needed: such a compile happened while the capture
page loaded as the layered session's page does, and any of its functions
that runs after the page is ready is counted. (A dynamically inserted
`<script>` has no embedding document either, so declining every replayed
script without one would decline pages that build their scripts as they
load.) The analysis page still sees every compile and declines one made
with nothing on the stack. The runtime and GSAP write only
what the fingerprint reads: DOM attributes and styles, and the native
properties of the elements GSAP's tweens target, which the fingerprint
reads back.

A record that cannot be started or read declines too.

## Probes the page cannot reach

The passthrough's own probes must not run anything the page can replace:
a page that replaced `SubtleCrypto#digest`, `TextEncoder#encode` or
`JSON.stringify` with a builtin returning a constant made an in-page
fingerprint hash the same on every frame. So:

- the fingerprint and the other DOM probes (the video's corner radius, the
  stylesheet scan) run in a DevTools isolated world (`isolatedWorld.ts`),
  which shares the DOM, CSSOM and paint state but has builtins of its own,
  and return plain data; the fingerprint is hashed in Node;
- what lives only in the main world (the timelines, their tweens' vars and
  targets, the runtime's globals, GSAP's ticker) is read with
  `Runtime.getProperties`, which never calls a getter or a Proxy trap
  (`seekReachable.ts`), from references the capture took before any page
  script ran. Object identity comes from the capture's `identify`, which
  runs on the captured `Map`. The runtime's own `window.gsap` getter (the
  early stub's) is renderer code and is called; any other accessor there
  declines;
- before any of the probes that still run in the main world (the engine's
  layout probe and static-frame analysis, the planner's timeline walk, the
  video animation gate), every builtin is compared with the capture
  (`findChangedIntrinsics`): every own property of the global object and of
  every global constructor and its prototype, `Math`, `JSON`, `Reflect`,
  `Intl`, `CSS`, `console` and the iterator prototypes. A slot whose value,
  getter or setter is now anything but script, or a prototype that changed,
  declines; a page-script replacement passes (the page code watch counts it
  if a probe calls it), as does a renderer one (the shim's timers) and one
  of the same object's own builtins under another name (the runtime keeps
  `Element.prototype.animate` as `__hfOriginalAnimate`). So those probes call
  the browser's builtins or page script.

## Callbacks that run no page script

V8's call counts see functions compiled from page script. A builtin, a
bound function, a callable Proxy or a WebAssembly export runs none, and the
page can hand one to the browser or the renderer to call on a seek:
`new MutationObserver(HTMLElement.prototype.showPopover.bind(pop))` on an
element a GSAP `set()` writes at 1.5 s opens the popover the first time
eligibility's layout samples seek past 1.5 s, and from then on every probe
and capture has it, frames before 1.5 s included, with no page function
counted and every fingerprint equal. The layered path opens it at frame 45.
Each such callback declines with `seek_callback`, read where it lives:

- event listeners and `on*` handlers, through the DevTools protocol, which
  reads them without calling anything: every node of the composed tree
  (`DOMDebugger.getEventListeners` on the document, piercing shadow trees and
  frames) and every other event target the page holds (`Runtime.queryObjects`
  on the captured `EventTarget.prototype`: window, workers, message ports,
  font sets, media query lists, animations). A handler counts when it has no
  source location, prints as native code (a WebAssembly export), is bound to
  one or is a Proxy with such a trap;
- what the renderer and GSAP call on the page's objects on a seek
  (`seekReachable.ts`): the registered timelines and `window.__timelines`,
  the page's accessors on `window.__hf*` globals (the runtime assigns
  `__hfTypegpuTime` and `__hfThreeTime` on every seek), every function value
  and accessor in tween vars, through plain objects and arrays (GSAP calls a
  function-based value on the tween's first render), the timelines' own
  methods and their prototypes', and the tween targets' accessors for the
  keys the tweens write, on the targets and along their prototype chains. A
  platform accessor (`scrollTop`) is native and passes: it prints as
  `function set scrollTop() { [native code] }`. A Proxy on a chain declines;
- observers and custom element definitions, where they are made: any
  declines ("Registrations"), whatever its callback is.

These are read before eligibility's first seek (a native listener added
with `once` is gone after it fires), after the timing analysis, and again
after capture.

The fingerprint reads the paint state such a builtin can set with no page
script running, so that a change that depends on the time alone at least
takes a screenshot: the pseudo-classes the browser keeps (`:popover-open`,
`:modal`, `:open`, `:target`, `:fullscreen`, `:autofill`, `:user-invalid`,
`:invalid`, `option:checked`, `:default`, `:focus-visible`,
`:not(:defined)`), the custom states the page's CSS names (`:state(x)`),
the document selection, each text control's selection, custom highlights
(`CSS.highlights`), `designMode` and the URL fragment.

## Content allowlists

Capture renders each distinct overlay once and reuses it across frames,
which is right only for content whose pixels follow the seek. Content that
paints from a clock of its own (an animated image, a canvas a worker draws,
a caret, a media control's progress) differs between frames the
fingerprint calls equal. Earlier versions declined each such thing by name,
and each review found another place one could hide (a pseudo-element the
list did not name, a canvas in a shadow root). `ownClock.ts` lists what is
accepted instead, and everything else declines:

- elements, from the DevTools DOM snapshot (which pierces every shadow
  tree; user-agent shadow trees are the browser's parts of an accepted
  element): static HTML (text, sections, lists, tables, images, `<picture>`,
  `<slot>`, `<template>`, scripts and styles), static SVG (shapes, text,
  gradients, patterns, masks, clip paths, filters, `<image>`, `<use>`,
  `<foreignObject>`), `<audio>` and the source `<video>`; pseudo-element
  nodes `::before`, `::after` and `::marker`. No canvas, form control,
  `<select>` or `<option>`, `<details>`, `<dialog>`, custom element, SVG
  animation element, MathML or any element this list does not name
  (`overlay_unsupported`);
- CSS, every stylesheet in the document, its open shadow roots (their own
  and adopted sheets) and `@import`s, read in the isolated world, plus
  inline styles and the loaded text of any sheet whose rules cannot be read
  (cross-origin): pseudo-elements from a list of static ones (`::before`,
  `::after`, `::marker`, `::first-line`, `::first-letter`, `::selection`,
  `::placeholder`, `::backdrop`, `::highlight()`, `::part()`, `::slotted()`,
  the `-webkit-scrollbar` family), no `paint()`, and no `scroll-behavior`
  but `auto` ("Motion on the browser's clock" below; `overlay_unsupported`);
- images: every image the page loads, whoever references it and however
  (an element, a pseudo-element, a border or mask, a `data:` or `blob:`
  URL), is read from the network record (`Network.enable` on the
  passthrough's own session from before the page navigates) and decoded far
  enough to tell: a single-frame GIF, a PNG without `acTL` frames, a WebP
  without animation, an AVIF/HEIF that is no sequence, a JPEG, BMP or ICO,
  or an SVG that is static once parsed (below). Anything else, or bytes
  that cannot be read, declines (`overlay_non_gsap_animation`); after
  capture an image still loading declines too.

An SVG shown as an image runs no script and loads nothing, but SMIL and CSS
animations in it play on the browser's clock, and capture would freeze it.
A scan of the raw bytes for animation names missed what reaches the browser
only after XML parsing: a SMIL element under a prefix bound to the SVG
namespace (`<s:animate>`), and CSS spelled with character references inside
`<style>` (`anim&#97;tion`, `&#64;keyframes`). `svgImage.ts` parses the
document as the browser's XML parser reads it, with namespaces resolved and
references decoded, and declines anything it does not read exactly: a
DOCTYPE (an internal subset can define entities), an entity other than the
five predefined ones, a processing instruction but the XML declaration, an
unbound prefix, malformed markup. Every SVG-namespace element must be on a
list of static ones by exact local name (no animation element, `<discard>`,
`<image>`, `<feImage>`, `<foreignObject>`, `<script>` or anything unlisted),
an element of another namespace must sit inside `<metadata>`, and the
decoded `<style>` text and `style` attributes must have no `animation`,
`transition` or `keyframes`, no CSS escape, no `@import`, and no `data:` or
`url()` but a fragment; no attribute may hold a `data:` URL, an external
`href` or `url()`, or an event handler. The parser reads the whole image:
one over 4 MiB declines. It used to read the first 4 MiB only, so whatever
followed that prefix (a static SVG, then more past the limit) was never
looked at.

An `<audio>` element paints nothing without controls; one whose controls
GSAP turns on mid-composition is in the fingerprint with its playback
position (the runtime seeks it), so frames with controls never merge and
the verification probes decline (`overlay_unverified`).

## Motion on the browser's clock

A GSAP `set()` of `scrollTop` on a scroller with `scroll-behavior: smooth`
starts a scroll the browser runs on its own clock, with no page code. The
probe right after the seek still reads the old offset, so the jump frame's
fingerprint equals the frame before it and capture reuses that state's PNG,
while the layered render's screenshot, taken later in the same frame, shows
the new position. A realistic 3 s HLG template (GSAP captions, logo, lower
third, local fonts, music) with a twelve-line credits scroller jumped twice
took the passthrough and decoded 35 of 90 frames identical to flag off: the
two jump frames showed the previous scroll position (36 dB in the scroller
crop), and the rest was x265 carrying that difference. Every probe agreed
with every other, `getAnimations()` does not list a smooth scroll, and the
page code watch saw no page code. A tween that sets `scrollBehavior` to
`smooth` at 1.0 s and back to `auto` at 2.6 s did the same (21/90), and so
did one that sets it to `smooth`, writes `scrollTop` and sets it back to
`auto` at one time position (26/90): Chrome keeps animating a smooth scroll
once it started, so no probe ever reads a smooth value. The layered render
is not repeatable there either: its screenshot catches the scroll wherever
the browser's clock has it, and two flag-off renders of the template on a
loaded host differ in the scroller at the first jump frame (13487 pixels,
up to 110 of 255), so a fallback can match flag off only as well as flag
off matches itself.

So the passthrough declines (`overlay_unsupported`) wherever smooth
scrolling can come from:

- CSS: any `scroll-behavior` declaration but `auto` (`smooth`, `inherit`,
  a `var()`) in a stylesheet, an open shadow root's sheets, an `@import` or
  an inline style, read with the other CSS gates (`ownClock.ts`);
- GSAP: any tween that writes `scroll-behavior`, as a key in any spelling
  GSAP resolves (`scrollBehavior`, `"scroll-behavior"`, inside `css` or
  `startAt`) or as a string that names it or holds a CSS escape (`attr:
{ style }`), found in the vars walk (`seekReachable.ts`);
- every probe: the fingerprint reads each element's computed
  `scroll-behavior` (the root's is the viewport's), open shadow trees
  included, and a probe where one is not `auto` throws `BrowserClockError`
  (`overlayFingerprint.ts`). This holds for a value no text scan reads
  (an escaped property name in a cross-origin sheet). An element outside
  the flat tree (a shadow host's unslotted child) has no computed style and
  no box to scroll.

A CSS transition is the same kind of motion: a GSAP `set()` of a property
an element transitions starts it on the seek, and it plays on the wall
clock, so the capture's screenshot and the layered render's catch it at
different points. Eligibility declines a running animation it sees
(`overlay_non_gsap_animation`), but a short one can start on a seek only
capture makes and end before any later gate looks: under load the review's
`css-transition` (0.5 s, set at 1.5 s) took the passthrough in one full
run of the earlier rounds' fixtures (about 400 parity runs), 29 of 90
frames identical. The fingerprint already reads
every animation's play state on every probe, and the probe right after the
seek always sees the transition running (reading the animations resolves
the style change first), so a probe that sees any running animation now
throws `BrowserClockError` too (`overlay_non_gsap_animation`).

Scroll snapping and scroll anchoring move the offset without page code
too, but synchronously: a `scrollTop` write on a `scroll-snap-type: y
mandatory` scroller reads back snapped, and a resized row above the anchor
reads back adjusted, on the write or the layout the read forces
(`overlayFingerprint.integration.test.ts`). Both take the passthrough and
decode identical to flag off (`snap-anchor-scroll`).

## Capture dedup

The planner's states are candidates: a superset of the frames where the
overlay can change (a clip cut claims the frames around it, a `set()` the
frames around its time). Capture walks every frame once, in order ("Two
pages"), and reads at each a fingerprint of everything the overlay's pixels
depend on: DOM attributes and
text (including open shadow roots and their own sheets), normalised inline styles, the CSSOM
(`@import`ed sheets included), the focused element,
scroll and form state, image and font load state, CSS / Web Animation times,
the native properties GSAP tweens write on their target elements, the
playback position of a media element with controls, the paint state no attribute holds
(see "Callbacks that run no page script" above), and the stacking order. The video's own
nodes and script text are left out. A new fingerprint is captured through the
unchanged layered capture path, at the frame just probed; a repeated one reuses
its PNG. At a candidate's first frame, a fingerprint or captured pixels that
match the state before it merge the candidate into it. A candidate whose overlay
differs in any way starts its own state, so a one-frame change is never merged
away. The fingerprint is collected in the
isolated world and hashed in Node ("Probes the page cannot reach").

That holds only for what the fingerprint can read. Page script cannot enter
a closed shadow root (`shadowRoot` is null) or, in general, the document of
an `<object>`, `<embed>` or frame: a tween there changes pixels and no
fingerprint, so every candidate of a change run would merge and every
verification probe would match without a screenshot. Eligibility reads a
DevTools DOM snapshot (`DOMSnapshot.captureSnapshot`, which pierces both)
and declines such content with `overlay_unreadable`; the snapshot is read
again after capture.

The other frames of a candidate are the planner's word, which holds only
for drivers its static analysis sees. Each is probed in turn; a fingerprint
the state has not seen is screenshotted, and pixels that differ from the
state's fall back (`overlay_unverified`) rather than ship a stale overlay.
The probe is exhaustive because it is the safety net for drivers no static
check names (a raw `requestAnimationFrame` loop, a setter on a runtime
seek-time global, a wrapped seek, a film-time timer): any sampling grid
misses a change shorter than its gap, and a periodic driver can alias with
it. It costs one probe (seek + fingerprint, no screenshot) per frame, which
the in-order walk needs anyway.

The video's own stacking entry is left out of the fingerprint, but not
unchecked. The composite lays the full-opacity source in one place on every
frame, while the layered compositor blits the video from its entry
(opacity, box, transform, radius, clip, `object-fit` / `object-position`,
z-order) frame by frame. A stylesheet rule that reaches the video through a
selector (`#root:has(#cue:not([style*=hidden])) video { opacity: .3 }`, a
sibling combinator) and fires on a caption's clip window or a GSAP `set()`
of another element changes that entry with no tween or animation on the
video, between eligibility's nine layout samples. So every probe and capture
checks the entry the stacking query already returns: fully opaque and,
field for field, the entry of the first frame probed. Any other frame falls
back (`video_animated`). Paintability is left out of the check: the frame
injector hides the native video on a capture and not on a probe.

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
per state and per verification probe. The encode drives `framesRendered`
from ffmpeg's frame count from its first frame; while capture is still
running it only keeps the watchdog alive, and once capture is done it
reports 35–80%.

## Limitations

- After a fallback the progress percentage can sit still until the layered
  path passes the point where the passthrough stopped.
- The stage is still reported as `capture_hdr_layered`, and HDR per-frame perf
  stats are not collected on the passthrough path.
- mp4 only; no alpha, HDR images or shader transitions.
- Content the fingerprint cannot read declines the whole composition,
  including a closed shadow root or `<object>` that never changes.
- A closed shadow root with no content is not in the DOM snapshot; one that
  gains content and loses it again between eligibility and the end of
  capture is not seen.
- GSAP is recognised by the exact text of a published build (core,
  `CustomEase`, `EasePack`, 3.10.0 and later). An older release, another
  plugin, GSAP bundled into a script of the page's own, and any other
  library that runs after load count as page code and decline, as does a
  page function GSAP calls on a tween's first render (a function-based
  value) when that render falls inside the watch.
- Compiler scripts other than the seek reapply (the position-edits render
  script, whose text depends on the edits) count as page code when they run
  after load, and decline.
- A page that replaces a builtin with a builtin declines, harmless or not
  (`Array.prototype.filter = Array.prototype.map`); one that replaces it
  with page script (a polyfill) passes, and declines only if a probe or a
  seek then runs it.
- A script the renderer sent before the overlay page's watch was armed is
  the page's: the watch is armed as the page opens, before the engine
  registers anything, so only a caller that skips the capture session's
  `onPageOpened` hook is affected (and declines).
- The passthrough loads the page twice (analysis and capture), and the
  capture page repeats the layered session's steps before frame 0: about a
  page load and a seek more than one page would cost.
- `hf-seek` listeners are read once, after the page loads; one added later
  is left to the verification probes.
- Any observer, custom element definition, worker, offscreen canvas or
  worklet the page makes declines, whatever its callback is: what it runs
  cannot be read back. The runtime's own pass (they are made from its
  scripts). A registration made before the document's first script runs
  is not seen; there is none to make.
- The registration watch pauses the analysis page at the first statement of
  each script until the page's own scripts start, and at each registration
  call while it loads, and its debugger makes every compile slower. The
  capture page is never paused and loads with no debugger; V8 call counts
  and then the debugger start once it is ready, and page code that runs
  from then on declines. While it loads, what still differs from the
  layered session is one new-document script (the builtin capture, run
  before any page script) and a second DevTools session receiving network
  events with larger buffers (`ownClock.ts`): no compile, pause or callback
  per page script, only a fixed cost before the first one and a per-request
  event, which a page could only time against its own network loads.
- A `FinalizationRegistry` whose cleanup ran, and which was collected,
  before the load census started (a garbage collection of the page's own
  while it loaded) is not seen; what its cleanup changed is in the page
  both overlay pages read, while the layered render applies it whenever V8
  happens to collect the target, which is not repeatable either. One still
  live when the census starts is seen: the heap snapshot is the census's
  first read, and the census declines when the page changed while it read
  (`gc-selfdrop-remove`, `gc-selfdrop-wrap`).
- Page code written to detect the passthrough at load time is out of scope
  for the experimental flag. The capture page differs from the layered
  session by one new-document script (the builtin capture, run before any
  page script) and a second DevTools session, and a page can time their
  side effects while it loads, with nothing running after load: the
  builtin capture has already touched (warmed) the global interface
  objects and their prototypes, so a first pass over them
  (`Object.getOwnPropertyDescriptor` on every global and its `prototype`,
  `if-gopd`; plain reads of the interface names, `if-get-mark`; one
  interface family read in one script and decided in a later one,
  `if-proto-late`) runs about as fast as a second one, where in the
  layered session it is several times slower. A page that paints on that
  difference renders differently from the layered render with no
  fallback.
- A registration the capture page makes while it loads is found by what it
  leaves behind once the page is ready ("The capture page is never
  paused"): one that is gone by then (an observer collected, a timer that
  fired, a wall-clock timer still pending with a builtin callback) is not
  counted; what it changed is in the page the census and the probes read.
- What a builtin the page hands over runs is found where the renderer, GSAP
  or the browser calls page objects on a seek (listed in "Callbacks that
  run no page script"). One reached some other way is not: a promise
  reaction, a `requestIdleCallback` callback, a listener on a node outside
  the document. A seek can trigger one (a lazy image's `decode()` settles
  once a seek shows it); capture's page reaches that seek in order, as the
  layered render does ("Two pages"), and the paint state a builtin can set
  is in the fingerprint, so a change the reaction makes where the planner
  sees none declines.
- Any `scroll-behavior` but `auto` declines, whether or not anything
  scrolls: a reset that sets `html { scroll-behavior: smooth }` costs the
  passthrough, as does a GSAP tween that writes the property at all.
- GSAP tweens of anything but elements decline when they write anything,
  including a plain object only page code reads (a counter whose `onUpdate`
  writes the DOM would decline on the callback anyway).
- The allowlists decline content that would render the same: a `<button>`,
  a form control nobody focuses, a `<canvas>` nobody draws on, an image
  format the passthrough does not decode (JPEG XL), an SVG in another
  encoding than UTF-8, a cross-origin stylesheet whose text the network
  record does not hold. SVG images pass only as plain static SVG (shapes,
  paths, gradients, patterns, clips, masks, markers and text, styled by
  presentation attributes, `svgImage.ts`): any `<style>` (static or not, in
  any namespace), `style` attribute, comment, CDATA section, DOCTYPE,
  filter, link, `<switch>`, element in another namespace (editor metadata
  included), external reference or attribute outside the static set
  declines, as does an SVG image over 4 MiB (`MAX_SVG_IMAGE_BYTES`): it is
  parsed whole or not at all.
- The encoder takes one frame at a time, each once it has gone idle, as the
  layered path's does ("Encoder pacing"): the encode costs the encoder's
  per-frame latency times the frame count, which grows with the host's
  load. Capture and the composite now run beside it, so a flag-on render
  costs about that encode plus the page loads, but no less: on a host at
  load average 33-174 the 20 s `captions` and `captions-gsap` fixtures
  rendered about 1.35-1.44x faster flag on than flag off (the round-9
  verify), with the encoder waited on to go idle for about 75% of the
  encode; round 10 measured 1.6-1.9x at load 34-89 (idle 65% of the
  encode). The gain shrinks as the host's load grows. The passthrough needs
  Linux to read the encoder's thread states, a software libx265 encode,
  and an ffmpeg 7.0 or later (which names its encoder thread) that is the
  spawned process itself (a symlink, a renamed copy or a script that execs
  it in place), not a wrapper around one.
- The census matches the capture page's observers to the analysis page's
  by the function their callback runs. A page that held a reference to one
  of the runtime's own observer callbacks could make an observer of its
  own with it on the capture page; it runs the runtime's code on other
  records. No such reference is reachable from the page's globals today.
  A capture page that holds one of the runtime's observers the analysis
  page had not made yet declines (falls back) rather than passes.
- The census reads observers from a heap snapshot (one more garbage
  collection, and 1-3 s on a loaded host for a 20 MB heap), and relies on
  Blink naming its callback holders (`V8MutationCallback`, ...) in the
  snapshot; a build that does not declines, as it holds fewer than
  `Runtime.queryObjects` finds.
- Event targets are found with `Runtime.queryObjects`, and observers and
  finalization registries from a heap snapshot, which collect garbage
  first: a page can notice that only through page code (a `WeakRef` it
  reads, counted) or a registry's cleanup (read and declined); what the
  garbage collector itself decides (a weak map entry dropped) runs no
  callback.
- Content that paints on the wall clock (`<marquee>`, an indeterminate
  `<progress>`, an animated image, a second video) declines, and its
  layered render is not repeatable either: two flag-off renders of such a
  fixture share no frame, so a fallback cannot decode identical to one.
- With a warm extraction cache, deferral costs a probe (about 0.3 s) that a
  cache hit would not.

## Validation

The parity harness in `src/hdr-passthrough-harness/` renders a composition
with the flag off and on and compares the outputs, and generates HLG and PQ
caption fixtures plus one negative fixture per fallback class. On 1080p30
caption fixtures from 20 s to 3 min, HLG and PQ, the passthrough output
decodes to the same frames as the layered render, 9-14x faster (a 16 min
render takes about 13 min instead of an estimated 2.4 h); its "Measured"
section has the numbers. Probing every frame in verification adds about
15-18 ms per frame (5-9x on the 20 s fixtures on a loaded host). The
blend self-test and the `seek_callback` gate add about 0.15 s and one page
evaluation; on a host twice as loaded, the 60 s fixture took 170.6 s against
1163.7 s for flag off (6.8x) and the 20 s one on ffmpeg 8.0.1 31.5 s against
315.9 s (10.0x), all identical.

With the video-layer check and the page-code watch, the 20 s `captions` and
`captions-gsap` fixtures still take the passthrough and decode identical to
flag off (framemd5 600/600, stream and frame side data equal) on HLG and PQ,
ffmpeg 7.0.2 and 8.0.1. Flag-off vs flag-on job time, two renders at a time
on a loaded host:

| ffmpeg | transfer | `captions`             | `captions-gsap`        |
| ------ | -------- | ---------------------- | ---------------------- |
| 7.0.2  | HLG      | 193.4 s / 32.1 s, 6.0x | 240.9 s / 32.5 s, 7.4x |
| 7.0.2  | PQ       | 179.7 s / 25.4 s, 7.1x | 204.7 s / 24.5 s, 8.4x |
| 8.0.1  | HLG      | 184.0 s / 24.1 s, 7.6x | 213.5 s / 30.6 s, 7.0x |
| 8.0.1  | PQ       | 213.7 s / 32.1 s, 6.7x | 324.0 s / 38.4 s, 8.4x |

Capture took 9.0-13.3 s of that with the call counts on (10.5-36.8 s on the
commit before, on a host loaded differently, so the counts' cost is inside
the noise). The 3 s fixtures where a selector dims the video between layout
samples, or page code on seeks changes a popover, highlight, `:state()`,
selection, option, validity or shadow-root canvas, fall back and decode
identical to flag off.

With script origins from how V8 compiled each script and the watch counting
from load (eligibility's probes included), on main merged at 7f54fded08 and
ffmpeg 8.0.1, the 20 s fixtures still take the passthrough and decode
identical to flag off (framemd5 600/600, stream and frame side data equal):

| transfer | `captions` off / on     | `captions-gsap` off / on |
| -------- | ----------------------- | ------------------------ |
| HLG      | 281.5 s / 161.5 s, 1.7x | 330.0 s / 183.1 s, 1.8x  |
| PQ       | 989.8 s / 249.1 s, 4.0x | 298.0 s / 82.2 s, 3.6x   |

The host ran up to four renders and the integration lanes at once, so the
ratios are not comparable with the tables above. The watch's own cost, on
`captions-gsap` 20 s HLG flag on, renders run alone and alternated with the
watch armed and with it stubbed out (a local switch, not in the tree): job
time 35.9 / 73.6 / 55.4 s with it against 39.8 / 76.4 / 50.7 s without,
capture 12.3 / 17.8 / 15.7 s against 14.0 / 17.3 / 14.7 s, inside the
noise. In isolation, 600 seek-and-read evaluations on one page took 16-27 %
longer with the watch (231-376 ms against 199-303 ms), about 0.1 ms a seek.

The 3 s fixtures whose page code defines the seek-time setter through an
inserted script, eval, `new Function`, a renderer or DevTools script name, a
string timer or a file named like GSAP, or the GSAP proxy through an inserted
script, all fall back with `seek_callback` and decode identical to flag off
(HLG on ffmpeg 7.0.2, PQ on ffmpeg 8.0.1); before this change the first
three took the passthrough with 15/90, 0/90 and 15/90 frames identical (HLG,
7.0.2). `builtins-counter` falls back and decodes identical on both. A page
that counts the builtins it replaced on every animation frame
(`pst-builtins`, SDR) renders identical to main with the flag off (60/60;
60/60 differed before) and identical to flag off with it on.

With callbacks that run no page script declined, the paint state they can
set in the fingerprint, and the snapshot and image gates reading shadow
trees and pseudo-elements, on main merged at bdf8debf73 and ffmpeg 8.0.1, the
20 s fixtures still take the passthrough and decode identical to flag off
(framemd5 600/600, stream and frame side data equal):

| transfer | `captions` off / on    | `captions-gsap` off / on |
| -------- | ---------------------- | ------------------------ |
| HLG      | 330.2 s / 39.1 s, 8.5x | 301.7 s / 82.2 s, 3.7x   |
| PQ       | 330.0 s / 38.6 s, 8.5x | 301.8 s / 80.2 s, 3.8x   |

Four renders and three fixture lanes ran at once (load average 60-75 on 32
cores); most of `captions-gsap`'s flag-on time is its x265 encode (68.7 s of
a 105 s stage in a timed rerun). The new gates took about 1.2 s of that
render: 0.22 s before the first seek, 0.16 s after the analysis and 0.76 s
after capture.

The 3 s fixtures that hand a builtin to an observer, a listener, an `on*`
handler, a custom element, a tween target's accessor or Proxy trap or a
tween value, and the one with `<audio controls>`, fall back and decode
identical to flag off (HLG on ffmpeg 7.0.2, PQ on ffmpeg 8.0.1); before this
change the review's `mo-popover`, `mo-select` and `audio-controls` took the
passthrough with 0/90 frames identical. The `<marquee>`, indeterminate
`<progress>`, animated GIF (pseudo-element `content`, list-style, border and
mask images, `<img>` and background in a shadow root), shadow-root
`<video>` and paint worklet fixtures fall back too; two flag-off renders of
each share no frame, so the harness checks their fallback and reason and
not their pixels (`wallClock` cases). The seek-time setter fixtures now keep
their highlight lit once a seek reaches 1 s: a setter that toggles it by
time is caught by the verification probes now that the fingerprint reads
highlights (`overlay_unverified`), and the sticky one is left to the page
code watch (`seek_callback`).

With nothing installed in the page (no callback record), registrations
watched from outside, the fingerprint and DOM probes in an isolated world,
script trust by exact text, the builtin comparison and the content
allowlists, on main merged at 2cc423b3c6 and ffmpeg 8.0.1, the 20 s
fixtures still take the passthrough and decode identical to flag off
(framemd5 600/600, stream and frame side data equal):

| transfer | `captions` off / on    | `captions-gsap` off / on |
| -------- | ---------------------- | ------------------------ |
| HLG      | 381.6 s / 83.8 s, 4.6x | 333.8 s / 94.2 s, 3.5x   |
| PQ       | 377.9 s / 85.5 s, 4.4x | 332.2 s / 96.4 s, 3.4x   |

Up to ten renders ran at once (load average 70-80 on 32 cores), so the
ratios are not comparable with the tables above.

What the new checks cost, from the renders' own `page gates` log line: the
DevTools-only gates take 0.3-0.9 s before the first seek, 0.3-1.3 s after
the analysis and 1.1-3.6 s after capture (most of it the event-target and
GSAP walks), the content gates 35-170 ms each, and the registration watch
pauses the page 14-29 times while it loads, 0.14-0.45 s in all. On the 3 s
`captions-gsap` fixture (HLG, ffmpeg 8.0.1, one render at a time on a host
at load average 60-80), flag-on renders alternating between the commit
before this change and this one took 21.3 / 22.3 / 24.1 s against 28.0 /
29.4 / 31.9 s of job time, capture 6.7-7.5 s against 8.6-10.2 s: about 6-7 s
a render, of which the gates are about 3 s; the rest is slower capture
probes on the watched page, which a run of the fingerprint alone (1.3-1.6 ms
a probe in either world) does not account for. The breakpoints are all
removed once the page is ready, before the first probe.

The round-6 adversarial fixtures, each rendered with the commit before this
change and with it (3 s, HLG, ffmpeg 7.0.2):

| fixture                                      | before                          | after                                       |
| -------------------------------------------- | ------------------------------- | ------------------------------------------- |
| `digest-const`, `encode-const`, `json-const` | passthrough, 24 / 20 / 24 of 90 | fallback `seek_callback`, 90/90 each        |
| `jsurl-seen` (`location.href`)               | passthrough, 0/90               | fallback `seek_callback`, 90/90             |
| `jsanchor-observer` (clicked anchor)         | passthrough, 0/90               | fallback `seek_callback`, 90/90             |
| `errname-raf`                                | fallback, 0/90 against flag off | fallback `seek_callback`, 90/90             |
| `shim-tostring`, `shim-tostring-width`       | passthrough, 0/90               | passthrough, 90/90                          |
| `picker-icon-gif`, `scroll-button-gif`       | passthrough, 0/90               | fallback `overlay_unsupported` (wall clock) |
| `shadow-canvas-worker`                       | passthrough, 0/90               | fallback `seek_callback` (wall clock)       |
| `audio-controls-gsap`                        | passthrough, 30/90              | fallback `overlay_unverified`, 90/90        |

The wall-clock fixtures' layered render is not repeatable either (two
flag-off renders share no frame), so only their fallback is checked.

The generated 3 s sets (`--ineligible`, HLG on ffmpeg 7.0.2 and PQ on
ffmpeg 8.0.1, both sides rendered) pass but for wall-clock and seek-count
cases: every fixture takes the route and reason it expects, the positive
ones and `tostring-painter` decode identical through the passthrough, and
every repeatable fallback (`error-getters-raf` and `builtins-counter`
included) decodes identical to flag off. The SVG SMIL, shadow-root CSS
animation and animated WebP / APNG / AVIF fixtures are now marked
`wallClock`: two flag-off renders of each share no frame. `raf-counter`'s
fallback still differed from flag off then, by one seek before frame 0 (see
"Two pages").
Flag off renders identical to main (`origin/main` at 2cc423b3c6) on twelve
producer fixtures, the HDR regression fixture, a PQ caption fixture and the
`errname-raf` and `shim-tostring` pages.

With capture on a fresh page in frame order, overlay pages that leave the
render's shared session state alone, and SVG images parsed as XML (on
83616beee9, ffmpeg 8.0.1, up to ten renders at once, load average 60-160 on
32 cores), the 20 s fixtures still take the passthrough:

| transfer | `captions` off / on                | `captions-gsap` off / on   |
| -------- | ---------------------------------- | -------------------------- |
| HLG      | 580.6 s / 124.6 s, 600/600         | 693.0 s / 220.1 s, 600/600 |
| PQ       | 593.1 s / 127.8 s, 256/600 (below) | 680.0 s / 216.1 s, 600/600 |
| PQ again | 366.9 s / 62.0 s, 600/600          |                            |

Stream and frame side data were equal on every run. The review's fixtures
(3 s, HLG):

| fixture                      | before                                | after                                        |
| ---------------------------- | ------------------------------------- | -------------------------------------------- |
| `scroll-clamp`               | passthrough, 0/90                     | passthrough, 90/90 (ffmpeg 7.0.2 and 8.0.1)  |
| `lazy-decode-popover`        | passthrough, 0/90                     | passthrough, 90/90 (both)                    |
| `svg-ns-smil`, `svg-ent-css` | passthrough, 0/90                     | fallback `overlay_non_gsap_animation` (both) |
| `raf-counter` (fallback)     | 0/90 against flag off (`n=4` / `n=5`) | 90/90 (both)                                 |

The generated 3 s sets, both sides rendered (HLG on ffmpeg 7.0.2, all 73
projects; PQ on ffmpeg 8.0.1, 31 of them), take the route they expect: the
positive fixtures, `tostring-painter`, `scroll-clamp` and
`lazy-decode-popover` take the passthrough and decode identical to flag off,
and every repeatable fallback (51 HLG, 23 PQ, `raf-counter`,
`builtins-counter` and `error-getters-raf` included) decodes identical to
flag off. `seek-time-setter`, `flash-setter` and `gsap-from-lazy` now decline
as `seek_callback` before capture: their setter runs on eligibility's seeks,
on the analysis page. The earlier rounds' adversarial fixtures (82 of them, both
sides rendered) take the routes they took before, but for the four above,
and every fallback decodes identical to flag off where the layered render
is repeatable (wall-clock content, a CSS `@starting-style` transition
included, is not: two flag-off renders of it differ too); one passthrough
render of `control` did not (below). Flag off renders identical to main on three
HDR fixtures (`hdr-hlg-regression`, `hdr-hlg-audio-windows`,
`hdr-regression`), eight SDR producer fixtures and the `pst-builtins` page.

Three passthrough renders out of about 50 in this run did not decode
identical to flag off: the PQ 20 s `captions` row above (from frame 255),
and two 3 s `control` renders (from frame 29, 34/90 and 26/90), all at
52-73 dB, spread over whole frames. The encoder was not deterministic when
fed faster than it encodes; see "Encoder pacing" for the measurements and
the fix, and the next section for the renders after it.

With the encode paced as the layered path feeds its encoder, the capture
page never paused, its load census held to the analysis page's, and SVG
images limited to plain static SVG (main merged at 590617475f):

Flag-on renders of 3 s fixtures, 20 to 26 at a time beside the other
lanes (load average 80-180 on 32 cores), each against a flag-off render of
the same fixture in the same batch:

| ffmpeg | transfer | fixtures                                                           | renders | decode identical | took the passthrough |
| ------ | -------- | ------------------------------------------------------------------ | ------- | ---------------- | -------------------- |
| 7.0.2  | HLG      | `control`, `gc-fr-remove`, `slot-then-direct`, `cis-hidden-toggle` | 46      | 46               | 39                   |
| 8.0.1  | HLG      | the same                                                           | 26      | 26               | 24                   |
| 7.0.2  | PQ       | `captions`, `captions-gsap`                                        | 24      | 24               | 24                   |
| 8.0.1  | PQ       | the same                                                           | 24      | 24               | 24                   |

All 120 decode identical to flag off (framemd5, 90/90 each). The 7 HLG
7.0.2 fallbacks are the census's first version, which held the runtime's
own animation-frame requests and observers to exact equality (2 or 3, 5 or
7 from one load to the next); the second run of that row, with the census
as described, took the passthrough 20 times out of 20. The 2 HLG 8.0.1
fallbacks are encoders the host's `earlyoom` stopped (`received signal
15`) when memory ran short; a flag-off render in another batch died the
same way. Before this change the same fixtures had decoded different from
flag off in 3 of about 20 renders.

The 20 s fixtures on ffmpeg 8.0.1 take the passthrough and decode identical
to flag off (framemd5 600/600, stream and frame side data equal), with
about a dozen renders running beside them (load average 110-130):

| transfer | `captions` off / on        | `captions-gsap` off / on   |
| -------- | -------------------------- | -------------------------- |
| HLG      | 565.1 s / 467.0 s, 600/600 | 708.1 s / 610.5 s, 600/600 |
| PQ       | 554.6 s / 462.3 s, 600/600 | 706.2 s / 603.2 s, 600/600 |

What the pacing costs: the encode now takes one frame at a time, so its
time is the encoder's own per-frame latency times the frame count instead
of its throughput. In the 20 s renders above it took 372-520 s (0.62-0.87 s
a frame), 220-326 s of it waiting for the encoder to go idle, against a
capture of 58-75 s; the commit before took 190 s for the whole flag-on
`captions` render under similar load, of which the composite was well
under a minute. On the 3 s `captions-gsap` fixture (HLG, ffmpeg 8.0.1, one
render at a time, alternating, load average 115-125): job time 53.6 /
54.8 / 55.0 s of stage before against 82.8 / 93.9 / 95.6 s after, the
encode 52.6-59.3 s of it (29-35 s waiting for idle). Measured alone on the
recorded `control` inputs at load average 67, a paced encode of 90 frames
took 11.8 s against 7.9 s unpaced: the cost grows with the host's load,
since every frame waits for its own encode, where the layered path hides
the encoder behind a capture that is slower still. The load census adds
2-4 s to the first page gate on each page under load (nine
`Runtime.queryObjects`, each collecting garbage); the capture page pauses 0
times, where it paused 28 times (0.39-0.48 s) before.

Flag off renders identical to main (590617475f) on ten fixtures: four
SDR producer fixtures, `hdr-hlg-regression`, `hdr-regression`,
`hdr-hlg-audio-windows`, the 3 s PQ `captions`, `errname-raf` and
`dbg-timer` (video framemd5, audio and stream metadata). The engine
change is a process id on the streaming encoder.

The generated 3 s sets, both sides rendered (HLG on ffmpeg 7.0.2, all 80
projects; PQ on ffmpeg 8.0.1, 31 of them), take the route they expect: the
positive fixtures, `tostring-painter`, `scroll-clamp`,
`lazy-decode-popover`, `pause-timer` and `pause-mark` take the passthrough
and decode identical to flag off (90/90); the four new SVG fixtures
(`svg-comment-css`, `svg-comment-keyframes`, `svg-cdata-css`,
`svg-xhtml-style`) decline with `overlay_non_gsap_animation`; every
repeatable fallback decodes identical to flag off. `audio-controls-gsap`
now declines with `overlay_non_gsap_animation` instead of
`overlay_unverified`: the media controls' own icons are SVG images with
`style` attributes.

The earlier rounds' fixtures (183 projects, both sides rendered, HLG on
ffmpeg 7.0.2, and 15 of them again on 8.0.1) take the routes they took
before but for the round-7 blockers: the SVG images that split
`animation` or `@keyframes` with a comment or CDATA section, or carry an
XHTML `<style>` in `<metadata>` (`svg-comment-split`,
`svg-comment-split-file`, `svg-cdata-split`, `svg-xhtml-style`,
`svg-xhtml-style-default`), took the passthrough with 0/90 frames
identical and now fall back with `overlay_non_gsap_animation` on both
versions; `dbg-timer` took it with 0/90 and now takes it with 90/90 on
both; `control`, `gc-fr-remove`, `slot-then-direct` and
`cis-hidden-toggle`, which had decoded 26-35/90, decode 90/90. All 43
passthrough renders and every repeatable fallback decode identical to flag
off; the 42 that do not are fallbacks on wall-clock content (animated
images and SVG, marquees, a CSS `@starting-style` transition), whose two
flag-off renders share no frame either. On the commit before, `dbg-timer`,
`svg-comment-split` and `svg-xhtml-style` still took the passthrough with
0/90 frames identical in this run, and the capture page paused 28 times.

With observers matched by callback, the pacing guards, SVG images parsed
whole, and capture and the composite run beside the paced encode (main
merged at bb87da4536):

The 20 s fixtures on ffmpeg 8.0.1, each row's three renders started
together (flag off; the commit before this change, flag on; this change,
flag on), two rows in a row, the second in the opposite launch order, with
eight to ten other renders on the host (load average 50-130):

| transfer | fixture         | flag off      | before, flag on     | after, flag on      |
| -------- | --------------- | ------------- | ------------------- | ------------------- |
| HLG      | `captions`      | 510 s / 434 s | 395 s / 329 s, 1.3x | 325 s / 281 s, 1.6x |
| HLG      | `captions-gsap` | 555 s / 477 s | 402 s / 331 s, 1.4x | 332 s / 280 s, 1.7x |
| PQ       | `captions`      | 517 s / 436 s | 403 s / 328 s, 1.3x | 326 s / 277 s, 1.6x |
| PQ       | `captions-gsap` | 548 s / 478 s | 406 s / 335 s, 1.4x | 332 s / 280 s, 1.7x |

All 16 flag-on renders took the passthrough and decode identical to flag
off (framemd5 600/600, stream and frame side data equal, bitstream
identical). The encode, from the encoder's spawn to its exit: before,
292-299 s / 243-248 s after a capture of 60-68 s / 48-54 s; after,
282-289 s / 240-243 s, of which 157-200 s came after a capture of
84-98 s / 74-84 s (slower beside the encode) that the encode overlapped.
The time left is the encoder's own per-frame latency: 208-247 s of each
encode waiting for it to go idle (182-232 s before), 0.35-0.41 s a frame.
The rest of the encode, writing the frame and reading the next, fell from
60-73 s to 26-37 s with the composite reading ahead.

Flag-on renders of 3 s fixtures, 24 at a time with one flag-off render of
each fixture and four repro renders beside them, the host's `earlyoom`
stopping the largest ffmpeg processes when memory ran short; two batches
per ffmpeg version, the second on this commit (the first lacked the
registry check below and named an exited encoder differently):

| ffmpeg | batch | load average up to | renders | decode identical | took the passthrough | fell back                                        |
| ------ | ----- | ------------------ | ------- | ---------------- | -------------------- | ------------------------------------------------ |
| 7.0.2  | 1     | 190                | 24      | 24               | 23                   | 1 composite stopped by `earlyoom`                |
| 8.0.1  | 1     | 325                | 24      | 24               | 19                   | 5 encoders stopped by `earlyoom`                 |
| 7.0.2  | 2     | 138                | 24      | 24               | 20                   | 4 `gc-fr-remove` (`seek_callback`, its registry) |
| 8.0.1  | 2     | 155                | 24      | 24               | 18                   | 4 `gc-fr-remove`, 2 encoders stopped             |

Each batch is 16 HLG renders (`control`, `gc-fr-remove`, `slot-then-direct`,
`cis-hidden-toggle`) and 8 PQ (`captions`, `captions-gsap`). All 96 decode
identical to flag off with the same bitstream, stream and frame side data.
An encode `earlyoom` stopped falls back (in batch 1 its encoder read as
unreadable thread states, `ffmpeg_unsupported`; it now reads as an encoder
that exited). On this commit the 20 s `captions` and `captions-gsap`
fixtures, HLG and PQ on ffmpeg 8.0.1, still take the passthrough and decode
identical to flag off (600/600, bitstream and side data equal; 166-169 s
each with four at a time).

The round-8 slack repro (`unp-mo-append`: a `MutationObserver` with a
bound `insertAdjacentText` callback, made only when the page was not
paused), rendered beside those batches: with the commit before, four of
eight renders took the passthrough (5 MutationObservers on the capture
page, its own among them, against 7 on the analysis page), three of them
with 0/90 frames identical to flag off (28.7 dB) and one whose frames
happened to match; with this change every render declines
with `seek_callback (a MutationObserver whose callback runs no script)`
and decodes identical to flag off. The integration tests run the class on
a real page against a stand-in runtime whose observer count the page
controls: a builtin, bound or page-script callback on a mutation, resize,
intersection, performance or reporting observer, a subtree observer, a
renderer function no analysis-page observer runs, and an observer in place
of one the runtime made only on the analysis page (same count; the commit
before passed it) all decline, and a capture page holding fewer of the
runtime's own observers passes.

The pacing guards, 3 s `captions` HLG: with `HYPERFRAMES_FFMPEG_PATH` naming
a shell script that runs ffmpeg 7.0.2 as its child, the commit before took
the passthrough, pacing on the shell's idle thread, and the change declines
(`ffmpeg_unsupported (the encoder process runs /usr/bin/dash, not ffmpeg)`)
and decodes identical to flag off with the same wrapper; before the
composite's pipes were closed from this side, that render stalled at
capture's end and failed. With `--gpu` (no GPU encoder on the host, so both
sides encode in software) it declines with `ffmpeg_unsupported (GPU encode
selected ...)` and decodes identical to flag off. Killing the composite or
the encoder mid-encode falls back and decodes identical to flag off, with
no process left behind.

The earlier rounds' fixtures (the 144 repros of rounds 5 to 7 and round
8's review and verify sets, 336 parity runs with both sides rendered, HLG
and PQ, ffmpeg 7.0.2 and 8.0.1, the generated 3 s sets included) take the
route they took on the commit before, and every passthrough among them
decodes identical to flag off but one: round 8's `gc-tenured-remove`, a
`FinalizationRegistry` with a bound `Element#remove` cleanup on a tenured
target, took the passthrough with 0/90 frames identical on both versions
(as on the commit before; it was not among round 8's open items). It now
declines with `seek_callback (a FinalizationRegistry whose callback runs no
script)`; its layered render is not repeatable (two flag-off renders share
29-32 of 90 frames: the box goes whenever V8 collects the target), so only
its fallback is checked. The non-identical fallbacks are the wall-clock
fixtures as before (animated images and SVG, marquees, a CSS transition,
WAAPI and message-loop drivers). The new negative fixtures
(`unpaused-*-observer`, `svg-over-size`; the round-8 `mo8` set and its
variants with a subtree, intersection, performance and resize observer, a
renderer function as the callback, and one that drops the runtime's
media-deferral observer and adds its own) all decline with the reason
they expect and decode identical to flag off on both versions.

Flag off renders identical to main (bb87da4536) on ten fixtures: four SDR
producer fixtures, `hdr-hlg-regression`, `hdr-regression`,
`hdr-hlg-audio-windows`, the 3 s PQ `captions`, `errname-raf` and
`dbg-timer` (video framemd5, audio and stream metadata). One flag-off
render of `hdr-hlg-regression` at load average 325 differed from main from
frame 123 (and in audio); two more renders of each side at lower load
were identical to each other and to main's first.

With the capture page loading with no debugger (its script record started
once it is ready, after the call counts; main merged at bb87da4536):

The review's `dbg-compile-detect` (3 s HLG: at load it times 3000 tiny
`eval`s against 3000 `JSON.parse` calls on `Event#timeStamp` and paints
"WATCHED" above a ratio of 15) took the passthrough with 0/90 frames
identical to flag off on the commit before (ffmpeg 7.0.2; the harness's
`compile-timer` fixture the same way, HLG). It now takes the passthrough and
decodes identical to flag off (90/90, bitstream identical) on ffmpeg 7.0.2
and 8.0.1, HLG and PQ, as `compile-timer` does. The ratio as each page
painted it (`dbg-ratio`, two renders each): flag off 4.00 and 3.62; flag on,
the commit before, 37.0 and 71.0; flag on now, 3.00 and 4.00. The
integration tests load the page with the debugger enabled before it
navigates, with no DevTools at all, and as the capture page: the capture
page sees no compile reported while it loads (9009 on the commit before) and
its ratio stays within three times the bare page's while the debugger's is
over four times the capture page's; a function the page compiled with `eval`
while it loaded is known by replay (`unobserved`, the page's) and passes,
and declines once it runs after the start.

The 20 s fixtures on ffmpeg 8.0.1, each row's three renders started together
(flag off; the commit before, flag on; this change, flag on), two rows, the
the first at load average 40-99, the second at 56-153:

| transfer | fixture         | flag off      | before, flag on | after, flag on |
| -------- | --------------- | ------------- | --------------- | -------------- |
| HLG      | `captions`      | 250 s / 479 s | 132 s / 328 s   | 132 s / 323 s  |
| HLG      | `captions-gsap` | 270 s / 525 s | 133 s / 326 s   | 133 s / 329 s  |
| PQ       | `captions`      | 250 s / 480 s | 133 s / 325 s   | 132 s / 320 s  |
| PQ       | `captions-gsap` | 252 s / 526 s | 133 s / 327 s   | 133 s / 328 s  |

All 16 flag-on renders took the passthrough and decode identical to flag off
(framemd5 600/600, bitstream, stream and frame side data equal). Capture
took 45-52 s / 84-91 s before and 45-51 s / 83-96 s after: loading the
capture page with no debugger and replaying its scripts once it is ready
costs nothing measurable.

Flag-on renders of 3 s fixtures, 24 per ffmpeg version at once with one
flag-off render of each and the round-8 repro (load average up to 583 and
243, the host's `earlyoom` stopping ffmpeg processes): all 48 decode
identical to flag off with the same bitstream, as do the six `unp-mo-append`
renders (each declines with `seek_callback`). 34 took the passthrough, 8 are
`gc-fr-remove` declining for its registry, and 6 fell back after an encoder
or composite was stopped. Flag off renders identical to main on ten
fixtures (`hdr-hlg-regression`, `hdr-regression`, `hdr-hlg-audio-windows`,
the 3 s PQ `captions`, `dbg-timer`, `errname-raf` and four SDR producer
fixtures). Killing the encoder or the composite mid-encode, or interrupting
the CLI, falls back or stops with no process left behind.

The earlier rounds' fixtures and the generated 3 s sets (384 parity runs,
both sides rendered, HLG and PQ, ffmpeg 7.0.2 and 8.0.1; rounds 5 to 8, the
round-9 review's fixtures and both generated sets with `compile-timer`) take
the route they took on the commit before, but for wall-clock fixtures whose
route varies from run to run (`unp-waapi`). Every passthrough among them, 94
renders, decodes identical to flag off but two: the round-9 review's
`gc-selfdrop-remove` and `gc-selfdrop-wrap` (below). Every fallback whose
layered render is repeatable decodes identical to flag off.

`gc-selfdrop-remove` hands a `FinalizationRegistry` a bound `Element#remove`
cleanup and drops both the target and the registry: the census's own
garbage collection runs the cleanup and collects the registry before it is
read, so both overlay pages show the box removed from frame 0 and the
passthrough takes it (0/90 identical, on the commit before as well). Its
layered render is not repeatable: two flag-off renders shared 19 and 22 of
90 frames with main's (the box goes whenever V8 collects the target). The
census now takes its heap snapshot first and declines when the page
changed while it read (round 10, below).

Round 10 (main merged at 5969cd2b43; ffmpeg 7.0.2 and 8.0.1):

`HYPERFRAMES_FFMPEG_PATH` wrappers, 3 s HLG `captions`, flag on against one
flag-off render. On the commit before, the verify's C wrappers that start
ffmpeg outside their own process tree (a double fork, the same a second
into the encode, a daemon in a new session) took the passthrough (2 of 10
such renders under load decoded different from flag off). Now they decline
(`ffmpeg_unsupported`, "holds no libx265 code"), as do a plain fork, a
fork in a new session and a shell script that runs ffmpeg as its child
("started 1 process(es)"); ffmpeg through a symlink, a renamed copy, and an
ELF and a script that exec ffmpeg in place take the passthrough. All 11
decode identical to flag off (90/90, bitstream identical).

`gc-selfdrop-remove` and `gc-selfdrop-wrap` took the passthrough with 0/90
frames identical on the commit before; both now decline with
`seek_callback` (the registry is in the heap snapshot read first) and
decode identical to flag off on both versions.

Killing the encoder mid-encode with SIGKILL (7.0.2) or SIGTERM (8.0.1)
falls back, the error naming its exit ("killed by SIGKILL"; "the encoder
exited mid-encode ... exited with code 255", with its stderr tail), and
decodes identical to flag off.

On a loaded host three kinds of fallback in the first runs were not the
host's: 1 of 16 concurrent renders declined on the first frame's idle wait
ending before ffmpeg started its libx265 thread (now waited for), 1 of 24
declined on a held thread missing from one `/proc` listing (now read
again), and four fell back logging only "the composite stopped reading
overlays" (the feed's failure replaced the first one; the first is now
kept). After those changes 24 concurrent flag-on renders of the 3 s HLG
`captions` (7.0.2) and 24 of the 3 s PQ `captions` (8.0.1) all took the
passthrough.

Concurrent load on the final code, 24 flag-on renders per version (the
`control`, `gc-fr-remove`, `slot-then-direct` and `cis-hidden-toggle` HLG
fixtures and the PQ `captions` and `captions-gsap`, four of each) with one
flag-off render of each, all at once: all 48 decode identical to flag off
with the same bitstream, stream and frame side data and audio (load
average up to 204 and 207). 38 took the passthrough, 8 are `gc-fr-remove`
declining for its registry, and 2 fell back after the host's `earlyoom`
stopped an ffmpeg (a composite, "exited with code 255"; an encoder whose
threads ended while it shut down: still a decline, naming the threads,
as it took over a second to exit). On the commit before (no encoder exit
named after a pacing decline), the same: 48 of 48 identical, 38
passthrough, once that version's flag-off PQ `captions` render, which had
stalled on the loaded host and failed by the layered path's own stall
rule, was rendered again.

The 20 s fixtures on ffmpeg 8.0.1 (the commit before), each row's eight
renders started together:

| row | load  | transfer | `captions` off / on | `captions-gsap` off / on |
| --- | ----- | -------- | ------------------- | ------------------------ |
| 1   | 35-89 | HLG      | 279 s / 173 s, 1.6x | 298 s / 170 s, 1.8x      |
| 1   | 35-89 | PQ       | 277 s / 171 s, 1.6x | 298 s / 171 s, 1.7x      |
| 2   | 34-76 | HLG      | 260 s / 151 s, 1.7x | 283 s / 151 s, 1.9x      |
| 2   | 34-76 | PQ       | 262 s / 151 s, 1.7x | 281 s / 151 s, 1.9x      |

All eight flag-on renders took the passthrough and decode identical to flag
off (framemd5 600/600, bitstream, stream and frame side data equal); the
encoder was waited on to go idle for 65-67% of the encode. In a lighter
window earlier (load 25-59, main merged, before the pacing fixes) the same
eight took 104-106 s flag on against 225-251 s flag off (2.1-2.4x).

Flag off renders identical to main (5969cd2b43) on ten fixtures
(`hdr-hlg-regression`, `hdr-regression`, `hdr-hlg-audio-windows`, the 3 s
PQ `captions`, `dbg-timer`, `errname-raf` and four SDR producer fixtures:
video framemd5, bitstream, stream and frame side data, audio), on the final
code and on each build before it.

The earlier rounds' fixtures and the generated 3 s sets (372 parity runs,
448 project renders, both sides rendered, HLG and PQ, ffmpeg 7.0.2 and
8.0.1; rounds 5 to 9, review and verify; the commit before) take the route
they took on round 9's code but for three: the review's `src-4k` and the
generated PQ `compile-timer`, which had fallen back under load with only
"the composite stopped reading overlays", take the passthrough, and the
verify's `unp-mo-rendererfn` (its `MutationObserver` constructor throws in
every render, so the page has no observer) takes the passthrough it
expects instead of declining. Every passthrough among them, 114 renders,
decodes identical to flag off but the hostile load-time channels left out
of scope ("Limitations"): `if-gopd`, `if-get-mark`, `if-proto-late` and
`iface-timer` (6 renders; `if-gopd` and `if-proto-late` on 7.0.2 happened
to match). Every fallback whose layered render is repeatable decodes
identical to flag off; the others are the wall-clock fixtures as before
(animated images and SVG, marquees, CSS and WAAPI animation, the
`gc-selfdrop` pair, run-varying `unp-po-append` and `unp-waapi`).

Round 11 (main merged at 5969cd2b43; ffmpeg 7.0.2 and 8.0.1): motion on
the browser's clock ("Motion on the browser's clock").

On the commit before, the review's realistic 3 s HLG template with a
smooth credits scroller took the passthrough on every run and decoded 35
of 90 frames identical to flag off on both versions (89/90 in a lighter
window), and two variants of it with no `scroll-behavior` in any
stylesheet did the same: a tween that sets `scrollBehavior` to `smooth`
for a while (21/90) and one that sets it, scrolls and sets it back at one
time position (26/90). All three now decline (`overlay_unsupported`: the
CSS gate, then the GSAP vars walk for both tweens), and their fallbacks
match a flag-off render made beside them. Scroll snapping and scroll
anchoring variants of the same template took the passthrough before and
after and decode identical (90/90, bitstream identical). The review's
`css-transition` took the passthrough in the first full run of the earlier
rounds' fixtures on this round's scroll changes (29/90); with the
probe's running-animation decline it falls back in the second run, as do
the generated `css-transition-set` (in one render by eligibility, in the
other by the probe the decline names) and the review's `css-trans-all`,
`css-trans-color` and `starting-style`.

The new harness fixtures (3 s, HLG on 7.0.2 and PQ on 8.0.1):
`smooth-scroll`, `smooth-scroll-toggle` and `css-transition-set` fall back
with their reasons; `snap-anchor-scroll` takes the passthrough and decodes
identical to flag off (90/90).

Concurrent load, the same 24 flag-on renders per version with one flag-off
render of each, all at once: 48 of 48 decode identical to flag off with
the same bitstream, stream and frame side data and audio (load average up
to 152 on 7.0.2 and 130 on 8.0.1), 40 taking the passthrough and 8 the
`gc-fr-remove` declines. A first 8.0.1 run met a load average of 439 from
other work on the host: two flag-off renders failed by the layered path's
own stall rule, and 13 flag-on renders fell back with "the encoder did not
go idle within 120000 ms"; it was run again.

The 20 s fixtures on ffmpeg 8.0.1, each row's eight renders started
together:

| row | load  | transfer | `captions` off / on | `captions-gsap` off / on |
| --- | ----- | -------- | ------------------- | ------------------------ |
| 1   | 21-58 | HLG      | 217 s / 107 s, 2.0x | 244 s / 106 s, 2.3x      |
| 1   | 21-58 | PQ       | 217 s / 104 s, 2.1x | 238 s / 106 s, 2.2x      |
| 2   | 25-66 | HLG      | 241 s / 118 s, 2.0x | 273 s / 121 s, 2.3x      |
| 2   | 25-66 | PQ       | 242 s / 121 s, 2.0x | 274 s / 122 s, 2.2x      |

All eight flag-on renders took the passthrough and decode identical to flag
off (framemd5 600/600, bitstream, stream and frame side data equal).

Flag off renders identical to main (5969cd2b43) on the same ten fixtures
as round 10.

The earlier rounds' fixtures and generated sets, plus the round-10
review's (404 parity runs, 478 project renders, both sides rendered),
take the route they took in round 10 but for two kinds: `unp-waapi`
declines with `overlay_unverified` where it declined with
`overlay_non_gsap_animation` or the other way round (four runs; both
fallbacks decode identical), and the `gc-selfdrop` pair took the
passthrough on the loaded host (0/90 on the round-9 copies, 90/90 on the
review's copy of `gc-selfdrop-remove`): their registry's cleanup ran and
the registry was collected while the page loaded, before the census, as
"Limitations" describes, and two flag-off renders of `gc-selfdrop-remove`
differ with each other (14/90). Every other passthrough, 128 renders,
decodes identical to flag off but the hostile load-time channels left out
of scope (`if-get-mark`, `if-proto-late`, `iface-timer`).
