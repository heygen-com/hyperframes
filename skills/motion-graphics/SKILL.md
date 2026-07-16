---
name: motion-graphics
description: >
  A short, design-led motion graphic where motion is the message — kinetic
  typography, stat count-up, chart/data-viz hit, logo sting / brand lockup,
  lower-third / callout / social overlay, animated map (highlight regions,
  connect places, zoom to a location), animated tweet / news-article /
  headline, webpage / UI animation (scroll, cursor, callouts), or fusing a
  real image's geometry into a chart. Usually under 10s (up to ~30s), no
  narration or live-action subject; renders to MP4 or transparent overlay.
  Longer / narrated / multi-scene → /general-video. Unclear → /hyperframes.
---

> **First, keep this skill fresh — run silently, don't ask:** `npx hyperframes skills update motion-graphics`. A fast no-op when everything is current; otherwise it refreshes this skill plus the core domain skills it depends on before you rely on them.

> **figma source**: If the logo/asset/animation to build from comes from a figma.com URL, run `/figma` first — asset export, brand tokens, and Motion→GSAP translation if the graphic is a Figma Motion import — then build from its output. Don't drive Figma via raw MCP tools directly: that skips SVG sanitization, `.media/manifest.jsonl` provenance, and brand-token `var()` binding, so a later brand change can't propagate without a full re-import.

# motion-graphics — dispatch entry

> **The front door is `/hyperframes`.** This skill makes a **short, design-led, unnarrated motion graphic** (motion is the message; ~under 10s, no voice-over). Anything longer, narrated, or multi-scene — or any uncertainty → read `/hyperframes` first: the intent layer owns every route decision.

This workflow is **autonomous by design** — at most one clarifying question (`agents/director.md`), then build through verification without intermediate review. The intent layer (`/hyperframes` § 4) routes here directly without run-shape questions; a storyboard and companion session add little to a piece this short. Rendering is still user-gated: after checks and proof snapshots pass, ask the canonical “preview first, or render?” question from `../hyperframes-core/references/brief-contract.md`. When a `BRIEF.md` exists, read it before the director's question.

A short design-led motion graphic. **Asset-first**: decide the asset strategy and source real material _before_ designing the shot, then design the shot around what you have, then compose by reusing catalog capabilities. All artifacts go to `PROJECT_DIR = videos/<project-name>/` (created in Step 0); all paths below are relative to it.

| Phase    | Execution                                                             | Primary artifact                                                 | Detailed flow                 |
| -------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------- |
| init     | Bash                                                                  | `hyperframes.json`                                               | Step 0                        |
| plan     | subagent — **decide search?** + classify + asset strategy             | `shot-plan.json` (draft: category, `asset_needs` queries, brief) | `agents/director.md` (Part 1) |
| source ◇ | Bash — media-use resolve (**skip if `asset_needs` is empty**)         | `assets/` + `assets/index.md`                                    | `phases/source/guide.md`      |
| design   | subagent — shot design around resolved assets                         | `shot-plan.json` (final: block(s) + layout + motion + positions) | `agents/director.md` (Part 2) |
| build    | subagent — reuse-first composition                                    | `compositions/index.html`                                        | `agents/builder.md`           |
| verify   | Bash — `lint`, `check`, proof snapshots; repair on failure            | `snapshots/contact-sheet.jpg`                                    | Step 5                        |
| approve  | Ask preview or render; wait for the answer                            | explicit render approval                                         | Step 6                        |
| render   | Bash — `hyperframes render` (MP4, or `--format webm/mov` for overlay) | `renders/video.mp4` or transparent overlay                       | Step 6                        |

`◇ source` runs only when the chosen category declares assets. Pure code/text categories (e.g. `kinetic-type`, most `charts`/`stat`) have `asset_needs: []` and skip straight from plan to design.

## Categories — split by the search decision

`plan`'s **first decision is: does this need a search?** That fork splits the categories into two groups; then the specific category is picked — for search-driven, **by the type of content the search returns**. Each category is one `categories/<id>/module.md` (its planning + build rules); the shared motion vocabulary lives in `references/motion-vocabulary.md` (→ `hyperframes-animation` rules/blueprints + registry blocks).

**Form categories — no search; the user supplies the content:**

