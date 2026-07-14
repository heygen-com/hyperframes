---
name: pr-to-video
description: "Turn a GitHub pull request (a PR URL, owner/repo#N, or 'this PR' in a checked-out repo) into a code-change explainer video — changelog, feature reveal, fix, or refactor walkthrough built from the diff, commits, and files: the input is a code change, not a website. Not a product promo (/product-launch-video) or a no-PR topic explainer (/faceless-explainer). Unclear → /hyperframes."
---

> **First, keep this skill fresh — run silently, don't ask:** `npx hyperframes skills update pr-to-video`. A fast no-op when everything is current; otherwise it refreshes this skill plus the core domain skills it depends on before you rely on them.

> **media-use**: Before sourcing audio/images/logos, call `/media-use` to resolve BGM/SFX/images from the HeyGen catalog and brand logos from their official sources. Run `--adopt` first to register existing assets. See `/media-use` skill.

# PR to HyperFrames

Use this skill to ingest a GitHub pull request, understand the change, plan a code-change explainer, and build it frame by frame in HyperFrames. The input is a **code change** (read via `gh`), not a website — there is **no capture step and no real assets** beyond the contributors' avatars.

> **Confirm the route before Step 0.** You are the orchestrator. Run each step, verify its gate, and only then continue. This skill is for a **GitHub pull request** (a code change). Route other intents elsewhere: a product launch/promo → `/product-launch-video`; a general website tour → `/website-to-video`; a topic explainer with no PR → `/faceless-explainer`; captions on existing footage → `/embedded-captions`; a short unnarrated motion graphic → `/motion-graphics`; a whole-repo or multi-PR release walkthrough → `/general-video`. **Out of scope:** live / at-render-time data — PR facts are read once at author time and baked in. If the user says only "make a video" or the route is uncertain, read `/hyperframes` first.

You are the orchestrator. Work in the resolved external `PROJECT_DIR`, never in the caller repository by default. Run steps in order and pass each gate before continuing. User-gated steps are Step 0, Step 3, and Step 6. Read `../hyperframes-core/references/brief-contract.md` before Step 0 — it defines the two modes, the gate types, and the brief fields; the mode governs the Step 0/3/6 gates. Do every step yourself except Step 5, where you dispatch a bounded pool of frame workers. Do not put design or motion rules here; those live in the frame-worker sub-agent, this skill's local `../hyperframes-animation/rules/` + `../hyperframes-animation/blueprints/`, and `hyperframes-creative`.

Workflow: Step 0 setup → `hyperframes.json`; Step 1 ingest → `capture/extracted/` + `assets/<login>.png`; Step 2 design system → `frame.md`; Step 3 storyboard/script → `STORYBOARD.md` and `SCRIPT.md`; Step 3.1 audio → `audio_meta.json`; Step 4 visual design → enriched `STORYBOARD.md`; Step 5 frames → `compositions/frames/NN-*.html` and `index.html`; Step 6 final render → `renders/video.mp4`.

---

## Step 0: Setup and Brief

Goal: Lock the PR reference and the core video brief, and create the HyperFrames project if needed.

Get the **PR reference** (a full URL, an `<owner>/<repo>#<N>` ref, or "this PR" in a checked-out repo), then confirm the brief in two rounds — through the question UI when the environment has one, conversationally otherwise. The intro text states **message** (the ONE thing the video must say about this change, in one sentence), **language**, and the style (always **claude**). Skip a question only when the user's request already answered it.

**Round 1 — mode.** One question, asked first. Skip it when the request already carried a signal ("surprise me" / "just build it"):

- **Collaborative (recommended)** — confirm the key choices together before building.
- **Autonomous** — every decision is made for the user, each stated with its reason; the only remaining question is preview-before-render.

Autonomous → ask nothing more. State the locked brief (all fields + receipts) as a heads-up and proceed straight through; the preview question waits at Step 6.

**Round 2 — the brief (collaborative).** One round, these four questions, recommended option first with its receipt:

- **Angle — what story does this PR tell?** changelog / feature-reveal / fix-explainer / refactor-walkthrough; recommend the one the PR itself suggests, with its basis.
- **Audience — who is it for?** developers (default) · mixed technical · non-technical stakeholders.
- **Length — how long?** From the size table below; the tier is a ceiling, and a one-headline story recommends inside 30–90s ("+A/−D across F files" is the receipt).
- **Destination — where will it play?** YouTube / embed → 16:9 (default for a code explainer) · X / LinkedIn / Instagram feed → 1:1 · Shorts / TikTok → 9:16.

