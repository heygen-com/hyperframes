---
name: pr-to-video
description: "turn a GitHub pull request (a PR URL like github.com/<owner>/<repo>/pull/<N>, an <owner>/<repo>#<N> ref, or 'this PR' in a checked-out repo) into a code-change explainer video, up to ~3 min (sweet spot 30-90s) — changelog, feature reveal, fix, or refactor walkthrough, rendered from the diff / commits / files. The input is a CODE CHANGE read via the gh CLI; there is no website capture. Use this skill for a GitHub PR. Do not use it for a product launch/promo (use /product-launch-video), a tour of a real website (use /website-to-video), a topic explainer with no PR (use /faceless-explainer), captions on existing footage (use /embedded-captions), or a short unnarrated motion graphic (use /motion-graphics). If the intent is unclear, route through /hyperframes first. This is the shot-sequence architecture: every frame is authored as a time-coded shot sequence picked from a menu of golden blueprints, so frames develop over their full duration instead of freezing after entrance."
---

> **media-use**: Before sourcing audio/images, call `/media-use` to resolve BGM/SFX/images from the HeyGen catalog. Run `--adopt` first to register existing assets. See `/media-use` skill.

# PR to HyperFrames

Use this skill to ingest a GitHub pull request, understand the change, plan a code-change explainer, and build it frame by frame in HyperFrames. The input is a **code change** (read via `gh`), not a website — there is **no capture step and no real assets** beyond the contributors' avatars.

> **Confirm the route before Step 0.** You are the orchestrator. Run each step, verify its gate, and only then continue. This skill is for a **GitHub pull request** (a code change). Route other intents elsewhere: a product launch/promo → `/product-launch-video`; a general website tour → `/website-to-video`; a topic explainer with no PR → `/faceless-explainer`; captions on existing footage → `/embedded-captions`; a short unnarrated motion graphic → `/motion-graphics`; a whole-repo or multi-PR release walkthrough → `/general-video`. **Out of scope:** live / at-render-time data — PR facts are read once at author time and baked in. If the user says only "make a video" or the route is uncertain, read `/hyperframes` first.

You are the orchestrator. Work in `videos/<project>/`. Run steps in order and pass each gate before continuing. User-gated steps are Step 0, Step 3, and Step 6. Do every step yourself except Step 5, where you dispatch one sub-agent per frame. Do not put design or motion rules here; those live in the frame-worker sub-agent, this skill's local `../hyperframes-animation/rules/` + `../hyperframes-animation/blueprints/`, and `hyperframes-creative`.

Workflow: Step 0 setup → `hyperframes.json`; Step 1 ingest → `capture/extracted/` + `assets/<login>.png`; Step 2 design system → `frame.md`; Step 3 storyboard/script → `STORYBOARD.md` and `SCRIPT.md`; Step 3.1 audio → `audio_meta.json`; Step 4 visual design → enriched `STORYBOARD.md`; Step 5 frames → `compositions/frames/NN-*.html` and `index.html`; Step 6 final render → `renders/video.mp4`.

---

## Step 0: Setup and Brief

Goal: Lock the PR reference and the core video brief, and create the HyperFrames project if needed.

