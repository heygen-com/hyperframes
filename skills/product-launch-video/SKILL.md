---
name: product-launch-video
description: >
  Use when the user wants a product launch, SaaS promo, feature reveal,
  app/company/site marketing video, or a script/brief turned into a
  product-focused video. Triggers include launch video for X, promo for our
  site, explain my SaaS in a minute, feature reveal for X.com, and turn this
  script into a 60s promo. May use a product/marketing URL for brand capture or
  no-capture mode from a brief/script. Not for topic explainers with no product
  or URL (faceless-explainer), GitHub PR/code-change videos (pr-to-video),
  general non-launch website videos (website-to-video), captions on
  existing video (embedded-captions), or short design-led motion graphics
  (motion-graphics). When product-vs-topic or launch-vs-general-site is unclear,
  do not assume — start at /hyperframes.
metadata: { "tags": "orchestrator, pipeline, product-launch" }
---

# product-launch-video - dispatch entry

> **Confirm the route before Step 0.** This skill makes a video for a **product being marketed / launched / promoted**. If it's really a **general (non-launch) site → video** (site tour / showcase, not selling a product) → `/website-to-video`; a **topic / concept with no product** → `/faceless-explainer`; a **GitHub PR** → `/pr-to-video`; an **existing video to caption / package** → `/embedded-captions` · `/graphic-overlays`. **Out of scope** (decline, don't fake): live / at-render-time data (every value is baked in at author time), or footage / screenshots / an avatar that doesn't exist yet (HyperFrames can't record or capture). Routed here on a vague "make a video", or unsure product-vs-topic / launch-vs-general-site? **Read `/hyperframes` first.**

All artifacts are written to `PROJECT_DIR = videos/<project-name>/` (created in Step 0). Paths below are relative to `PROJECT_DIR`. You (the orchestrator) run the Bash steps and dispatch the subagents; per-phase details live in the linked guides/agents/scripts — do not expand them here. Dispatch is harness-portable: before the first subagent dispatch, read `<SKILL_DIR>/../hyperframes-core/references/subagent-dispatch.md` once — it maps the dispatch verbs (parallel fan-out / background / wait) to your harness's primitives; a concurrency cap below N means waves of the cap size, never fewer scenes. **This file is a binding runbook, not background reading**: execute the steps in order and produce every phase artifact with its designated script or agent role — do not substitute a freestyle pipeline (hand-written narration, ad-hoc TTS calls, one hand-authored composition), and do not skip a pause step because the request seems clear. A step you cannot perform → stop and report; improvising past it breaks every downstream contract.

| Phase         | Execution                                                                                  | Primary artifact                                     | Detailed flow                             |
| ------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------- |
| init          | Bash directly                                                                              | `hyperframes.json`                                   | Step 0 (this file)                        |
| capture       | Bash directly (`hyperframes capture`)                                                      | `capture/extracted/tokens.json`                      | `phases/capture/guide.md`                 |
| design-system | subagent                                                                                   | `design-system/design.html` + `chunks/`              | `agents/design-system.md`                 |
| story-design  | subagent                                                                                   | `narrator_scripts.json`                              | `agents/story-design.md`                  |
| audio         | Bash directly (`audio.mjs`)                                                                | `audio_meta.json`                                    | `phases/audio/guide.md`                   |
| visual-design | subagent                                                                                   | `section_plan.md`                                    | `agents/visual-design.md`                 |
| prep          | Bash directly (`prep.mjs`)                                                                 | `group_spec.json`                                    | `scripts/prep.mjs` header                 |
| captions      | Bash directly (`captions.mjs group` -> `html`)                                             | `caption_groups.json` + `compositions/captions.html` | `scripts/captions.mjs` header             |
| scenes        | N x subagent (parallel, one scene each)                                                    | `compositions/scene_*.html`                          | `agents/hyperframes-scene.md`             |
| finalize      | Bash prelude (wait-bgm + assemble + transitions + hoist + sfx-verify) -> finalize subagent | `renders/video.mp4`                                  | Step 7 / `agents/hyperframes-finalize.md` |