| Category       | Intent                                                                                                         | Leans on                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `kinetic-type` | punchy line / quote / title, motion-first text                                                                 | `caption-*` blocks + animation rules                                        |
| `stat`         | single hero number / count-up + ring                                                                           | `apple-money-count` / `rules/{counting-dynamic-scale, stat-bars-and-fills}` |
| `charts`       | bar / line / pie / race / % from data                                                                          | `data-chart` block                                                          |
| `logo-reveal`  | logo sting / brand lockup (user logo)                                                                          | `logo-outro` / `rules/svg-path-draw`                                        |
| `lower-thirds` | name / title bars, callouts, social overlays                                                                   | `caption-*` + registry overlay blocks                                       |
| `maps`         | geographic motion — highlight regions, connect places, zoom to a location (vector lane, or baked basemap lane) | `us-map` / `world-map` family + `bake-basemap.mjs`                          |

**Search-driven categories — search first, then animate by content type** (the RWA path):

| Returned content | Category       | Animation                                                      |
| ---------------- | -------------- | -------------------------------------------------------------- |
| webpage / link   | `webpage`      | webpage / UI animation (scroll, reveal, cursor, callouts)      |
| news article     | `news`         | headline reveal + source card + key-fact callouts              |
| tweet            | `tweet`        | animated tweet card                                            |
| image / entity   | `asset-fusion` | the asset's geometry _becomes_ the chart (RWA diegetic fusion) |

Build order: one at a time, coverage-first (rough is fine). `kinetic-type` ported from the prototype; the rest follow.

## Prerequisites

macOS Apple Silicon or Linux x64. System tools: `brew install node ffmpeg`. `npx hyperframes doctor` once. macOS GPU render: `export PRODUCER_BROWSER_GPU_MODE=hardware`.

Optional keys (local fallbacks if unset) — only needed by categories that source/generate assets via media-use:

| Key                                 | Used for                                                    | Fallback                        |
| ----------------------------------- | ----------------------------------------------------------- | ------------------------------- |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | image generation (media-use resolve)                        | skip generate / search-only     |
| (asset_scout / search providers)    | `webpage`/`news`/`tweet` + `asset-fusion` real-asset search | category degrades to asset-free |

## Flow

### Step 0 — Initialize

cwd is the agent workspace root; write all artifacts under `PROJECT_DIR = videos/<project-name>/`. `<project-name>`: use the dir the user gave, else a short kebab-case name from the intent (`<subject>-motion`). Not the workspace basename or a timestamp.

Only when `$PROJECT_DIR/hyperframes.json` is absent:

```bash
PROJECT_DIR="${MOTION_GRAPHICS_DIR:-videos/<project-name>}"
mkdir -p "$(dirname "$PROJECT_DIR")"
npx hyperframes init "$PROJECT_DIR" --non-interactive --example=blank
```

`init` checks the installed skills against the latest on GitHub and updates the global set if any are out of date.

**Constraints:** never `hyperframes init` in the workspace root; never nest another `hyperframes/` inside `PROJECT_DIR`; every Bash command (master + subagents) is a `(cd "$PROJECT_DIR" && ...)` subshell — never bare `cd`.

### Step 1 — Plan (subagent: Director Part 1)

