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

**Plugin installs:** Before setup or freshness commands, follow [plugin execution rules](../hyperframes/references/plugin-installation.md) when this skill is inside a HyperFrames plugin. Standalone installs keep the update instructions below.

> **First, keep this skill fresh — confirm with the user before running:** `npx hyperframes skills update motion-graphics`. A fast no-op when everything is current; otherwise it refreshes this skill plus the core domain skills it depends on before you rely on them.

> **figma source**: If the logo/asset/animation to build from comes from a figma.com URL, run `/figma` first — asset export, brand tokens, and Motion→GSAP translation if the graphic is a Figma Motion import — then build from its output. Don't drive Figma via raw MCP tools directly: that skips SVG sanitization, `.media/manifest.jsonl` provenance, and brand-token `var()` binding, so a later brand change can't propagate without a full re-import.

# motion-graphics — dispatch entry

> **The front door is `/hyperframes`.** This skill makes a **short, design-led, unnarrated motion graphic** (motion is the message; ~under 10s, no voice-over). Anything longer, narrated, or multi-scene — or any uncertainty → read `/hyperframes` first: the intent layer owns every route decision.

This workflow is **autonomous by design** — at most one clarifying question (`agents/director.md`), then build through verification without intermediate review. The intent layer (`/hyperframes` → `references/intent-interview.md`) routes here directly without run-shape questions; a storyboard and companion session add little to a piece this short. Rendering is still user-gated: after checks and proof snapshots pass, ask the canonical “preview first, or render?” question from `../hyperframes/references/brief-contract.md`. When a `BRIEF.md` exists, read it before the director's question.

A short design-led motion graphic. **Asset-first**: decide the asset strategy and source real material _before_ designing the shot, then design the shot around what you have, then compose by reusing catalog capabilities. All artifacts go to `PROJECT_DIR = videos/<project-name>/` (created in Step 0); all paths below are relative to it.

Asset strategy is independent from the search decision. The Director classifies
the shot first, then inspects supplied, local, and existing Quiver assets and
chooses reuse, generate, vectorize, edit, or animate when that operation is
appropriate. A selected operation creates a non-empty `asset_needs` item even
for a form category; keep `asset_needs: []` only when no asset work is needed.

## Setup and provider boundaries

Keep the released HyperFrames skill fresh for ordinary released-user workflows
with:

```bash
npx hyperframes skills update motion-graphics
```

When a request pins a project-local candidate or explicitly asks to use the
already-installed skills, do not run that refresh. Use the installed
HyperFrames CLI and preserve the project-local candidate; do not change
`HOME`/`CODEX_HOME` or rely on a private wrapper.

If the HyperFrames CLI is not available, use the released fallback:

```bash
npx skills add heygen-com/hyperframes --skill motion-graphics
```