A "go" accepts all recommended defaults.

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

State the basis in one phrase when you propose it (e.g. "~40s — small change, +44/−13 across 12 files"). A huge PR doesn't mean a long video — the tier is a **ceiling** on how much story the diff can support, never a floor to fill. When the story is **one headline change**, recommend inside the 30–90s sweet spot regardless of the size tier, and say so (the tier's range can still appear as a non-recommended option for a fuller walkthrough).

Resolve the project directory before doing any other work. Preserve a user-supplied project directory; otherwise use the durable external cache location printed by the resolver. Never create `videos/` in the caller repository:

```bash
PR="<url | owner/repo#N>"
if [ -n "${EXPLICIT_PROJECT_DIR:-}" ]; then
  PROJECT_DIR="$(node <SKILL_DIR>/scripts/project-dir.mjs --pr "$PR" --project-dir "$EXPLICIT_PROJECT_DIR")"
else
  PROJECT_DIR="$(node <SKILL_DIR>/scripts/project-dir.mjs --pr "$PR")"
fi
echo "PR-to-video project: $PROJECT_DIR"
node <SKILL_DIR>/scripts/preflight.mjs
```

The capability preflight runs before fetch, story work, audio, or frame dispatch. If the installed CLI cannot run the validation command required by this skill, stop with its upgrade instruction rather than spending the run's context first.

Initialize only if `$PROJECT_DIR/hyperframes.json` is missing. Its basename comes from the PR, such as `acme-sdk-pr-1842`; never use the workspace name or a timestamp.

`npx hyperframes init "$PROJECT_DIR" --non-interactive --example=blank` — `init` checks the installed skills against the latest on GitHub and updates the global set if any are out of date.

Every relative-path command below runs with `$PROJECT_DIR` as its working directory. Examples without an explicit subshell mean `(cd "$PROJECT_DIR" && …)`; never change the caller repository's working tree.

**Show sign-in status before the brief** — run `npx hyperframes auth status` and **relay its output verbatim (don't paraphrase or rewrite it).** It reports whether voice/BGM will use HeyGen or local engines and, when not signed in, how to sign in. **If not signed in, STOP and wait for the user to choose — sign in, or say "go"/"offline" to continue with local engines — before asking the brief or anything else.** Treat it as a real decision point, not a passing note; don't fold the choice into the brief question, and don't write keys into a per-repo `.env`. (In autonomous mode, note the status and continue offline.) See `../media-use` → Preflight for the canonical guidance.

**Gate:** `hyperframes.json` exists; the PR ref is captured; angle, audience, length, destination → aspect, message, and language are locked; sign-in status was shown (signed in, or continuing offline).

---

## Step 1: Ingest the PR (no capture)

Goal: Fetch the PR's facts and fold them into the project as the source of information. There is **no website capture**. `fetch-pr.mjs` runs `gh` deterministically — completing the files list via paginated `gh api` so a large PR doesn't truncate at ~100 files, and writing only `capture/pr.json` + `capture/diff.patch` (no scratch dir). For MERGED PRs it also resolves a best-effort `shipped_version` (+ `version_source`) into `pr.json`, so the end card can cite a real version instead of inventing one. Then `ingest.mjs` folds that into the synthetic capture package offline.

```bash
PR="<url | owner/repo#N | N>"

# Fetch the PR deterministically: runs gh, completes the files list via paginated
# gh api (so a big PR doesn't truncate at ~100 files), writes only capture/pr.json +
# capture/diff.patch — no scratch dir. gh auth / not-found / private errors exit 1 here.
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/fetch-pr.mjs --pr "$PR" --out-dir ./capture)

# Offline transform → capture/extracted/{tokens.json (colors:[] → claude palette),
# visible-text.txt (the brief), people.json (contributors, bot-filtered, name+login,
# avatarFile=assets/<login>.png)}.
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/ingest.mjs \
  --pr-json ./capture/pr.json --diff ./capture/diff.patch --out-dir ./capture/extracted)

# The people front's one network step — download each contributor's GitHub avatar to
# assets/<login>.png for the credits close. Best-effort; always exits 0.
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/fetch-people-avatars.mjs \
  --people ./capture/extracted/people.json)
```

If `fetch-pr.mjs` exits 1 (gh auth / not found / private), report its stderr and stop — **do not fabricate PR contents**. If `ingest.mjs` exits 1, read its stderr (usually a malformed `pr.json`), fix, and rerun (deterministic). `fetch-people-avatars.mjs` always exits 0; missing avatars just mean no credits close to author.

`people.json` carries a `name` for whichever contributors `gh` already named (the PR author, commit authors, `mergedBy`) — `null` for the rest (reviewers/commenters/assignees, which `gh pr view` only ever gives a bare `login`). Before writing the credits close in Step 3, resolve any `null` name yourself for the 1-6 people who'll actually appear on that frame: `gh api users/<login> --jq .name` (you already have `gh` — no need to script this). If GitHub has no public name for that user either, fall back to the login on-screen and drop that person from the spoken line (see story-design.md's credits section — the voiceover must still say names, never raw handles).

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

