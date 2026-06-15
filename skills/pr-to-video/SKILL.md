---
name: pr-to-video
description: pr-to-video workflow - a GitHub pull request (URL like github.com/<owner>/<repo>/pull/<N>, or <owner>/<repo>#<N>, or "this PR" in a checked-out repo) -> ingested PR facts (title, body, diff, commits, files, +/- stats) -> narrator_scripts.json + audio (voice + BGM) + section_plan.md -> code-diff / before-after / impact explainer video. Input is a CODE CHANGE. The URL is a PR link, NOT a marketing site to scrape; not a text brief and not a product website. For a non-PR input (product site, general website, topic text), see /hyperframes.
metadata:
  {
    "tags": "orchestrator, pipeline, pr-to-video, changelog, dev-rel, code-explainer, release-notes",
  }
---

# pr-to-video - dispatch entry

Input is a **GitHub pull request** (a code change), supplied as a PR URL, an `<owner>/<repo>#<N>` ref, or "this PR" while a repo with an open PR is checked out. Output is a **code-change explainer**: what shipped, why, and how it works — rendered from the diff/commits as before-after, diff-highlight, file-tree, and impact scenes. Default length **up to ~3 min** (sweet spot ~30-90s); a genuinely longer or exhaustive every-file walkthrough (5 min+) is a different register → `/general-video`. There is **no website scrape and no headless Chrome for ingest** — ingest is the `gh` CLI. The shipped style preset is always **claude** (warm editorial; signature navy code window).

> **Confirm the route before Step 0.** This skill explains a **GitHub pull request** (a code change read via `gh`). If the input is a **marketing / product site** → `/product-launch-video`; a **general website** → `/website-to-video`; a **topic / article with no PR** → `/faceless-explainer`; a **whole-repo tour or multi-PR release** → `/general-video`. **Out of scope**: live / at-render-time data — PR facts are read once at author time and baked in. Handed a non-PR input, or unsure? **Read `/hyperframes` first.**

This workflow owns only the PR-specific front (**ingest + story-design**); every phase marked _shared_ reuses the engine copied from faceless-explainer unchanged (it lives under this skill's own `scripts/` + `agents/` + `phases/`, so `<SKILL_DIR>` resolves to pr-to-video).

All artifacts go to `PROJECT_DIR = videos/<project-name>/` (created in Step 0); all paths below are relative to it. Dispatch is harness-portable: before the first subagent dispatch, read `<SKILL_DIR>/../hyperframes-core/references/subagent-dispatch.md` once — it maps the dispatch verbs (parallel fan-out / background / wait) to your harness's primitives; a concurrency cap below N means waves of the cap size, never fewer workers. **This file is a binding runbook, not background reading**: execute the steps in order and produce every phase artifact with its designated script or agent role — do not substitute a freestyle pipeline, and do not skip a pause step because the request seems clear. A step you cannot perform → stop and report.

| Phase                   | Execution                                                                                                                                                                                        | Primary artifact                                                                                              | Detailed flow                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| init                    | Bash                                                                                                                                                                                             | `hyperframes.json`                                                                                            | Step 0                                    |
| **ingest** (own)        | Bash (`gh` CLI + `ingest.mjs` + `fetch-people-avatars.mjs`, NO agent, NO scrape)                                                                                                                 | `capture/pr.json` + `diff.patch` + `extracted/{tokens.json,visible-text.txt,people.json}` + `public/avatars/` | Step 1                                    |
| design-system (shared)  | Bash (no agent, deterministic `claude`)                                                                                                                                                          | `design-system/design.html` + `chunks/`                                                                       | Step 1b                                   |
| **story-design** (own)  | subagent                                                                                                                                                                                         | `narrator_scripts.json`                                                                                       | `agents/story-design.md`                  |
| audio (shared)          | `audio.mjs` in Bash                                                                                                                                                                              | `audio_meta.json`                                                                                             | `phases/audio/guide.md`                   |
| visual-design (shared)  | subagent                                                                                                                                                                                         | `section_plan.md`                                                                                             | `agents/visual-design.md`                 |
| prep (shared)           | `prep.mjs` in Bash                                                                                                                                                                               | `group_spec.json`                                                                                             | `scripts/prep.mjs`                        |
| captions (shared, det.) | `captions.mjs group` -> `captions.mjs html` in Bash (no subagent)                                                                                                                                | `caption_groups.json` + `compositions/captions.html`                                                          | `scripts/captions.mjs`                    |
| scenes (shared)         | N x subagent (parallel)                                                                                                                                                                          | `compositions/scene_*.html` or `compositions/group_w*.html`                                                   | `agents/hyperframes-scene.md`             |
| finalize (shared)       | Bash prelude (wait-bgm + assemble + inject/verify-transitions + hoist-videos + sfx-verify + preflight) -> finalize subagent (fix brief findings in place + one lean contact-sheet look + render) | `renders/video.mp4`                                                                                           | Step 7 / `agents/hyperframes-finalize.md` |

## Prerequisites

macOS Apple Silicon or Linux x64. System tools: `brew install python@3.11 node ffmpeg` (use Homebrew Python, **not** `/usr/bin/python3`, or `pip install` is blocked by PEP 668); then `npx hyperframes doctor` once (downloads Chrome — needed for snapshot/render, not for ingest). The rendered overlap gate (`scripts/check-overlap.mjs`, run in worker self-checks and preflight) reuses that same cached Chrome — it never downloads a browser; its only dep is the `puppeteer-core` npm module, ensured once before scene fan-out (Step 5.5, `--ensure-deps`, ~5s, no full `puppeteer` install). CLIs: **`gh`** (GitHub CLI, authenticated — `gh auth status` must pass) and `hyperframes`. Optional cloud keys (else local fallbacks) — inject in Step 0.5:

| Key / requirement                              | Used for                                    | Default / fallback                                             |
| ---------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| `gh auth status` OK                            | Reading the PR (public or private)          | **required** — fail fast with the auth hint                    |
| `HEYGEN_API_KEY` (or `hyperframes auth login`) | TTS (cloud, word-level timestamps)          | voice: auto (first English starfish voice; override `--voice`) |
| `ELEVENLABS_API_KEY`                           | TTS (cloud; needs `pip install elevenlabs`) | voice `21m00Tcm4TlvDq8ikWAM` (Rachel)                          |
| neither, and not logged in                     | TTS                                         | local Kokoro, voice `am_michael` (non-English: pass `--voice`) |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` (aliases)  | Lyria BGM                                   | unset -> local MusicGen (first run downloads ~300 MB)          |

## Flow

### Step 0.0 - Confirm the brief (ALWAYS ask one round, then build)

Before Step 0, **always pause and ask the brief in one message, then wait for the user — never skip this, even for a request that looks complete.** Lead with a recommended default for each field and pre-fill anything the user already gave (confirm it rather than re-asking blindly): the **angle** (changelog / feature reveal / fix / refactor — default: infer from the PR), the **audience** (developers vs general users — default: developers), **length** (default ~60-90s), and — if `/hyperframes` didn't set them — **aspect** (default 16:9) and **language**. Style is always `claude`. Proceed to Step 0 only after the user replies; a "go" / "use the defaults" is a valid reply that accepts every default.

### Step 0 - Initialize the video project

cwd is the agent workspace root (e.g. `/tmp/pr-video-...`). Write all video artifacts under `PROJECT_DIR = videos/<project-name>/`.

`<project-name>`: use the directory the user gave (e.g. `Use ./videos/retry-pr`), else a short kebab-case name derived from the PR (`<repo>-pr-<N>`, e.g. `widgets-pr-1187`). **Not** the workspace basename or a timestamp.

Only when `$PROJECT_DIR/hyperframes.json` is absent:

```bash
PROJECT_DIR="${PR_VIDEO_DIR:-videos/<project-name>}"
mkdir -p "$(dirname "$PROJECT_DIR")"
npx hyperframes init "$PROJECT_DIR" --non-interactive --skip-skills --example=blank
```

> `hyperframes init` drops a generic `AGENTS.md` / `CLAUDE.md` into `$PROJECT_DIR`; **leave them in place** — they are agent scaffolding for whoever opens the finished project later.

**Constraints:** never run `hyperframes init` / generate `AGENTS.md` / `CLAUDE.md` in the workspace root; never nest another `hyperframes/` inside `PROJECT_DIR`; every Bash command (master + subagents) is a `(cd "$PROJECT_DIR" && ...)` subshell — never bare `cd`.

### Step 0.5 - API key guidance

Skip if `$PROJECT_DIR/.env` exists or `context.log` is non-empty (= not the first run). Otherwise **first detect what's available** (HeyGen TTS on if `$HEYGEN_API_KEY` / `$HYPERFRAMES_API_KEY` set or `~/.heygen/credentials` exists from `hyperframes auth login`; ElevenLabs / Gemini only if their env keys set), then **always pause and offer the menu — wait for the user; do not proceed on your own even when a workable config is detected** (the user may want to add a key like Gemini). State what's detected, then: paste keys (→ Write `$PROJECT_DIR/.env`, one `KEY=value` per line, overwrite same-name) / "go" (proceed with what's configured — env, `.env`, or `hyperframes auth login`) / "skip" (proceed with local fallbacks for anything unconfigured). Then proceed to Step 1.

### Step 1 - Ingest (Bash, NO agent, NO scrape)

Resolve the PR ref and pull structured facts with `gh`, then fold them into the synthetic capture package the shared backend expects (mirrors faceless-explainer's no-scrape scaffold). `gh` runs **here, in the orchestrator**, so auth / not-found / private-repo errors surface with gh's own stderr; `ingest.mjs` is a pure offline transform.

```bash
# PR ref: a full URL, "<owner>/<repo>#<N>", or "<N>" inside a checked-out repo.
PR="<url | owner/repo#N | N>"

# Fail fast if gh is not authenticated.
gh auth status || { echo "gh not authenticated — run: gh auth login"; exit 1; }

(cd "$PROJECT_DIR" && mkdir -p capture/extracted capture/assets)
(cd "$PROJECT_DIR" && gh pr view "$PR" \
  --json number,title,body,author,url,baseRefName,headRefName,commits,files,additions,deletions,changedFiles,labels,reviews,latestReviews,comments,assignees,reviewDecision,mergedBy \
  > capture/pr.json)
(cd "$PROJECT_DIR" && gh pr diff "$PR" > capture/diff.patch)

# Fold pr.json + diff.patch into tokens.json (colors:[] → claude native palette) +
# visible-text.txt (the narrative brief) + people.json (PR author + commit authors w/ counts +
# reviewers / commenters / assignees, bot-filtered + deduped, each with a GitHub avatar URL).
# (The PR `author` is only the opener; commit authors from commits[].authors[] are tracked too.)
# ingest is OFFLINE.
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/ingest.mjs \
  --pr-json ./capture/pr.json --diff ./capture/diff.patch --out-dir ./capture/extracted)

# Network step (the people front's only one — ingest stays offline): download each
# contributor's GitHub avatar to public/avatars/<login>.png for an optional credits /
# shipped-by close. Best-effort — a missing avatar or offline run never blocks (exit 0).
# Avatars + that close are the ONE place pr-to-video relaxes the faceless default.
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/fetch-people-avatars.mjs \
  --people ./capture/extracted/people.json)
