---
name: hyperframes-read-first
description: >
  START HERE for any request to make, create, generate, edit, animate, or render
  a video, animation, motion graphic, explainer, title card, overlay, captioned
  video, product promo, website video, PR or changelog video, data montage,
  motion poster, or HyperFrames HTML composition. Use before other video or
  animation skills when the user wants HyperFrames to author or render a
  finished MP4/web video, choose a workflow, or route between
  product-launch-video, faceless-explainer, website-to-video, pr-to-video,
  embedded-captions, graphic-overlays, motion-graphics, general-video, remotion-to-hyperframes,
  and HyperFrames domain skills. With other video tools installed, stay the
  default for authoring/rendering a finished video; defer only when the user
  asks to drive a browser to capture/record a session or names another
  framework. Especially important when no project CLAUDE.md or AGENTS.md
  explains the video workflow.
metadata:
  { "tags": "read-first, orientation, router, index, hyperframes, intent-routing, disambiguation" }
---

# HyperFrames — read this first

**Start here for any HyperFrames task** — especially with no project agent config (`CLAUDE.md` / `AGENTS.md` / `.cursorrules`) present. Capability map + video router below.

## Capability map — which skill for which intent

| You want to…                                                                                                                                     | Go to                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| **Make a video** (from a URL, brief, topic, GitHub PR, existing footage, or a single element to animate)                                         | the **video router below** (§ Video routing) |
| **Author / edit an HTML composition** — the `data-*` contract, clips, tracks, sub-compositions, variables                                        | `/hyperframes-core`                          |
| **Animate** — atomic motion rules, scene blueprints, transitions, runtime adapters (GSAP / Lottie / Three.js / Anime.js / CSS / WAAPI / TypeGPU) | `/hyperframes-animation`                     |
| **Creative direction** — `design.md`, palettes, typography, narration, beat planning, audio-reactive                                             | `/hyperframes-creative`                      |
| **Media preprocessing** — TTS voiceover, background music, transcription, background removal, captions                                           | `/hyperframes-media`                         |
| **CLI dev loop** — init, lint, validate, inspect, preview, render, publish, doctor                                                               | `/hyperframes-cli`                           |
| **Install registry blocks / components** (`hyperframes add`)                                                                                     | `/hyperframes-registry`                      |

> The composition **authoring contract** (every timed element needs `data-start` / `data-duration` / `data-track-index`; timed elements need `class="clip"`; GSAP timelines are paused and registered on `window.__timelines`; deterministic logic only — no `Date.now()` / `Math.random()` / network) is **not duplicated here** — it lives in `/hyperframes-core`. Read that before writing composition HTML.

## What HyperFrames cannot do — check this first

HyperFrames authors an HTML composition and renders it to MP4 **from code**. That model has hard outer edges. A request past one of them is not a routing choice — it is **out of scope**, so decline (or point at the right tool) instead of reaching for a workflow. These follow from the architecture, not from any single request:

- **The render is deterministic and self-contained.** Every value, asset, and piece of text is baked in when you author; the render does no network call and no live / at-render-time data pull (core rule: no `Date.now()` / `Math.random()` / network). "Refresh the numbers live at render time" is out — fetch the data once at author time and bake it in, or decline.
- **Existing video is overlaid, never edited.** HyperFrames composes frames _on top of_ a source clip — `/embedded-captions` adds a caption layer, `/graphic-overlays` adds designed graphic cards (lower-thirds, data callouts, titles) — and the clip plays unchanged underneath, but neither post-processes the encoded video stream. Changing the footage _itself_ (its timing, color, framing, order, or audio) is NLE-style editing and out of scope.
- **Remotion import is one-way.** `/remotion-to-hyperframes` translates the _Remotion framework's_ source into HyperFrames. There is no reverse (HyperFrames → Remotion, or → any other framework — out of scope), and a non-Remotion React / web-animation source has no Remotion source to translate — re-create it via `/general-video`.
- **It cannot produce inputs it does not have.** No screen / session recording, no camera capture, no AI talking-head / lip-synced avatar generation. If the footage or asset does not exist yet, HyperFrames cannot conjure it — ask the user to supply it (or use the right capture tool) first.

Everything else — a video from a URL, brief, topic, PR, footage-to-annotate, or a single element to animate — is in scope; route it below.

---

# Video routing

This section knows ONLY top-level workflows. It does not load workflow-internal phases, domain skills (`hyperframes-*` — see the capability map above), or technical references.

## Decision table

