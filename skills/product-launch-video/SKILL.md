---
name: product-launch-video
description: "turn a product or marketing URL, pasted script, or brief into a product launch video, including SaaS promos, feature reveals, app launches, company promos, and product marketing videos. Use this skill when the user wants to market, launch, promote, or reveal a product. Do not use it for general non-launch website tours, non-product topic explainers, GitHub pull requests, captioning existing footage, or short unnarrated motion graphics. If the intent is unclear, route through /hyperframes first."
---

# Product Launch to HyperFrames

Use this skill to capture a product, understand its brand, plan a launch video, and build it frame by frame in HyperFrames.

> **Confirm the route before Step 0.** You are the orchestrator. Run each step, verify its gate, and only then continue to the next step. This skill is for a **product being marketed, launched, promoted, or revealed**, including requests such as "promo for our site" when the purpose is promotional. Route other intents elsewhere: a general non-launch website tour -> `/website-to-video`; a topic explainer with no product -> `/faceless-explainer`; a GitHub PR -> `/pr-to-video`; captions on existing footage -> `/embedded-captions`; a short unnarrated motion graphic -> `/motion-graphics`. If the user says only "make a video" or the route is uncertain, read `/hyperframes` first.

You are the orchestrator. Work in `videos/<project>/`. Run steps in order and pass each gate before continuing. User-gated steps are Step 0, Step 3, and Step 6. Do every step yourself except Step 5, where you dispatch one sub-agent per frame. Do not put design or motion rules here; those live in the frame-worker sub-agent, `hyperframes-creative`, and `hyperframes-animation`.

Workflow: Step 0 setup -> `hyperframes.json`; Step 1 capture -> `capture/`; Step 2 design system -> `frame.md`; Step 3 storyboard/script -> `STORYBOARD.md` and `SCRIPT.md`; Step 3.1 audio -> `audio_meta.json`; Step 4 visual design -> enriched `STORYBOARD.md`; Step 5 frames -> `compositions/frames/NN-*.html` and `index.html`; Step 6 final render -> `renders/video.mp4`.

---

## Step 0: Setup and Brief

Goal: Lock the core video brief and create the HyperFrames project if needed.

Initialize only if `hyperframes.json` is missing. Name `<project>` from the brand or domain in kebab-case, such as `acme-promo`; never use workspace name or timestamp.

`npx hyperframes init "videos/<project>" --non-interactive --skip-skills --example=blank`

**Gate:** `hyperframes.json` exists, and angle, length, aspect ratio, and language are locked.

---

## Step 1: Capture assets

Goal: Collect the source material, brand signals, and usable assets for the video.

Classify the input and choose the path. Explicit URL -> capture it and use the site for narration and assets. Pasted script/brief -> save verbatim as `user_script.txt`, ask once "use it verbatim or restructure?", store answer as `VO_MODE`, then resolve capture target: URL in text -> use it; brand name only -> `WebSearch`, confirm URL in one line, then crawl; no URL/site -> no-capture path.

Run capture with: `npx hyperframes capture "<URL>" -o ./capture`

If `GEMINI_API_KEY`, `GOOGLE_API_KEY`, or an OpenRouter key exists, capture auto-captions assets into `capture/extracted/asset-descriptions.md`. This is not a review gate. Without a vision key, use DOM context and continue.

No-capture path: create `capture/extracted/tokens.json`, `capture/extracted/visible-text.txt`, `capture/extracted/asset-descriptions.md`, and `capture/assets/` by hand. `tokens.json` should be `{ "title": "", "description": "", "colors": [], "fonts": [] }`; fill title/description from the brief when possible. `visible-text.txt` contains the full brief or script. `asset-descriptions.md` should say no assets were captured unless the user gave asset notes.

**Gate:** `capture/extracted/tokens.json`, `capture/extracted/visible-text.txt`, `capture/extracted/asset-descriptions.md`, and `capture/assets/` exist; you can state the brand in one clear sentence. Treat `asset-descriptions.md` as the main asset inventory. If it is missing after real capture, stop and report capture incomplete. If `capture/BLOCKED.md` exists, follow it.

---

## Step 2: Design System

Goal: Choose one shipped frame preset; a script turns it into this video's `frame.md` + caption skin.