```

Validation:

```bash
[ -s "$PROJECT_DIR/capture/pr.json" ] && \
[ -s "$PROJECT_DIR/capture/diff.patch" ] && \
[ -s "$PROJECT_DIR/capture/extracted/tokens.json" ] && \
[ -s "$PROJECT_DIR/capture/extracted/visible-text.txt" ] && \
[ -s "$PROJECT_DIR/capture/extracted/people.json" ] && \
[ -d "$PROJECT_DIR/capture/assets" ] && echo ok || echo missing
# public/avatars/ is best-effort — its absence is NOT a failure (no avatars resolved / offline).
```

If `gh` errors (auth / not found / private), report the exact stderr and stop — **do not fabricate PR contents**. If `ingest.mjs` exits 1, read its stderr (usually a malformed `pr.json`), fix, rerun (deterministic, finishes instantly). `fetch-people-avatars.mjs` always exits 0; if avatars are missing, story-design simply has no credits scene to author.

### Step 1b - Design system (Bash, NO agent, deterministic — SHARED)

Three deterministic commands produce a fully-styled `design.html` + chunks against the synthetic input, with the **claude** preset (its `code-window` / `number-lockup` / `stat-card` components are the PR visual vocabulary):

```bash
(cd "$PROJECT_DIR" && node <SKILL_DIR>/phases/design-system/scripts/build-design.mjs ./design-system --no-emit --style claude)
(cd "$PROJECT_DIR" && node <SKILL_DIR>/phases/design-system/scripts/build-design.mjs ./design-system --style claude)
(cd "$PROJECT_DIR" && node <SKILL_DIR>/phases/design-system/scripts/emit-chunks.mjs ./design-system)
```

Validation:

```bash
[ -s "$PROJECT_DIR/design-system/inference.json" ] && \
[ -s "$PROJECT_DIR/design-system/design.html" ] && \
[ -s "$PROJECT_DIR/design-system/chunks/index.json" ] && echo ok || echo missing
```

If any is missing, read the build-design / emit-chunks stderr, fix the invocation, and rerun (deterministic, finishes in seconds).

### Step 2 - Story-design (subagent) — OWN

Dispatch one subagent. prompt = full contents of `agents/story-design.md` + the `## Dispatch context` below, passed through verbatim:

```
SKILL_DIR: <absolute path>
PROJECT_DIR: <video project root>
Schema validator: <SKILL_DIR>/scripts/validate-narrator.mjs
PR facts: ./capture/pr.json                          # title / body / commits / files / +/- stats — read first
Diff: ./capture/diff.patch                           # the actual change — pull 2-4 representative hunks
Brief: ./capture/extracted/visible-text.txt          # the assembled narrative brief
People: ./capture/extracted/people.json              # contributors (PR author + commit authors w/ commitCount + reviewers/commenters) + avatarFile; avatars in public/avatars/ — optional credits close
Design DNA: ./design-system/inference.json           # Read site_dna once to set register (soft hint only)
Orientation: <landscape | portrait | square>        # From the Step 0.0 aspect (16:9→landscape, 9:16→portrait, 1:1→square; default landscape). Emit VERBATIM as the top-level `orientation` field — dictated, not a choice; sets the canvas (portrait→1080×1920) for the whole pipeline.
Script style: concise, dev-facing — 1-2 sentences/scene, <=20 words; name the change, the why, the impact
```

The agent picks a PR **archetype** for `narrativeArchetype` (`changelog` / `feature-reveal` / `fix-explainer` / `refactor-walkthrough`, or `"<outer> with <inner>"`), echoes the dispatched **`orientation`** as a top-level field (Step 5 prep → canvas size), and emits `narrator_scripts.json` (it runs the validator before returning). `continuity` drives worker grouping: `continue` = same worker as the previous scene (cap=3); `break` = new worker; scene 1 is always `break`. `intent` / `sharedMotif` are soft hints. `assetCandidates` is `[]` on essentially every scene (faceless) — the one exception is an **optional credits / shipped-by close** that may reference the contributor avatars in `public/avatars/<login>.png` (from `people.json`).

### Step 3 - Audio — SHARED

After `narrator_scripts.json` exists:

```bash
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/audio.mjs \
  --narrator-scripts ./narrator_scripts.json \
  --hyperframes . \
  --out ./audio_meta.json \
  --lyria-recipe <SKILL_DIR>/phases/audio/lyria-recipe.py)
```

BGM generation runs detached in the background. Backend selection (audio.mjs Step 5b): **cloud Lyria** is used only when a `GEMINI_API_KEY`/`GOOGLE_API_KEY` is set, the `--lyria-recipe` exists, AND `import google.genai` actually succeeds — if the key is set but the package is missing, audio.mjs tries to `pip install google-genai` on demand. When Lyria can't run, it **falls back to local MusicGen** (`facebook/musicgen-small` via transformers, no key; deps auto-installed in the background, parallel with TTS). BGM is only skipped entirely when neither backend can be made to run (e.g. no network for pip). It never blocks the render. Flags + BGM mechanics: top of `audio.mjs`.

- exit 0 -> voice + transcribe complete (BGM may still be rendering; `audio_meta.json` records `bgm_log` / `bgm_pid`), continue.
- exit 1 -> zero scenes produced voice; report and stop.

### Step 4 - Visual-design (subagent) — SHARED

After `design-system/chunks/index.json`, `narrator_scripts.json`, and `audio_meta.json` exist, concatenate all inputs into one dispatch packet (contracts first, static references middle, work items last):

```bash
# Dispatch packets live in $PROJECT_DIR/.dispatch/ (transient; safe to delete after the run).
# NEVER use a fixed /tmp path: it persists across runs/projects, so a failed write silently
# reuses another project's stale packet and contaminates every worker.
mkdir -p "$PROJECT_DIR/.dispatch"
DP="$PROJECT_DIR/.dispatch/vd-dispatch.txt"
{
  echo "## Design chunks"
  (cd "$PROJECT_DIR" && cat design-system/chunks/index.json \
    design-system/chunks/composition-hints.md design-system/chunks/voice.md \
    design-system/chunks/tokens.css design-system/chunks/easings.js 2>/dev/null)
  echo "## Effects catalog";  cat <SKILL_DIR>/phases/visual-design/effects-catalog.md
  echo "## Design rules";     cat <SKILL_DIR>/phases/visual-design/rules/{typography,color-system,composition,motion-language}.md
  echo "## SFX library";      cat <SKILL_DIR>/assets/sfx/manifest.json
  echo "## Narrator scripts"; (cd "$PROJECT_DIR" && cat narrator_scripts.json)
  echo "## Audio meta";       (cd "$PROJECT_DIR" && cat audio_meta.json 2>/dev/null)   # Optional; overrides Duration if drift >10%
} > "$DP"
# Guard: a partially-failed build must fail LOUDLY here, not downstream in the subagent
grep -q '^## Narrator scripts' "$DP" || { echo "FATAL: vd-dispatch.txt incomplete — rebuild before dispatching"; }

# Captions planning hint (put it in the Captions: line of the dispatch below)
(cd "$PROJECT_DIR" && node -e 'try{const m=require("./audio_meta.json");process.stdout.write(Object.values(m.scenes||{}).some(s=>s.wordsPath)?"enabled":"disabled")}catch{process.stdout.write("enabled")}')
```

Then dispatch the visual-design subagent. prompt = full contents of `agents/visual-design.md` + the `## Dispatch context` below, verbatim:

```
SKILL_DIR: <absolute path>
PROJECT_DIR: <video project root>
Schema validator: <SKILL_DIR>/scripts/validate-section.mjs
Canvas: <width>×<height>   # default 1920×1080 (16:9 landscape); 1080×1920 (9:16 portrait) or 1080×1080 (1:1 square) if requested upstream (narrator_scripts.orientation/dimensions). Plan layouts for THIS aspect ratio — see composition.md "Portrait & Square".
Captions: <enabled | disabled>   # Planning hint from the node -e above: enabled => leave the bottom ~17% of canvas height as caption territory in prose
Dispatch packet: <PROJECT_DIR>/.dispatch/vd-dispatch.txt   # Step 0 reads it once for all inputs
Visuals: faceless code-change — every scene is a code-window / before-after split / file-tree / +/- counter / diagram / typography invented from the script + the featured diff hunk. assetCandidates is [] for most or all scenes; plan visuals from the script and diff, not from captured assets.
```

Output is `section_plan.md`. The `Captions:` line is an optimistic hint; the authoritative gate is `group_spec.captions_enabled` from Step 5.

### Step 5 - prep (deterministic script, NO subagent) — SHARED

After `section_plan.md` exists:

```bash
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/prep.mjs \
  --section-plan ./section_plan.md \
  --narrator-scripts ./narrator_scripts.json \
  --audio-meta ./audio_meta.json \
  --rules-dir <SKILL_DIR>/../hyperframes-animation/rules \
  --capture ./capture \
  --design-system ./design-system \
  --hyperframes . \
  --sfx-lib <SKILL_DIR>/assets/sfx \
  --out ./group_spec.json)
```

Merges all upstream artifacts into `group_spec.json` (parse `section_plan` anchors, validate effect/component ids, group by `Continuity` with cap=3, build `visual_clips[]` where a multi-scene continue worker becomes one `group_wN.html`, compute Tier-B `transitions[]` between different visual clips, copy assets/fonts/SFX). `capture/assets/` is empty, so asset-copy is a no-op (faceless). Internal logic: header of `prep.mjs`.

