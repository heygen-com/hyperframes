# Prompt Guide expansion plan

Status: draft 2026-07-08. Owner: Vance. Source of validated content: the 2026-07-07/08
prompting-guide work (18 verified example prompts, showreel recreation, motion grammar,
asset-gen hybrid, recreation protocol; renders in ~/src/hyperframes-prompt-examples,
preview page https://www.heygenverse.com/a/5db0a33b-97e3-4fdb-8747-823a73ad9bbe).

## Goal

Promote `guides/prompting` from a single page to a top-level **Prompt Guide** nav group:
the current page splits into focused sub-pages, each expanded, and every documented
feature that _implies_ a promptable action gets actual prompting guidance. Standing
rule carried over from the original guide: **no prompt ships unverified** — every
example is built, rendered, and (where feasible) embedded next to its prompt.

## Navigation (docs.json)

New top-level group between **Concepts** and **Guides**:

```
[Prompt Guide]
  prompting/overview
  [Fundamentals]
    prompting/anatomy
    prompting/specification-dial
    prompting/vocabulary
    prompting/iterating
    prompting/rules-and-anti-patterns
  [Making it look good]
    prompting/visual-specs
    prompting/motion
    prompting/generated-artwork
    prompting/recreating-references
  [By video type]
    prompting/product-launch
    prompting/explainers
    prompting/code-and-prs
    prompting/music-and-slideshows
    prompting/captions-and-talking-heads
    prompting/motion-graphics
  [By feature]
    prompting/transitions
    prompting/captions-catalog
    prompting/overlays-and-lower-thirds
    prompting/code-blocks
    prompting/data-and-maps
    prompting/vfx-and-liquid-glass
    prompting/rendering-and-output
    prompting/editing-existing-videos
    prompting/media-and-audio
    prompting/variables-and-templating
    prompting/runtimes-and-3d
    prompting/design-systems
```

`guides/prompting` becomes a redirect to `prompting/overview`. Keep the page count out
of prose (drift rule, same as skills.mdx).

## Page-by-page

### prompting/overview

Landing: what prompting a video means, one-time skill setup (moved from current page),
the two prompt shapes (cold/warm), the recommended workflow loop, and a map of the
section. Ends with 3 "best of" example prompts w/ embedded renders.

### Fundamentals (split + expand current content — all already validated)

- **anatomy** — the 6-part skeleton, per-part rationale, assembled terminal example,
  plus 3 dissections: take a weak prompt, show the fixed version, diff annotated.
- **specification-dial** — mood → style tokens → full spec; cross-model validation
  result; the two always-pins (Three.js, sequencing). Expand: when looseness is a
  feature (creative exploration) vs when density is mandatory.
- **vocabulary** — existing mapping tables (easing, caption tones, transition energy,
  audio-reactive, marker highlights, TTS voices, render quality) + new validated ones:
  camera language ("push in 6%", "drone orbit"), depth language ("near-lens bokeh"),
  pacing language ("punchy 2s cuts" vs "cinematic holds").
- **iterating** — talk-like-an-editor edits (existing) + the calibration rules from the
  recreation work: absolute targets not relative nudges, one axis at a time, freeze
  what works.
- **rules-and-anti-patterns** — the 7 technical rules, anti-patterns, plus the newly
  validated ones: never "holds motionless", don't create simultaneity conflicts,
  don't override skill-mandated styles, "~60s" with verbatim scripts.

### Making it look good (current sections promoted to pages, each gains examples)

- **visual-specs** — density ladder + mountain-title worked example + 2 more specs
  (one UI piece, one typographic piece) with renders.
- **motion** — the six-rule premium-motion grammar; before/after render pair
  (frozen-hold build vs motion-pass build of the same piece — we have both).
- **generated-artwork** — hybrid pattern, 3 keying/restraint rules, before/after
  (hand-drawn SVG team vs asset-gen team — we have both renders).
- **recreating-references** — the transcribe → iterate → distill protocol, fidelity
  table, globe worked example + its one-shot render; honest-ceiling callout.

### By video type (one page per workflow; the 8 current examples seed them)

Each page: what the workflow does, 3-5 verified prompts (the existing one + variants:
different durations, aspect ratios, tones), the knobs that matter for that workflow
(e.g. explainer: verbatim vs summarized script, caption style, scene density), and
common failure modes. NEW VALIDATION NEEDED: ~2-4 variant builds per page.
Pages: product-launch (also covers website-to-video), explainers, code-and-prs
(pr-to-video + code blocks context), music-and-slideshows, captions-and-talking-heads
(embedded-captions + talking-head-recut), motion-graphics (also logo stings, stats).

### By feature — the "implied but unguided" gap pages

Sourced from existing docs that document a capability without prompting guidance:

- **transitions** (sources: 14 shader + 13 CSS catalog groups, transitions skill) —
  energy/mood → named block mapping, when shader vs CSS, per-seam prompting
  ("whip-pan on phrase changes"), full block name table. Validation: montage build
  exercising ~6 transitions.
- **captions-catalog** (sources: 15 caption components + embedded-captions skill) —
  tone → component mapping ("karaoke pill", "kinetic slam", "matrix decode"), per-word
  styling asks, safe-area/vertical notes. Validation: one clip rendered with 4 styles.
- **overlays-and-lower-thirds** (sources: social overlays, lower-thirds, news-ticker
  catalog groups) — "add a lower third at 0:03 with name/title" class of prompts,
  picking styles by brand tone, transparent-overlay output for NLEs.
- **code-blocks** (sources: code animations + 24 code-snippet themes) — prompting
  code walkthroughs: typing, diff, highlight, scroll; theme selection language.
- **data-and-maps** (sources: data-chart, 5 US-map variants, world/spain maps) — chart
  prompts from CSV/inline data, map highlight/flow/bubble asks, the animated-map
  motion-graphics pattern.
- **vfx-and-liquid-glass** (sources: HTML-in-Canvas group, html-in-canvas guide) —
  device mockups, liquid glass, shatter/portal/magnetic effects; when these need the
  canvas pipeline and what to say.
- **rendering-and-output** (sources: rendering, 4k-rendering, hdr, deploy/lambda) —
  quality/format/framerate asks, transparent WebM (and when it's incoherent — full-frame
  designs), 4K/HDR guidance incl. cost warnings, "render this on Lambda" cloud prompts.
- **editing-existing-videos** (sources: timeline-editing, keyframes,
  video-editor-cheatsheet, studio docs) — NLE-verb prompts: trim/split/move/retime
  scenes, keyframe nudges, "make scene 2 snappier", swap assets; maps the cheatsheet's
  editor verbs to prompt phrasings. Likely the highest-traffic page of the group.
- **media-and-audio** (sources: video-components, remove-background, media-use skill)
  — TTS voice/tone/speed asks, BGM mood + loudness targets ("under -18dB"), SFX cues,
  transcription/captions from audio, background removal, video-in-video/PiP, and the
  supplied-assets rule (explicit paths).
- **variables-and-templating** (sources: concepts/variables, sdk) — parameterized
  compositions ("make name/logo/color variables"), batch/personalization prompts,
  template-then-instantiate pattern.
- **runtimes-and-3d** (sources: concepts/frame-adapters, gsap-animation) — the
  Three.js-via-adapter pin with worked language, when Lottie/CSS/WAAPI make sense to
  request, shader transition requests, canvas/WebGL determinism caveats in prompt form.
- **design-systems** (sources: claude-design, open-design, figma skill) — design.md /
  brand-token driven prompting, "use the site's own palette", Figma import asks.

## Validation & build plan

Reuse the proven pipeline: Opus builder subagents, one-shot from the page's prompts,
lint+validate+render gates, frame verification; embed finished MP4s next to prompts
(Mintlify supports video embeds; assets go wherever docs media lives today — confirm
hosting path, else link the HeyGenVerse gallery).

Phasing (each phase shippable):

1. **Restructure** — split current page into overview + Fundamentals + Making-it-look-good
   (no new validation needed; content exists). Add nav group + redirect. ~1 PR.
2. **High-traffic gaps** — editing-existing-videos, rendering-and-output,
   media-and-audio, transitions, captions-catalog. Each needs a validation build day.
3. **By video type** — 6 pages, variant builds per workflow.
4. **Long tail** — remaining feature pages (data-and-maps, vfx, variables, runtimes,
   design-systems, overlays, code-blocks).

## Competitive research findings (2026-07-08, adversarially verified)

Deep-research survey of first-party prompt guides — Sora 2 (OpenAI Cookbook), Runway
Gen-3/Gen-4, Veo (DeepMind + Cloud Veo 3.1), Luma, Anthropic prompt-engineering docs.
(Pika/Kling/Midjourney/Gemini/Copilot claims failed verification — resurvey later.)
What the best guides converge on, and what we adopt:

1. **Named content-slot anatomy.** Every major guide teaches a slot formula
   (camera + subject + action + context + style [+ audio]); Veo 3.1 and Runway Gen-3
   make it a literal bracket template. We already have a _process_ skeleton
   (route/spec/beats/copy/technique/negatives) — ADD a named _content_ formula whose
   slots map to HyperFrames concepts (beat + element + motion + layout + style/brand
   - audio), demonstrated in one worked example. Lives on the anatomy page.
2. **Keyword→Output tables.** Runway Gen-3's gold standard: six categorized keyword
   tables where every row pairs the keyword with the actual generated output. Our
   vocabulary tables get the same treatment: motion verbs → GSAP behavior, camera
   terms → transform/Three.js choreography, style terms → CSS treatment — each row
   with a small rendered clip. (Borrow the format, not their legacy keywords.)
3. **Output pairing is the differentiator.** Even the best guides skip outputs on
   their most complex examples (Sora's longest templates ship without any; both Veo
   guides mostly unpaired — refuted 0-3). Our article standard (every prompt +
   unedited render) beats the field; keep it absolute.
4. **❌/✅ paired rewrites under named rules with engine rationale** — Runway's
   dominant device (e.g. ❌ "no clouds in the sky" → ✅ "a clear blue sky", because
   negative prompts backfire). Adopt across anatomy + rules pages using our own
   validated pairs: ❌ "holds motionless" → ✅ "settles into ambient idle";
   ❌ "both at 4s" → ✅ "fades out by 4.2s; at 4.2s..."; ❌ "make dots 2x finer" →
   ✅ "dot radius = 25% of row spacing".
5. **Iteration as single-variable science.** Sora: "editing is for nudging, not
   gambling" — one change per edit; Runway Gen-4: minimal motion-only prompt first,
   then add ONE element type at a time; strip-then-relayer when a shot misfires.
   Expand the iterating page with these three moves + our absolute-targets rule.
6. **Timestamped/beat-segmented prompting as a signature device.** Veo 3.1's
   [00:00-00:02] per-segment prompting is the survey's most distinctive device — and
   it maps one-to-one onto HyperFrames' native data-* timing. Our "Beat N (x-ys)"
   convention is this; promote it explicitly ("more native here than in any
   diffusion model") on anatomy + by-video-type pages.
7. **Anthropic's IA moves**: thin-router overview, one consolidated living
   best-practices reference (legacy URLs 301 into anchors), prerequisite gate
   ("before prompting, have X"). Adopt: keep overview thin; add a short
   prerequisites block (skills installed, preview running, project scaffolded);
   plan redirects when pages consolidate later.
8. **Efficacy evidence as differentiation** (research open question): no surveyed
   guide shows its advice measurably works. Ours can — renders are deterministic and
   cheap; we already hold before/after pairs (frozen vs motion-passed, hand-drawn vs
   generated, loose vs dense builds). Add "before/after" render pairs as a standard
   device on making-it-look-good pages.

Full cited report: deep-research run wf_c81199b6-b15 (22 confirmed claims, 3 refuted;
sources incl. cookbook.openai.com, help.runwayml.com, deepmind.google, cloud.google.com,
lumalabs.ai, platform.claude.com).

## Incorporate the article's drafted guidance

The HeyGenVerse article (https://www.heygenverse.com/a/5db0a33b-97e3-4fdb-8747-823a73ad9bbe)
drafted guidance and presentation patterns beyond the current mdx — these become the
template for every expanded page:

- **Proof pairing**: every example prompt is immediately followed by its unedited
  render with the label "Rendered from the prompt above, unedited." This is the
  guide's core credibility device — pages without renders don't ship.
- **Provenance line**: each page states how its claims were validated (built,
  rendered, frame-verified) and when. The article's footer wording is the model.
- **Example tags**: prompts carry a visible registry-block / workflow / freeform tag
  so readers learn which layer of the system they're exercising.
- **Drafted section prose to carry over into the split pages** (the article's phrasing
  is tighter than the mdx in places — reconcile toward the article):
  - Specification dial: "controls how far the result drifts from what you imagined,
    not whether it works" + the two-pins callout as a distinct highlighted element.
  - Generated artwork: the wins/loses two-column comparison (code-drawn wins /
    code-drawn loses) rather than prose paragraphs.
  - Motion: six numbered rules with the "frozen final second is the biggest
    cheap-motion tell" line.
  - Recreation: the 3-row fidelity table (transcribe ~75% / iterate ~90% /
    distill ~80-90%) + honest-ceiling callout, with the one-shot render embedded
    under the distilled spec (not the hand-tuned version — the honest artifact).
- **Article lifecycle**: the HV page stays the shareable preview/marketing surface;
  it gets regenerated from the docs content at the end of each phase so the two never
  fork. Renders already uploaded as HV assets (19 MP4s) are reusable by URL in the
  docs if we choose the link-out hosting option (open question 2).

## Consistency obligations

- CLAUDE.md "skill catalog maintenance" applies: skills' SKILL.md descriptions stay the
  source of truth for one-line blurbs; the by-video-type pages must link the matching
  skill and not fork its routing language.
- llms.txt regenerates from docs — verify the new group lands there.
- Vocabulary tables must match what skills actually implement (easing map, caption
  tones) — audit against skills/hyperframes-animation + embedded-captions at write time.
- Catalog pages already demo each block; feature pages link to them rather than
  duplicating block docs. Prompting pages own only the "what to say" layer.

## Open questions

1. Group vs tab in docs.json (Mintlify): group keeps single-sidebar; tab gives the
   guide its own sidebar. Current nav is single-tab groups — start as group, promote to
   tab if it crowds.
2. Where do example MP4s live for docs embeds — repo (heavy), CDN bucket, or link out
   to the HeyGenVerse gallery page? Decide before Phase 1 ships renders.
3. Do by-video-type pages absorb the existing standalone guides (website-to-video) or
   link them? Proposal: link, don't absorb — those guides cover mechanics, prompting
   pages cover phrasing.
