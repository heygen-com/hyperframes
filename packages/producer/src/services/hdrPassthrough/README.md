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
       ├─ overlay page: scripts recorded as V8 compiles them    scriptOrigins.ts
       │    from before it navigates; call counts from load      pageCodeWatch.ts
       ├─ checkPassthroughEligibility                           eligibility.ts
       │    render / video gates, ffmpeg blend self-test         ffmpegBlendCheck.ts
       │    in-page layout gates, animation gates,
       │    analyzeOverlayTiming → frames where the overlay can change,
       │    hf-seek listeners on window (DevTools listener lookup),
       │    content the fingerprint cannot read or that paints on its
       │    own clock (DevTools DOM snapshot, shadow-piercing walk),
       │    page callbacks that run on seeks (virtual-time shim record,
       │    GSAP's global timeline, read before the first seek too),
       │    callbacks that run no page script                      nativeCallbacks.ts
       ├─ planOverlayStates → candidate states                  planner.ts
       ├─ captureOverlayStates → one PNG per distinct overlay   overlayCapture.ts
       │    probe each candidate (seek + overlayFingerprint.ts),
       │    screenshot only unseen fingerprints, merge identical neighbours,
       │    re-probe every frame of each merged state,
       │    hold the video's own layer still on every probe,
       │    then decline if any page function ran since load      pageCodeWatch.ts
       │    and run the callback, snapshot and image gates again
       └─ compositeAndEncode → videoOnlyPath                    ffmpegComposite.ts
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
  `HDR passthrough off: video_animated (...)`.
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
- an ffmpeg whose `maskedmerge` rounds exactly like the layered blend (see
  "ffmpeg" below; `ffmpeg_unsupported` otherwise);
- no page code that runs on seeks and keeps state across them: an
  animation-frame callback, a film-time timer, a GSAP ticker listener of the
  page's own, or anything playing on GSAP's global timeline outside the
  registered timelines, such as a `gsap.delayedCall` (`seek_callback`; see
  "History-dependent drivers" below);
- no callback that runs no page script, where V8's call counts cannot see
  it: a builtin, bound function, callable Proxy or WebAssembly export as an
  event listener or `on*` handler anywhere, an observer callback, a tween
  target's accessor or Proxy trap, a tween value, a setter on a runtime
  global, and no custom element definition at all (`seek_callback`; see
  "Callbacks that run no page script" below);
- no overlay content the capture fingerprint cannot read: a closed shadow
  root, or an `<iframe>`, `<object>`, `<embed>` or frame anywhere, shadow
  trees included (`overlay_unreadable`; see "Capture dedup" below);
- overlays that change only at frames the planner can see: clip windows and
  GSAP tweens or `set()` calls. Anything animating on its own clock declines
  (CSS / Web Animations, canvas, iframes, frame sources, timeline callbacks,
  Lottie and other adapters, three.js / WebGPU, SVG SMIL, animated GIF / WebP /
  APNG / AVIF, `hf-seek` listeners on `window`; CSS animations and SMIL inside
  open shadow roots too, which `document.getAnimations()` does not list), as does a run of per-frame
  changes longer than a short transition, or more states than the analysis
  limit. Animated images count wherever they paint: an `<img>`,
  `<input type=image>`, SVG `<image>` / `<feImage>` / external `<use>`, or a
  CSS background, `content`, list-style, border or mask image of an element
  or of its `::before`, `::after`, `::marker` or other pseudo-elements, in the
  document and in every open shadow root; a CSS Paint worklet (`paint()`)
  runs page code of its own on every paint and declines too. So do content
  that animates inside a user-agent shadow tree (`<marquee>`, a `<progress>`
  with no value), an `<audio controls>` (the runtime sets every audio
  element's `currentTime` on a seek, and the controls paint it), and any
  `<video>` besides the source, in a shadow root or added by script
  (`video_count`), all read from the DOM snapshot, which pierces every shadow
  tree. A seek-driven writer none of these name (a setter on a runtime
  global, a wrapped runtime function, an accessor GSAP writes through) is
  page code that runs on capture's seeks, which declines the passthrough
  after capture (`seek_callback`) if the verification probes have not
  already declined it (`overlay_unverified`);
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
- The encoder options are the ones the layered stage gives
  `spawnStreamingEncoder` (codec, preset, CRF or bitrate, delivery caps, GOP
  lock, GPU selection, x265 colour parameters, BT.2020 tags); only the raw
  stdin input and `-vf` are replaced by the file inputs and the composite
  graph.
- The layered encoder reads raw frames, which carry no side data. The
  composite decodes the source file, and ffmpeg 8 carries the source's
  mastering display and content light level through the graph, where the mp4
  muxer writes them as container `mdcv` / `clli` boxes, and defaults
  libx265's `dolbyvision` to `auto`, which copies Dolby Vision RPUs. The
  graph starts with `sidedata=mode=delete` (every type), and libx265 gets
  `-dolbyvision 0` when the binary has the option (8.0 does, 7.0 has none and
  rejects it). The harness compares the stream's side data and every side
  data value on the first frame, not just the types.

On the generated fixtures, including the rational-rate, odd-canvas,
fractional-duration and deep-seek edge cases, the result is bit-identical to
the layered render with ffmpeg 7.0 and with 8.0 (the version the Dockerfiles
and CI pin).

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

## History-dependent drivers

Capture reads each frame from a fresh seek, out of order, and many frames
more than once; the layered path seeks every frame once, in order. A driver
whose output depends on the time alone renders the same either way, which
the verification probes check frame by frame. A driver that keeps state
across seeks does not, and its probes can agree with each other while
disagreeing with the layered render: a `requestAnimationFrame` counter that
shows "WAIT" for its first three callbacks has stopped changing long before
capture starts; a film-time interval that appends a mark has already fired
up to the furthest frame eligibility seeked, and a backward seek un-fires
nothing.

With the passthrough on, and only then, the virtual-time shim
(`fileServer.ts`, `virtualTimeShimFor`) carries a callback record that
notes, from page load, every distinct animation-frame callback, counts every
film-time timer whose caller is page code, and counts every string timer.
The renderer's callers are told apart by the script their stack frame names:
`hyperframes://injected/<n>` (the file server's), the compiler's
`hyperframes://position-seek-reapply` and DevTools `pptr:` evaluations. A
page can name a script that way, so the page code watch declines any page
script that takes one of these names (`RENDERER_SCRIPT_NAMES`), and the name
in a stack is the renderer's. Eligibility declines with `seek_callback` when
the page has registered any callback, set any string timer, or added a
listener to GSAP's ticker. GSAP's own ticker
also runs from an animation frame; it is told apart by sleeping and waking
it (which cancels and re-requests its frame). It renders GSAP's global
timeline on its own clock, the seeks it has seen so far, lag-smoothed: the
registered timelines and the roots they hang from are seeked to film time by
the runtime, but anything else that plays there (a `gsap.delayedCall`, a
tween of a plain object, an unregistered timeline, element target or not)
fires on that clock, which capture's out-of-order seeks do not share with
the layered path. Eligibility declines (`seek_callback`) any playing child
of the global timeline off a registered timeline's chain, and any paused one
holding a callback. GSAP drops a fired `delayedCall` from the global
timeline, so this is read before eligibility's first seek as well as after
the analysis. The record and the global timeline are read again after
capture, for a callback first registered on a frame only capture visited.

The record also counts observers (`MutationObserver`, `ResizeObserver`,
`IntersectionObserver`, `PerformanceObserver`, `ReportingObserver`) whose
callback runs no page script, and every custom element definition; see
"Callbacks that run no page script" below.

What the record cannot see, a setter on a runtime seek-time global or a
wrapped runtime function that keeps state of its own, runs after load, which
the page-code watch below declines.

The record must not change any render. With the flag off it is not in the
page at all: those renders are served `VIRTUAL_TIME_SHIM`, the shim exactly
as it is without the feature (`fileServer-callbackRecord.test.ts` compares
it with `origin/main`'s text when the checkout has it). The record is
spliced into that text at four anchors rather than written into it, and a
shim whose anchors moved gets no record, so the passthrough declines.

With the flag on, a render that falls back must still match the flag-off
render, so the record calls nothing the page can replace or observe. Every
intrinsic it uses is captured when the shim runs, before any page script,
and called through saved references (`Function.prototype.call.bind`); its
property descriptors have no prototype (`defineProperty` reads `get` and
`set` through one); it parses stacks with string searches, not regular
expressions (which update `RegExp.$1`). It reads its caller from a stack
taken from the realm's own `Error` with the page's `Error.prepareStackTrace`
and `Error.stackTraceLimit` set aside as own data properties and put back as
they were, so a hook the page installs never runs for it. A hook that cannot
be set aside (non-configurable), or a stack it cannot read, makes the caller
page code. A page that replaces every builtin a shim could reach for sees
the same calls with the record as without it (the unit test counts them).
The observer constructors and `CustomElementRegistry.prototype.define` are
replaced by Proxies of themselves, which forward everything they do not
record and keep `name`, `prototype`, `prototype.constructor` and the
property attributes; what tells them apart is listed under "Limitations".

## Page code on seeks

The fingerprint reads what page script can read back, and paints only
through the DOM, the CSSOM and the paint state it lists ("Capture dedup").
Page code that runs on a seek can change what paints where it does not
read, and can keep state across seeks, through a setter on
`__hfTypegpuTime`, a replaced `__hf.seek`, an accessor on a GSAP tween
target, a custom element reacting to an attribute GSAP writes or a
MutationObserver. Every probe then fingerprints equal while the pixels
differ, and no screenshot is taken.

So fingerprints stand in for pixels only while no page code runs after the
overlay page loads. `pageCodeWatch.ts` turns on V8's precise call counts
(`Profiler.startPreciseCoverage` with `callCount`, which resets the counts)
once the overlay page is ready, before eligibility's first probe, and reads
them after capture. Eligibility's probes are inside the window too: a page
function they reach (a builtin the page replaced, a getter) runs on the
overlay page and not on the layered path's. Any function that ran in a
script that is neither the renderer's nor GSAP's declines the passthrough
with `seek_callback`, naming the first one.

Whose a script is never comes from its URL, which the page chooses
(`//# sourceURL=`) or leaves empty (eval, `new Function`, inserted inline
scripts). `scriptOrigins.ts` records every script on the overlay page as V8
compiles it (`Debugger.scriptParsed`, enabled before the page navigates) and
counts a script as the renderer's only when how it was made says so:

- its text is, byte for byte, one the renderer put in the page: the file
  server's injected scripts (`injectedScriptTexts`, read back from what the
  injection helpers write) and the compiler's seek reapply
  (`POSITION_SEEK_REAPPLY_SCRIPT`), by SHA-256;
- it was compiled in an isolated world (the DevTools utility world);
- it was compiled in the main frame with no script on the stack and no
  embedding document, either before anything else in its document (the
  renderer's `evaluateOnNewDocument` scripts) or under a `pptr:` URL
  (DevTools evaluations; the planner's own listener lookup is named so).

eval, `new Function` and inserted scripts are compiled with the page's code
on the stack; parser-inserted and external scripts have an embedding
document; so a page script reaches the third rule only through a string
timer, which the shim's record declines, or a `javascript:` URL (see
"Limitations"). GSAP is a published build (`gsapBuilds.ts`: the core bundle,
`CustomEase` and `EasePack`, 3.10.0 and later, minified or not), by SHA-256
of the script as served or as the compiler inlines it; a file only named
like one is the page's. A script never seen being compiled is the page's,
and a page script that takes one of the renderer's names declines even if it
never runs. The runtime and GSAP write only what the fingerprint reads: DOM
attributes and styles, and the values of GSAP's tween targets, which the
fingerprint reads back.

A record that cannot be started or read declines too.

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

- event listeners and `on*` handlers, through the DevTools protocol
  (`nativeCallbacks.ts`), which reads them without calling anything: every
  node of the composed tree (`DOMDebugger.getEventListeners` on the
  document, piercing shadow trees and frames) and every other event target
  the page holds (`Runtime.queryObjects` on `EventTarget.prototype`: window,
  workers, message ports, font sets, media query lists, animations). A
  handler counts when it has no source location, prints as native code
  (a WebAssembly export), is bound to one or is a Proxy with such a trap;
- what the renderer and GSAP call on the page's objects on a seek: the
  registered timelines and `window.__timelines`, the page's accessors on
  `window.__hf*` globals (the runtime assigns `__hfTypegpuTime` and
  `__hfThreeTime` on every seek), function values in tween vars (GSAP calls
  a function-based value on the tween's first render), the tween targets
  (a Proxy among them, or on their prototype chains, with a trap that is
  not page script) and their accessors for the keys the tweens write. A
  platform accessor (`scrollTop`) is native and passes: it prints as
  `function set scrollTop() { [native code] }`;
- observers, in the shim's callback record, which notes each construction
  whose callback prints as native code: nothing reads an observer's
  callback back once it is registered;
- custom element definitions, in the same record: the registry keeps the
  lifecycle callbacks it read at define time
  (`attributeChangedCallback = HTMLElement.prototype.showPopover` opens the
  element as a popover when GSAP writes an observed attribute), and nothing
  reads those back, so any definition declines.

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

## Capture dedup

The planner's states are candidates: a superset of the frames where the
overlay can change (a clip cut claims the frames around it, a `set()` the
frames around its time). Capture seeks to each candidate and reads a
fingerprint of everything the overlay's pixels depend on: DOM attributes and
text (including open shadow roots and their own sheets), normalised inline styles, the CSSOM
(`@import`ed sheets included), the focused element,
scroll and form state, image and font load state, CSS / Web Animation times,
non-CSS values written by GSAP tweens, the paint state no attribute holds
(see "Callbacks that run no page script" above), and the stacking order. The video's own
nodes and script text are left out. A new fingerprint is captured through the
unchanged layered capture path; a repeated one reuses its PNG; a candidate
whose fingerprint or captured pixels match the state before it is merged into
it. A candidate whose overlay differs in any way starts its own state, so a
one-frame change is never merged away.

That holds only for what the fingerprint can read. Page script cannot enter
a closed shadow root (`shadowRoot` is null) or, in general, the document of
an `<object>`, `<embed>` or frame: a tween there changes pixels and no
fingerprint, so every candidate of a change run would merge and every
verification probe would match without a screenshot. Eligibility reads a
DevTools DOM snapshot (`DOMSnapshot.captureSnapshot`, which pierces both)
and declines such content with `overlay_unreadable`; the snapshot is read
again after capture.

The frames between capture frames are the planner's word, which holds only
for drivers its static analysis sees. When a merged state closes, each of
its candidates is probed again at every frame but its capture frame. A fingerprint the
state has not seen is screenshotted; pixels that differ from the state's
fall back (`overlay_unverified`) rather than ship a stale overlay. The probe
is exhaustive because it is the safety net for drivers no static check
names (a raw `requestAnimationFrame` loop, a setter on a runtime seek-time
global, a wrapped seek, a film-time timer): any sampling grid misses a
change shorter than its gap, and a periodic driver can alias with it. It
costs one probe (seek + fingerprint, no screenshot) per frame.

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
from ffmpeg's frame count and reports 35–80%.

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
- Page code compiled from a `javascript:` URL under a `pptr:` name passes
  for a DevTools evaluation: such a script has nothing on the stack and no
  embedding document. It takes a page that names its code after the
  renderer's internals; string timers, the other way to compile code like
  that, decline.
- GSAP is recognised by the exact text of a published build (core,
  `CustomEase`, `EasePack`, 3.10.0 and later). An older release, another
  plugin, GSAP bundled into a script of the page's own, and any other
  library that runs after load count as page code and decline, as does a
  page function GSAP calls on a tween's first render (a function-based
  value) when that render falls inside the watch.
- Compiler scripts other than the seek reapply (the position-edits render
  script, whose text depends on the edits) count as page code when they run
  after load. So does a page builtin replacement any of the renderer's probes
  calls (`Array.prototype.filter`, say): both decline.
- For a driver that counts seeks, a fallback render is not bit-identical to
  a flag-off render either: the layered path makes one seek fewer before
  frame 0 after a fallback (`raf-counter` shows `n=4` where flag off shows
  `n=5`). Both are the layered path; the passthrough itself never shipped.
  The same holds for a page that counts the builtins the renderer's page
  code calls: one that counts `indexOf`, `split`, `test` and `exec` calls
  shows 15 more before frame 0 after a fallback, then the same count per
  frame. The shim's callback record is not the cause: a flag-off render with
  the record forced into its shim decodes identical to one without.
- `hf-seek` listeners are read once, after the page loads; one added later
  is left to the verification probes.
- Any custom element definition declines, page-script callbacks or not: the
  ones the registry keeps cannot be read back.
- What a builtin the page hands over runs is found where the renderer, GSAP
  or the browser calls page objects on a seek (listed in "Callbacks that
  run no page script"). One reached some other way is not: a builtin the
  page put in place of another builtin the renderer calls
  (`Array.prototype.filter = Function.prototype.call.bind(...)`), a promise
  reaction or `requestIdleCallback` callback (each runs once, on the wall
  clock), a listener on a node outside the document. A builtin can only
  change state; the paint state it can set is in the fingerprint, so a
  change that depends on the time alone is still captured.
- The record is not invisible to a page that reads source text. The shim's
  `requestAnimationFrame`, `setTimeout` and `setInterval` wrappers print
  with the record's lines in them, and the observer constructors and
  `CustomElementRegistry.prototype.define` are Proxies, which
  `Function.prototype.toString` prints as `function () { [native code] }`,
  without their name; an error thrown inside one (`new MutationObserver(1)`)
  has the record's trap in its stack. A page that paints that text renders
  differently with the flag on, fallback or not.
- Reading the tween targets' accessors calls the traps of a Proxy among the
  targets or on their prototype chains; such a Proxy declines unless its
  traps are page script, which the call counts then see. Event targets are
  found with `Runtime.queryObjects`, which collects garbage first: only a
  page that watches its own collection (`FinalizationRegistry`, `WeakRef`)
  can notice.
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