Get the **PR reference** (a full URL, an `<owner>/<repo>#<N>` ref, or "this PR" in a checked-out repo) and, in one message, confirm the brief — lead with a recommended default for each and pre-fill anything `/hyperframes` already set: **angle** (changelog / feature-reveal / fix-explainer / refactor-walkthrough — default: infer from the PR), **audience** (default: developers), **length** (default: **scale to the PR's change size** — see below), **aspect** (default 16:9), **language**. The style is always **claude**. Proceed only after the user replies; a "go" accepts the defaults.

**Recommend the length from the PR's change size**, not a fixed guess. Before confirming the brief, peek at the PR once — a read-only call that also grounds the angle (Step 1 still does the full deterministic fetch):

```bash
gh pr view <PR_REF> --json title,additions,deletions,changedFiles
```

Pick the tier from `additions + deletions` (nudged up by `changedFiles`) and lead with it as the default (the user can override; hard cap ~3 min):

| PR change size                    | Recommended length |
| --------------------------------- | ------------------ |
| trivial (≲ 50 lines changed)      | ~20–40s            |
| focused (~50–200 lines)           | ~40–70s            |
| substantial (~200–600 lines)      | ~70–110s           |
| large (≳ 600 lines, or 25+ files) | ~110–180s          |

State the basis in one phrase when you propose it (e.g. "~40s — small change, +44/−13 across 12 files"). A huge PR doesn't mean a long video — if the story is one headline change, keep it tight and say so.

Initialize only if `hyperframes.json` is missing. Name `<project>` from the PR in kebab-case, such as `acme-sdk-pr-1842`; never use the workspace name or a timestamp.

`npx hyperframes init "videos/<project>" --non-interactive --example=blank` — `init` checks the installed skills against the latest on GitHub and updates the global set if any are out of date.

**Show sign-in status before the brief** — run `npx hyperframes auth status` and **relay its output verbatim (don't paraphrase or rewrite it).** It reports whether voice/BGM will use HeyGen or local engines and, when not signed in, how to sign in. **If not signed in, STOP and wait for the user to choose — sign in, or say "go"/"offline" to continue with local engines — before asking the brief or anything else.** Treat it as a real decision point, not a passing note; don't fold the choice into the brief question, and don't write keys into a per-repo `.env`. (In autonomous mode, note the status and continue offline.) See `../media-use` → Preflight for the canonical guidance.

**Gate:** `hyperframes.json` exists; the PR ref is captured; angle, length, aspect ratio, and language are locked; sign-in status was shown (signed in, or continuing offline).

---

## Step 1: Ingest the PR (no capture)

Goal: Fetch the PR's facts and fold them into the project as the source of information. There is **no website capture**. `fetch-pr.mjs` runs `gh` deterministically — completing the files list via paginated `gh api` so a large PR doesn't truncate at ~100 files, and writing only `capture/pr.json` + `capture/diff.patch` (no scratch dir). Then `ingest.mjs` folds that into the synthetic capture package offline.

```bash
PR="<url | owner/repo#N | N>"

# Fetch the PR deterministically: runs gh, completes the files list via paginated
# gh api (so a big PR doesn't truncate at ~100 files), writes only capture/pr.json +
# capture/diff.patch — no scratch dir. gh auth / not-found / private errors exit 1 here.
(cd "videos/<project>" && node <SKILL_DIR>/scripts/fetch-pr.mjs --pr "$PR" --out-dir ./capture)

# Offline transform → capture/extracted/{tokens.json (colors:[] → claude palette),
# visible-text.txt (the brief), people.json (contributors, bot-filtered, avatarFile=assets/<login>.png)}.
(cd "videos/<project>" && node <SKILL_DIR>/scripts/ingest.mjs \
  --pr-json ./capture/pr.json --diff ./capture/diff.patch --out-dir ./capture/extracted)

# The people front's one network step — download each contributor's GitHub avatar to
# assets/<login>.png for an optional credits close. Best-effort; always exits 0.
(cd "videos/<project>" && node <SKILL_DIR>/scripts/fetch-people-avatars.mjs \
  --people ./capture/extracted/people.json)
```

If `fetch-pr.mjs` exits 1 (gh auth / not found / private), report its stderr and stop — **do not fabricate PR contents**. If `ingest.mjs` exits 1, read its stderr (usually a malformed `pr.json`), fix, and rerun (deterministic). `fetch-people-avatars.mjs` always exits 0; missing avatars just mean no credits close to author.

**Gate:** `capture/pr.json`, `capture/diff.patch`, `capture/extracted/tokens.json`, `capture/extracted/visible-text.txt`, and `capture/extracted/people.json` exist; you can state the PR's change in one clear sentence. `assets/<login>.png` is best-effort — its absence is not a failure.

---

## Step 2: Design System

Goal: Adopt the claude frame preset; a script turns it into this video's `frame.md` + caption skin.

The style is fixed — **claude** (warm editorial; a navy code surface built for diffs). Run:

```bash
node <SKILL_DIR>/scripts/build-frame.mjs --preset claude --hyperframes .
```

The script copies the claude preset's `FRAME.md` → `frame.md`, remixes it onto any brand tokens in `capture/extracted/tokens.json` (a PR has none → `colors:[]`/`fonts:[]` keeps claude's own palette, a complete design), copies the preset's caption skin to `.hyperframes/caption-skin.html`, and self-validates (exits 1 on a broken mapping). Proceed as soon as it exits 0 — no hand-editing.

**Gate:** `build-frame.mjs` exited 0 — `frame.md` exists from the claude preset, and `.hyperframes/caption-skin.html` exists as the caption skin source.

---

## Step 3: Storyboard and Script

Goal: Turn the PR into an approved frame-by-frame explanation plan.

Read `references/story-design.md`, `../hyperframes-animation/blueprints-index.md`, `../hyperframes-core/references/storyboard-format.md`, and `../hyperframes-core/references/script-format.md`. Use them to write `STORYBOARD.md` and, when narration is needed, `SCRIPT.md`.

Use `story-design.md` for the PR archetype (changelog / feature-reveal / fix-explainer / refactor-walkthrough), the PR-native frame types, hook, persuasion, beats, the per-frame word budget, and the optional credits close. The sequence comes from **narrative design, not the diff's file order** — explain the change, don't read the diff aloud. As a **soft guide**, consult the role→blueprint menu in `../hyperframes-animation/blueprints-index.md`: for each beat, write the voiceover in the shape its candidate blueprint implies and tag that candidate `blueprint:` id when one fits (story truth still decides which beats exist — never force a beat to fit a shape). Feature 2–4 real diff hunks (from `capture/diff.patch`), each a small legible snippet; name the `code-*` block each wants in the frame's `scene`. Frames carry no `asset_candidates` except an optional `credits` close (2–6 `assets/<login>.png` avatars). Use the exact required fields from the storyboard and script references.

After drafting, show a frame-by-frame summary. In that same message ask the user (a) to approve or request changes, and (b) whether they want a live preview of the storyboard scaffold (`npx hyperframes preview`) — open it only on a yes. Iterate until approved; carry the preview choice to Step 6.

**Gate:** `STORYBOARD.md` exists, every frame has the required narrative fields, `SCRIPT.md` exists when narration is needed, and the user approved the plan.

---

## Step 3.1: Audio

Goal: Generate narration, word timings, music, and audio metadata from the approved script.

Start audio after Step 3 approval. Run it in the background, then continue to Step 4.

`node <SKILL_DIR>/scripts/audio.mjs --script ./SCRIPT.md --storyboard ./STORYBOARD.md --hyperframes . --out ./audio_meta.json &`

The audio script handles narration, word timings, BGM lookup from HeyGen's music library, and timing metadata. BGM mood comes from the storyboard's `music:` field. This uses the HeyGen Audio API for retrieval, not generation, and the same `~/.heygen` credential as TTS. For provider details, read `../media-use/audio/references/tts.md`.

If there is no narration and no `SCRIPT.md`, skip voice generation. BGM may still run if the storyboard has a music mood.

**Gate:** audio job has started, or the project is marked silent.

---

## Step 4: Frame Visual Design

Goal: Add the visual direction, layout intent, and motion choices to each storyboard frame.

Edit `STORYBOARD.md` in place. Do not create another storyboard. Use `frame.md` as source of truth for color, type, layout feel, and style.

Read `references/visual-design.md`, `../hyperframes-animation/blueprints-index.md`, `references/motion-language.md`, `references/code-vocabulary.md`, and `../hyperframes-animation/rules-index.md`. Use `visual-design.md` for the method (the time-coded shot sequence, the inline Layout vocabulary, and the code-beat treatment), plus the required `## Video direction` block. Use `../hyperframes-animation/blueprints-index.md` to pick each frame's shot shape. Use `code-vocabulary.md` to pick the right `code-*` block per code beat (diff = `code-diff`, refactor = `code-morph`, new code = `code-typing`, …). Use `motion-language.md` (the motion vocabulary + the motion doctrine) and `../hyperframes-animation/rules-index.md` (valid rule names) for motion — do not invent motion or block/blueprint names.

For every frame, write a **time-coded shot sequence** into `STORYBOARD.md` per `visual-design.md`'s method: pick the frame's blueprint (or compose), instantiate it with THIS frame's content, and pace each Scene's reveal to the voiceover so the frame develops across its full duration instead of front-loading then freezing. **For a code beat, the `code-*` block is the frame's `focal`** and the Scenes choreograph the surrounding claude Code Surface (the entry of the file/header, the camera onto the hunk, the landing line) — **not** the code animation itself, which the block owns. State layout and motion **inline** per Scene (vocabularies in `visual-design.md` and `motion-language.md`). Add one video-wide `## Video direction` block.

Do not change story, script, `transition_in`, `asset_candidates`, or the PR source. Do not write HTML in this step. There is **no asset-staging step** — the only real assets are the credits avatars, already in `assets/`.

**Gate:** every frame has a time-coded shot sequence whose reveals are paced to the voiceover (no front-loading); code frames name a `code-*` block as the `focal`; `## Video direction` exists.

---

## Step 5: Build Frames

Goal: Build every storyboard frame as an HTML composition and assemble the playable video.

Wait for Step 3.1 audio to finish if audio was started. Then sync durations and fetch SFX; skip both if silent.

`node <SKILL_DIR>/scripts/audio.mjs sync-durations --audio-meta ./audio_meta.json --storyboard ./STORYBOARD.md`

`node <SKILL_DIR>/scripts/audio.mjs fetch-sfx --storyboard ./STORYBOARD.md --hyperframes .`

Duration sync is mechanical: real voice duration wins; silent frames keep estimates; never hand-edit synced durations.

**Pre-install the registry blocks** named across `STORYBOARD.md` once, before dispatch, so parallel workers don't race on the registry:

`for b in <each registry block named in the storyboard>; do npx hyperframes add "$b"; done`

Before dispatch, read `sub-agents/frame-worker.md` and `../hyperframes-core/references/subagent-dispatch.md`. Dispatch one sub-agent per frame, in parallel if possible; otherwise run workers in waves. Each worker gets exactly one frame. Each worker's context must include `PROJECT_DIR`, `frame_id`, canvas size, caption status and keep-out band if captions are enabled, `RULES_DIR` (absolute path to this skill's `../hyperframes-animation/rules/`), and the absolute path to `references/code-vocabulary.md`. Each worker reads `frame.md`, its own `## Frame N` block from `STORYBOARD.md`, the local rule recipe (`../hyperframes-animation/rules/<id>.md`) for each cited motion, the frame's blueprint template (`../hyperframes-animation/blueprints/<id>.md`), and — for a code beat — `code-vocabulary.md` for the named block's inputs. Each worker writes only `compositions/frames/NN-*.html`; workers never edit `STORYBOARD.md`.