Dispatch one subagent. prompt = full `agents/director.md` + `## Dispatch context` (`SKILL_DIR` / `PROJECT_DIR` / the user's request / `Schema: <SKILL_DIR>/references/shot-plan-ir.md`). It must:

1. **Decide: does this need a search?** (the first fork)
   - **No** → pick a **form category** (kinetic-type / stat / charts / logo-reveal / lower-thirds); content is user-supplied; `asset_needs: []`.
   - **Yes** → emit a **search plan** into `asset_needs[]` (news / web / tweet / image; two-pole queries). The specific **search-driven category** (webpage / news / tweet / asset-fusion) is confirmed by the content type returned in Step 2, and finalized in Step 3.
2. Write a draft `shot-plan.json` (envelope + chosen form category _or_ search intent + `asset_needs` + a one-paragraph shot brief). Schema: `references/shot-plan-ir.md`.

Validation: `[ -s "$PROJECT_DIR/shot-plan.json" ] && echo ok || echo missing`.

### Step 2 — Source ◇ (Bash: media-use, conditional)

If `shot-plan.json.asset_needs` is non-empty, resolve assets (search / generate / fetch → frozen project-local paths + ledger). See `phases/source/guide.md` (wraps `media-use resolve`; the search-driven categories use the news/web/tweet/image search). If `asset_needs` is empty, **skip to Step 3**.

```bash
# illustrative — see phases/source/guide.md
(cd "$PROJECT_DIR" && node <SKILL_DIR>/phases/source/resolve.mjs --plan ./shot-plan.json --out ./assets)
```

Degrade gracefully: if a search/provider is unavailable, the category falls back to asset-free (note it in `context.log`).

### Step 3 — Design (subagent: Director Part 2)

Dispatch a subagent (prompt = `agents/director.md` Part 2 + dispatch context including the resolved `assets/index.md` if Step 2 ran + `catalog-map.md`). It designs the shot **around the available assets**: pick the catalog block(s) + the `hyperframes-animation` rules/blueprints, the layout, the motion, beats, and (for `asset-fusion`) the `element_positions` + eyedropper palette. Finalizes `shot-plan.json` (`content.block` + `content.customize` + per-category content).

### Step 4 — Build (subagent: Builder, reuse-first)

Dispatch a subagent. prompt = full `agents/builder.md` + dispatch context (`shot-plan.json`, `catalog-map.md`, the category's `module.md`, `references/motion-vocabulary.md`, `references/builder-contract.md`). **Reuse-first**: `npx hyperframes add <block>` + customize in place; hand-author only gaps + the asset-fusion affordance. Output `compositions/index.html` honoring the HF contract (paused GSAP timeline on `window.__timelines`, `class="clip"` + stable ids, `tl.seek(0)`, deterministic).

### Step 5 — Verify (Bash → repair subagent on failure)

```bash
(cd "$PROJECT_DIR" && npx hyperframes lint .)
(cd "$PROJECT_DIR" && npx hyperframes check .)
(cd "$PROJECT_DIR" && npx hyperframes snapshot --at <proof-times>)
```

Choose proof times that show the opening state, signature move, and final hold. Inspect the generated contact or snapshot sheet before continuing. On `lint`, `check`, or snapshot failure, dispatch the repair subagent (`agents/finalize.md`) for one in-place fix pass, then rerun the failed gate. Never change a fixed duration merely to hide a defect.

### Step 6 — Approve and render (Bash)

Ask one question: “preview first, or render?” If the user chooses preview, open Studio and return to the same approval gate after revisions:

```bash
(cd "$PROJECT_DIR" && npx hyperframes preview)
```

Render only after an explicit render answer:

```bash
(cd "$PROJECT_DIR" && npx hyperframes render . --skill=motion-graphics -q high -o ./renders/video.mp4)
# transparent overlay variant: --format webm  (or mov)
```

Verify the output exists, is non-empty, and has the intended duration. The final handoff names the artifact, actual duration, composition or frame id, proof times, and the inspected contact or snapshot sheet. Flags live in `/hyperframes-cli` → `references/preview-render.md`.

## Resume table

| State                                                    | Continue from              |
| -------------------------------------------------------- | -------------------------- |
| no `shot-plan.json`                                      | Step 1 (plan)              |
| `shot-plan.json` has `asset_needs`, no `assets/`         | Step 2 (source)            |
| `shot-plan.json` final, no `compositions/index.html`     | Step 3/4 (design+build)    |
| `compositions/index.html` exists, proof snapshots absent | Step 5 (verify)            |
| checks and proof snapshots pass, no approved render      | Step 6 (approval)          |
| approved render exists                                   | verify output, then report |

## Design notes (maintainers — execution does not read this)

- **Asset-first rationale:** sourcing is front-loaded and informs shot design (the RWA flow: analyze → search → review → compose). the search-driven categories (`webpage`/`news`/`tweet`) and `asset-fusion` both lean on media-use search (news/web/tweet/image), which is media-use's documented RWA lineage.
- **Reuse-first:** the in-ecosystem analog of LLM-generated templates is "compose catalog blocks + `hyperframes-animation` rules". HF's paused GSAP timeline ≙ Remotion's `useCurrentFrame`.
- **Category module contract:** one `categories/<id>/module.md` (planning + build), sharing `references/motion-vocabulary.md` (+ optional eval). Adding a category = drop the folder + register its classifier line in `agents/director.md` + its row in `catalog-map.md`; the phase pipeline is untouched.
- **Directory shape:**
  ```
  videos/<project-name>/
    hyperframes.json  context.log
    shot-plan.json            # the IR (Director output)
    assets/  assets/index.md  # media-use output (if sourced)
    compositions/index.html   # Builder output
    renders/video.mp4
  ```
- **Registration:** in `hyperframes` router — add the "design-led short motion graphic" intent + Workflow description; carve the motion-graphics triggers out of `/general-video`; add reverse Do-NOT-use edges. See `motion-graphics-genre.md` §5-7.