## Prerequisites (install before first run)

macOS Apple Silicon or Linux x64:

```bash
brew install python@3.11 node ffmpeg                   # On Linux, use the apt/dnf equivalent
npx hyperframes doctor                                  # One-time check that Chrome / dependencies are ready
```

- `python@3.11` — **Homebrew Python, not system `/usr/bin/python3`** (PEP 668 blocks `pip install` otherwise); used by the MusicGen fallback
- `node >= 18` + `ffmpeg` (`audio.mjs` uses `ffprobe`)
- Chrome downloads automatically on first `npx hyperframes capture`. `hoist-videos.mjs` (Step 7, runs only when a scene declares footage) reuses that cached Chrome; if it reports deps missing, run `node <SKILL_DIR>/scripts/hoist-videos.mjs --ensure-deps` once (~5s)

Optional API keys (unset -> local fallbacks; injection in Step 0.5; `GEMINI_API_KEY` ≡ `GOOGLE_API_KEY`):

| Key                                            | Used for                                       | Default voice / fallback                                                                      |
| ---------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `HEYGEN_API_KEY` (or `hyperframes auth login`) | TTS (cloud, with word-level timestamps)        | voice: auto (first English starfish voice; override `--voice`)                                |
| `ELEVENLABS_API_KEY`                           | TTS (cloud; requires `pip install elevenlabs`) | voice `21m00Tcm4TlvDq8ikWAM` (Rachel)                                                         |
| Neither, and not logged in                     | TTS                                            | local Kokoro, voice `am_michael` (for non-English, pass `--voice`)                            |
| `GEMINI_API_KEY` (one key for both uses)       | Capture vision caption + Lyria BGM             | unset -> captions use DOM context only; BGM uses local MusicGen (first run downloads ~300 MB) |

## Flow

### Step 0.0 - Confirm the brief (one round, then build)

Before Step 0, in **one** message confirm only what materially shapes the launch video and you can't infer — lead with a recommended default, skip anything the user already gave: the **angle / focus** (the product overall, a headline feature, an offer / CTA), **length** (default ~30-90s; up to ~3 min), and — if `/hyperframes` did not already set them — **aspect** (default 16:9; 9:16 for vertical / social) and **language**. The preset is derived from brand capture, not asked. For a fully specified request, skip this and build.

### Step 0 - Initialize the video project

cwd is the agent workspace root; all video artifacts go in `PROJECT_DIR = videos/<project-name>/`.

**Naming `<project-name>`**: an explicit user-given directory wins; otherwise choose a short kebab-case name like `<brand>-promo` (**never** the workspace basename or a timestamp). From a URL, derive it from the domain/page title; the name is fixed once `capture/` is written.

**Initialization** (only when `$PROJECT_DIR/hyperframes.json` does not exist):

```bash
PROJECT_DIR="${LAUNCH_VIDEO_DIR:-videos/<project-name>}"
mkdir -p "$(dirname "$PROJECT_DIR")"
npx hyperframes init "$PROJECT_DIR" --non-interactive --skip-skills --example=blank
```

> `hyperframes init` drops a generic `AGENTS.md` / `CLAUDE.md` into `$PROJECT_DIR`; leave them in place but do not treat their generic guidance as run-time constraints — this skill is the source of truth.

**Constraints** (each violation breaks later phases):

- Do not run `hyperframes init` (or generate `AGENTS.md` / `CLAUDE.md`) in the workspace root; do not create a `hyperframes/` subproject inside `PROJECT_DIR`.
- Every subagent dispatch context contains a `PROJECT_DIR: <path>` line; the subagent treats it as the project root.
- **cwd discipline (master too)**: every Bash command runs as a `(cd "$PROJECT_DIR" && ...)` subshell — never bare `cd "$PROJECT_DIR" && ...` (persistent cwd drift makes later relative paths wrong).

### Step 0.5 - API key guidance