You make the one judgment call — **which preset**. Read `../hyperframes-creative/references/design-spec.md` and pick the preset whose look best fits the brand and brief. Then run:

```bash
node <SKILL_DIR>/scripts/build-frame.mjs --preset <name> --hyperframes .
```

The script does the rest deterministically: copies the preset's `FRAME.md` → `frame.md` and **remixes** it onto the brand tokens in `capture/extracted/tokens.json` (brand colors mapped onto the preset's color keys by role — ink, canvas, accents — keeping keys/structure/components; the preset's display + body fonts swapped for the brand's), copies the preset's `caption-skin.html` verbatim, and self-validates (exits 1 on a broken mapping). Proceed to the next step as soon as it exits 0 — no hand-editing of the spec.

`tokens.json` with no brand colors/fonts (e.g. no capture) → the script keeps the preset's own palette, a complete shippable design. If the brief names brand colors/fonts the capture missed, add them to `capture/extracted/tokens.json` before running (or use the user's `design.md` to populate it); only adjust `frame.md` by hand afterward if a mapping truly needs it.

**Gate:** `build-frame.mjs` exited 0 — `frame.md` exists from a named preset, and (when the preset ships one) `caption-skin.html` is at the project root.

---

## Step 3: Storyboard and Script

Goal: Turn the brief and captured material into an approved frame-by-frame story plan.

Read `references/story-design.md`, `../hyperframes-core/references/storyboard-format.md`, and `../hyperframes-core/references/script-format.md`. Use them to write `STORYBOARD.md` and, when narration is needed, `SCRIPT.md`.

Use `story-design.md` for story archetype, hook, persuasion logic, beats, `VO_MODE`, and asset choices. Choose each visual frame's `asset_candidates` from `capture/extracted/asset-descriptions.md` (the canonical inventory) — don't browse raw `capture/assets/`. Do not ask the user to pick assets unless that inventory is missing or unusable. Use the exact required fields from the storyboard and script references.

After drafting, show a frame-by-frame summary. In that same message ask the user two things: (a) to approve or request changes, and (b) whether they want a live preview of the storyboard scaffold (npx hyperframes preview) — open it only on a yes. Iterate until approved, and carry the preview choice to Step 6.

**Gate:** `STORYBOARD.md` exists, every visual frame has `asset_candidates`, `SCRIPT.md` exists when narration is needed, and the user approved the frame-by-frame plan.

---

## Step 3.1: Audio

Goal: Generate narration, word timings, music, and audio metadata from the approved script.

Start audio after Step 3 approval. Run it in the background, then continue to Step 4.

`node <SKILL_DIR>/scripts/audio.mjs --script ./SCRIPT.md --storyboard ./STORYBOARD.md --hyperframes . --out ./audio_meta.json &`

The audio script handles narration, word timings, BGM lookup from HeyGen's music library, and timing metadata. BGM mood comes from the storyboard's `music:` field. This uses the HeyGen Audio API for retrieval, not generation, and uses the same `~/.heygen` credential as TTS. For provider details, read `../hyperframes-media/references/tts.md`.

If there is no narration and no `SCRIPT.md`, skip voice generation. BGM may still run if the storyboard has a music mood.

**Gate:** audio job has started, or the project is marked silent.

---

## Step 4: Frame Visual Design

Goal: Add the visual direction, layout intent, and motion choices to each storyboard frame.

Edit `STORYBOARD.md` in place. Do not create another storyboard. Use `frame.md` as source of truth for color, type, layout feel, and style.

Read `references/visual-design.md`, `references/composition.md`, `references/motion-language.md`, and `../hyperframes-animation/`. Use `visual-design.md` for required frame fields and the required `## Video direction` block. Use `composition.md` for layout, hierarchy, focal points, and visual roles. Use `motion-language.md` and `../hyperframes-animation/` for valid effects and blueprint IDs. Do not invent effect names or blueprint IDs.

For every visual frame, add required visual and motion fields, including `effects` and `focal` and/or `roles`. Add one video-wide `## Video direction` block for overall visual direction, motion style, pacing, and design rules.

Do not change story, script, asset choices, `asset_candidates`, `transition_in`, or captured source material. Do not write HTML in this step.

Stage named assets after visual design is locked:

`node <SKILL_DIR>/scripts/stage-assets.mjs --storyboard ./STORYBOARD.md --hyperframes .`

