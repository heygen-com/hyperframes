---
name: faceless-explainer
description: faceless-explainer video workflow - arbitrary text (article / notes / topic / brief) -> narrator_scripts.json + audio (voice + BGM) + section_plan.md -> typography / abstract-graphics / diagram / data-viz video. Typical length up to ~3 min (sweet spot ~30-90s); a genuinely longer piece is general-video, not this workflow. Generates its OWN narration (TTS) — it does not sync to a user-supplied / pre-recorded voiceover (that is general-video). No website capture, no real product screenshots. If the text names a product / its site to promote, that is /product-launch-video; when product-vs-topic is unclear, start at /hyperframes.
metadata: { "tags": "orchestrator, pipeline, faceless-explainer, text-to-video" }
---

# faceless-explainer - dispatch entry

Input is **arbitrary text** (article / notes / topic / brief). Output is a **faceless explainer** video: no captured website, no product screenshots — every visual is invented by the LLM (typography / abstract graphics / diagram / data-viz), chosen per scene by content. The style preset is **auto-selected per input** by the scriptwriting agent (Step 2) from the 5 shipped presets (`block-frame` / `capsule` / `claude` / `pin-and-paper` / `scatterbrain`; default `pin-and-paper` when nothing clearly fits).

> **Confirm the route before Step 0.** This skill explains a **topic / concept** with **no product and no site to capture**. If the text actually **markets a product / names its site** → `/product-launch-video`; there's a **URL to turn into a video** → `/website-to-video`; a **GitHub PR** → `/pr-to-video`; **existing footage** to caption / package → `/embedded-captions` · `/graphic-overlays`. **Out of scope**: timing visuals to a **user-supplied / pre-recorded voiceover** (faceless generates its own TTS → `/general-video`), or live / at-render-time data. Unsure product-vs-topic, or routed here on a vague request? **Read `/hyperframes` first.**

All artifacts go to `PROJECT_DIR = videos/<project-name>/` (created in Step 0); all paths below are relative to it. Dispatch is harness-portable: before the first subagent dispatch, read `<SKILL_DIR>/../hyperframes-core/references/subagent-dispatch.md` once — it maps the dispatch verbs (parallel fan-out / background / wait) to your harness's primitives; a concurrency cap below N means waves of the cap size, never fewer workers. **This file is a binding runbook, not background reading**: execute the steps in order and produce every phase artifact with its designated script or agent role — do not substitute a freestyle pipeline, and do not skip a pause step because the request seems clear. A step you cannot perform → stop and report.

| Phase                    | Execution                                                                                                                                                                                        | Primary artifact                                                     | Detailed flow                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------- |
| init                     | Bash                                                                                                                                                                                             | `hyperframes.json`                                                   | Step 0                                    |
| scaffold                 | Bash (no agent)                                                                                                                                                                                  | `capture/extracted/tokens.json` + `visible-text.txt`                 | Step 1                                    |
| scriptwriting            | subagent                                                                                                                                                                                         | `narrator_scripts.json` (incl. chosen `stylePreset` + `orientation`) | Step 2 / `agents/scriptwriting.md`        |
| design-system            | Bash (no agent, deterministic — style = `narrator_scripts.stylePreset`)                                                                                                                          | `design-system/design.html` + `chunks/`                              | Step 2b                                   |
| audio                    | `audio.mjs` in Bash                                                                                                                                                                              | `audio_meta.json`                                                    | `phases/audio/guide.md`                   |
| visual-design            | subagent                                                                                                                                                                                         | `section_plan.md`                                                    | `agents/visual-design.md`                 |
| prep                     | `prep.mjs` in Bash                                                                                                                                                                               | `group_spec.json`                                                    | `scripts/prep.mjs`                        |
| captions (deterministic) | `captions.mjs group` -> `captions.mjs html` in Bash (no subagent)                                                                                                                                | `caption_groups.json` + `compositions/captions.html`                 | `scripts/captions.mjs`                    |
| scenes                   | N x subagent (parallel)                                                                                                                                                                          | `compositions/scene_*.html` or `compositions/group_w*.html`          | `agents/hyperframes-scene.md`             |
| finalize (Phase 4c)      | Bash prelude (wait-bgm + assemble + inject/verify-transitions + hoist-videos + sfx-verify + preflight) -> finalize subagent (fix brief findings in place + one lean contact-sheet look + render) | `renders/video.mp4`                                                  | Step 7 / `agents/hyperframes-finalize.md` |