**Full-bleed backgrounds ride on a `class="clip"` layer, never the `#root`.** A frame's ground (color field / gradient / grid) is its own full-duration background clip — a `background` set on the `#root` / `data-composition-id` element is clip-gated to the frame's window and is not a dependable ground, so dark content can land on the black host `body` and render invisible. The video's base ground is painted by the assembler from `frame.md`'s `canvas` color onto the index `#root`. (Full rule + self-check: `sub-agents/frame-worker.md`.)

As each worker returns, mark that frame `animated` in `STORYBOARD.md`.

After audio timings exist, build captions in the background and assemble the index:

`node <SKILL_DIR>/scripts/captions.mjs build --storyboard ./STORYBOARD.md --audio-meta ./audio_meta.json --hyperframes . --out ./caption_groups.json &`

`node <SKILL_DIR>/scripts/assemble-index.mjs --storyboard ./STORYBOARD.md --hyperframes .`

`captions.mjs` uses the project's `.hyperframes/caption-skin.html` (claude's, copied in Step 2), injecting brand tokens from `frame.md`; `captions: skipped (<reason>)` is valid. `assemble-index.mjs` stages the credits avatars from `assets/` as an idempotent backstop.

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

After checks pass, pause for user review. The video is assembled, viewable, and editable in Studio. Manage preview only once across Step 3 and Step 6: open it if the user asked earlier, offer it if they declined earlier, do not ask again if they are already reviewing in Studio.

