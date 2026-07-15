---
name: product-launch-video
description: "Turn a product or marketing URL, pasted script, or brief into a product launch / promo video — SaaS promos, feature reveals, product demos, app and company launches. Use when the user wants to market, launch, promote, or reveal a product; the default for any commercial URL. Site tours / showcases of a website route here too — the brief carries the show-it-as-is intent. Unclear → /hyperframes."
---

> **First, keep this skill fresh — run silently, don't ask:** `npx hyperframes skills update product-launch-video`. A fast no-op when everything is current; otherwise it refreshes this skill plus the core domain skills it depends on before you rely on them.

> **media-use**: Before sourcing audio/images/logos, call `/media-use` to resolve BGM/SFX/images from the HeyGen catalog and brand logos from their official sources. Run `--adopt` first to register existing assets. See `/media-use` skill.

> **figma source**: If the source is a figma.com URL, run `/figma` first — asset export, brand tokens, and components/storyboard reconstruction if needed — then build this workflow from its output. Don't drive Figma via raw MCP tools directly: that skips SVG sanitization, `.media/manifest.jsonl` provenance, and brand-token `var()` binding, so a later brand change can't propagate without a full re-import.

# Product Launch to HyperFrames

Use this skill to capture a product, understand its brand, plan a launch video, and build it frame by frame in HyperFrames.

