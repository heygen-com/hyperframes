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
| an in-process composite (graph straight into libx265)        | 60   | 0 (1 of 10 earlier)  |
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
repeats. A composite that feeds an in-process encoder straight from the
filter graph is the first row: 3 of about 20 such renders under load
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
  encoder's, so it declines only once the process has been idle without
  one for 10 s (`LIBX265_THREAD_WAIT_MS`);
- before every frame, unless the process is still the one proven (same
  executable, lineage, no child), and on every poll after the first frame,
  unless that libx265 thread and every thread present once the first frame
  went idle (x265's pool) are still there. A listing that misses one is
  read again (up to three times) before the thread counts as gone, and the
  decline names it: on a loaded host one `/proc` read in a long encode can
  fail for another reason than the thread exiting;
- when a poll finds no thread states to read: an unread encoder is not an
  idle one.

A name, a mapped library and a thread name can all be forged: a wrapper
that maps a library named `libx265` (or carries its banner) and names an
idle thread `enc0:0:libx265` passes every check above, and can leave the
frames to the real ffmpeg, started as a `setsid`'d, double-forked
grandchild that inherits its stdin. So the proof also asks who reads the
frames:

- the process's stdin (`/proc/<pid>/fd/0`) is a pipe or socket, as `spawn`
  made it, and the same one before every frame;
- no other process of this user holds it (every `/proc/<n>/fd`), read when
  the process is proven, once the first frame has gone idle, and after the
  last frame, while the pipe is still open (whatever reads the frames
  holds it until then). A process of this user whose descriptors cannot be
  read (one still starting up, read again for up to 5 s)
  declines, unless it started before the encoder, when it was not handed
  the encoder's stdin at spawn (an ssh session's processes, non-dumpable,
  keep their descriptors from their own user);