## Prerequisites

macOS Apple Silicon or Linux x64. System tools: `brew install python@3.11 node ffmpeg` (use Homebrew Python, **not** `/usr/bin/python3`, or `pip install` is blocked by PEP 668); then `npx hyperframes doctor` once (downloads Chrome). The rendered overlap gate (`scripts/check-overlap.mjs`, run in worker self-checks and preflight) reuses that same cached Chrome — it never downloads a browser; its only dep is the `puppeteer-core` npm module, ensured once before scene fan-out (Step 5.5, `--ensure-deps`, ~5s, no full `puppeteer` install). Optional cloud keys (else local fallbacks) — inject in Step 0.5:

| Key                                            | Used for                                    | Default / fallback                                             |
| ---------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------- |
| `HEYGEN_API_KEY` (or `hyperframes auth login`) | TTS (cloud, word-level timestamps)          | voice: auto (first English starfish voice; override `--voice`) |
| `ELEVENLABS_API_KEY`                           | TTS (cloud; needs `pip install elevenlabs`) | voice `21m00Tcm4TlvDq8ikWAM` (Rachel)                          |
| neither, and not logged in                     | TTS                                         | local Kokoro, voice `am_michael` (non-English: pass `--voice`) |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` (aliases)  | Lyria BGM                                   | unset -> local MusicGen (first run downloads ~300 MB)          |

## Flow

### Step 0.0 - Confirm the brief (ALWAYS ask one round, then build)

Before Step 0, **always pause and ask the brief in one message, then wait for the user — never skip this, even for a request that looks complete.** Lead with a recommended default for each field and pre-fill anything the user already gave (confirm it rather than re-asking blindly): the **topic / angle** (the one idea), **length** (default ~60-90s), and — if `/hyperframes` did not already set them — **aspect** (default 16:9; 9:16 for vertical) and **language**. Style is **not** asked here — the scriptwriting agent auto-picks the preset from the input in Step 2. Proceed to Step 0 only after the user replies; a "go" / "use the defaults" is a valid reply that accepts every default.

### Step 0 - Initialize the video project

cwd is the agent workspace root (e.g. `/tmp/explainer-video-...`). Write all video artifacts under `PROJECT_DIR = videos/<project-name>/`.

`<project-name>`: use the directory the user gave (e.g. `Use ./videos/refactoring-explainer`), else a short kebab-case name derived from the input topic (`<topic>-explainer` / `<topic>-howto`). **Not** the workspace basename or a timestamp.

Only when `$PROJECT_DIR/hyperframes.json` is absent:

```bash
PROJECT_DIR="${LAUNCH_VIDEO_DIR:-videos/<project-name>}"
mkdir -p "$(dirname "$PROJECT_DIR")"
npx hyperframes init "$PROJECT_DIR" --non-interactive --skip-skills --example=blank
```

> `hyperframes init` drops a generic `AGENTS.md` / `CLAUDE.md` into `$PROJECT_DIR`; **leave them in place** — they are agent scaffolding for whoever opens the finished project later. This skill (not those files) is the source of truth for the workflow, so do not treat their generic guidance as run-time constraints.

**Constraints:** never run `hyperframes init` / generate `AGENTS.md` / `CLAUDE.md` in the workspace root; never nest another `hyperframes/` inside `PROJECT_DIR`; every Bash command (master + subagents) is a `(cd "$PROJECT_DIR" && ...)` subshell — never bare `cd`.

### Step 0.5 - API key guidance

Skip if `$PROJECT_DIR/.env` exists or `context.log` is non-empty (= not the first run). Otherwise **first detect what's available** (HeyGen TTS on if `$HEYGEN_API_KEY` / `$HYPERFRAMES_API_KEY` set or `~/.heygen/credentials` exists from `hyperframes auth login`; ElevenLabs / Gemini only if their env keys set), then **always pause and offer the menu — wait for the user; do not proceed on your own even when a workable config is detected** (the user may want to add a key like Gemini). State what's detected, then: paste keys (→ Write `$PROJECT_DIR/.env`, one `KEY=value` per line, overwrite same-name) / "go" (proceed with what's configured — env, `.env`, or `hyperframes auth login`) / "skip" (proceed with local fallbacks for anything unconfigured). Then proceed to Step 1.

### Step 1 - Scaffold (Bash, NO agent, NO capture)

There is no website capture. Synthesize the minimal on-disk package the copied backend (`build-design --capture`, `prep --capture`) expects, directly from the user's text. `capture/` holds synthetic tokens + the input text (NOT a scrape); `capture/assets/` stays empty (faceless). With `colors:[]`, build-design uses the pin-and-paper native palette; if the user supplied brand colors, fill `colors[]` (`colors[0]` becomes the brand primary).

```bash
(cd "$PROJECT_DIR" && mkdir -p capture/extracted capture/assets)
(cd "$PROJECT_DIR" && cat > capture/extracted/tokens.json <<'JSON'
{ "title": "<title>", "description": "<one-line>", "colors": [], "fonts": [], "headings": [], "sections": [], "ctas": [], "svgs": [], "cssVariables": {} }
JSON
)
(cd "$PROJECT_DIR" && printf '%s\n' "<full input text / article / notes / brief>" > capture/extracted/visible-text.txt)
```

Validation:

```bash
[ -s "$PROJECT_DIR/capture/extracted/tokens.json" ] && \
[ -s "$PROJECT_DIR/capture/extracted/visible-text.txt" ] && \
[ -d "$PROJECT_DIR/capture/assets" ] && echo ok || echo missing
```

If any is missing, report and stop.

### Step 2 - Scriptwriting (subagent — also picks the style preset)

Dispatch one subagent. prompt = full contents of `agents/scriptwriting.md` + the `## Dispatch context` below, passed through verbatim:

```
SKILL_DIR: <absolute path>
PROJECT_DIR: <video project root>
Schema validator: <SKILL_DIR>/scripts/validate-narrator.mjs
Input text: ./capture/extracted/visible-text.txt   # The source article / notes / brief — the agent reads this first
Style preset: pick one from the menu in the guide and emit it as the top-level `stylePreset` (default `pin-and-paper` when unsure); match the narration register to the chosen preset
Orientation: <landscape | portrait | square>   # From the Step 0.0 aspect (16:9→landscape, 9:16→portrait, 1:1→square; default landscape). Emit it VERBATIM as the top-level `orientation` field — this is dictated, not a creative choice; it sets the canvas (portrait→1080×1920) for the whole pipeline.
Script style: Keep each scene's script concise — 1-2 sentences, no more than 20 words
```

> Fill the `Orientation:` line from the aspect confirmed in Step 0.0 (default `landscape`). prep reads `narrator_scripts.orientation` → stamps `group_spec.width/height`; without it the video stays 16:9.

The agent picks an explainer **structure** for `narrativeArchetype` (`concept-explainer` / `how-to-process` / `listicle` / `story-explainer`, or `"<outer> with <inner>"`), picks a top-level **`stylePreset`** from the 5 shipped presets (consumed by Step 2b), echoes the dispatched **`orientation`** as a top-level field (consumed by Step 5 prep → canvas size), and emits `narrator_scripts.json` (it runs the validator before returning). `continuity` drives worker grouping: `continue` = same worker as the previous scene (a run of **up to 3** scenes, cap=3); `break` = new worker; scene 1 is always `break`. `intent` / `sharedMotif` are soft hints. `assetCandidates` is `[]` on essentially every scene (faceless).

### Step 2b - Design system (Bash, NO agent, deterministic — style chosen by Step 2)

Read the agent's `stylePreset` from `narrator_scripts.json` (default `pin-and-paper` if absent), then run three deterministic commands to produce a fully-styled `design.html` + chunks against the synthetic input:

```bash
STYLE=$(cd "$PROJECT_DIR" && node -e 'try{const p=require("./narrator_scripts.json").stylePreset;process.stdout.write((p&&String(p).trim())||"pin-and-paper")}catch{process.stdout.write("pin-and-paper")}')
(cd "$PROJECT_DIR" && node <SKILL_DIR>/phases/design-system/scripts/build-design.mjs ./design-system --no-emit --style "$STYLE")
(cd "$PROJECT_DIR" && node <SKILL_DIR>/phases/design-system/scripts/build-design.mjs ./design-system --style "$STYLE")
(cd "$PROJECT_DIR" && node <SKILL_DIR>/phases/design-system/scripts/emit-chunks.mjs ./design-system)
```

`stylePreset` must be one of the 5 shipped presets (`block-frame` / `capsule` / `claude` / `pin-and-paper` / `scatterbrain`); an unknown name makes `build-design.mjs` exit 1 — fall back to `pin-and-paper` and rerun. This step depends only on `narrator_scripts.json`, so it may run in parallel with Step 3 audio; both must finish before Step 4 visual-design.

Validation:

```bash
[ -s "$PROJECT_DIR/design-system/inference.json" ] && \
[ -s "$PROJECT_DIR/design-system/design.html" ] && \
[ -s "$PROJECT_DIR/design-system/chunks/index.json" ] && echo ok || echo missing
```

If any is missing, read the build-design / emit-chunks stderr, fix the invocation, and rerun (deterministic, finishes in seconds).

### Step 3 - Audio

After `narrator_scripts.json` exists:

```bash
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/audio.mjs \
  --narrator-scripts ./narrator_scripts.json \
  --hyperframes . \
  --out ./audio_meta.json \
  --lyria-recipe <SKILL_DIR>/phases/audio/lyria-recipe.py)
```

BGM generation runs detached in the background when keys/deps allow, otherwise is silently skipped. Flags + BGM mechanics: top of `audio.mjs`.

- exit 0 -> voice + transcribe complete (BGM may still be rendering; `audio_meta.json` records `bgm_log` / `bgm_pid`), continue.
- exit 1 -> zero scenes produced voice; report and stop.

### Step 4 - Visual design

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
Canvas: <width>×<height>   # default 1920×1080 (16:9 landscape); 1080×1920 (9:16 portrait) or 1080×1080 (1:1 square) if requested upstream (narrator_scripts.orientation/dimensions). Plan layouts for THIS aspect ratio — see composition.md "Portrait & square".
Captions: <enabled | disabled>   # Planning hint from the node -e above: enabled => leave the bottom ~17% of canvas height as caption territory in prose
Dispatch packet: <PROJECT_DIR>/.dispatch/vd-dispatch.txt   # Step 0 reads it once for all inputs
Visuals: faceless — every scene is typography / abstract graphics / diagram / data-viz invented from the script. assetCandidates is [] for most or all scenes; plan visuals from text, not from captured assets.
```

Output is `section_plan.md`. `type-roles.md` and component HTML bodies are not in the packet (worker responsibilities). The `Captions:` line is an optimistic hint; the authoritative gate is `group_spec.captions_enabled` from Step 5.

### Step 5 - prep (deterministic script, NO subagent)

After `section_plan.md` exists:

```bash
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/prep.mjs \
  --section-plan ./section_plan.md \
  --narrator-scripts ./narrator_scripts.json \
  $( [ -f audio_meta.json ] && echo "--audio-meta ./audio_meta.json" ) \
  --rules-dir <SKILL_DIR>/../hyperframes-animation/rules \
  --capture ./capture \
  --design-system ./design-system \
  --hyperframes . \
  --sfx-lib <SKILL_DIR>/assets/sfx \
  --out ./group_spec.json)