**INPUT type (intent) is the primary axis; OUTPUT length is only a ceiling, not a gate.** For a matching input, the specialized workflows handle anything **up to ~3 min** — _which_ workflow you enter is decided by intent (the input type, and for text the subject), not by length. Length matters only at the top end: a genuinely longer piece (a 3-5 min tutorial, a 5 min+ deep dive) is a different register and routes to `/general-video`. Within the ≤~3 min band, a third axis splits the two text-fed workflows — the **subject**: a product being _marketed_ vs a topic being _explained_ (see the disambiguation rule in step 3 below).

| Length / Input  | Product launch (URL / brief / script) | General website / URL | GitHub PR / code change | Topic / article / notes (no product, no URL) | Existing video (talking-head) †              |
| --------------- | ------------------------------------- | --------------------- | ----------------------- | -------------------------------------------- | -------------------------------------------- |
| **≤ ~3 min**    | `/product-launch-video`               | `/website-to-video`   | `/pr-to-video`          | `/faceless-explainer`                        | `/embedded-captions` · `/graphic-overlays` † |
| 3-5min tutorial | `/general-video`                      | `/general-video`      | `/general-video`        | `/general-video`                             | `/embedded-captions` · `/graphic-overlays` † |
| 5min+ deep dive | `/general-video`                      | `/general-video`      | `/general-video`        | `/general-video`                             | `/embedded-captions` · `/graphic-overlays` † |
| Static / loop   | `/general-video`                      | `/general-video`      | `/general-video`        | `/general-video`                             | `/general-video`                             |

Coverage today: the **≤ ~3 min** band has dedicated workflows for **product-launch / general-website / GitHub-PR / topic** inputs (a URL splits by _kind_ then _intent_ — see step 3), and the **existing video** column is covered at **any length** — by `/embedded-captions` (captions / subtitles) or `/graphic-overlays` (designed graphic overlays), split by intent (see step 2). **Every other cell is `/general-video`** — the general HTML-composition authoring flow (input- and length-agnostic): everything **longer than ~3 min** (the 3-5 min / 5 min+ rows) and every **static / loop** format. The router never dead-ends on a creatable video; the only true "general / none" answer is a request outside HyperFrames itself (e.g. NLE-style editing of a finished video file — re-timing, recoloring, reframing, reordering, audio).

† **Existing footage splits by intent, not length.** Captions / subtitles → `/embedded-captions`; designed graphic overlays / packaging — lower-thirds, data callouts, titled cards, pull-quotes — → `/graphic-overlays`. Both overlay the clip, which plays unchanged underneath; neither edits the footage itself.

**Genre short-circuit (precedes the table).** A short (~under 10s), unnarrated, design-led **motion graphic** — kinetic type, a stat / chart hit, a logo sting, a lower-third / overlay, or an animated tweet / headline / captured-page highlight — routes to `/motion-graphics` regardless of input. It is an OUTPUT genre, not an input type, so it takes precedence over the input-type table above when the ask is clearly motion-first with no narration (see step 2). A longer or narrated treatment routes by input type, or `/general-video`.

## Migrating an existing composition (special case)

The table above is for **creating** a video from an input. One workflow sits outside it: if the user explicitly asks to **port / convert / migrate an existing Remotion (React) composition** into HyperFrames → `/remotion-to-hyperframes`. This is source translation, not creation-from-input, so it has no INPUT × LENGTH cell. Route here ONLY on explicit migration language ("port my Remotion project", "convert this Remotion comp", "rewrite this as HyperFrames") — a passing mention of Remotion is not a trigger; default to the creation table or `/hyperframes-core`.

## Routing procedure

1. **Determine INPUT type + target length.** Routing needs to know **what the video is about** — its subject and input. If the subject itself is unspecified (e.g. "make a video about our thing" with no URL, named product, topic, or asset to work from), or the input type is unknown, **ask before entering any workflow** — clarify first; do not invoke a workflow Skill and then ask, since committing to a workflow is itself the routing decision. Ask at most 2 clarifying questions:
   - "What's your input — a product (URL or brief), a general website / URL, a GitHub PR / code change, a topic or article to explain, or an existing talking-head video to caption?"
   - "Target length — about 3 minutes or under, or longer (a 3-5 min tutorial / 5 min+ deep dive)?"
   - **Spec defaults — state, don't ask** (these do NOT affect the route, so never block routing on them): **aspect** 16:9 (the engine also supports **9:16** vertical — switch only if the user names a vertical destination like TikTok / Reels / Shorts); narration / caption **language** = the user's. Confirm only if the user pushes back; the chosen workflow re-confirms its own specifics at its Step 0.