Read `../hyperframes-creative/references/story-spine.md` (hook language, value-before-evidence, storyboard-as-proposal), `references/story-design.md`, `../hyperframes-animation/blueprints-index.md`, `../hyperframes-core/references/storyboard-format.md`, and `../hyperframes-core/references/script-format.md`. Use them to write `STORYBOARD.md` and, when narration is needed, `SCRIPT.md`.

Use `story-design.md` for the PR archetype (changelog / feature-reveal / fix-explainer / refactor-walkthrough), the PR-native frame types, hook, persuasion, beats, the per-frame word budget, and the credits close. The sequence comes from **narrative design, not the diff's file order** — explain the change, don't read the diff aloud. As a **soft guide**, consult the role→blueprint menu in `../hyperframes-animation/blueprints-index.md`: for each beat, write the voiceover in the shape its candidate blueprint implies and tag that candidate `blueprint:` id when one fits (story truth still decides which beats exist — never force a beat to fit a shape). Feature 2–4 real diff hunks (from `capture/diff.patch`), each a small legible snippet; name the `code-*` block each wants in the frame's `scene`. Frames carry no `asset_candidates` except the `credits` close (1–6 `assets/<login>.png` avatars). Use the exact required fields from the storyboard and script references.

After drafting, present the plan as a proposal per story-spine § 3: open by echoing **"This video tells [audience] that [message]"**, then the frame table — one row per frame: frame · beat (type, duration) · on screen · why (its `narrativeRole`, traced to the message). In that same message ask the user (a) to approve or request changes, and (b) whether they want a live preview of the storyboard scaffold — open it only on a yes. Start that preview once with `npx hyperframes preview "$PROJECT_DIR" --background`; retain the printed URL for Step 6 instead of starting another server. Iterate until approved; carry the preview choice to Step 6. This is a **checkpoint gate** (brief contract § 1): in autonomous mode, post the same summary as a heads-up and proceed — the preview question is asked once, at Step 6.

**Gate:** `STORYBOARD.md` exists, every frame has the required narrative fields, `SCRIPT.md` exists when narration is needed, and the user approved the plan (autonomous: the summary was posted as a heads-up).

---

## Step 3.1: Audio

Goal: Generate narration, word timings, music, and audio metadata from the approved script.

Start audio after Step 3 approval. Run it in the background, then continue to Step 4.

**Choose the narration voice from the user's ask before invoking.** If the request named a voice, gender, or tone, pick a matching voice id and pass it with `--voice <id>`. The pipeline default is otherwise **Marcia (female)** on HeyGen / `am_michael` on Kokoro — so a request like "a male voice" is silently ignored unless you pass the flag. Voice ids are provider-specific; resolve against whichever provider Step 0's sign-in status selected: **HeyGen** (signed in) via `node ../media-use/audio/scripts/heygen-tts.mjs --list` (or `GET /v3/voices?engine=starfish`); **Kokoro** (offline) via the voice table in `../media-use/audio/references/tts.md` (prefixes `am_`/`bm_` male, `af_`/`bf_` female). Omit `--voice` only when the user expressed no preference.

`node <SKILL_DIR>/scripts/audio.mjs --script ./SCRIPT.md --storyboard ./STORYBOARD.md --hyperframes . --out ./audio_meta.json --voice <voice-id> &`

The audio script handles narration, word timings, BGM lookup from HeyGen's music library, and timing metadata. BGM mood comes from the storyboard's `music:` field. This uses the HeyGen Audio API for retrieval, not generation, and the same `~/.heygen` credential as TTS. For provider details, read `../media-use/audio/references/tts.md`.

If there is no narration and no `SCRIPT.md`, skip voice generation. BGM may still run if the storyboard has a music mood.

**Gate:** audio job has started, or the project is marked silent.

---

## Step 4: Frame Visual Design

Goal: Add the visual direction, layout intent, and motion choices to each storyboard frame.

Edit `STORYBOARD.md` in place. Do not create another storyboard. Use `frame.md` as source of truth for color, type, layout feel, and style.