- after the last frame, the libx265 thread has run since the first frame
  went idle (its CPU time, `schedstat`, or `stat`'s utime + stime): ffmpeg
  hands every frame to libx265 on that thread, while a thread that only
  bears the name waits.

A wrapper that daemonizes ffmpeg shares its stdin with it until it closes
its own copy, and has none after; both decline. The scan reads a few
thousand descriptors on a busy host, tens of milliseconds, three times per
render.

Wrappers named `ffmpeg` that start the real one as a child, in a new
session, outside their process tree (a double fork, the same a second into
the encode, a daemon), forged ones as above, and shell scripts all decline
and render identical to flag off through the layered path; ffmpeg itself,
a symlink, a renamed copy, an ELF or a script that execs ffmpeg in place,
and `taskset` or `nice` exec-ing it take the passthrough and decode
identical to flag off (`encoderPacing.integration.test.ts` runs the same
shapes).

A wrapper also leaves its child holding the composite's pipes when the
composite is stopped, which would keep the encode from ever settling, so
the composite's pipes are closed from this side when it stops, and its
child ends too.

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
session asks first runs it and every later session skips it. An overlay
page that asked first would take that seek away from the layered DOM
session after a fallback (a page that counts its seeks, `raf-counter`,
would show `n=4` at frame 0 where flag off shows `n=5`). So the analysis
page never reads it, and the capture page reads it exactly when the layered
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
once a target is collected: one handed a bound `Element#remove` for a
tenured target (`gc-tenured-remove`) would have the overlay pages'
collections remove a box the layered render, which never collects it that
early, keeps. So the census reads every live registry's cleanup from the
heap snapshot like an observer's callback, and one that is not the
renderer's script declines (`seek_callback`).

## The capture page is never paused

A page can time the analysis page's pauses on a clock the shim does not
replace (`Event#timeStamp` around a `setTimeout` the watch breaks on, the
start times of `performance.mark()` around one) and paint differently when
it was paused. A capture page watched the same way would be paused too and
paint that way, while the layered session, never paused, paints the other
(`dbg-timer`). So:

- The capture page loads with no debugger at all. With the debugger
  enabled, V8 reports every compile to DevTools (`Debugger.scriptParsed`),
  which makes compiling many times slower, and a page can time that while
  it loads: `dbg-compile-detect` timed 3000 tiny `eval`s against 3000
  `JSON.parse` calls on `Event#timeStamp`, a ratio of 3.5 in the layered
  session and 40-84 on a page with the debugger on, and painted "WATCHED"
  above 15; two pages that both had the debugger would agree with each
  other on the watched paint. So the capture page's script
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

  Anything else declines (`seek_callback`). A count that allows for the
  runtime's variance would not do: a page that timed the analysis page's
  pauses and made one `MutationObserver` with a bound builtin callback
  only on the capture page fits inside that allowance whenever the runtime
  happens to make fewer of its own there (`unp-mo-append`).

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
fingerprint calls equal. A list of such things by name always misses a
place one can hide (a pseudo-element the list does not name, a canvas in a
shadow root), so `ownClock.ts` lists what is accepted instead, and
everything else declines:

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
one over 4 MiB declines, rather than reading a prefix and never looking at
what follows it.

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
capture makes and end before any later gate looks (`css-transition`, 0.5 s,
set at 1.5 s, under load). The fingerprint reads every animation's play
state on every probe, and the probe right after the seek always sees the
transition running (reading the animations resolves the style change
first), so a probe that sees any running animation throws
`BrowserClockError` too (`overlay_non_gsap_animation`).

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
- Hostile pages that detect the passthrough at load time are out of scope
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
  load. Capture and the composite run beside it, so a flag-on render costs
  about that encode plus the page loads, but no less: the 20 s `captions`
  and `captions-gsap` fixtures render about 1.35-1.44x faster flag on than
  flag off at high load (load average 33-174 on 32 cores, the encoder
  waited on to go idle for about 75% of the encode), and up to about 2x at
  moderate load. The gain shrinks as the host's load grows. The
  passthrough needs Linux to read the encoder's thread states and
  descriptors, a software libx265 encode, and an ffmpeg 7.0 or later (which
  names its encoder thread) that is the spawned process itself (a symlink,
  a renamed copy or a script that execs it in place), not a wrapper around
  one.
- The encoder proof cannot tie the encoder's stdin to the pipe end this
  process writes: `spawn` makes a socket pair, whose two ends have
  different inodes, and Linux does not show a socket's peer in `/proc`. So
  a wrapper that swaps its stdin for another pipe before it is first read,
  or that reads the frames itself and forwards them to an ffmpeg, is not
  caught; neither is a process that started before the encoder, cannot be
  read, and is handed the pipe later. Like hostile pages, a hostile
  `HYPERFRAMES_FFMPEG_PATH` built to defeat the proof is out of scope; the
  proof keeps an honest wrapper from being paced on the wrong threads.
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

The parity harness (`src/hdr-passthrough-harness/`) renders a composition
with the flag off and on and compares the decoded frames (`framemd5`), the
HEVC bitstream, stream and frame side data and audio. It generates the HLG
and PQ caption fixtures, one negative fixture per fallback class
(`--ineligible`) and the edge cases (`--edge`). On HLG and PQ, ffmpeg 7.0.2
and 8.0.1:

- The 3 s and 20 s `captions` and `captions-gsap` fixtures and every
  positive generated case take the passthrough and decode identical to
  flag off, with the same bitstream and side data.
- Every negative fixture takes the route and reason it expects, and every
  fallback whose layered render is repeatable decodes identical to flag
  off. Content on the wall clock (animated images, marquees, CSS and WAAPI
  animation) is not repeatable flag off either, so only its route and
  reason are checked.
- About 400 parity runs of adversarial fixtures (page code on seeks,
  builtins handed to the browser, observers and finalization registries,
  shadow trees, scroll and transition motion), both sides rendered: every
  passthrough among them decodes identical to flag off, except the hostile
  load-time channels and the finalization registries collected before the
  census that "Limitations" leaves out.
- Concurrent load: 24 flag-on renders per ffmpeg version and a flag-off
  render of each fixture, all at once (load average up to about 200 on 32
  cores), decode identical to flag off.
- `HYPERFRAMES_FFMPEG_PATH` wrappers ("Encoder pacing"): ffmpeg itself and
  the wrappers that run it in place take the passthrough and decode
  identical to flag off; the others decline and render identical through
  the layered path.
- Killing the encoder or the composite mid-encode, or interrupting the
  CLI, falls back or stops with no process left behind.
- With the flag off, renders are identical to main's
  (`hdr-hlg-regression`, `hdr-regression`, `hdr-hlg-audio-windows`, the 3 s
  HLG and PQ `captions`, and SDR producer fixtures).

What the passthrough saves is in "Limitations": about 1.35-1.44x at high
load and up to about 2x at moderate load on the 20 s fixtures.