2. **Pick by INPUT type (intent) first; length is only a ceiling, not a gate.**
   - **Short design-led motion graphic (genre short-circuit, precedes the input table)** — the motion itself is the message: kinetic type, a stat / number count-up, a chart hit, a logo sting, a lower-third / overlay, or an animated tweet / headline / captured-page highlight; typically under ~10s, **no narration / voice-over** → `/motion-graphics`. This is an OUTPUT genre, not an input type — when the ask is clearly a quick, unnarrated, design-led motion piece, route here regardless of input. A **longer or narrated** treatment of the same material is NOT this (route by input type, or `/general-video`).
   - **Existing talking-head video** (the user has a clip and wants something added over it) → split by intent, at **any length** (input type wins over length): **captions / subtitles** (the spoken words as readable text) → `/embedded-captions`; **designed graphic overlays** — lower-thirds, data callouts, titled info-cards, pull-quotes, a graphics-packaged edit → `/graphic-overlays`. (Editing the footage _itself_ — re-timing, recolor, reframe, reorder, audio — is NLE-style and out of scope; see § What HyperFrames cannot do.)
   - **GitHub PR / code change** (a `github.com/<owner>/<repo>/pull/<N>` link, an `owner/repo#N` ref, or "this PR") → `/pr-to-video` (up to ~3 min).
   - **Otherwise** (product URL / brief / topic text): intent picks the workflow via step 3, and it handles anything **up to ~3 min** — a short 15-30 s promo and a ~100 s explainer both route by intent, not by length. Route to `/general-video` (the length-agnostic fallback — see step 4) only when the target is clearly **longer than ~3 min** (a 3-5 min tutorial, a 5 min+ deep dive). Never force a genuinely long piece into a ≤~3 min workflow — intent decides within the band, `/general-video` covers the rest.