**Skip when** `$PROJECT_DIR/.env` exists or `context.log` is non-empty. Otherwise detect what's configured (HeyGen TTS = `$HEYGEN_API_KEY` / `$HYPERFRAMES_API_KEY` / `~/.heygen/credentials`; ElevenLabs / Gemini = their env keys), then **always pause and ask — do not proceed on your own, even when a workable config is detected**:

> Detected: <summary>. Cloud keys are optional — without them, unconfigured providers fall back locally (TTS -> Kokoro unless HeyGen is configured; BGM -> MusicGen). Reply with:
>
> - paste keys -> I will write them to `$PROJECT_DIR/.env`
> - "go" -> proceed with what is configured now
> - "skip" -> proceed with local fallbacks for anything unconfigured

Pasted keys -> Write/Edit `$PROJECT_DIR/.env`, one `KEY=value` per line (overwrite same-name keys, do not judge values). "go" / "skip" -> Step 1.

### Step 1 - Capture (Phase 1)

1. Resolve `SKILL_DIR` and any explicit `TARGET_URL` from the prompt; ensure Step 0 ran.
2. Read `$PROJECT_DIR/context.log` if it exists and use the Resume table below to skip completed phases.
3. **Classify the input** (Step 1.0) to set `CAPTURE` and `VO_MODE`, then run the matching path. Both paths share the same downstream commands.

#### Step 1.0 - Classify the input (set CAPTURE + VO_MODE)

| Input shape                                          | What to do                                                                                                                                                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Explicit URL in the prompt**                       | `TARGET_URL` = that URL; `CAPTURE=yes`; no voice-over question (narration comes from the captured site). Path (A).                                                                                        |
| **User pasted / pointed at a script or brief**       | (1) Save the verbatim text to `$PROJECT_DIR/user_script.txt`. (2) **Ask the voice-over question once** (below) → set `VO_MODE`. (3) **Resolve a capture target from the script** (below) → set `CAPTURE`. |
| **A topic / brief with no script prose, no product** | `CAPTURE=no`; no voice-over question. Path (B).                                                                                                                                                           |

**Voice-over question** (only when the user supplied actual script prose) — ask one short line and wait:

> Should I use your script **verbatim** as the voice-over, or **restructure** it into more screen-ready scene narration?
>
> - Verbatim — keep the original wording; I only split scenes and pair visuals. Duration follows the script.
> - Restructure — treat it as a brief and rewrite tighter narration, 1-2 sentences per scene.

`VO_MODE = verbatim | restructure` (default `restructure`); threaded to story-design in Step 2.

**Resolve a capture target from the script** — default to finding and crawling a site (real brand tokens beat preset fallbacks); skip only when the user opted out ("no web / text-only / no capture"). In order: (1) explicit `http(s)://` URL in the script → use it, announce, `CAPTURE=yes`; (2) clear brand/product name → `WebSearch` for the official site, **confirm the resolved URL with the user in one line** before crawling (decline / nothing credible → `CAPTURE=no`); (3) nothing derivable → `CAPTURE=no`.

> **Capture + user script coexist**: the crawl supplies only brand tokens + assets + visual register; the narration spine stays `user_script.txt` (honored via `VO_MODE`), never the site's own copy.

**(A) Capture path (`CAPTURE=yes`)**:

```bash
(cd "$PROJECT_DIR" && npx hyperframes capture "<TARGET_URL>" -o ./capture)
```

**(B) No-capture path (`CAPTURE=no`)** — synthesize a minimal capture package; downstream is identical. **You (master) choose the preset** (no site to infer from; pick from the 19 presets per user intent, or ask one short question). The full script/brief goes into `visible-text.txt`; `colors:[]` triggers the preset-palette fallback (fill `colors` only if the user named brand colors):

