---
name: faceless-explainer
description: "turn arbitrary text — an article, notes, a topic, a brief — into a faceless explainer video, up to ~3 min (sweet spot 30-90s), where every visual is invented (typography, abstract graphics, diagrams, data-viz) rather than captured. There is no URL, no website capture, and no real assets. Use this skill for topic explainers, concept breakdowns, how-tos, listicles, and narrative explainers. Do not use it for a product launch/promo (use /product-launch-video), a tour of a real website (use /website-to-video), a GitHub PR (use /pr-to-video), captions on existing footage (use /embedded-captions), or a short unnarrated motion graphic (use /motion-graphics). If the intent is unclear, route through /hyperframes first."
---

# Faceless Explainer to HyperFrames

Use this skill to turn a body of text into an explainer video: pick a design system, plan a teaching story, and build it frame by frame in HyperFrames. **Faceless** means every visual is invented downstream — there is no capture step and no real asset inventory.

> **Confirm the route before Step 0.** You are the orchestrator. Run each step, verify its gate, and only then continue. This skill is for **explaining a topic from text, with no product and no website to capture**. Route other intents elsewhere: a product launch/promo → `/product-launch-video`; a tour of a real site → `/website-to-video`; a GitHub PR → `/pr-to-video`; captions on existing footage → `/embedded-captions`; a short unnarrated motion graphic → `/motion-graphics`. If the user says only "make a video" or the route is uncertain, read `/hyperframes` first.

You are the orchestrator. Work in `videos/<project>/`. Run steps in order and pass each gate before continuing. User-gated steps are Step 0, Step 3, and Step 6. Do every step yourself except Step 5, where you dispatch one sub-agent per frame. Do not put design or motion rules here; those live in the frame-worker sub-agent, `hyperframes-creative`, and `hyperframes-animation`.

Workflow: Step 0 setup → `hyperframes.json`; Step 1 brief → `capture/extracted/`; Step 2 design system → `frame.md`; Step 3 storyboard/script → `STORYBOARD.md` and `SCRIPT.md`; Step 3.1 audio → `audio_meta.json`; Step 4 visual design → enriched `STORYBOARD.md`; Step 5 frames → `compositions/frames/NN-*.html` and `index.html`; Step 6 final render → `renders/video.mp4`.

---

## Step 0: Setup and Brief

Goal: Lock the core video brief and create the HyperFrames project if needed.

Initialize only if `hyperframes.json` is missing. Name `<project>` from the topic in kebab-case, such as `compound-interest-explained`; never use workspace name or timestamp.

`npx hyperframes init "videos/<project>" --non-interactive --skip-skills --example=blank`

**Show sign-in status before the brief** — run `npx hyperframes auth status` and **relay its output verbatim (don't paraphrase or rewrite it).** It reports whether voice/BGM will use HeyGen or local engines and, when not signed in, how to sign in. **If not signed in, STOP and wait for the user to choose — sign in, or say "go"/"offline" to continue with local engines — before asking the brief or anything else.** Treat it as a real decision point, not a passing note; don't fold the choice into the brief question, and don't write keys into a per-repo `.env`. (In autonomous mode, note the status and continue offline.) See `../hyperframes-media` → Preflight for the canonical guidance.

**Gate:** `hyperframes.json` exists, and angle, length, aspect ratio, and language are locked; sign-in status was shown (signed in, or continuing offline).

---

## Step 1: Brief (no capture)

Goal: Fold the user's text into the project as the source of information. There is **no website capture and no real assets** — this is a faceless explainer.

Save the user's full input verbatim, then create the synthetic capture package by hand:

- `capture/extracted/visible-text.txt` — the full article / notes / topic / brief, verbatim. This is the source of **information**, not a story template (Step 3 reshapes it).
- `capture/extracted/tokens.json` — `{ "title": "", "description": "", "colors": [], "fonts": [] }`. Fill `title`/`description` from the brief. Leave `colors`/`fonts` empty unless the user explicitly gave brand colors or fonts — then add them (the design preset supplies a complete palette regardless).

Do **not** run `npx hyperframes capture` (there is no URL). Do not create `asset-descriptions.md` or populate `capture/assets/` — faceless visuals are invented in Steps 4-5, not captured. The one exception: if the user supplied a real image, place it under `public/<basename>` and note it for Step 3.

**Gate:** `capture/extracted/visible-text.txt` and `capture/extracted/tokens.json` exist; you can state the explainer's topic and audience in one clear sentence.

---

## Step 2: Design System

Goal: Choose one shipped frame preset; a script turns it into this video's `frame.md` + caption skin.

You make the one judgment call — **which preset**. Read `../hyperframes-creative/references/design-spec.md` and browse `../hyperframes-creative/frame-presets/`; pick the preset whose look best fits the topic, tone, and audience. Then run:

```bash
node <SKILL_DIR>/scripts/build-frame.mjs --preset <name> --hyperframes .
```

The script does the rest deterministically: copies the preset's `FRAME.md` → `frame.md` and **remixes** it onto any brand tokens in `capture/extracted/tokens.json` (brand colors mapped onto the preset's color keys by role; the preset's display + body fonts swapped for the brand's), copies the preset's caption skin to `.hyperframes/caption-skin.html`, and self-validates (exits 1 on a broken mapping). Proceed as soon as it exits 0 — no hand-editing of the spec.