```

Merges all upstream artifacts into `group_spec.json` (parse `section_plan` anchors, validate effect/component ids, group by `Continuity` with cap=3, build `visual_clips[]` where a multi-scene continue worker becomes one `group_wN.html`, compute Tier-B `transitions[]` between different visual clips, copy assets/fonts/SFX). `capture/assets/` is empty, so asset-copy is a no-op (faceless). Internal logic: header of `prep.mjs`.

- exit 0 -> read stdout (scenes / groups / total duration / per-group) and append to `context.log`.
- exit 1 -> stderr names the failing scene + anchor (usually a malformed anchor or unknown effect/transition id); return to Step 4 and re-dispatch visual-design.

### Step 5.5 + Step 6 - Captions (deterministic) + scene worker fan-out

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

exit 0 = normal. If either prints `captions: skipped (<reason>)`, skip the whole chain: no `captions.html`, assemble won't mount track 12. Skin selection / self-check: top of `captions.mjs html`; for offline, pass `--skin-file`. **Do not** run `npx hyperframes lint` on `captions.html`.

Then ensure the overlap-gate dep **once, from the workspace root** (NOT inside `PROJECT_DIR` — the module must land in the workspace `node_modules/` where every worker and preflight can resolve it):

```bash
node <SKILL_DIR>/scripts/check-overlap.mjs --ensure-deps
# Installs puppeteer-core (module only, no browser download) if not already resolvable; Chrome is
# reused from the hyperframes browser cache. Workers must NOT install it themselves (parallel npm race).
```

Then read `group_spec.json.groups[]` for worker count N. Each worker's self-check runs two scoped machine gates before returning — `captions.mjs keepout --scene` (when captions enabled) and `check-overlap.mjs --scene` (always) — so layout violations are fixed at the source instead of surfacing at preflight. Build the shared header once, then per-worker packets (`film direction` / `tokens` / `easings` / `voice` are identical for every worker):

```bash
# Same rule as Step 4: packets go in $PROJECT_DIR/.dispatch/, never a fixed /tmp path
# (a stale /tmp file from a previous project survives a failed write and silently
# poisons every worker with the wrong design system).
# `## Film direction` = the film-level invariants from group_spec.film_direction
# (palette system / motion defaults + budget / ambient system / negative list);
# each scene's creative_brief carries only scene-specific deltas on top of it.
mkdir -p "$PROJECT_DIR/.dispatch/scene-dispatch"
{
  echo "## Film direction"
  (cd "$PROJECT_DIR" && node -p 'JSON.parse(require("fs").readFileSync("group_spec.json","utf8")).film_direction || ""')
  echo "## Tokens/easings/voice"
  (cd "$PROJECT_DIR" && cat design-system/chunks/tokens.css design-system/chunks/easings.js design-system/chunks/voice.md 2>/dev/null)
} > "$PROJECT_DIR/.dispatch/scene-shared.txt"
# Guard BEFORE fan-out: the project's own brand token must be present; a contaminated
# packet here costs a full re-author round across every affected worker.
grep -q -- '--brand-primary' "$PROJECT_DIR/.dispatch/scene-shared.txt" || \
  { echo "FATAL: scene-shared.txt incomplete/stale — rebuild before dispatching workers"; }
# Then per worker: shared header + that worker's Scenes YAML -> $PROJECT_DIR/.dispatch/scene-dispatch/w<N>.txt
```

Start **N scene workers in parallel** (concurrent background dispatches; a harness concurrency cap below N means waves of the cap size until every worker has run — never fewer workers). prompt = full contents of `agents/hyperframes-scene.md` + `## Dispatch context`, verbatim. Top-level fields: `SKILL_DIR` / `PROJECT_DIR` / `Worker ID` / `Composition width` + `Composition height` (= `group_spec.width` / `group_spec.height`) / `Captions: <enabled|disabled>` (= `group_spec.captions_enabled`) / `Dispatch packet: <PROJECT_DIR>/.dispatch/scene-dispatch/w<N>.txt`, plus the shared header body (`## Film direction` + `## Tokens/easings/voice`) + a `Scenes:` list.

For the worker top-level context, copy from `group_spec.json.groups[i]`: `worker_id`, `composition_id`, `composition_file`, `duration_s`, `scene_ids`; and from the top of `group_spec.json`: `width`, `height` (the worker authors + self-checks the root at these dims — landscape 1920×1080 unless portrait/square was requested upstream). **When `Captions: enabled`, also pass `Caption band top y` = `height − round(height × 0.1667)` and `Foreground max y` = `Caption band top y − 20`** (landscape → 900 / 880; portrait → 1600 / 1580) — constraint #13 keep-out is computed from these, not hardcoded. Copy every field in the **`Scenes:` list verbatim from `group_spec.json.groups[i].scenes[<sid>]`** (only that worker's 1-3 logical scenes): `scene_id` / `local_start_s` / `effects` / `rule_paths` / `assetCandidates` / `estimatedDuration_s` / `voicePath` / `design_chunks` (absolute paths to the whole component library — the worker chooses by visual judgment) / `creative_brief`. A 2-3 scene worker writes one `group_wN.html` with true shared DOM across the segments.