```bash
(cd "$PROJECT_DIR" && mkdir -p capture/extracted capture/assets)
(cd "$PROJECT_DIR" && cat > capture/extracted/tokens.json <<'JSON'
{ "title": "<brand/title>", "description": "<one-line>", "colors": [], "fonts": [], "headings": [], "sections": [], "ctas": [], "svgs": [], "cssVariables": {} }
JSON
)
(cd "$PROJECT_DIR" && echo '{}' > capture/extracted/design-styles.json)
(cd "$PROJECT_DIR" && printf '%s\n' "<full user script / brief>" > capture/extracted/visible-text.txt)
```

> If the user already has a final `narrator_scripts.json`, place it in `$PROJECT_DIR/`; the Resume table skips story-design.

**Shared downstream for both paths** (Path B appends `--style <chosen-preset>` to build-design; Path A omits it for auto-inference):

```bash
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/derive-context-pack.mjs --capture ./capture)
(cd "$PROJECT_DIR" && node <SKILL_DIR>/phases/design-system/scripts/build-design.mjs ./design-system --no-emit)   # Path B: append --style <chosen-preset>
```

Validation (stop and report if anything is missing; if `capture/BLOCKED.md` exists, the site blocked the crawl — follow the instructions inside it):

```bash
[ -s "$PROJECT_DIR/capture/extracted/tokens.json" ] && \
[ -s "$PROJECT_DIR/capture/extracted/design-styles.json" ] && \
[ -s "$PROJECT_DIR/capture/context_pack.md" ] && \
[ -s "$PROJECT_DIR/design-system/inference.json" ] && \
[ -d "$PROJECT_DIR/capture/assets" ] && echo ok || echo missing
```

### Step 1b + Step 2 - design-system ∥ story-design (parallel fork)

Both subagents depend only on Step 1 artifacts and do not read each other's output — after capture validates, start them **in parallel** (two concurrent background dispatches, per the dispatch adapter); do not serialize:

- **design-system**: prompt = full `agents/design-system.md` + `## Dispatch context` with `SKILL_DIR` / `PROJECT_DIR` / `Target URL` + the full text of `design-system/inference.json` inlined via `cat` (~2-4 KB, saves the subagent one Read).
- **story-design**: prompt = full `agents/story-design.md` + `## Dispatch context`:

  ```
  SKILL_DIR: <absolute path>
  PROJECT_DIR: <video project root>
  Schema validator: <SKILL_DIR>/scripts/validate-narrator.mjs
  Design DNA: ./design-system/inference.json   # read site_dna once to set the narrative register
  Provided script: ./user_script.txt   # ONLY when the user supplied a script; omit the line otherwise
  Voice-over mode: <verbatim | restructure>   # pair with Provided script; omit otherwise
  Script style: Keep each scene's script concise - 1-2 sentences, no more than 20 words   # suspended in verbatim mode (length follows the script)
  Orientation: <landscape | portrait | square>   # from the user's aspect (16:9→landscape, 9:16→portrait, 1:1→square; default landscape). Echoed verbatim into narrator_scripts.orientation → sets the canvas for the whole pipeline
  ```

### Step 3 - Audio (Phase 2.5)

After story-design returns (`narrator_scripts.json` exists) — audio does not wait for design-system:

```bash
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/audio.mjs \
  --narrator-scripts ./narrator_scripts.json \
  --hyperframes . \
  --out ./audio_meta.json \
  --lyria-recipe <SKILL_DIR>/phases/audio/lyria-recipe.py)
```

BGM runs detached in the background when available (`$GOOGLE_API_KEY` → Lyria cloud; else installed `transformers torch soundfile numpy` → local MusicGen, first run ~300 MB) and is silently skipped otherwise; all flags (`--voice` / `--provider` / `--no-bgm` / ...) are documented at the top of `audio.mjs`.

- exit 0 -> voice + transcribe complete (BGM may still be running; `audio_meta.json` records `bgm_log` / `bgm_pid`), continue.
- exit 1 -> zero scenes produced voice; report and stop.

### Step 4 - Visual design (Phase 3)

**Join point**: `design-system/chunks/index.json` + `narrator_scripts.json` + `audio_meta.json` all exist. Build one dispatch packet (the subagent reads it once, zero extra Reads):