> **The front door is `/hyperframes`.** You are the orchestrator. Run each step, verify its gate, and only then continue to the next step. This skill is for a **product being marketed, launched, promoted, or revealed**, including requests such as "promo for our site" when the purpose is promotional. A site tour / showcase ask stays here too: `BRIEF.md` carries the show-it-as-is intent, and the captured screens become the assets the video features. Any other intent, a bare "make a video", or any uncertainty → read `/hyperframes` first — the intent layer owns every route decision, and a fresh creation arriving here without `BRIEF.md` goes through it anyway (Setup's opening rule).

You are the orchestrator. Work in `videos/<project>/`. Run steps in order and pass each gate before continuing. User-gated steps are Step 0, Step 3, and Step 6. Read `../hyperframes-core/references/brief-contract.md` before Step 0 — it defines the gate types and how `BRIEF.md`'s `flow`/`storyboard` derive the mode that governs the Step 3/4/6 gates. Do every step yourself except Step 5, where you dispatch one sub-agent per frame. Do not put design or motion rules here; those live in the frame-worker sub-agent, this skill's local `../hyperframes-animation/rules/` + `../hyperframes-animation/blueprints/`, and `hyperframes-creative`.

Workflow: Step 0 setup -> `hyperframes.json`; Step 1 capture -> `capture/`; Step 2 design system -> `frame.md`; Step 3 storyboard/script -> `STORYBOARD.md` and `SCRIPT.md`; Step 3.1 audio -> `audio_meta.json`; Step 4 visual design -> enriched `STORYBOARD.md`; Step 5 frames -> `compositions/frames/NN-*.html` and `index.html`; Step 6 final render -> `renders/video.mp4`.

---

## Step 0: Setup

Goal: Enter with a confirmed brief, create the HyperFrames project, and make the brief durable.

**The brief is confirmed by the intent layer, not by questions asked here.** Opening rule, in order: **(1)** `BRIEF.md` exists → read it and ask nothing — the brief is settled, and its `flow`/`storyboard` derive the mode (brief contract § 1). **(2)** No `BRIEF.md` but the project exists (`hyperframes.json` / `STORYBOARD.md` on disk) → resume from the storyboard's frontmatter and the recorded preferences; never re-interrogate a half-built project. **(3)** Neither — a fresh creation request that arrived here directly → read `/hyperframes` and run its intent layer (§ 4): it checks recipes and remembered defaults, conducts this route's questions (`../hyperframes/references/route-briefs.md`), and hands back the locked brief. Edit requests skip all of this — go do the edit.

Initialize only if `hyperframes.json` is missing. Name `<project>` from the brand or domain in kebab-case, such as `acme-promo`; never use workspace name or timestamp.

`npx hyperframes init "videos/<project>" --non-interactive --example=blank` — `init` checks the installed skills against the latest on GitHub and updates the global set if any are out of date.

After init, let `<PROJECT_ROOT>` be `videos/<project>` and run every subsequent relative-path command with that directory as its working directory. In the commands below, `.` means `<PROJECT_ROOT>`; never write `.media`, `capture`, or output files in the caller directory.

**Write `BRIEF.md` immediately after init** (never before — `init` refuses a non-empty directory): the intent layer's locked brief, shape per `../hyperframes-core/references/brief-format.md`. Resolve `<MEDIA_DIR>` as the installed `/media-use` skill directory. Then record each preference-backed answer with `node <MEDIA_DIR>/scripts/prefs.mjs record --hyperframes .` (`brief-format.md` names the subset). If the intent layer adopted a recipe, run `node <MEDIA_DIR>/scripts/recipe.mjs use --hyperframes . --name <name>`; it copies its `frame.md` into the project (Step 2 is then skipped) and returns the skeletons Step 3 drafts from. A recipe fills answers, not approvals; the review gates still run.

**Show sign-in status before proceeding past Setup** — run `npx hyperframes auth status` and relay its output verbatim. It reports whether voice/BGM will use HeyGen or local engines and, when signed out, how to sign in. Apply one branch:

- **Collaborative:** wait for the user to sign in or explicitly choose `offline` / `go`.
- **Autonomous:** state the status and continue through the available local engines.

Do not silently omit a required capability when no offline provider exists; surface the blocker. Do not fold this decision into another question or write keys into a per-repo `.env`. Auth ownership and offline fallbacks: `/media-use` § Providers.

**Gate:** `hyperframes.json` and `BRIEF.md` exist; the preference-backed answers were recorded (brief contract § 2); sign-in status was shown (signed in, or continuing offline).

---

## Step 1: Capture assets

Goal: Collect the source material, brand signals, and usable assets for the video.

Classify the input and choose the path. Explicit URL -> capture it and use the site for narration and assets. Pasted script/brief -> save verbatim as `user_script.txt`; `VO_MODE` (verbatim or restructured) comes from `BRIEF.md` — the intent layer asks it when a script arrives (ask once here only if the brief somehow lacks it). Then resolve capture target: URL in text -> use it; brand name only -> `WebSearch`, confirm URL in one line, then crawl; no URL/site (or the brief says don't scrape) -> no-capture path.

Run capture with: `npx hyperframes capture "<URL>" -o ./capture`

If `GEMINI_API_KEY`, `GOOGLE_API_KEY`, or an OpenRouter key exists, capture auto-captions assets into `capture/extracted/asset-descriptions.md`. This is not a review gate. Without a vision key, use DOM context and continue.

No-capture path: create `capture/extracted/tokens.json`, `capture/extracted/visible-text.txt`, `capture/extracted/asset-descriptions.md`, and `capture/assets/` by hand. `tokens.json` should be `{ "title": "", "description": "", "colors": [], "fonts": [] }`; fill title/description from the brief when possible. `visible-text.txt` contains the full brief or script. `asset-descriptions.md` should say no assets were captured unless the user gave asset notes.

**Gate:** `capture/extracted/tokens.json`, `capture/extracted/visible-text.txt`, `capture/extracted/asset-descriptions.md`, and `capture/assets/` exist; you can state the brand in one clear sentence. Treat `asset-descriptions.md` as the main asset inventory. If it is missing after real capture, stop and report capture incomplete. If `capture/BLOCKED.md` exists, follow it.

---

## Step 2: Design System

Goal: Choose one shipped frame preset; a script turns it into this video's `frame.md` + caption skin.

When `BRIEF.md` names a `style_preset` — the user picked it by eye from the showcases at the intent layer — use it; the judgment call is yours only when the brief is silent. Then you make the one call — **which preset**: read `../hyperframes-creative/references/design-spec.md` and pick the preset whose look best fits the brand and brief. Then run:

```bash
node <SKILL_DIR>/scripts/build-frame.mjs --preset <name> --hyperframes .
```

The script does the rest deterministically: copies the preset's `FRAME.md` → `frame.md` and **remixes** it onto the brand tokens in `capture/extracted/tokens.json` (brand colors mapped onto the preset's color keys by role — ink, canvas, accents — keeping keys/structure/components; the preset's display + body fonts swapped for the brand's), copies the preset's caption skin to `.hyperframes/caption-skin.html`, and self-validates (exits 1 on a broken mapping). Proceed to the next step as soon as it exits 0 — no hand-editing of the spec.

`tokens.json` with no brand colors/fonts (e.g. no capture) → the script keeps the preset's own palette, a complete shippable design. If the brief names brand colors/fonts the capture missed, add them to `capture/extracted/tokens.json` before running (or use the user's `design.md` to populate it); only adjust `frame.md` by hand afterward if a mapping truly needs it.