**Gate:** every visual frame has `effects` plus `focal` and/or `roles`; `## Video direction` exists; `assets/` contains the named assets.

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

`captions.mjs` uses the project's `caption-skin.html` (copied in Step 2) as the caption look, injecting brand tokens from `frame.md`; with no skin present it renders the built-in default pill. `captions: skipped (<reason>)` is valid. Continue without captions when explicitly skipped.

**Gate:** every frame is marked `animated`, `index.html` exists, and captions are built or explicitly skipped.

---

## Step 6: Finalize

Goal: Verify the assembled video, get user approval, and render the final MP4.

Inject transitions, run checks, pause for review, then render.

`node <SKILL_DIR>/scripts/transitions.mjs inject --storyboard ./STORYBOARD.md --hyperframes .`

`node <SKILL_DIR>/scripts/transitions.mjs verify --storyboard ./STORYBOARD.md --index ./index.html`

`npx hyperframes lint`

`npx hyperframes validate`

`npx hyperframes inspect --strict-layout`

`npx hyperframes snapshot --at <frame-midpoints>`

If a command fails, surface stderr and stop. Do not pile on recovery commands. If a gate names a frame, fix `compositions/frames/NN-*.html` with the cheapest safe fix: edit the frame HTML for a local issue; re-dispatch the frame worker only when the whole shot must be rebuilt.

After checks pass, pause for user review. The video is assembled, viewable, and editable in Studio. Manage preview only once across Step 3 and Step 6: open it if the user asked earlier, offer it if they declined earlier, and do not ask again if they are already reviewing in Studio.

Preview: `npx hyperframes preview`

Render only after user approval:

`npx hyperframes render --quality high --output renders/video.mp4`

Do not rerun `lint`, `validate`, `inspect`, or `snapshot` after rendering unless the user asks.

**Gate:** `lint`, `validate`, and `inspect` passed before render; user approved at the review pause; `renders/video.mp4` exists. Final reply states MP4 path and final duration.

---

## Quick Reference

**Formats:** landscape `1920x1080` by default; portrait `1080x1920`; square `1080x1080`. Set the format once in the storyboard frontmatter.

**Background scripts:** the workflow ships only these scripts under `scripts/`: `build-frame` for adopting + brand-remixing a frame preset into `frame.md` (+ caption skin); `audio` for TTS, transcription, BGM, SFX, and duration syncing; `captions`; `transitions` for inject and verify; `stage-assets` for copying frame-named assets into `assets/`; and `assemble-index`. Everything else is handled by the `hyperframes` CLI.

| Read                                                                                                         | When                                                     |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `[../hyperframes-creative/frame-presets/](../hyperframes-creative/frame-presets/)`                           | Step 2: choose and adopt a frame preset.                 |
| `[../hyperframes-creative/references/design-spec.md](../hyperframes-creative/references/design-spec.md)`     | Step 2: apply brand tokens correctly.                    |
| `[references/story-design.md](references/story-design.md)`                                                   | Step 3: plan the product-launch story.                   |
| `[../hyperframes-core/references/storyboard-format.md](../hyperframes-core/references/storyboard-format.md)` | Step 3: write `STORYBOARD.md`.                           |
| `[../hyperframes-core/references/script-format.md](../hyperframes-core/references/script-format.md)`         | Step 3: write `SCRIPT.md`.                               |
| `[../hyperframes-media/references/tts.md](../hyperframes-media/references/tts.md)`                           | Step 3.1: choose or understand TTS providers and voices. |
| `[references/visual-design.md](references/visual-design.md)`                                                 | Step 4: enrich the storyboard visually.                  |
| `[references/composition.md](references/composition.md)`                                                     | Step 4: judge composition.                               |
| `[references/motion-language.md](references/motion-language.md)`                                             | Step 4: judge motion language.                           |
| `[../hyperframes-animation/](../hyperframes-animation/)`                                                     | Step 4: cite effect and blueprint IDs.                   |
| `[sub-agents/frame-worker.md](sub-agents/frame-worker.md)`                                                   | Step 5: dispatch per-frame workers.                      |
| `[../hyperframes-core/references/subagent-dispatch.md](../hyperframes-core/references/subagent-dispatch.md)` | Step 5: dispatch sub-agents safely.                      |
