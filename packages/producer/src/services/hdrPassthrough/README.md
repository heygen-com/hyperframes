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
       │    registrations while it loads (debugger pauses),     registrationWatch.ts
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
       │    its first seek, then the layered DOM session's steps
       │    before frame 0 (scene reads, the seek and stacking
       │    query at the video's start)
       ├─ captureOverlayStates → one PNG per distinct overlay   overlayCapture.ts
       │    walk every frame once, in order (seek + fingerprint  overlayFingerprint.ts
       │    in an isolated world, hashed in Node), screenshot    isolatedWorld.ts
       │    only unseen fingerprints, fold candidates that
       │    render the same overlay, decline a frame that
       │    differs from its candidate's first,
       │    hold the video's own layer still on every probe,
       │    then run the page and content gates again and
       │    decline if any page function ran since load          pageCodeWatch.ts
       └─ compositeAndEncode → videoOnlyPath                    ffmpegComposite.ts
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
  `HDR passthrough off: video_animated (...)`.
- Any other error inside the passthrough logs `HDR passthrough failed; falling back
to the layered HDR composite` and takes the layered path. The layered
  encoder overwrites any partial output.
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
  "ffmpeg" below; `ffmpeg_unsupported` otherwise);
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
  (`overlayPages.ts`, below), and is watched the same way as the analysis
  page; the DevTools-only gates run before its first seek;
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
page the passthrough never touched. The passthrough's own overlay page,
opened only once the render, video and ffmpeg gates have passed (so only
for an HDR render that will attempt it), gets no script, wrapper or global
either: everything below is read through DevTools, from a second session,
and from an isolated world. What the page can observe is timing: the
debugger pauses while the page loads ("Registrations"), and
`Runtime.queryObjects` collects garbage, which a page that watches its own
collection (`FinalizationRegistry`, `WeakRef`) can notice.

## Registrations

What a page registers to run on seeks or on its own clock cannot be read
back once registered: nothing reads an observer's callback, the registry's
lifecycle callbacks or a timer's, and wrapping the constructors in the page
changes what the page sees (`String(MutationObserver)`, an error's stack).
`registrationWatch.ts` watches the registrations as they happen, from
outside, with the debugger:

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
script on the overlay page as V8 compiles it (`Debugger.scriptParsed`,
enabled as the page opens), and a script is the renderer's only by
identity:

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
never seen being compiled is the page's. The runtime and GSAP write only
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
  the `-webkit-scrollbar` family), and no `paint()` (`overlay_unsupported`);
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
`href` or `url()`, or an event handler.

An `<audio>` element paints nothing without controls; one whose controls
GSAP turns on mid-composition is in the fingerprint with its playback
position (the runtime seeks it), so frames with controls never merge and
the verification probes decline (`overlay_unverified`).

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
- The registration watch pauses the page at the first statement of each
  script until the page's own scripts start, and at each registration call
  while it loads: the page loads a little slower, and sees nothing else.
- What a builtin the page hands over runs is found where the renderer, GSAP
  or the browser calls page objects on a seek (listed in "Callbacks that
  run no page script"). One reached some other way is not: a promise
  reaction, a `requestIdleCallback` callback, a listener on a node outside
  the document. A seek can trigger one (a lazy image's `decode()` settles
  once a seek shows it); capture's page reaches that seek in order, as the
  layered render does ("Two pages"), and the paint state a builtin can set
  is in the fingerprint, so a change the reaction makes where the planner
  sees none declines.
- GSAP tweens of anything but elements decline when they write anything,
  including a plain object only page code reads (a counter whose `onUpdate`
  writes the DOM would decline on the callback anyway).
- The allowlists decline content that would render the same: a `<button>`,
  a form control nobody focuses, a `<canvas>` nobody draws on, an image
  format the passthrough does not decode (JPEG XL), an SVG image with an
  external reference, a DOCTYPE, a CSS escape or editor elements outside
  `<metadata>` (Inkscape's `sodipodi:namedview`), an SVG in another
  encoding than UTF-8, a cross-origin stylesheet whose text the network
  record does not hold.
- Event targets are found with `Runtime.queryObjects`, which collects
  garbage first: only a page that watches its own collection
  (`FinalizationRegistry`, `WeakRef`) can notice.
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
52-73 dB, spread over whole frames. The overlay PNGs and the concat list of
the second `control` one were byte-identical to those of nine renders that
matched. Replaying its composite command ten times at once on those inputs,
the composite graph's frames (`-f framemd5` before the encoder) were
identical every time, and one of the ten libx265 encodes differed (21/90).
The encoder, fed as fast as the graph runs and encoding up to 16 frames at
once (`frame-threads=16`), is not deterministic under load; the layered
encoder gets one frame at a time from capture. This is open: the
passthrough has no check for it.