**Gate:** `build-frame.mjs` exited 0 — `frame.md` exists from a named preset, and (when the preset ships one) `.hyperframes/caption-skin.html` exists as the caption skin source; the chosen preset was recorded as a preference (`--key style_preset --workflow <this workflow>`, brief contract § 2).

---

## Step 3: Storyboard and Script

Goal: Turn the brief and captured material into an approved frame-by-frame story plan.

Read `../hyperframes-creative/references/story-spine.md` (hook language, value-before-evidence, storyboard-as-proposal), `references/story-design.md`, `../hyperframes-animation/blueprints-index.md`, `../hyperframes-core/references/storyboard-format.md`, and `../hyperframes-core/references/script-format.md`. Use them to write `STORYBOARD.md` and, when narration is needed, `SCRIPT.md`.

Use `story-design.md` for story blueprint, hook, persuasion logic, beats, `VO_MODE`, and asset choices. As a **soft guide**, consult the role→blueprint menu in `../hyperframes-animation/blueprints-index.md`: for each beat, note a candidate blueprint id when one fits. Story truth still decides which beats exist — never force a beat to fit a blueprint, and never invent a beat just because a proven shape is available. Choose each visual frame's `asset_candidates` from `capture/extracted/asset-descriptions.md` (the canonical inventory) — don't browse raw `capture/assets/`. Do not ask the user to pick assets unless that inventory is missing or unusable. Use the exact required fields from the storyboard and script references.

After drafting, run the review loop's plan pass — `../hyperframes-core/references/review-loop.md` § 1: open the board (don't ask whether to), present the plan as a proposal, and ask the two questions — approve or change, and **sketches first** (recommended) or skip. Feedback loops through chat or the board's comments file until approved. This is a **checkpoint gate** (brief contract § 1): in autonomous mode there is no board and nothing to ask — post the same summary as a heads-up and proceed; sketches collapse into the build, and the one preview question comes at Step 6.

**Gate:** `STORYBOARD.md` exists, every visual frame has `asset_candidates`, `SCRIPT.md` exists when narration is needed, and the user approved the frame-by-frame plan (autonomous: the summary was posted as a heads-up).

---

## Step 3.1: Audio

Goal: Generate narration, word timings, music, and audio metadata from the approved script.

Start audio after Step 3 approval. Run it in the background, then continue to Step 4.