`assetCandidates` is `[]` for most or all scenes — the worker invents the visual from `creative_brief` + design chunks; there are no captured assets to place. `design_chunks: null` (chunks missing) → worker falls back to reading `./design-system/design.html` fully; should not happen in the normal path.

After all workers + captions return, run preflight (scans `group_spec.visual_clips[]`; does NOT check `captions.html`):

```bash
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/check-compositions.mjs \
  --hyperframes . \
  --group-spec ./group_spec.json)
```

- exit 0 -> all compositions pass, continue to Step 7.
- exit 1 -> stderr names the violating scene + rule category; return to Step 6 and re-dispatch the affected worker (do not Edit in the master — fix upstream).

### Step 7 - Assembly prelude + preflight gate + finalize

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
```

`inject` only changes the `index.html` shell `data-start`/`data-duration`/`data-track-index`, never visual roots. **`hoist-videos` reads each composition's poster `data-video-src` declarations, measures the poster's rendered rect headless, and mounts the real `<video class="clip">` at the index.html host root with global timing clamped clear of transitions** — the ONLY legal way footage plays, since the runtime never decodes a `<video>` nested in a scene. Internal logic: header of each script.

- assemble exit 1 -> names a visual composition (root `data-duration` != group_spec, or file missing) = worker contract break → return to Step 6, re-dispatch that worker, rerun this step.
- inject/verify-transitions exit 1 -> injector bug (prep already validated `transitions[]`) → report, don't roll back workers.
- hoist-videos exit 1 -> a `data-video-src` declaration is invalid (missing file / bad numbers / window too small after transition clamping / poster not measurable) — stderr names the scene + declaration; `Edit` the visual source file (or re-dispatch its worker for a real relayout), then rerun this step. exit 2 -> browser unavailable; run `node <SKILL_DIR>/scripts/check-overlap.mjs --ensure-deps` from the workspace root, then rerun. exit 0 prints one line per hoisted video (src, global window, track, rect).
- sfx-verify exit 1 -> assembler bug → report.

**(2) Preflight gate (Bash):**

```bash
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/preflight-finalize.mjs --group-spec ./group_spec.json --hyperframes .)
```

preflight does everything the agent does not need to judge and writes it all into `finalize_brief.json`: warms a pinned `npx hyperframes@<version>` cache, runs lint/validate/inspect with that version (**inspect runs STRICT — no `--tolerance` flag, CLI default**; by-design transient overflow from 3D morph / tilt / zoom peaks is declared per-element with `data-layout-allow-overflow`, never absorbed numerically — any re-run of inspect elsewhere must also be plain or verdicts disagree) and captures tails + summary counts, computes the snapshot timeline, runs **`check-overlap.mjs`** (the single-rule rendered overlap gate: every scene loaded headless, timeline seeked to 0.4/0.7/0.92 of duration, all non-background paint atoms flattened onto one plane with z-index ignored, pairwise-intersected; persistent overlap = a finding finalize must fix; `status: unavailable` blocks at exit 2 — the gate never soft-skips), and when `captions_enabled` runs `captions.mjs keepout` static check for "foreground lower edge y <= 900" (the bbox math folds in CSS transforms AND `margin-top`/`margin-bottom`). **Keep-out violations include ready-to-apply Edit strings** (`edit_old`/`edit_new`) and **overlap violations carry both selectors + both rects + the overlap rect** — finalize consumes both directly and fixes them in place. Brief fields (`preflight_clean` / `gates_clean` / `gates.*` / `bgm.*` / `overlap.*` / `caption_keepout.*` / `anomalies[]` / `snapshot_times_s[]` / `npx_prefix` / `scenes[]` / `internal_seams[]`) and algorithm details are documented at the top of `preflight-finalize.mjs`. Only contrast and cramped-container remain eye-owned (finalize's one contact-sheet scan); collision / panel-bleed are machine-owned by the overlap gate.

**Exit codes (orchestrator must read them)**:

- **exit 0** -> dispatch finalize — **clean or not**. Findings (gate errors / `overlap.violations[]` / `caption_keepout.violations[]`) ride in the brief and finalize fixes them in place as its first work step. Do NOT diagnose them yourself, do NOT hand-Edit visual source files, do NOT re-dispatch workers for them.
- **exit 2** -> ONLY when the overlap gate could not run (`overlap.status: "unavailable"` — puppeteer-core / Chrome missing). Environment problem with a deterministic remedy: run `node <SKILL_DIR>/scripts/check-overlap.mjs --ensure-deps` from the workspace root (and `npx hyperframes doctor` if it names Chrome), then rerun preflight — do not proceed unmeasured.
- **exit 1** -> preflight itself crashed (bad invocation / missing group_spec) → fix the invocation.

**Worker re-dispatch (Repair Mode) is the EXCEPTION path now, not a preflight branch:** it triggers only when **finalize STOPs** because a scene needs recomposition (content fundamentally wrong / real relayout / animation broken beyond a couple of edits). Then: re-dispatch that scene's owning worker (a group worker owns every logical scene in its `group_wN.html` — dispatch it once with all its findings) with the full `agents/hyperframes-scene.md` + normal dispatch context + a `## Repair context` block carrying finalize's verbatim findings, `npx_prefix` from the brief, `Inspect at: <t1,t2,t3>` (that scene's `midpoint_s` + extras from `brief.scenes[]`), and `Captions: enabled|disabled`; the worker Edits in place and self-verifies (scoped plain `inspect --at` + `check-overlap.mjs --scene` + keepout) per the contract's Repair Mode section. After it returns, rerun (1)+(2) and re-dispatch finalize. If the same finding survives two rounds, STOP and surface it to the user.