> **`--audio-meta ./audio_meta.json` is what carries each scene's `voicePath` / `wordsPath` and the `bgm_path` into `group_spec` — and therefore into the assembled `index.html`.** Omitting it (or pointing it at a path whose wavs don't resolve under `--hyperframes`) silently blanks every voice / caption / BGM track and renders a **SILENT, caption-less** video while every gate stays green. prep now defaults this flag to `./audio_meta.json` and prints a `CRITICAL` banner when `audio_meta` lists voiced scenes but none get wired; `assemble-index.mjs` re-asserts the same guard before render. Keep passing the flag explicitly anyway.

- exit 0 -> read stdout (scenes / groups / total duration / per-group) and append to `context.log`.
- exit 1 -> stderr names the failing scene + anchor (usually a malformed anchor or unknown effect/transition id); return to Step 4 and re-dispatch visual-design.

### Step 5.5 + Step 6 - Captions (deterministic) + scene worker fan-out — SHARED

**Captions: two deterministic scripts (no subagent), after prep exits 0 and before fan-out:**

```bash
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/captions.mjs group \
  --group-spec ./group_spec.json --hyperframes . \
  --tokens design-system/chunks/tokens.css --out ./caption_groups.json)

(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/captions.mjs html \
  --hyperframes . --groups ./caption_groups.json \
  --tokens design-system/chunks/tokens.css \
  --inference design-system/inference.json \
  --out compositions/captions.html)
```

exit 0 = normal. If either prints `captions: skipped (<reason>)`, skip the whole chain: no `captions.html`, assemble won't mount track 12. Skin selection / self-check: top of `captions.mjs html` (the claude preset ships its own `caption-skin.html`); for offline, pass `--skin-file`. **Do not** run `npx hyperframes lint` on `captions.html`.

Then ensure the overlap-gate dep **once, from the workspace root** (NOT inside `PROJECT_DIR` — the module must land in the workspace `node_modules/` where every worker and preflight can resolve it):

```bash
node <SKILL_DIR>/scripts/check-overlap.mjs --ensure-deps
# Installs puppeteer-core (module only, no browser download) if not already resolvable; Chrome is
# reused from the hyperframes browser cache. Workers must NOT install it themselves (parallel npm race).
```

Then read `group_spec.json.groups[]` for worker count N. Build the shared header once, then per-worker packets (`film direction` / `tokens` / `easings` / `voice` are identical for every worker):

```bash
# Same rule as Step 4: packets go in $PROJECT_DIR/.dispatch/, never a fixed /tmp path
# (a stale /tmp file from a previous project survives a failed write and silently
# poisons every worker with the wrong design system).
mkdir -p "$PROJECT_DIR/.dispatch/scene-dispatch"
# `## Film direction` = the film-level invariants from group_spec.film_direction
# (palette system / motion defaults + budget / ambient system / negative list);
# each scene's creative_brief carries only scene-specific deltas on top of it.
{
  echo "## Film direction"
  (cd "$PROJECT_DIR" && node -p 'JSON.parse(require("fs").readFileSync("group_spec.json","utf8")).film_direction || ""')
  echo "## Tokens / easings / voice"
  (cd "$PROJECT_DIR" && cat design-system/chunks/tokens.css design-system/chunks/easings.js design-system/chunks/voice.md 2>/dev/null)
} > "$PROJECT_DIR/.dispatch/scene-shared.txt"
# Guard BEFORE fan-out: the project's own brand token must be present; a contaminated
# packet here costs a full re-author round across every affected worker.
grep -q -- '--brand-primary' "$PROJECT_DIR/.dispatch/scene-shared.txt" || \
  { echo "FATAL: scene-shared.txt incomplete/stale — rebuild before dispatching workers"; }
# Then per worker: shared header + that worker's Scenes YAML -> $PROJECT_DIR/.dispatch/scene-dispatch/w<N>.txt
```

Start **N scene workers in parallel** (concurrent background dispatches; a harness concurrency cap below N means waves of the cap size until every worker has run — never fewer workers). prompt = full contents of `agents/hyperframes-scene.md` + `## Dispatch context`, verbatim. Top-level fields: `SKILL_DIR` / `PROJECT_DIR` / `Worker ID` / `Composition width` + `Composition height` (= `group_spec.width` / `group_spec.height`) / `Captions: <enabled|disabled>` (= `group_spec.captions_enabled`) / `Dispatch packet: <PROJECT_DIR>/.dispatch/scene-dispatch/w<N>.txt`, plus the shared header body (`## Film direction` + `## Tokens / easings / voice`) + a `Scenes:` list. Each worker's self-check runs two scoped machine gates before returning — `captions.mjs keepout --scene` (when captions enabled) and `check-overlap.mjs --scene` (always) — so layout violations are fixed at the source instead of surfacing at preflight.