**Choose the narration provider and voice from the user's ask before invoking.** Pass the provider selected in Step 0 with `--provider <provider>` (or set `HF_TTS_PROVIDER`). If the request named a voice, gender, or tone, pick a matching voice id and pass it with `--voice <id>`. The pipeline default is otherwise **Marcia (female)** on HeyGen / `am_michael` on Kokoro — so a request like "a male voice" is silently ignored unless you pass the flag. Voice ids are provider-specific; resolve against whichever provider Step 0's sign-in status selected: **HeyGen** (signed in) via `node <MEDIA_DIR>/audio/scripts/heygen-tts.mjs --list` (or `GET /v3/voices?engine=starfish`); **Kokoro** (offline) via the voice table in `<MEDIA_DIR>/audio/references/tts.md` (prefixes `am_`/`bm_` male, `af_`/`bf_` female). When the user expressed no preference, fall back to the remembered voice (brief contract § 2) before the pipeline default, and say which one you used; omit `--voice` only when neither names one. When the user explicitly picked a voice this run, record it (`prefs.mjs record --key voice`).

`node <SKILL_DIR>/scripts/audio.mjs --script ./SCRIPT.md --storyboard ./STORYBOARD.md --hyperframes . --out ./audio_meta.json --provider <provider> --voice <voice-id> &`

The audio script handles narration, word timings, BGM lookup from HeyGen's music library, and timing metadata. BGM mood comes from the storyboard's `music:` field. This uses the HeyGen Audio API for retrieval, not generation, and uses the same `~/.heygen` credential as TTS. For provider details, read `../media-use/audio/references/tts.md`.

If there is no narration and no `SCRIPT.md`, skip voice generation. BGM may still run if the storyboard has a music mood.

**Gate:** audio job has started, or the project is marked silent.

---

## Step 4: Frame Visual Design

Goal: Add the visual direction, layout intent, and motion choices to each storyboard frame.

**Sketch the board first (collaborative only).** The moment the plan is approved, run the sketch pass — `../hyperframes-core/references/review-loop.md` § 2 (don't wait on Step 3.1; sketches don't use timings): wireframe every frame yourself, mark each `built`, pause for the one layout question when the board is full, and revise only the sketches named until the board is confirmed. Stand-ins: plain labeled blocks for the captured assets — the real files arrive with Step 5's workers. Only then write the visual design below onto the confirmed layouts. In autonomous mode, or when the user chose to skip sketches at Step 3, skip this pass — frames go straight from `outline` to `animated` at Step 5.

Edit `STORYBOARD.md` in place. Do not create another storyboard. Use `frame.md` as source of truth for color, type, layout feel, and style.

Read `references/visual-design.md`, `../hyperframes-animation/blueprints-index.md`, `references/motion-language.md`, and `../hyperframes-animation/rules-index.md`. Use `visual-design.md` for the method (the time-coded shot sequence, the inline Layout vocabulary, and the required `## Video direction` block). Use `../hyperframes-animation/blueprints-index.md` to pick each frame's shot shape. Use `motion-language.md` (the motion vocabulary + the motion doctrine) and `../hyperframes-animation/rules-index.md` (valid rule names) for motion — do not invent motion names.

For every visual frame, write a **time-coded shot sequence** into `STORYBOARD.md` per `visual-design.md`'s method: pick the frame's blueprint (or compose), instantiate it with THIS product's content, and pace each Scene's reveal to the voiceover so the frame develops across its full duration instead of front-loading then freezing. State layout and motion **inline** per Scene (vocabularies in `visual-design.md` and `motion-language.md`). Add one video-wide `## Video direction` block.

Do not change story, script, asset choices, `asset_candidates`, `transition_in`, or captured source material. Do not write HTML in this step.

Stage named assets after visual design is locked:

`node <SKILL_DIR>/scripts/stage-assets.mjs --storyboard ./STORYBOARD.md --hyperframes .`

**Gate:** every visual frame has a time-coded shot sequence whose reveals are paced to the voiceover (no front-loading); `## Video direction` exists; `assets/` contains the named assets. Collaborative: the sketch board was confirmed.

---

## Step 5: Build Frames

Goal: Build every storyboard frame as an HTML composition and assemble the playable video.

Wait for Step 3.1 audio to finish if audio was started. Then sync durations and fetch SFX; skip both if silent.