Read `references/visual-design.md`, `../hyperframes-animation/blueprints-index.md`, `references/motion-language.md`, `references/code-vocabulary.md`, and `../hyperframes-animation/rules-index.md`. Use `visual-design.md` for the method (the time-coded shot sequence, the inline Layout vocabulary, and the code-beat treatment), plus the required `## Video direction` block. Use `../hyperframes-animation/blueprints-index.md` to pick each frame's shot shape. Use `code-vocabulary.md` to pick the right `code-*` block per code beat (diff = `code-diff`, refactor = `code-morph`, new code = `code-typing`, …). Use `motion-language.md` (the motion vocabulary + the motion doctrine) and `../hyperframes-animation/rules-index.md` (valid rule names) for motion — do not invent motion or block/blueprint names.

For every frame, write a **time-coded shot sequence** into `STORYBOARD.md` per `visual-design.md`'s method: pick the frame's blueprint (or compose), instantiate it with THIS frame's content, and pace each Scene's reveal to the voiceover so the frame develops across its full duration instead of front-loading then freezing. **For a code beat, the `code-*` block is the frame's `focal`** and the Scenes choreograph the surrounding claude Code Surface (the entry of the file/header, the camera onto the hunk, the landing line) — **not** the code animation itself, which the block owns. Immediately after each code frame's fields, add a `### Source excerpt` fenced `diff` block containing only the exact real hunk the worker must render (12 lines maximum). Select it here from `capture/diff.patch`; workers are forbidden from reopening that full diff. State layout and motion **inline** per Scene (vocabularies in `visual-design.md` and `motion-language.md`). Add one video-wide `## Video direction` block.

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

Before dispatch, read `sub-agents/frame-worker.md` and `../hyperframes-core/references/subagent-dispatch.md`. Build bounded packets:

```bash
node <SKILL_DIR>/scripts/frame-packets.mjs --project "$PROJECT_DIR" --storyboard "$PROJECT_DIR/STORYBOARD.md"
```

The packet builder hard-fails a code frame without the upstream-selected `### Source excerpt`, and hard-caps packet bytes. Dispatch **at most three workers total**, balanced across the packet paths; each worker may build multiple assigned frames sequentially and reads shared instructions once. Workers read only their packet(s) and `frame.md`. They never open the full `STORYBOARD.md`, `capture/diff.patch`, or `capture/extracted/visible-text.txt`. Each worker writes only its assigned `compositions/frames/NN-*.html`; workers never edit `STORYBOARD.md`.

On a failed frame, re-dispatch **that frame only**, with its existing packet plus the exact validator/lint finding. One retry maximum. Do not replay a whole batch and do not retry without a concrete finding.

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

`npx hyperframes check`

`npx hyperframes snapshot --at <frame-midpoints>`

`snapshot` stitches the captured frames into one contact sheet (`snapshots/contact-sheet.jpg`). Glance at it; if nothing is obviously broken, move on — don't linger here.

If a command fails, surface stderr and stop — don't pile on recovery commands. Fix it yourself: the cheapest safe edit to `compositions/frames/NN-*.html`, then rerun the failed check.

**Known false-positive — do not chase it.** `inspect` may report a handful of `text_box_overflow` errors of ~1–4px on the **caption** highlight words (selector `#caption-word-*` / `.caption-line`). The caption pill uses a deliberately snug `line-height` (set once in `scripts/captions.mjs`) and has **no `overflow:hidden`**, so a heavy display glyph's ink spills a few px into the pill's own padding — nothing is actually clipped. Treat these as expected and proceed. Do **not** inflate the caption `line-height` (it balloons the pill, which is worse). Only act on a `text_box_overflow` when it names a **frame** element (`#el-NN-*`), not a caption word.

After checks pass, pause for user review. The video is assembled, viewable, and editable in Studio. Manage preview only once across Step 3 and Step 6: reuse the retained background-preview URL if the user asked earlier; if they declined earlier, offer it once and start it with the command below only on a yes. Do not ask again if they are already reviewing in Studio. In autonomous mode this is the one question the mode keeps: ask "preview first, or render?" — open the preview on yes, render on no — then deliver the MP4 with the contact sheet and the frame ids so revisions can target a single frame.

Preview: `npx hyperframes preview "$PROJECT_DIR" --background`

Render only after user approval (autonomous mode: after the preview-or-render question):

`npx hyperframes render --skill=pr-to-video --quality high --output renders/video.mp4`

Do not rerun `lint`, `validate`, `inspect`, or `snapshot` after rendering unless the user asks.