A faceless explainer usually has **no brand colors/fonts** (`tokens.json` colors/fonts empty) → the script keeps the preset's own palette, a complete shippable design. Only when the user named brand colors/fonts add them to `tokens.json` before running, and only adjust `frame.md` by hand afterward if a mapping truly needs it.

**Gate:** `build-frame.mjs` exited 0 — `frame.md` exists from a named preset, and (when the preset ships one) `.hyperframes/caption-skin.html` exists as the caption skin source.

---

## Step 3: Storyboard and Script

Goal: Turn the text into an approved frame-by-frame teaching plan.

Read `references/story-design.md`, `../hyperframes-core/references/storyboard-format.md`, and `../hyperframes-core/references/script-format.md`. Use them to write `STORYBOARD.md` and, when narration is needed, `SCRIPT.md`.

Use `story-design.md` for the explainer structure (concept / how-to / listicle / story), hook strategy, clarity techniques, emotional beats, the type-enum mapping, and `VO_MODE`. The video's sequence comes from **narrative design, not the input text's paragraph order** — reorder, merge, omit, compress. Faceless visuals are invented downstream, so frames do **not** carry an asset inventory: leave `asset_candidates` empty unless the user supplied a real `public/<basename>` image. Use the exact required fields from the storyboard and script references.

After drafting, show a frame-by-frame summary. In that same message ask the user two things: (a) to approve or request changes, and (b) whether they want a live preview of the storyboard scaffold (`npx hyperframes preview`) — open it only on a yes. Iterate until approved, and carry the preview choice to Step 6.

**Gate:** `STORYBOARD.md` exists, every frame has the required narrative fields, `SCRIPT.md` exists when narration is needed, and the user approved the frame-by-frame plan.

---

## Step 3.1: Audio

Goal: Generate narration, word timings, music, and audio metadata from the approved script.

Start audio after Step 3 approval. Run it in the background, then continue to Step 4. (Sign-in status was already shown in Step 0; the engine falls back automatically.)

`node <SKILL_DIR>/scripts/audio.mjs --script ./SCRIPT.md --storyboard ./STORYBOARD.md --hyperframes . --out ./audio_meta.json &`

The audio script handles narration, word timings, BGM lookup from HeyGen's music library, and timing metadata. BGM mood comes from the storyboard's `music:` field. This uses the HeyGen Audio API for retrieval, not generation, and the same `~/.heygen` credential as TTS. For provider details, read `../hyperframes-media/references/tts.md`.

If there is no narration and no `SCRIPT.md`, skip voice generation. BGM may still run if the storyboard has a music mood.

**Gate:** audio job has started, or the project is marked silent.

---

## Step 4: Frame Visual Design

Goal: Add the visual direction, layout intent, and motion choices to each storyboard frame.