`node <SKILL_DIR>/scripts/audio.mjs sync-durations --audio-meta ./audio_meta.json --storyboard ./STORYBOARD.md`

`node <SKILL_DIR>/scripts/audio.mjs fetch-sfx --storyboard ./STORYBOARD.md --hyperframes .`

Duration sync is mechanical: real voice duration wins; silent frames keep estimates; never hand-edit synced durations.

Before dispatch, read `sub-agents/frame-worker.md` and `../hyperframes-core/references/subagent-dispatch.md`. Dispatch one sub-agent per frame, in parallel if possible; otherwise run workers in waves. Each worker gets exactly one frame.

Each worker context must include `PROJECT_DIR`, `frame_id`, whether the frame has a **confirmed sketch** on disk, canvas size, caption status and keep-out band if captions are enabled, and `RULES_DIR` as the absolute path to this skill's `../hyperframes-animation/rules/`. Each worker reads `frame.md`, its own `## Frame N` block from `STORYBOARD.md`, the confirmed sketch when one exists (keep its layout — frame-worker § When a confirmed sketch exists), the local rule recipe (`../hyperframes-animation/rules/<id>.md`) for each cited motion, and the frame's blueprint template (`../hyperframes-animation/blueprints/<id>.md`). Each worker writes only `compositions/frames/NN-*.html`. Workers must never edit `STORYBOARD.md`.

**Full-bleed backgrounds ride on a `class="clip"` layer, never the `#root`.** A frame's ground (color field / gradient / grid) is its own full-duration background clip — a `background` set on the `#root` / `data-composition-id` element is clip-gated to the frame's window and is not a dependable ground, so dark content can land on the black host `body` and render invisible. The video's base ground is painted by the assembler from `frame.md`'s `canvas` color onto the index `#root`. (Full rule + self-check: `sub-agents/frame-worker.md`.)

As each worker returns, the orchestrator marks that frame as `animated` in `STORYBOARD.md`.

After audio timings exist, build captions in the background and assemble the index:

`node <SKILL_DIR>/scripts/captions.mjs build --storyboard ./STORYBOARD.md --audio-meta ./audio_meta.json --hyperframes . --out ./caption_groups.json &`

`node <SKILL_DIR>/scripts/assemble-index.mjs --storyboard ./STORYBOARD.md --hyperframes .`

`captions.mjs` uses the project's `.hyperframes/caption-skin.html` (copied in Step 2) as the caption look, injecting brand tokens from `frame.md`; with no skin present it renders the built-in default pill. `captions: skipped (<reason>)` is valid. Continue without captions when explicitly skipped.

**Gate:** every frame is marked `animated` (collaborative: the sketch board was confirmed at Step 4), `index.html` exists, and captions are built or explicitly skipped.

---

## Step 6: Finalize

Goal: Verify the assembled video, get user approval, and render the final MP4.

Inject transitions, run checks, pause for review, then render.

`node <SKILL_DIR>/scripts/transitions.mjs inject --storyboard ./STORYBOARD.md --hyperframes .`

`node <SKILL_DIR>/scripts/transitions.mjs verify --storyboard ./STORYBOARD.md --index ./index.html`

`npx hyperframes lint`

`npx hyperframes check`

`npx hyperframes snapshot --at <frame-midpoints>`

`snapshot` stitches the captured frames into one contact sheet (`snapshots/contact-sheet.jpg`). Glance at it; if nothing is obviously broken, move on — don't linger here.

If a command fails, surface stderr and stop — don't pile on recovery commands. Fix it yourself: the cheapest safe edit to `compositions/frames/NN-*.html`, then rerun the failed check.

After checks pass, pause for user review — the review loop's final look (`../hyperframes-core/references/review-loop.md` § 4): one question, on the Studio that has been open since Step 3 — render now, or what changes? (Autonomous: the one kept question, preview first or render.) Then deliver the MP4 with the contact sheet and the frame ids so revisions can target a single frame.