```bash
# Dispatch packets live in $PROJECT_DIR/.dispatch/ (transient; safe to delete after the run).
# NEVER use a fixed /tmp path: it persists across runs/projects, so a failed write silently
# reuses another project's stale packet and contaminates every worker.
mkdir -p "$PROJECT_DIR/.dispatch"
DP="$PROJECT_DIR/.dispatch/vd-dispatch.txt"
{
  # Section order is deliberate: contracts first, static references middle, work items last
  echo "## Design chunks"
  (cd "$PROJECT_DIR" && cat design-system/chunks/index.json \
    design-system/chunks/composition-hints.md design-system/chunks/voice.md \
    design-system/chunks/tokens.css design-system/chunks/easings.js 2>/dev/null)
  echo "## Effects catalog";  cat <SKILL_DIR>/phases/visual-design/effects-catalog.md
  echo "## Blueprints index"; cat <SKILL_DIR>/phases/visual-design/blueprints-index.md
  echo "## Design rules";     cat <SKILL_DIR>/phases/visual-design/rules/{typography,color-system,composition,motion-language}.md
  echo "## SFX library";      cat <SKILL_DIR>/assets/sfx/manifest.json
  echo "## Narrator scripts"; (cd "$PROJECT_DIR" && cat narrator_scripts.json)
  echo "## Audio meta";       (cd "$PROJECT_DIR" && cat audio_meta.json 2>/dev/null)   # optional; overrides Duration on >10% drift
} > "$DP"
# Guard: a partially-failed build must fail LOUDLY here, not downstream in the subagent
grep -q '^## Narrator scripts' "$DP" || { echo "FATAL: vd-dispatch.txt incomplete — rebuild before dispatching"; }

# Captions planning hint for the Captions: dispatch line below
(cd "$PROJECT_DIR" && node -e 'try{const m=require("./audio_meta.json");process.stdout.write(Object.values(m.scenes||{}).some(s=>s.wordsPath)?"enabled":"disabled")}catch{process.stdout.write("enabled")}')
```

Dispatch the subagent: prompt = full `agents/visual-design.md` + `## Dispatch context` (copy verbatim, do not digest):

```
SKILL_DIR: <absolute path>
PROJECT_DIR: <video project root>
Schema validator: <SKILL_DIR>/scripts/validate-section.mjs
Canvas: <width>×<height>   # 1920×1080 default; 1080×1920 portrait / 1080×1080 square when narrator_scripts.orientation says so
Captions: <enabled | disabled>   # the node -e hint above; enabled => plan keeps key content in the upper ~83%
Dispatch packet: <PROJECT_DIR>/.dispatch/vd-dispatch.txt
```

The `Captions:` line is an optimistic hint; the authoritative gate is `group_spec.captions_enabled` from Step 5 prep (mismatch is safe — Step 6/7 keep-out always follows group_spec).

### Step 5 - prep (deterministic, NO subagent)

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

- exit 0 -> append the stdout summary to `$PROJECT_DIR/context.log`.
- exit 1 -> stderr names the failing scene + anchor; re-dispatch visual-design (Step 4) with the error passed through.

### Step 5.5 + Step 6 - Captions (deterministic) + scene worker fan-out

**Captions are two Bash scripts, no subagent** (run after prep, before fan-out):

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

exit 0 = normal. `captions: skipped (<reason>)` = legal skip — no `captions.html`, assemble will not mount track 12; continue. **Do not** run `npx hyperframes lint <file>` on `captions.html` (lint takes a project directory; a file path exits 1).

**Scene worker fan-out**: read `group_spec.json.groups[]` for worker count N and `group_spec.captions_enabled` for the `Captions:` flag, then build the per-worker dispatch packets and start **N workers in parallel** (concurrent background dispatches; a harness concurrency cap below N means waves of the cap size until all N scenes exist — one scene per worker either way, never fewer scenes):