Quiver is an optional asset provider. For its tools, use the official [Quiver
plugin README](https://github.com/quiverai/cursor-plugin#readme), the hosted
MCP at `https://app.quiver.ai/mcp`, host-managed OAuth, and the bundled
`quiverai` skill. Do not invent host-specific connection flags or another
installer. MCP OAuth is separate from genuine SVG editing: the edit lane needs
`QUIVERAI_API_KEY`, an edit-capable permitted model, and API Platform balance.

| Phase    | Execution                                                             | Primary artifact                                                 | Detailed flow                 |
| -------- | --------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------------------------- |
| init     | Bash                                                                  | `hyperframes.json`                                               | Step 0                        |
| plan     | subagent — classify + asset strategy, then decide search when needed  | `shot-plan.json` (draft: category, `asset_needs`, brief)         | `agents/director.md` (Part 1) |
| source ◇ | agent-driven source procedure (**skip if `asset_needs` is empty**)    | `assets/` + `assets/index.md`                                    | `phases/source/guide.md`      |
| design   | subagent — shot design around resolved assets                         | `shot-plan.json` (final: block(s) + layout + motion + positions) | `agents/director.md` (Part 2) |
| build    | subagent — reuse-first composition                                    | `index.html`                                                     | `agents/builder.md`           |
| verify   | Bash — `lint`, `check`, proof snapshots; repair on failure            | `snapshots/contact-sheet.jpg`                                    | Step 5                        |
| approve  | Ask preview or render; wait for the answer                            | explicit render approval                                         | Step 6                        |
| render   | Bash — `hyperframes render` (MP4, or `--format webm/mov` for overlay) | `renders/video.mp4` or transparent overlay                       | Step 6                        |

`◇ source` runs only when `asset_needs` is non-empty. Pure code/text categories
(e.g. `kinetic-type`, most `charts`/`stat`) use `asset_needs: []` only when no
asset work is required; a form category with a selected Quiver operation still
enters Source.

## Categories — split by the search decision

`plan` first classifies the shot and decides whether any asset work is needed.
Search is one source option, not the asset-strategy gate. Search-driven
categories are finalized by the returned content type; form categories may
still carry a non-empty asset need when the selected operation requires it.
Each category is one `categories/<id>/module.md` (its planning + build rules);
the shared motion vocabulary lives in `references/motion-vocabulary.md` (→
`hyperframes-animation` rules/blueprints + registry blocks).

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
npx hyperframes init "$PROJECT_DIR" --non-interactive --example=blank --skill=motion-graphics
```

For a pinned project-local candidate, prefix the same command with
`HYPERFRAMES_SKIP_SKILLS=1`:

```bash
HYPERFRAMES_SKIP_SKILLS=1 npx hyperframes init "$PROJECT_DIR" --non-interactive --example=blank --skill=motion-graphics
```

This prevents `init` from refreshing the canonical/global skill set. The
current CLI ignores `--skip-skills` on the normal user path, so that flag is
not a substitute for the environment variable. Without the environment
variable, `init` checks installed skills against the latest GitHub versions and
may update the global set.

**Constraints:** never `hyperframes init` in the workspace root; never nest another `hyperframes/` inside `PROJECT_DIR`; every Bash command (master + subagents) is a `(cd "$PROJECT_DIR" && ...)` subshell — never bare `cd`.

### Step 1 — Plan (subagent: Director Part 1)

Dispatch one subagent. prompt = full `agents/director.md` + `## Dispatch context` (`SKILL_DIR` / `PROJECT_DIR` / the user's request / `Schema: <SKILL_DIR>/references/shot-plan-ir.md`). It must:

1. **Classify the shot first**, then decide whether asset work is needed. Inspect supplied/local/existing Quiver assets before selecting `reuse`, `generate`, `vectorize`, `edit`, or `animate`.
   - Keep `asset_needs: []` only when no asset work is required.
   - For a selected Quiver operation, emit a non-empty need with `provider: "quiver"` and `operation: "reuse|generate|vectorize|edit|animate"`.
   - If search is needed, emit its search plan in `asset_needs[]` (news / web / tweet / image; two-pole queries). The specific search-driven category is confirmed by returned content in Step 2 and finalized in Step 3.
2. Write a draft `shot-plan.json` (envelope + category or search intent + `asset_needs` + one-paragraph shot brief). Schema: `references/shot-plan-ir.md`.

Validation: `[ -s "$PROJECT_DIR/shot-plan.json" ] && echo ok || echo missing`.

### Step 2 — Source ◇ (agent-driven, conditional)

If `shot-plan.json.asset_needs` is non-empty, follow
`phases/source/guide.md`. A need with `provider: "quiver"` routes to
`phases/source/quiver.md`; all other needs retain the existing media-use
search/capture/generate behavior. In either lane, Source freezes accepted
material into project-local paths and writes the ledger. If `asset_needs` is
empty, **skip to Step 3**.

If a required provider or operation is unavailable, record the distinct unmet
state in the ledger/context and do not fabricate an SVG, preview, creation, or
provenance. Optional Quiver absence can preserve an existing HyperFrames path
when no Quiver asset work is required.

### Step 3 — Design (subagent: Director Part 2)

Dispatch a subagent (prompt = `agents/director.md` Part 2 + dispatch context including the resolved `assets/index.md` if Step 2 ran + `catalog-map.md`). It designs the shot **around the available assets**: pick the catalog block(s) + the `hyperframes-animation` rules/blueprints, the layout, the motion, beats, and (for `asset-fusion`) the `element_positions` + eyedropper palette. Finalizes `shot-plan.json` (`content.block` + `content.customize` + per-category content).

### Step 4 — Build (subagent: Builder, reuse-first)

Dispatch a subagent. prompt = full `agents/builder.md` + dispatch context (`shot-plan.json`, `catalog-map.md`, the category's `module.md`, `references/motion-vocabulary.md`, `references/builder-contract.md`). **Reuse-first**: `npx hyperframes add <block>` + customize in place; hand-author only gaps + the asset-fusion affordance. Output the actual root `index.html` that the pinned HyperFrames CLI loads, honoring the HF contract (paused GSAP timeline on `window.__timelines`, `class="clip"` + stable ids, `tl.seek(0)`, deterministic). `assets/` inputs are local paths only.

### Step 5 — Verify (Bash → repair subagent on failure)

```bash
(cd "$PROJECT_DIR" && npx hyperframes lint .)
(cd "$PROJECT_DIR" && npx hyperframes check .)
(cd "$PROJECT_DIR" && npx hyperframes snapshot --at <proof-times>)
```

Choose proof times that show the opening state, signature move, and final hold. Inspect the generated contact or snapshot sheet before continuing. On `lint`, `check`, or snapshot failure, dispatch the repair subagent (`agents/finalize.md`) with the actual root `index.html` as the repair target for one in-place fix pass, then rerun the failed gate. Never change a fixed duration merely to hide a defect.

### Step 6 — Approve and render (Bash)

Ask one question: “preview first, or render?” If the user chooses preview, open Studio and return to the same approval gate after revisions:

```bash
(cd "$PROJECT_DIR" && npx hyperframes preview --background)
```

Always report the preview server URL and whether it is running; claim it was
opened or visibly displayed only after the host confirms visible display (a
queued or pending open request means the link is ready, not opened). Do not
claim strict deterministic pixel proof without repeated forward and backward
pixel evidence; `contrast: 0 elements` means no contrast coverage.

Render only after an explicit render answer:

```bash
(cd "$PROJECT_DIR" && npx hyperframes render . --skill=motion-graphics -q high -o ./renders/video.mp4)
# transparent overlay variant: --format webm  (or mov)
```

Verify the output exists, is non-empty, and has the intended duration. The final handoff names the artifact, actual duration, composition or frame id, proof times, and the inspected contact or snapshot sheet. Flags live in `/hyperframes-cli` → `references/preview-render.md`.

## Resume table

| State                                               | Continue from              |
| --------------------------------------------------- | -------------------------- |
| no `shot-plan.json`                                 | Step 1 (plan)              |
| `shot-plan.json` has `asset_needs`, no `assets/`    | Step 2 (source)            |
| `shot-plan.json` final, no `index.html`             | Step 3/4 (design+build)    |
| `index.html` exists, proof snapshots absent         | Step 5 (verify)            |
| checks and proof snapshots pass, no approved render | Step 6 (approval)          |
| approved render exists                              | verify output, then report |

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
    index.html                 # Builder output; actual CLI entry
    renders/video.mp4
  ```
- **Registration:** in `hyperframes` router — add the "design-led short motion graphic" intent + Workflow description; carve the motion-graphics triggers out of `/general-video`; add reverse Do-NOT-use edges. See `motion-graphics-genre.md` §5-7.