Preview: `npx hyperframes preview`

Render only after user approval:

`npx hyperframes render --skill=pr-to-video --quality high --output renders/video.mp4`

Do not rerun `lint`, `validate`, `inspect`, or `snapshot` after rendering unless the user asks.

**Gate:** `lint`, `validate`, and `inspect` passed before render; user approved at the review pause; `renders/video.mp4` exists. Final reply states the MP4 path and final duration.

---

## Quick Reference

**Formats:** landscape `1920x1080` by default; portrait `1080x1920`; square `1080x1080`. Set the format once in the storyboard frontmatter.

**PR deltas vs a captured-asset workflow:** no Step 1 capture (the `gh` CLI ingests the PR into a synthetic `capture/extracted/` package — `tokens.json` + `visible-text.txt` + `people.json`); the only real assets are the contributors' `assets/<login>.png` avatars (an optional credits close); no `asset-descriptions.md`, no asset-staging step. Code beats are rendered by the `code-*` registry blocks on claude's navy Code Surface; the style is always **claude**.

**Background scripts:** the workflow ships these under `scripts/`: `fetch-pr` (PR → `capture/pr.json` + `diff.patch` via `gh`; large-PR-safe, no scratch), `ingest` (→ synthetic capture package; offline), and `fetch-people-avatars` (contributor avatars → `assets/`); plus the shared engine — `build-frame` (adopt + brand-remix a preset into `frame.md` + caption skin), `audio` (TTS, BGM, SFX, duration sync), `captions`, `transitions` (inject + verify), and `assemble-index`. Everything else is the `hyperframes` CLI. Code blocks install via `npx hyperframes add <name>`.