Edit `STORYBOARD.md` in place. Do not create another storyboard. Use `frame.md` as the source of truth for color, type, layout feel, and style.

Read `references/visual-design.md`, `references/composition.md`, `references/motion-language.md`, and `../hyperframes-animation/`. Use `visual-design.md` for required frame fields and the required `## Video direction` block. Use `composition.md` for layout, hierarchy, focal points, and the invented-visual treatment. Use `motion-language.md` and `../hyperframes-animation/` for valid effects and blueprint IDs. Do not invent effect names or blueprint IDs.

For every frame, add required visual and motion fields, including `effects` and `focal` and/or `roles`. Because the explainer is faceless, `focal`/`roles` describe **invented visual elements** (a hero word, a diagram node, a data-viz series), not captured assets. Add one video-wide `## Video direction` block for overall visual direction, motion style, pacing, and design rules.

Do not change story, script, `transition_in`, or the source text. Do not write HTML in this step. There is **no asset-staging step** — faceless visuals are built by the workers in Step 5. If the user supplied a real `public/<basename>` image, reference it by path in the relevant frame's `focal`/`roles`; otherwise nothing to stage.

**Gate:** every frame has `effects` plus `focal` and/or `roles`; `## Video direction` exists.

---

## Step 5: Build Frames

Goal: Build every storyboard frame as an HTML composition and assemble the playable video.

Wait for Step 3.1 audio to finish if audio was started. Then sync durations and fetch SFX; skip both if silent.

`node <SKILL_DIR>/scripts/audio.mjs sync-durations --audio-meta ./audio_meta.json --storyboard ./STORYBOARD.md`

`node <SKILL_DIR>/scripts/audio.mjs fetch-sfx --storyboard ./STORYBOARD.md --hyperframes .`

Duration sync is mechanical: real voice duration wins; silent frames keep estimates; never hand-edit synced durations.

Before dispatch, read `sub-agents/frame-worker.md` and `../hyperframes-core/references/subagent-dispatch.md`. Dispatch one sub-agent per frame, in parallel if possible; otherwise run workers in waves. Each worker gets exactly one frame.

Each worker context must include `PROJECT_DIR`, `frame_id`, canvas size, caption status and keep-out band if captions are enabled, and `ANIM_DIR` as the absolute path to `../hyperframes-animation/`. Each worker reads `frame.md`, its own `## Frame N` block from `STORYBOARD.md`, and the recipe body for each cited effect or blueprint ID. Each worker writes only `compositions/frames/NN-*.html`. Workers must never edit `STORYBOARD.md`.

As each worker returns, the orchestrator marks that frame as `animated` in `STORYBOARD.md`.

After audio timings exist, build captions in the background and assemble the index:

`node <SKILL_DIR>/scripts/captions.mjs build --storyboard ./STORYBOARD.md --audio-meta ./audio_meta.json --hyperframes . --out ./caption_groups.json &`

`node <SKILL_DIR>/scripts/assemble-index.mjs --storyboard ./STORYBOARD.md --hyperframes .`

`captions.mjs` uses the project's `.hyperframes/caption-skin.html` (copied in Step 2) as the caption look, injecting brand tokens from `frame.md`; with no skin present it renders the built-in default pill. `captions: skipped (<reason>)` is valid. Continue without captions when explicitly skipped.

**Gate:** every frame is marked `animated`, `index.html` exists, and captions are built or explicitly skipped.

---

## Step 6: Finalize

Goal: Verify the assembled video, get user approval, and render the final MP4.

Inject transitions, run checks, pause for review, then render.

`node <SKILL_DIR>/scripts/transitions.mjs inject --storyboard ./STORYBOARD.md --hyperframes .`

`node <SKILL_DIR>/scripts/transitions.mjs verify --storyboard ./STORYBOARD.md --index ./index.html`

`npx hyperframes lint`

`npx hyperframes validate`

`npx hyperframes inspect`

`npx hyperframes snapshot --at <frame-midpoints>`

`snapshot` stitches the captured frames into one contact sheet (`snapshots/contact-sheet.jpg`). Glance at it; if nothing is obviously broken, move on — don't linger here.