```bash
# Same rule as Step 4: packets go in $PROJECT_DIR/.dispatch/, never a fixed /tmp path
# (a stale /tmp file from a previous project survives a failed write and silently
# poisons every worker with the wrong design system).
mkdir -p "$PROJECT_DIR/.dispatch/scene-dispatch"
# Shared header (identical for every worker), computed once:
# `## Film direction` = the film-level invariants from group_spec.film_direction
# (palette system / motion defaults + budget / ambient system / negative list);
# each scene's creative_brief carries only scene-specific deltas on top of it.
{
  echo "## Film direction"
  (cd "$PROJECT_DIR" && node -p 'JSON.parse(require("fs").readFileSync("group_spec.json","utf8")).film_direction || ""')
  echo "## Tokens / easings / voice"
  (cd "$PROJECT_DIR" && cat design-system/chunks/tokens.css design-system/chunks/easings.js design-system/chunks/voice.md 2>/dev/null)
} > "$PROJECT_DIR/.dispatch/scene-shared.txt"
# Guard BEFORE fan-out: header structure + the project's own brand token must both be present;
# a contaminated packet here costs a full re-author round across every affected worker.
grep -q '^## Film direction' "$PROJECT_DIR/.dispatch/scene-shared.txt" && \
  grep -q -- '--brand-primary' "$PROJECT_DIR/.dispatch/scene-shared.txt" || \
  { echo "FATAL: scene-shared.txt incomplete/stale — rebuild before dispatching workers"; }
# Per-worker packet: shared header + that worker's Scenes YAML -> $PROJECT_DIR/.dispatch/scene-dispatch/w<N>.txt
```

Each worker's prompt = full `agents/hyperframes-scene.md` + `## Dispatch context` with: `SKILL_DIR` / `PROJECT_DIR` / `Worker ID` / `Composition width` + `Composition height` (= `group_spec.width`/`height`) / `Captions: <enabled|disabled>` / `Dispatch packet: <PROJECT_DIR>/.dispatch/scene-dispatch/w<N>.txt`, plus the shared header body (`## Film direction` + `## Tokens / easings / voice`) and the worker's `Scenes:` list **copied verbatim from `group_spec.json.groups[i].scenes[<sid>]`** (`scene_id` / `effects` / `rule_paths` / `assetCandidates` / `estimatedDuration_s` / `voicePath` / `blueprint` / `design_chunks` / `creative_brief`). **When `Captions: enabled`, also pass `Caption band top y` = `height − round(height × 0.1667)` and `Foreground max y` = `Caption band top y − 20`** (landscape → 900 / 880; portrait → 1600 / 1580). `design_chunks: null` (anomaly already reported by prep) -> the worker falls back to reading `design-system/design.html`.

After all workers return, run the static composition gate (scans `compositions/scene_*.html` per `group_spec.scene_ids`; `captions.html` is covered by its own self-lint + Step 7 whole-project lint):

```bash
(cd "$PROJECT_DIR" && node <SKILL_DIR>/scripts/check-compositions.mjs \
  --hyperframes . \
  --group-spec ./group_spec.json)
```

- 0 -> continue to Step 7.
- 1 -> stderr names the violating scene + rule; **re-dispatch that worker** (do not Edit in the master).

### Step 7 - Assembly prelude + finalize (Phase 4c)

**(1) Deterministic Bash prelude** (each script documents its internals in its own header; you only branch on exit codes):

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

No agent hand-writes `index.html` or manually checks BGM. Exit-code branches:

- assemble exit 1 -> names a scene (root `data-duration` ≠ group_spec, or file missing) = worker contract break -> **re-dispatch that worker (Step 6)**, then rerun this step.
- transitions inject/verify exit 1 -> injector bug (prep already validated `transitions[]`) -> report for investigation; do not roll back workers.
- hoist-videos exit 1 -> an invalid `data-video-src` declaration (stderr names scene + reason); `Edit` the scene file (or re-dispatch for a real relayout), rerun this step. exit 2 -> run `node <SKILL_DIR>/scripts/hoist-videos.mjs --ensure-deps` from the workspace root, rerun.
- sfx-verify exit 1 -> assembler bug -> report for investigation.