For the worker top-level context, copy from `group_spec.json.groups[i]`: `worker_id`, `composition_id`, `composition_file`, `duration_s`, `scene_ids`; and from the top of `group_spec.json`: `width`, `height` (the worker authors + self-checks the root at these dims — landscape 1920×1080 unless portrait/square was requested upstream). **When `Captions: enabled`, also pass `Caption band top y` = `height − round(height × 0.1667)` and `Foreground max y` = `Caption band top y − 20`** (landscape → 900 / 880; portrait → 1600 / 1580) — constraint #13 keep-out is computed from these, not hardcoded. Copy every field in the **`Scenes:` list verbatim from `group_spec.json.groups[i].scenes[<sid>]`** (only that worker's 1-3 logical scenes): `scene_id` / `local_start_s` / `effects` / `rule_paths` / `assetCandidates` / `estimatedDuration_s` / `voicePath` / `design_chunks` (absolute paths to the whole component library — the worker chooses by visual judgment) / `creative_brief`. A continue run of 2-3 scenes writes one `group_wN.html` with true shared DOM across the segments.

`assetCandidates` is `[]` for most or all scenes — the worker invents the visual from `creative_brief` + design chunks (code-window for diffs, before/after, +/- counters); there are no captured assets to place. `design_chunks: null` (chunks missing) → worker falls back to reading `./design-system/design.html` fully; should not happen in the normal path.

After all workers + captions return, run preflight (scans `group_spec.visual_clips[]`; does NOT check `captions.html`):

```bash
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/check-compositions.mjs \
  --hyperframes . \
  --group-spec ./group_spec.json)
```

- exit 0 -> all compositions pass, continue to Step 7.
- exit 1 -> stderr names the violating scene + rule category; return to Step 6 and re-dispatch the affected worker (do not Edit in the master — fix upstream).

### Step 7 - Assembly prelude + preflight gate + finalize — SHARED

After Step 6 exits 0: a deterministic Bash prelude (wait-bgm + assemble + inject/verify-transitions + **hoist-videos** + sfx-verify + preflight), then one **finalize subagent** that fixes the brief's findings in place, takes ONE lean contact-sheet look, and renders. Principle: deterministic prelude is all Bash; findings go to finalize (not back to workers); worker re-dispatch is reserved for recomposition. `compositions/scene_N.html` / `group_wN.html` are worker source files; editing them edits the source.

**(1) BGM wait + assembly (Bash):**

```bash
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/wait-bgm.mjs \
  --audio-meta ./audio_meta.json \
  --hyperframes . \
  --timeout-ms 120000 \
  --interval-ms 2000)
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/assemble-index.mjs --group-spec ./group_spec.json --hyperframes .)
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/transitions.mjs inject --group-spec ./group_spec.json --hyperframes .)
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/transitions.mjs verify --group-spec ./group_spec.json --index ./index.html)
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/hoist-videos.mjs --group-spec ./group_spec.json --hyperframes .)
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/verify-output.mjs sfx --group-spec ./group_spec.json --index ./index.html)
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/verify-output.mjs audio --hyperframes . --group-spec ./group_spec.json --index ./index.html)
```

`inject` only changes the `index.html` shell `data-start`/`data-duration`/`data-track-index`, never visual roots. **`hoist-videos` reads each scene's poster `data-video-src` declarations, measures the poster's rendered rect headless, and mounts the real `<video class="clip">` at the index.html host root with global timing clamped clear of transitions** — the ONLY legal way footage plays, since the runtime never decodes a `<video>` nested in a scene. Internal logic: header of each script.

- assemble exit 1 -> names a visual composition (root `data-duration` != group_spec, or file missing) = worker contract break → return to Step 6, re-dispatch that worker, rerun this step.
- inject/verify-transitions exit 1 -> injector bug (prep already validated `transitions[]`) → report, don't roll back workers.
- hoist-videos exit 1 -> a `data-video-src` declaration is invalid (missing file / bad numbers / window too small after transition clamping / poster not measurable) — stderr names the scene + declaration; `Edit` the visual source file (or re-dispatch its worker for a real relayout), then rerun this step. exit 2 -> browser unavailable; run `node <SKILL_DIR>/scripts/check-overlap.mjs --ensure-deps` from the workspace root, then rerun. exit 0 prints one line per hoisted video (src, global window, track, rect).
- sfx-verify exit 1 -> assembler bug → report.
- verify-output **audio** exit 1 -> a voice wav / `bgm.wav` / `captions.html` exists on disk but was NOT wired into `index.html` (the silent / caption-less render class). This is an upstream wiring bug — almost always empty `group_spec` voicePaths because prep ran without `--audio-meta`. **Do NOT render.** Re-run Step 5 prep with `--audio-meta ./audio_meta.json`, then re-run this Step 7(1) chain. `⚠`-prefixed lines (BGM / captions intended but never produced on disk) are non-blocking generation gaps — render proceeds.

**(2) Preflight gate (Bash):**

```bash
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/preflight-finalize.mjs --group-spec ./group_spec.json --hyperframes .)
```