If a command fails, surface stderr and stop — don't pile on recovery commands. Fix it yourself: the cheapest safe edit to `compositions/frames/NN-*.html`, then rerun the failed check.

**Known false-positive — do not chase it.** `inspect` may report a handful of `text_box_overflow` errors of ~1–4px on the **caption** highlight words (selector `#caption-word-*` / `.caption-line`). The caption pill uses a deliberately snug `line-height` (set once in `scripts/captions.mjs`) and has **no `overflow:hidden`**, so a heavy display glyph's ink spills a few px into the pill's own padding — nothing is actually clipped. Treat these as expected and proceed. Do **not** inflate the caption `line-height` (it balloons the pill, which is worse). Only act on a `text_box_overflow` when it names a **frame** element (`#el-NN-*`), not a caption word.

After checks pass, pause for user review. The video is assembled, viewable, and editable in Studio. Manage preview only once across Step 3 and Step 6: open it if the user asked earlier, offer it if they declined earlier, and do not ask again if they are already reviewing in Studio.

Preview: `npx hyperframes preview`

Render only after user approval:

`npx hyperframes render --skill=faceless-explainer --quality high --output renders/video.mp4`

Do not rerun `lint`, `validate`, `inspect`, or `snapshot` after rendering unless the user asks.

**Gate:** `lint`, `validate`, and `inspect` passed before render; user approved at the review pause; `renders/video.mp4` exists. Final reply states MP4 path and final duration.

---

## Quick Reference

**Formats:** landscape `1920x1080` by default; portrait `1080x1920`; square `1080x1080`. Set the format once in the storyboard frontmatter.

**Faceless deltas vs a captured-asset workflow:** no Step 1 capture (synthetic `tokens.json` + `visible-text.txt`); no `asset-descriptions.md` and no `capture/assets/`; no asset-staging in Step 4; `asset_candidates` empty by default; every visual is invented by the Step 5 workers (typography / abstract graphics / diagrams / data-viz). A user-supplied `public/<basename>` image is the only real asset path.

**Background scripts:** the workflow ships only these under `scripts/`: `build-frame` for adopting + brand-remixing a frame preset into `frame.md` (+ caption skin); `audio` for TTS, transcription, BGM, SFX, and duration syncing; `captions`; `transitions` for inject and verify; and `assemble-index`. Everything else is the `hyperframes` CLI.

| Read                                                                                                         | When                                          |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `[../hyperframes-creative/frame-presets/](../hyperframes-creative/frame-presets/)`                           | Step 2: choose and adopt a frame preset.      |
| `[../hyperframes-creative/references/design-spec.md](../hyperframes-creative/references/design-spec.md)`     | Step 2: apply brand tokens correctly.         |
| `[references/story-design.md](references/story-design.md)`                                                   | Step 3: plan the explainer story.             |
| `[../hyperframes-core/references/storyboard-format.md](../hyperframes-core/references/storyboard-format.md)` | Step 3: write `STORYBOARD.md`.                |
| `[../hyperframes-core/references/script-format.md](../hyperframes-core/references/script-format.md)`         | Step 3: write `SCRIPT.md`.                    |
| `[../hyperframes-media/references/tts.md](../hyperframes-media/references/tts.md)`                           | Step 3.1: choose or understand TTS providers. |
| `[references/visual-design.md](references/visual-design.md)`                                                 | Step 4: enrich the storyboard visually.       |
| `[references/composition.md](references/composition.md)`                                                     | Step 4: judge composition.                    |
| `[references/motion-language.md](references/motion-language.md)`                                             | Step 4: judge motion language.                |
| `[../hyperframes-animation/](../hyperframes-animation/)`                                                     | Step 4: cite effect and blueprint IDs.        |
| `[sub-agents/frame-worker.md](sub-agents/frame-worker.md)`                                                   | Step 5: dispatch per-frame workers.           |
| `[../hyperframes-core/references/subagent-dispatch.md](../hyperframes-core/references/subagent-dispatch.md)` | Step 5: dispatch sub-agents safely.           |