The reusable, domain-agnostic shot shapes live in `../hyperframes-animation/blueprints/` (indexed by `../hyperframes-animation/blueprints-index.md`); the `code-*` registry blocks are the code-beat vocabulary (`references/code-vocabulary.md`).

| Read                                                                                                                                                        | When                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `[references/story-design.md](references/story-design.md)`                                                                                                  | Step 3: plan the PR explanation.                               |
| `[../hyperframes-animation/blueprints-index.md](../hyperframes-animation/blueprints-index.md)`                                                              | Step 3: role→blueprint menu. Step 4: pick the shot shape.      |
| `[../hyperframes-core/references/storyboard-format.md](../hyperframes-core/references/storyboard-format.md)`                                                | Step 3: write `STORYBOARD.md`.                                 |
| `[../hyperframes-core/references/script-format.md](../hyperframes-core/references/script-format.md)`                                                        | Step 3: write `SCRIPT.md`.                                     |
| `[../media-use/audio/references/tts.md](../media-use/audio/references/tts.md)`                                                                              | Step 3.1: choose or understand TTS providers.                  |
| `[references/visual-design.md](references/visual-design.md)`                                                                                                | Step 4: write the frame's shot sequence (+ Layout vocabulary). |
| `[references/code-vocabulary.md](references/code-vocabulary.md)`                                                                                            | Step 4 + 5: pick + fill the `code-*` block for a code beat.    |
| `[references/motion-language.md](references/motion-language.md)`                                                                                            | Step 4: the motion vocabulary + the motion doctrine.           |
| `[references/cut-catalog.md](references/cut-catalog.md)`                                                                                                    | Step 4-5: the cut catalog (worker builds within-frame seams).  |
| `[../hyperframes-animation/rules-index.md](../hyperframes-animation/rules-index.md)` + `[../hyperframes-animation/rules/](../hyperframes-animation/rules/)` | Step 5: local rule recipe bodies for the cited motions.        |
| `[sub-agents/frame-worker.md](sub-agents/frame-worker.md)`                                                                                                  | Step 5: dispatch per-frame workers.                            |
| `[../hyperframes-core/references/subagent-dispatch.md](../hyperframes-core/references/subagent-dispatch.md)`                                                | Step 5: dispatch sub-agents safely.                            |
| `[../hyperframes-creative/frame-presets/claude/FRAME.md](../hyperframes-creative/frame-presets/claude/FRAME.md)`                                            | Step 2: the claude preset (fixed style).                       |