preflight does everything the agent does not need to judge and writes it all into `finalize_brief.json`: warms a pinned `npx hyperframes@<version>` cache, runs lint/validate/inspect with that version (**inspect runs STRICT — no `--tolerance` flag, CLI default**; by-design transient overflow from 3D morph / tilt / zoom peaks is declared per-element with `data-layout-allow-overflow`, never absorbed numerically — any re-run of inspect elsewhere must also be plain or verdicts disagree) and captures tails + summary counts, computes the snapshot timeline, runs **`check-overlap.mjs`** (the single-rule rendered overlap gate: every scene loaded headless, timeline seeked to 0.4/0.7/0.92 of duration, all non-background paint atoms flattened onto one plane with z-index ignored, pairwise-intersected; persistent overlap = a finding finalize must fix; `status: unavailable` blocks at exit 2 — the gate never soft-skips), and when `captions_enabled` runs `captions.mjs keepout` static check for "foreground lower edge y <= 900" (the bbox math folds in CSS transforms AND `margin-top`/`margin-bottom`, so negative-margin-centered cards are measured at their real bbox). **Keep-out violations include ready-to-apply Edit strings** (`edit_old`/`edit_new`) and **overlap violations carry both selectors + both rects + the overlap rect** — finalize consumes both directly and fixes them in place. Brief fields (`preflight_clean` / `gates_clean` / `gates.*` / `bgm.*` / `overlap.*` / `caption_keepout.*` / `anomalies[]` / `snapshot_times_s[]` / `npx_prefix` / `scenes[]` / `internal_seams[]`) and algorithm details are documented at the top of `preflight-finalize.mjs`. Only contrast and cramped-container remain eye-owned (finalize's one contact-sheet scan); collision / panel-bleed are machine-owned by the overlap gate.

- **exit 0** -> dispatch finalize — **clean or not**. Findings (gate errors / `overlap.violations[]` / `caption_keepout.violations[]`) ride in the brief and finalize fixes them in place as its first work step. Do NOT diagnose them yourself, do NOT hand-Edit scene files, do NOT re-dispatch workers for them.
- **exit 2** -> ONLY when the overlap gate could not run (`overlap.status: "unavailable"` — puppeteer-core / Chrome missing). Environment problem with a deterministic remedy: run `node <SKILL_DIR>/scripts/check-overlap.mjs --ensure-deps` from the workspace root (and `npx hyperframes doctor` if it names Chrome), then rerun preflight — do not proceed unmeasured.
- **exit 1** -> preflight itself crashed (bad invocation / missing group_spec) → fix the invocation.

**Worker re-dispatch (Repair Mode) is the EXCEPTION path now, not a preflight branch:** it triggers only when **finalize STOPs** because a scene needs recomposition (content fundamentally wrong / real relayout / animation broken beyond a couple of edits). Then: re-dispatch that scene's **owning worker** (a continue worker owns its whole `group_wN.html` and repairs all its logical scenes together) with the full `agents/hyperframes-scene.md` + the normal dispatch context + a `## Repair context` block containing: (a) finalize's **verbatim** findings for that worker's scene(s) (never paraphrase measurements), (b) `npx_prefix` copied from `finalize_brief.json`, (c) `Inspect at: <t1,t2,t3>` = that scene's `midpoint_s` + `high_risk_extras_s` (or `start_s + 0.5/0.75/0.9 × duration`) from `brief.scenes[]`, (d) `Captions: enabled|disabled`. Per the contract's Repair Mode section, each worker **Edits in place and self-verifies (scoped plain `inspect --at` + `check-overlap.mjs --scene` + keepout) before returning** — so you (master) do NOT hand-Edit scene files and do NOT re-run the full preflight after each individual fix. When ALL repair workers have returned green, rerun (1)+(2) once and re-dispatch finalize. If the same finding survives two full repair rounds, STOP and surface it to the user instead of looping.

Scan `anomalies[]` even on exit 0 (loud non-blocking warnings surfaced by preflight; currently rare — read each entry's `message` and decide whether it changes the dispatch).

**(3) Dispatch finalize subagent (fix brief findings in place -> ONE lean contact-sheet look -> render)**. prompt = full contents of `agents/hyperframes-finalize.md` + `## Dispatch context`:

```
SKILL_DIR: <absolute path>
PROJECT_DIR: <video project root>
Render quality: high     # Or draft / standard
Finalize brief: <PROJECT_DIR>/finalize_brief.json   # Preflight has already written it; agent reads once for findings + npx_prefix + scene timings
Film direction: |        # = group_spec.film_direction (film-level invariants the briefs assume)
  <verbatim>
Visual clips:            # One line per group_spec.visual_clips[] entry
  - { id, file, kind, worker_id, scene_ids, start_s, duration_s }
Scenes:                  # One line per logical scene, copied verbatim from group_spec.json
  - { scene_id, start_s, estimatedDuration_s, effects: [...], creative_brief: |
      <Phase 3 prose for this scene> }
```

`index.html` is already assembled (transitions injected, videos hoisted); all gates have already run. Finalize's flow: **fix every brief finding in place first** (gate `output_tail` -> Edit + rerun only that gate; `overlap.violations[]` -> Edit per the given selectors/rects + scoped `check-overlap --scene` verify; `caption_keepout.violations[]` -> apply `edit_old`/`edit_new` mechanically), then **ONE snapshot call at scene midpoints + group-internal continue-seam mids, one read of the contact sheet** (looking only for blank/black panels, cut or unreadable text, crushed interiors, seam jank — escalate single frames only on suspicion), then **render + verify-render**. No per-frame QA walkthrough. **Finalize must never change a visual root `data-duration`** (= `visual_clips[].duration_s`, fixed upstream; changing it makes assemble fatal — timing is only fixable by returning to Step 6).

- finalize reports the mp4 (verify-render passed) + gate/snapshot status + files repaired in place -> complete.
- finalize STOP (only when a scene needs full recomposition) -> return to Step 6, re-dispatch that worker, rerun (1)+(2), re-dispatch finalize.

### Completion report

Summarize per phase: PR (repo / #N / title), preset (always `claude`), PR archetype, scene count / total duration, worker grouping, transitions, gate status (lint / validate / inspect (strict) / overlap), hoisted videos (count + tracks), findings fixed in place, lean pass (tiles scanned, escalations), visual files repaired in place, final mp4 path + bytes + duration.

**Offer a live preview — never auto-open one.** The deliverable is the mp4 above. A browser preview is optional and **must not be started until the user asks for it**. Do NOT run `hyperframes preview` / `play` during any earlier phase: a preview opened mid-run shows half-edited compositions and dies when that phase's own snapshot/render server is torn down. When the user asks, start a long-lived dev server **after** the render (it serves the final on-disk files and stays up until stopped), then report the actual URL with the real port + project name:

```bash
(cd "$PROJECT_DIR" && npx hyperframes preview)   # Studio UI, e.g. http://localhost:3002/#project/<project-name>
# or a lightweight shareable player link instead:
(cd "$PROJECT_DIR" && npx hyperframes play)       # plain http://localhost:<port>
```

Flags (custom port, external browser) live in the `hyperframes-cli` skill (`references/preview-render.md`).

---

## Resume table

Read `$PROJECT_DIR/context.log` and resume from:

| State                                                                                            | Continue from                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| log missing or empty                                                                             | Full pipeline                                                                                                                                                         |
| `capture/pr.json` **or** `capture/extracted/visible-text.txt` missing                            | Step 1 (ingest)                                                                                                                                                       |
| ingest done, `design-system/inference.json` **or** `chunks/index.json` missing                   | Step 1b (three deterministic commands)                                                                                                                                |
| `chunks/index.json` exists, `narrator_scripts.json` missing                                      | Step 2 (story-design). If the user supplied a final `narrator_scripts.json`, place it in `$PROJECT_DIR/` to skip this state                                           |
| `narrator_scripts.json` exists, `audio_meta.json` missing                                        | Step 3 (audio)                                                                                                                                                        |
| `audio_meta.json` exists, `section_plan.md` missing                                              | Step 4 (visual-design)                                                                                                                                                |
| `section_plan.md` exists, `group_spec.json` missing                                              | Step 5 (prep)                                                                                                                                                         |
| `group_spec.json` exists, any `visual_clips[].file` missing **or** `caption_groups.json` missing | Step 5.5+6 (run `captions.mjs group` -> `html`, then dispatch workers for missing clips). Captions-ran criterion = `caption_groups.json` exists (NOT `captions.html`) |
| all `visual_clips[].file` exist + captions decided, `renders/video.mp4` missing                  | Step 7 (rerun assemble + sfx-verify + preflight, overwriting `finalize_brief.json` / `index.html`, then dispatch finalize)                                            |
| `renders/video.mp4` exists                                                                       | Report completed and stop                                                                                                                                             |

## Directory shape

```text
./                            # workspace root
├── .claude/skills/
├── node_modules/  package.json
└── videos/<project-name>/    # PROJECT_DIR - HyperFrames project root
    ├── hyperframes.json  context.log
    ├── capture/              # synthetic package (NOT a scrape) — kept for backend layout compatibility
    │   ├── pr.json           # gh pr view --json (now incl. reviews / comments / assignees / reviewDecision)
    │   ├── diff.patch        # gh pr diff (the full change; story-design pulls hunks from here)
    │   ├── extracted/        # tokens.json (synthetic) + visible-text.txt (brief) + people.json (contributors)
    │   └── assets/           # empty (faceless)
    ├── design-system/        # build-design outputs: inference.json / design.html / chunks/ / fonts/
    ├── narrator_scripts.json  audio_meta.json  section_plan.md  group_spec.json
    ├── public/  assets/  compositions/  snapshots/   # public/avatars/<login>.png — contributor avatars
    └── renders/video.mp4
```

## Routing note (for the hyperframes router)

- **Input:** a **GitHub PR** — a code change (PR URL, `owner/repo#N`, or "this PR"). A URL, but **a `github.com/.../pull/N` link, not a product/marketing website**.
- **Output:** code-change explainer, up to ~3 min (sweet spot ~30-90s); 5 min+ exhaustive deep-dives → `/general-video`.
- **Triggers:** "make a video about this PR", "turn PR #1187 into a changelog video", "explain what this pull request does as a video", "release-notes video from github.com/org/repo/pull/123", "turn this PR into a video".
- **Do NOT use for:** a product/marketing website URL (-> `/product-launch-video`) or a general website to turn into a video (-> `/website-to-video`); a topic/article/text with no PR (-> `/faceless-explainer`); adding captions to an existing video (-> `/embedded-captions`); a whole-repo tour or multi-PR release (no workflow yet -> `/general-video`).