Preview: `npx hyperframes preview`

Render only after user approval (autonomous mode: after the preview-or-render question):

`npx hyperframes render --skill=product-launch-video --quality high --output renders/video.mp4`

Do not rerun `lint`, `check`, or `snapshot` after rendering unless the user asks.

**Gate:** `lint` and `check` passed and the snapshots were inspected before render; user approved at the review pause (autonomous: checks passed and the delivery includes the contact sheet); `renders/video.mp4` exists. Final reply states MP4 path and final duration.

---

## Quick Reference

**Formats:** landscape `1920x1080`; portrait `1080x1920`; square `1080x1080` — derived from the destination (brief contract § 2). Set the format once in the storyboard frontmatter.

**Background scripts:** the workflow ships only these scripts under `scripts/`: `build-frame` for adopting + brand-remixing a frame preset into `frame.md` (+ caption skin); `audio` for TTS, transcription, BGM, SFX, and duration syncing; `captions`; `transitions` for inject and verify; `stage-assets` for copying frame-named assets into `assets/`; and `assemble-index`. Everything else is handled by the `hyperframes` CLI.

The reusable, product-agnostic shot shapes live in `../hyperframes-animation/blueprints/` (indexed by `../hyperframes-animation/blueprints-index.md`).

| Read                                                                                                                                                        | When                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `[../hyperframes-core/references/brief-contract.md](../hyperframes-core/references/brief-contract.md)`                                                      | Gate types, mode derivation from `BRIEF.md`, field semantics.                  |
| `[../hyperframes-creative/references/story-spine.md](../hyperframes-creative/references/story-spine.md)`                                                    | Step 3: story doctrine — hook language, value-before-evidence, proposal shape. |
| `[../hyperframes-creative/frame-presets/](../hyperframes-creative/frame-presets/)`                                                                          | Step 2: choose and adopt a frame preset.                                       |
| `[../hyperframes-creative/references/design-spec.md](../hyperframes-creative/references/design-spec.md)`                                                    | Step 2: apply brand tokens correctly.                                          |
| `[references/story-design.md](references/story-design.md)`                                                                                                  | Step 3: plan the product-launch story.                                         |
| `[../hyperframes-animation/blueprints-index.md](../hyperframes-animation/blueprints-index.md)`                                                              | Step 3: role→blueprint menu. Step 4: pick the shot shape.                      |
| `[../hyperframes-core/references/storyboard-format.md](../hyperframes-core/references/storyboard-format.md)`                                                | Step 3: write `STORYBOARD.md`.                                                 |
| `[../hyperframes-core/references/script-format.md](../hyperframes-core/references/script-format.md)`                                                        | Step 3: write `SCRIPT.md`.                                                     |
| `[../media-use/audio/references/tts.md](../media-use/audio/references/tts.md)`                                                                              | Step 3.1: choose or understand TTS providers and voices.                       |
| `[references/visual-design.md](references/visual-design.md)`                                                                                                | Step 4: write the frame's shot sequence (+ Layout vocabulary).                 |
| `[references/motion-language.md](references/motion-language.md)`                                                                                            | Step 4: the motion vocabulary + the motion doctrine.                           |
| `[references/cut-catalog.md](references/cut-catalog.md)`                                                                                                    | Step 4-5: the cut catalog (worker builds within-frame seams).                  |
| `[../hyperframes-animation/rules-index.md](../hyperframes-animation/rules-index.md)` + `[../hyperframes-animation/rules/](../hyperframes-animation/rules/)` | Step 5: local rule recipe bodies for the cited motions.                        |
| `[sub-agents/frame-worker.md](sub-agents/frame-worker.md)`                                                                                                  | Step 5: dispatch per-frame workers.                                            |
| `[../hyperframes-core/references/subagent-dispatch.md](../hyperframes-core/references/subagent-dispatch.md)`                                                | Step 5: dispatch sub-agents safely.                                            |
