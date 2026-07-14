# Workflow catalog

Use this catalog while routing, before the selected workflow is lazy-installed. After the routing table in `../SKILL.md` yields a candidate, read that candidate's section and confirm that its input and output match the request.

## Sections

- [`/product-launch-video`](#product-launch-video), [`/faceless-explainer`](#faceless-explainer), [`/pr-to-video`](#pr-to-video)
- [`/embedded-captions`](#embedded-captions), [`/talking-head-recut`](#talking-head-recut)
- [`/motion-graphics`](#motion-graphics), [`/music-to-video`](#music-to-video), [`/slideshow`](#slideshow)
- [`/general-video`](#general-video), [`/remotion-to-hyperframes`](#remotion-to-hyperframes)

## `/product-launch-video`

- **Input:** A website URL; a script or brief that names a site; or a product-launch script with no derivable site or an explicit “do not scrape” instruction. Capture website assets and brand tokens unless the brief selects no-capture mode. Ask whether supplied script copy is verbatim voice-over or may be restructured.
- **Output:** A product promo, launch video, site tour, or showcase MP4. Sweet spot 30–90s; hard cap about 3 minutes. A show-it-as-is brief features captured screens rather than inventing a separate route.
- **Triggers:** “launch video for X”, “promo for our site”, “turn this script into a 60s promo”, “text-only launch video”, “turn this website into a video”, “site tour from this URL”.

## `/faceless-explainer`

- **Input:** A topic, article, notes, or arbitrary text being explained, with no product being marketed and no website to capture.
- **Output:** A faceless explainer MP4 with invented typography, abstract graphics, diagrams, or data visualization. Sweet spot 30–90s; hard cap about 3 minutes.
- **Triggers:** “faceless explainer about X”, “explain how DNS works as a video”, “turn this article into an explainer”.

## `/pr-to-video`

- **Input:** A GitHub PR URL, `owner/repo#N`, or “this PR”, read through `gh`; it is not a website capture request.
- **Output:** A changelog, feature reveal, fix explainer, or refactor walkthrough with diff, before/after, file-tree, and impact scenes. Hard cap about 3 minutes; duration follows change size.
- **Triggers:** “make a video about this PR”, “turn PR #1187 into a changelog video”, “release-notes video from this pull request”.

## `/embedded-captions`

- **Input:** Existing talking-head footage to caption. It is an actual media file, not a URL or creative brief.
- **Output:** The same footage, untouched, with a caption layer and selected caption identity. The subject may occlude embedded captions. Any length.
- **Triggers:** “add captions”, “add subtitles”, “captions behind the subject”, “cinematic captions for my clip”.

## `/talking-head-recut`

- **Input:** Existing talking-head, interview, or podcast footage to package. The underlying clip plays unchanged.
- **Output:** The same footage with transcript-synced graphic-overlay cards: kinetic titles, lower-thirds, data callouts, pull-quotes, side panels, or picture-in-picture. Any length.
- **Triggers:** “package this video”, “add graphic overlays to my talk”, “add lower-thirds or data callouts to this interview”.

## `/motion-graphics`

- **Input:** A short design-led unit, typically under 10s, with no narration, where motion is the message: kinetic type, stat/count-up, chart hit, logo sting, animated title, lower-third, map, tweet/headline/page highlight, or asset-fusion shot.
- **Output:** A short MP4 or transparent alpha WebM/MOV overlay.
- **Triggers:** “an 8s logo sting”, “animate this stat”, “kinetic-type intro”, “animate this title”, “transparent lower-third overlay”.

## `/music-to-video`

- **Input:** A music track, or a video whose audio becomes the track, with no narration or website capture. User images or videos are optional.
- **Output:** A beat-synced MP4 driven by a deterministic beat/energy map (`audiomap.json`). It may become a lyric video, slideshow, visualizer, or kinetic promo without changing pipelines.
- **Triggers:** “make a video for this song”, “beat-synced video”, “lyric video”, “music visualizer”, “kinetic promo to this beat”.

## `/slideshow`

- **Input:** A brief, outline, or existing page to author as a presentation, pitch deck, or interactive deck. If “slides”, “deck”, or “convert this page” is ambiguous, confirm that the user wants a HyperFrames slideshow before authoring.
- **Output:** A runnable HyperFrames composition plus the JSON island used by `SlideshowController`: discrete slides, fragment reveals, branching, hotspots, presenter mode, and speaker notes. The deliverable is a navigable deck, not an MP4.
- **Triggers:** “make a pitch deck”, “interactive presentation”, “convert this page into slides”, “slideshow with presenter mode”.

## `/general-video`

- **Input:** Any custom creation or edit not covered above: a static title card, longer brand or sizzle reel, multi-scene montage, static loop/poster, NLE-like footage remix, or freeform composition. It also executes every `flow: companion` brief.
- **Output:** A HyperFrames composition of any length or format through design → plan → static layout → animation → check → approval → render.
- **Triggers:** “make a static title card”, “longer brand reel”, “multi-scene composition”, “static loop”, “custom video”, or any unmatched video request.

## `/remotion-to-hyperframes`

- **Input:** Existing Remotion React source, only when the user explicitly asks to port, convert, or migrate it. A passing Remotion mention is not a trigger.
- **Output:** A HyperFrames HTML composition translated from the source and compared with the Remotion render through the migration evaluation harness.
- **Triggers:** “port my Remotion project”, “convert this Remotion composition”, “migrate from Remotion”.