After the user is done reviewing (or after render when no more live edits are expected), stop only this project's background server: `npx hyperframes preview "$PROJECT_DIR" --stop`. Never tear it down while waiting for review.

**Gate:** `lint`, `validate`, and `inspect` passed before render; user approved at the review pause (autonomous: checks passed and the delivery includes the contact sheet); `renders/video.mp4` exists. Final reply states the MP4 path and final duration.

---

## Quick Reference

**Formats:** landscape `1920x1080`; portrait `1080x1920`; square `1080x1080` — derived from the destination (brief contract § 2). Set the format once in the storyboard frontmatter.

**PR deltas vs a captured-asset workflow:** no Step 1 capture (the `gh` CLI ingests the PR into a synthetic `capture/extracted/` package — `tokens.json` + `visible-text.txt` + `people.json`); the only real assets are the contributors' `assets/<login>.png` avatars (the credits close); no `asset-descriptions.md`, no asset-staging step. Code beats are rendered by the `code-*` registry blocks on claude's navy Code Surface; the style is always **claude**.

**Background scripts:** the workflow ships these under `scripts/`: `fetch-pr` (PR → `capture/pr.json` + `diff.patch` via `gh`; large-PR-safe, no scratch), `ingest` (→ synthetic capture package; offline), and `fetch-people-avatars` (contributor avatars → `assets/`); plus the shared engine — `build-frame` (adopt + brand-remix a preset into `frame.md` + caption skin), `audio` (TTS, BGM, SFX, duration sync), `captions`, `transitions` (inject + verify), and `assemble-index`. Everything else is the `hyperframes` CLI. Code blocks install via `npx hyperframes add <name>`.

The reusable, domain-agnostic shot shapes live in `../hyperframes-animation/blueprints/` (indexed by `../hyperframes-animation/blueprints-index.md`); the `code-*` registry blocks are the code-beat vocabulary (`references/code-vocabulary.md`).

| Read                                                                                                                                                        | When                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `[../hyperframes-core/references/brief-contract.md](../hyperframes-core/references/brief-contract.md)`                                                      | Step 0: the interaction mode, brief fields, and how to ask.                    |
| `[../hyperframes-creative/references/story-spine.md](../hyperframes-creative/references/story-spine.md)`                                                    | Step 3: story doctrine — hook language, value-before-evidence, proposal shape. |
| `[references/story-design.md](references/story-design.md)`                                                                                                  | Step 3: plan the PR explanation.                                               |
| `[../hyperframes-animation/blueprints-index.md](../hyperframes-animation/blueprints-index.md)`                                                              | Step 3: role→blueprint menu. Step 4: pick the shot shape.                      |
| `[../hyperframes-core/references/storyboard-format.md](../hyperframes-core/references/storyboard-format.md)`                                                | Step 3: write `STORYBOARD.md`.                                                 |
| `[../hyperframes-core/references/script-format.md](../hyperframes-core/references/script-format.md)`                                                        | Step 3: write `SCRIPT.md`.                                                     |
| `[../media-use/audio/references/tts.md](../media-use/audio/references/tts.md)`                                                                              | Step 3.1: choose or understand TTS providers.                                  |
| `[references/visual-design.md](references/visual-design.md)`                                                                                                | Step 4: write the frame's shot sequence (+ Layout vocabulary).                 |
| `[references/code-vocabulary.md](references/code-vocabulary.md)`                                                                                            | Step 4 + 5: pick + fill the `code-*` block for a code beat.                    |
| `[references/motion-language.md](references/motion-language.md)`                                                                                            | Step 4: the motion vocabulary + the motion doctrine.                           |
| `[references/cut-catalog.md](references/cut-catalog.md)`                                                                                                    | Step 4-5: the cut catalog (worker builds within-frame seams).                  |
| `[../hyperframes-animation/rules-index.md](../hyperframes-animation/rules-index.md)` + `[../hyperframes-animation/rules/](../hyperframes-animation/rules/)` | Step 5: local rule recipe bodies for the cited motions.                        |
| `[sub-agents/frame-worker.md](sub-agents/frame-worker.md)`                                                                                                  | Step 5: dispatch per-frame workers.                                            |
| `[../hyperframes-core/references/subagent-dispatch.md](../hyperframes-core/references/subagent-dispatch.md)`                                                | Step 5: dispatch sub-agents safely.                                            |
| `[../hyperframes-creative/frame-presets/claude/FRAME.md](../hyperframes-creative/frame-presets/claude/FRAME.md)`                                            | Step 2: the claude preset (fixed style).                                       |