**(2) Dispatch the finalize subagent**: prompt = full `agents/hyperframes-finalize.md` + `## Dispatch context`:

```
SKILL_DIR: <absolute path>
PROJECT_DIR: <video project root>
Render quality: high     # or draft / standard
Captions: <enabled | disabled>   # = group_spec.captions_enabled
BGM: <one-line wait-bgm verdict, e.g. "ready (lyria)" / "skipped (no key)" / "timeout">
Film direction: |        # = group_spec.film_direction (film-level invariants the briefs assume)
  <verbatim>
Scenes:                  # one line per scene, copied verbatim from group_spec.json
  - { scene_id, start_s, estimatedDuration_s, effects: [...], creative_brief: |
      <Phase 3 prose for this scene> }
```

Finalize runs lint+validate, takes one contact-sheet look, fixes what the pixels show, renders, and verifies — its prompt owns that flow. Outcomes:

- Reports the verified mp4 + fixes in place -> complete.
- **STOP** (a scene needs real recomposition — exception, not default) -> re-dispatch that worker (Step 6) with normal dispatch context + a `## Repair context` block carrying finalize's verbatim findings and the `Captions:` flag -> rerun (1) -> re-dispatch finalize. Same finding survives two rounds -> stop and surface to the user.

### Completion report

Summarize per phase from `context.log` + each step's stdout: capture URL / asset counts, preset, archetype, scene count + total duration, transitions, gate status, fixes in place, final mp4 path + bytes + duration.

**Offer a live preview — never auto-open one.** The deliverable is the mp4. Do NOT run `hyperframes preview` / `play` during any earlier phase (a mid-run preview shows half-edited compositions and dies with that phase's server). Only when the user asks, after the render:

```bash
(cd "$PROJECT_DIR" && npx hyperframes preview)   # Studio UI, e.g. http://localhost:3002/#project/<project-name>
(cd "$PROJECT_DIR" && npx hyperframes play)       # or a plain shareable player at http://localhost:<port>
```

Report the actual URL with the real port. Flags live in the `hyperframes-cli` skill.

---

## Resume table

Read `$PROJECT_DIR/context.log` and resume from the first missing artifact:

| State                                                                                              | Continue from                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| log missing or empty                                                                               | Full pipeline                                                                                                                                                                                                                                                        |
| `capture/extracted/tokens.json` missing                                                            | Rerun Step 1 (capture + derive-context-pack + `build-design.mjs --no-emit`)                                                                                                                                                                                          |
| `tokens.json` exists, `design-system/inference.json` missing                                       | Rerun only `build-design.mjs --no-emit` (deterministic, seconds)                                                                                                                                                                                                     |
| `inference.json` exists, but `design.html` **or** `narrator_scripts.json` missing                  | Step 1b/2 fill-in: dispatch whichever subagent's artifact is missing (both missing -> both in parallel)                                                                                                                                                              |
| `narrator_scripts.json` exists, `audio_meta.json` missing                                          | Step 3 (audio)                                                                                                                                                                                                                                                       |
| `audio_meta.json` exists, `section_plan.md` missing                                                | Step 4 (visual-design)                                                                                                                                                                                                                                               |
| `section_plan.md` exists, `group_spec.json` missing                                                | Step 5 (prep)                                                                                                                                                                                                                                                        |
| `group_spec.json` exists, `compositions/scene_*.html` missing **or** `caption_groups.json` missing | Step 5.5+6: run the captions scripts first, then dispatch workers for whichever scenes are missing, in parallel. **Captions-ran criterion = `caption_groups.json` exists** (a legal skip writes no `captions.html`; keying on `captions.html` would re-skip forever) |
| All `compositions/scene_*.html` exist + captions state decided, `renders/video.mp4` missing        | Step 7: rerun the full Bash prelude (overwrite `index.html` — upstream scenes may have changed), then dispatch finalize                                                                                                                                              |
| `renders/video.mp4` exists                                                                         | Report completed and stop                                                                                                                                                                                                                                            |