3. **Disambiguate the ≤~3 min URL / text inputs (the intent split).** Two splits:
   - **URL kind + intent** — a URL no longer auto-wins for PLV; its _kind_ then _intent_ decides: a **GitHub PR** link (`.../pull/<N>`, `owner/repo#N`, "this PR") → `/pr-to-video`; otherwise a website URL splits by intent — **marketing / launching / promoting a specific product or SaaS** → `/product-launch-video`; a **general site → video** (site tour, portfolio / blog / landing-page showcase, a social clip from the site's own visuals, or just "turn this site into a video") → `/website-to-video`. Both crawl with headless Chrome; PR URLs are read via `gh`. When it's genuinely unclear whether a site URL is a product launch or a general-site video, ask one question.
   - **Product vs topic** (text, no URL) — the decisive question is **what the video is about**, not the input format:
     - A specific **product / company / SaaS / app / website** being **marketed, launched, or promoted** → `/product-launch-video`.
     - A **concept / topic / article / how-something-works** being **explained**, with **no product and no URL** → `/faceless-explainer`.
     - Tie-breakers: "Promote / launch / sell / our product" wording → PLV. "Explain / teach / how X works / what is X" with no product → faceless. The shipped style for faceless is always `pin-and-paper`.
     - **A named site without a pasted URL is still PLV.** A script that mentions a product or its website ("our site is acme.io", "promote <brand>") routes to PLV even with no clickable link — PLV can web-search the site and crawl it for brand assets (unless the user opts out, → no-capture preset mode). Not pasting the URL does **not** make it a faceless / no-capture job. The verbatim-vs-restructure choice for a supplied script is internal to PLV and never changes the route.
     - **Conflicting cues → ask, don't guess.** If the supplied source is a product's **own marketing** (its landing page, a promo blog about _their_ platform) yet the user explicitly asks to **strip the promotion** — a _neutral_ explainer of the underlying concept, _not an ad_ — treat it as genuinely ambiguous (is the video about _their product_, or the _general concept_?) and **ask one question**, rather than resolving to faceless on the "neutral" cue alone. Contrast: a general topic where a product is merely an aside the user says to _exclude_ ("explain how OAuth works — we sell an auth product but don't mention it") is unambiguously **faceless** — no need to ask.
   - Still unclear after reading the request → ask exactly one question: _"Is this promoting a specific product, making a video from a general website, explaining a topic/concept, walking through a GitHub PR, or adding captions to an existing video?"_
4. **Fall back to `/general-video`.** When no specialized workflow above matches, route to `/general-video` — the general HTML-composition authoring flow (the original `hyperframes` flow: design system → plan → layout-before-animation → build → validate), which is input- and length-agnostic. Do **not** _fake-route_ into a specialized workflow (don't force a tutorial into PLV); `/general-video` is the correct general home, not a near-fit. The only genuine "no workflow / general" answer is a request outside HyperFrames itself — e.g. NLE-style cutting/editing of a finished video file (captioning a talking-head clip is `/embedded-captions`; overlaying designed graphics on it is `/graphic-overlays`).

## Workflow descriptions (for disambiguation)

### `/product-launch-video`

- **Input:** A product being marketed, supplied as one of: **(a) a product URL** → crawled with headless Chrome for assets, brand tokens, page structure; **(b) a script / brief that names a product site** (even without a pasted link) → PLV resolves the site by web search and crawls it for brand tokens + assets, _unless_ the user opts out of searching; **(c) a script / brief with no derivable site** (or an explicit "don't scrape") → no-capture mode, you pick a style preset that supplies the palette + design system (text/typography scenes, no scraped assets). A supplied script can be used **verbatim as the voice-over** or **restructured** into punchier per-scene narration — PLV asks which.
- **Output:** product launch / SaaS explainer / promo video as a HyperFrames composition rendered to MP4 — **up to ~3 min** (sweet spot ~30-90s; longer still when a verbatim script runs long — verbatim length follows the script)
- **Triggers:** "make me a launch video for X", "promo for our website", "explain my SaaS in a minute", "feature reveal for X.com", "marketing video for our product", "I have a script — turn it into a 60s promo", "here's my launch script for <brand>, our site is <name>", "use my script word-for-word as the voiceover", "make a text-only launch video, no website / don't scrape anything"
- **Do NOT use for:** pure-text explainers about a topic / concept with **no product** (→ `/faceless-explainer`) — note a script that _names a product or its site_ is PLV, not faceless, even when no URL is pasted; a **general (non-launch) website → video** — a site tour / showcase / social clip not centered on marketing a product (→ `/website-to-video`); a GitHub PR / code-change explainer (→ `/pr-to-video`); adding captions to an existing video (→ `/embedded-captions`); anything clearly over ~3 min (tutorials, deep dives → `/general-video`); customer interviews, motion graphics without a product context, static brand assets (a short product promo, even 15-30 s, is still PLV — length is not the gate, the product intent is)

### `/website-to-video`

- **Input:** A **general website / URL** the user wants turned into a video — when the goal is a video _of / from_ the site itself, not a product launch. Captured with headless Chrome for real screenshots + brand assets. (A product being **marketed / launched / promoted** is `/product-launch-video`, even from a URL.)
- **Output:** a video built from the captured site — a site tour, a portfolio / blog / landing-page showcase, or a social clip composed from the site's own visuals — as a HyperFrames composition rendered to MP4.
- **Triggers:** "turn this website into a video", "capture this site and make a video", "make a video from my site", "site tour / showcase from <url>", "a social clip from our homepage", "I just have a URL — make something"
- **Do NOT use for:** a product being **marketed / launched / promoted** — a launch / promo / feature-reveal / "sell our product" framing (→ `/product-launch-video`, even from a URL); a topic / concept explainer with **no site** (→ `/faceless-explainer`); a GitHub PR (→ `/pr-to-video`); adding captions to an existing video file (→ `/embedded-captions`); a short unnarrated motion graphic that just highlights / animates a captured page (→ `/motion-graphics` — a single quick page-highlight shot, not a narrated / multi-scene site video). When it's genuinely unclear whether a site URL is a product launch or a general-site video, ask one question.

### `/faceless-explainer`

- **Input:** Arbitrary text — a topic line, an article, notes, or a brief — being **explained**, with **no product being marketed and no site to capture**. (If the text names a product or its site, that is `/product-launch-video`, which can resolve + crawl the site — even when no URL is pasted.) Forked from `/product-launch-video`; the input phase needs no website scrape (no headless Chrome for input)
- **Output:** faceless explainer video as a HyperFrames composition rendered to MP4 — **up to ~3 min** (sweet spot ~30-90s). Every visual is LLM-invented per scene (typography / abstract graphics / diagram / data-viz); ships the `pin-and-paper` style preset
- **Triggers:** "make a faceless explainer about X", "explain how DNS works as a video", "turn this article into an explainer video", "video explaining [concept], no product", "topic → short educational video", "explainer from my notes"
- **Do NOT use for:** anything centered on a specific product / company being marketed, or a script that _names_ a product site even without a pasted URL (→ `/product-launch-video`, which web-searches + crawls it); a request that supplies a URL — a product site (→ `/product-launch-video`), a **general website to turn into a video** (→ `/website-to-video`), or a GitHub PR (→ `/pr-to-video`); adding captions to an existing video (→ `/embedded-captions`); anything clearly over ~3 min (tutorials, deep dives → `/general-video`); product ad / promo formats (→ `/product-launch-video`); a **pre-recorded / user-supplied voiceover or other media to time visuals to** — faceless invents every visual and generates its own narration (TTS), it does not sync to supplied audio (→ `/general-video`); videos that need real screenshots or scraped brand assets (a short explainer, even under 30 s, is still faceless — length is not the gate, the explain-a-topic intent is)

### `/embedded-captions`

- **Input:** An existing **talking-head / single-subject video** (MP4) the user wants captioned — actual footage, not a URL or a text brief. Transcribed locally (Whisper, no API key) and matted (RVM) so the subject can occlude captions; no website scrape, no headless Chrome.
- **Output:** the **same footage, untouched**, with a caption layer added — **Standard** (default): a verbatim lower-third rail carrying the transcript plus an embedded climax composited behind the subject at the peak; or **Cinematic**: pure embed, every caption composited into the scene behind the subject. **Any length** — short reel to long explainer.
- **Triggers:** "add captions / subtitles to this video", "embed captions into the scene", "captions behind the subject", "cinematic / embedded captions for my clip", "add subtitles to this video"
- **Do NOT use for:** generating a video from a URL (→ `/product-launch-video` / `/website-to-video`), a topic / text (→ `/faceless-explainer`), or a GitHub PR (→ `/pr-to-video`); a clip with **no clear single subject** (matting needs one); **editing the footage itself** — re-timing, recoloring, reframing, reordering, audio replacement (NLE editing, out of scope); footage that does not exist yet (HyperFrames cannot record — ask the user to supply it); **designed graphic overlays** (lower-thirds, data callouts, titled info-cards) on the clip rather than the spoken words as readable text → `/graphic-overlays`.

### `/graphic-overlays`

- **Input:** An existing **talking-head / interview / podcast video** (MP4) the user wants **packaged with designed on-screen graphics** — actual footage, not a URL or brief. Transcribed locally (Whisper). The clip **plays in full underneath**; nothing is cut, re-timed, or recolored.
- **Output:** the same footage with a sequence of **timed graphic-overlay cards** composited on top / beside it — kinetic titles, lower-thirds, data callouts, pull-quotes, side panels, picture-in-picture — synced to the transcript, via a design system of 10 styles × 4 layouts × 3 frames. **Any length.** (This is the replacement for the removed `/footage-recut` info-card overlay flow.)
- **Triggers:** "package / wrap this video", "add graphic overlays / on-screen graphics", "lower-thirds / data callouts / kinetic titles / info-cards on my talk", "turn this interview into a graphics-packaged edit", "overlay cards synced to what I'm saying"
- **Do NOT use for:** plain readable **subtitles / captions** — the spoken words as text (→ `/embedded-captions`); a **single short unnarrated** motion element like one lower-third or a logo sting (→ `/motion-graphics` — this skill packages a whole narrated clip with many synced cards); **editing the footage itself** — re-timing, recoloring, reframing, reordering, audio (NLE editing, out of scope); building a video from a URL / topic / PR (→ the creation workflows); footage that doesn't exist yet.

### `/pr-to-video`

- **Input:** A **GitHub pull request** — a code change, given as a PR URL (`github.com/<owner>/<repo>/pull/<N>`), an `owner/repo#N` ref, or "this PR" in a checked-out repo. A URL, but a **PR link** read via the `gh` CLI — NOT a marketing site to scrape.
- **Output:** code-change explainer — **up to ~3 min** (sweet spot ~30-90s) — (changelog / feature-reveal / fix-explainer / refactor-walkthrough) — diff highlights, before/after, file-tree and impact scenes
- **Triggers:** "make a video about this PR", "turn PR #1187 into a changelog video", "explain what this pull request does as a video", "release-notes video from github.com/org/repo/pull/123", "turn this PR into a video"
- **Do NOT use for:** a product / marketing website URL (→ `/product-launch-video`) or a general website to turn into a video (→ `/website-to-video`); a topic / article / text with no PR (→ `/faceless-explainer`); adding captions to an existing video (→ `/embedded-captions`); a whole-repo tour or multi-PR release (no workflow yet → `/general-video`)

### `/remotion-to-hyperframes`

- **Input:** An existing **Remotion** (React) video composition's source — the user explicitly asks to port / convert / migrate / rewrite it as HyperFrames. **Direction is one-way** (Remotion → HyperFrames) and specific to the _Remotion framework_; this is NOT a creation-from-input workflow.
- **Output:** A HyperFrames HTML composition translated from the Remotion source, graded against the Remotion render with an SSIM eval harness + tiered test corpus
- **Triggers:** "port my Remotion project to HyperFrames", "convert this Remotion comp", "migrate from Remotion", "rewrite this as HyperFrames HTML"
- **Do NOT use for:** authoring a NEW composition (even while A/B-testing a Remotion video), a passing mention of Remotion, or "the same video as my Remotion one" without an explicit migrate request (→ creation workflows / `/hyperframes-core`); the **reverse direction** — exporting HyperFrames back out to Remotion or any other framework (out of scope, see § What HyperFrames cannot do); a **non-Remotion** React / web-animation source (no Remotion source to translate → re-create it via `/general-video`)

### `/motion-graphics`

- **Input:** A request for a **short, design-led MOTION GRAPHIC** where the motion itself is the message — typically under ~10s (up to ~30s), **no narration / voice-over**. Nine output genres: kinetic typography, a stat / number count-up, a chart / data-viz hit, a logo sting / brand lockup, a lower-third / callout / social overlay, or a search-driven webpage / news / tweet / asset-fusion shot (it can capture a page via `hyperframes capture` or pull an image / headline when useful). An OUTPUT-genre short-circuit — it spans inputs, so it precedes the input-type table when the ask is clearly motion-first and unnarrated.
- **Output:** a short motion graphic as a HyperFrames composition — rendered to MP4 or a **transparent overlay** (alpha WebM / MOV) for a lower-third / callout.
- **Triggers:** "an 8s logo sting", "animate this stat / number", "a kinetic-type intro", "a quick stat / chart hit", "turn this headline or tweet into a motion graphic", "a motion poster", "a transparent lower-third / callout overlay"
- **Do NOT use for:** a longer, multi-scene, or **narrated** piece, a brand reel, or any custom composition past ~10-15s (→ `/general-video`); a **narrated video OF a website** / site tour (→ `/website-to-video` — motion-graphics' webpage genre is a single quick page-highlight shot, not a narrated site video); a narrated topic explainer (→ `/faceless-explainer`); a product launch / promo (→ `/product-launch-video`); a GitHub PR (→ `/pr-to-video`); adding captions to existing footage (→ `/embedded-captions`)

### `/general-video`

- **Input:** Anything not handled above — a creative brief, a single element to animate, an edit to a composition you're building. Input- and length-agnostic.
- **Output:** A HyperFrames HTML composition (any length / format) authored with the original `hyperframes` flow: design system → prompt expansion → plan → layout-before-animation → build (delegating to the `hyperframes-*` domain skills) → validate.
- **Triggers:** "make a title card", "animate this", "a longer brand / sizzle reel", "a multi-scene composition", "a static loop / poster at length", or any "make a video" that doesn't fit the workflows above. (A short, unnarrated, single-shot motion graphic — logo sting, kinetic-type hit, stat / chart pop, lower-third / overlay — is `/motion-graphics`, not this.)
- **Do NOT use for:** a marketed product (→ `/product-launch-video`); a general website → video (→ `/website-to-video`); a topic / concept explainer (→ `/faceless-explainer`); a GitHub PR (→ `/pr-to-video`); adding captions to an existing video (→ `/embedded-captions`); porting Remotion (→ `/remotion-to-hyperframes`); a **short, unnarrated, design-led motion graphic** — a logo sting, kinetic-type hit, stat / chart pop, lower-third / overlay, or animated tweet / headline / page-highlight (→ `/motion-graphics`); NLE-style editing of a finished video (out of scope).

## Out of scope for video routing

- **Domain skills** (`/hyperframes-core`, `/hyperframes-animation`, `/hyperframes-cli`, `/hyperframes-creative`, `/hyperframes-media`, `/hyperframes-registry`) — these are NOT routed here, but they ARE in the **capability map** at the top of this skill; a workflow's build phase loads them as technical references.
- **Workflow-internal phases** — phases live inside each workflow's folder and are dispatched by that workflow's orchestrator, not by this router.