Scan `anomalies[]` even on exit 0 (loud non-blocking warnings; currently rare — read each entry's `message` and decide whether it changes the dispatch).

**(3) Dispatch finalize subagent (fix brief findings in place -> ONE lean contact-sheet look -> render)**. prompt = full contents of `agents/hyperframes-finalize.md` + `## Dispatch context`:

```
SKILL_DIR: <absolute path>
PROJECT_DIR: <video project root>
Render quality: high     # Or draft / standard
Finalize brief: <PROJECT_DIR>/finalize_brief.json   # Preflight has already written it; agent reads once to get findings + npx_prefix + scene timings
Film direction: |        # = group_spec.film_direction (film-level invariants the briefs assume)
  <verbatim>
Visual clips:            # One line per group_spec.visual_clips[] entry
  - { id, file, kind, worker_id, scene_ids, start_s, duration_s }
Scenes:                  # One line per logical scene, copied verbatim from group_spec.json
  - { scene_id, start_s, estimatedDuration_s, effects: [...], creative_brief: |
      <Phase 3 prose for this scene> }
```

`index.html` is already assembled (transitions injected, videos hoisted); all gates have already run. Finalize's flow: **fix every brief finding in place first** (gate `output_tail` -> Edit + rerun only that gate; `overlap.violations[]` -> Edit per the given selectors/rects + scoped `check-overlap --scene` verify; `caption_keepout.violations[]` -> apply `edit_old`/`edit_new` mechanically), then **ONE snapshot call at scene midpoints + group-internal seam mids, one read of the contact sheet** (looking only for blank/black panels, cut or unreadable text, crushed interiors, broken internal seams — escalate single frames only on suspicion), then **render + verify-render**. No per-frame QA walkthrough. **Finalize must never change a visual root `data-duration`** (= `visual_clips[].duration_s`, fixed upstream; changing it makes assemble fatal — timing is only fixable by returning to Step 6).

- finalize reports the mp4 (verify-render passed) + gate status + findings fixed + lean-pass summary + files repaired in place -> complete.
- finalize STOP (only when a scene needs full recomposition) -> return to Step 6, re-dispatch that worker, rerun (1)+(2), re-dispatch finalize. This is an exception path, not the default.

### Completion report

Summarize per phase: input title / topic, preset (auto-picked by scriptwriting from the 5 shipped presets), explainer structure, scene count / total duration, worker grouping, transitions, gate status (lint / validate / inspect strict / overlap), hoisted videos (count + tracks), findings fixed in place, lean pass (tiles scanned, escalations), visual files repaired in place, final mp4 path + bytes + duration.

**Offer a live preview — never auto-open one.** The deliverable is the mp4 above. A browser preview is optional and **must not be started until the user asks for it**. Do NOT run `hyperframes preview` / `play` during any earlier phase: a preview opened mid-run shows half-edited compositions and dies when that phase's own snapshot/render server is torn down, which confuses more than it helps. End the report with a single offer line, e.g.:

> Optional: I can open a live preview so you can scrub frame-by-frame, change playback speed, or get a shareable link — say the word and I'll start it.

Only **after** the user asks, start a long-lived dev server (it serves the final on-disk files and stays up until stopped), then report the actual URL with the real port + project name:

```bash
(cd "$PROJECT_DIR" && npx hyperframes preview)   # Studio UI, e.g. http://localhost:3002/#project/<project-name>
# or a lightweight shareable player link instead:
(cd "$PROJECT_DIR" && npx hyperframes play)       # plain http://localhost:<port>
```

Flags (custom port, external browser) live in the `hyperframes-cli` skill (`references/preview-render.md`).

---

## Resume table

Read `$PROJECT_DIR/context.log` and resume from:

| State                                                                                            | Continue from                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| log missing or empty                                                                             | Full pipeline                                                                                                                                                                                           |
| `capture/extracted/tokens.json` **or** `visible-text.txt` missing                                | Step 1 (scaffold)                                                                                                                                                                                       |
| scaffold done, `narrator_scripts.json` missing                                                   | Step 2 (scriptwriting). If the user supplied a final `narrator_scripts.json`, place it in `$PROJECT_DIR/` to skip this state (add a top-level `stylePreset`, or Step 2b defaults to `pin-and-paper`)    |
| `narrator_scripts.json` exists, `design-system/chunks/index.json` missing                        | Step 2b (design-system; `--style` = `narrator_scripts.stylePreset`, default `pin-and-paper`)                                                                                                            |
| `narrator_scripts.json` exists, `audio_meta.json` missing                                        | Step 3 (audio)                                                                                                                                                                                          |
| `audio_meta.json` exists, `section_plan.md` missing                                              | Step 4 (visual-design)                                                                                                                                                                                  |
| `section_plan.md` exists, `group_spec.json` missing                                              | Step 5 (prep)                                                                                                                                                                                           |
| `group_spec.json` exists, any `visual_clips[].file` missing **or** `caption_groups.json` missing | Step 5.5+6 (run `captions.mjs group` -> `html`, then dispatch workers for missing clips). Captions-ran criterion = `caption_groups.json` exists (NOT `captions.html`, since a legal skip produces none) |
| all `visual_clips[].file` exist + captions decided, `renders/video.mp4` missing                  | Step 7 (rerun assemble + sfx-verify + preflight, overwriting `finalize_brief.json` / `index.html`, then dispatch finalize)                                                                              |
| `renders/video.mp4` exists                                                                       | Report completed and stop                                                                                                                                                                               |

## Directory shape

```text
./                            # workspace root
├── .claude/skills/
├── node_modules/  package.json
└── videos/<project-name>/    # PROJECT_DIR - HyperFrames project root
    ├── hyperframes.json  context.log
    ├── capture/              # synthetic package (NOT a scrape) — kept for backend layout compatibility
    │   ├── extracted/        # tokens.json (synthetic) + visible-text.txt (the input text)
    │   └── assets/           # empty (faceless)
    ├── design-system/        # build-design outputs: inference.json / design.html / chunks/ / fonts/
    ├── narrator_scripts.json  audio_meta.json  section_plan.md  group_spec.json
    ├── public/  assets/  compositions/  snapshots/
    └── renders/video.mp4
```
