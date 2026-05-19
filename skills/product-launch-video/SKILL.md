---
name: product-launch-video
description: End-to-end pipeline that turns a website URL (or product brief) into a 60-90s product-launch / SaaS explainer / promo video as a HyperFrames composition. Orchestrates four subagent phases — web-extraction, story-design, visual-design, hyperframes build — then renders. Use when the user provides a URL and asks for a launch video, a promo video, a SaaS explainer, a feature reveal, or otherwise says "make me a video for <url>". You dispatch subagents via the Agent tool; you do NOT execute phase work yourself.
metadata:
  tags: orchestrator, pipeline, product-launch, promo, saas-explainer, web-to-video
---

# Product Launch Video — Orchestrator

You are the orchestrator. You dispatch one specialized subagent per phase, pass context between them, and handle user interaction. You do **NOT** execute phase work yourself.

The pipeline cleanly separates **skills** (reusable domain knowledge) from **subagent prompts** (this pipeline's per-phase contract):

- **Skills** (top-level, reusable) — `/web-extraction`, `/story-design`, `/visual-design`, `/hyperframes-animation` + friends. Each describes how to do that activity in general.
- **Subagent prompts** (this skill's `agents/` dir) — pipeline-specific wrappers around the skills. Each one says "you are Phase N of THIS pipeline, here's your cwd contract, here's what to invoke, here's how to report". You inject these as the `prompt` to the Agent tool.

## Pipeline

| Phase | Subagent prompt file          | Underlying skill(s) the subagent loads via Skill tool                                               | Writes                      |
| ----- | ----------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------- |
| 1     | `agents/web-extraction.md`    | `web-extraction`                                                                                    | `extraction/`               |
| 2     | `agents/story-design.md`      | `story-design`                                                                                      | `narrator_scripts.json`     |
| 3     | `agents/visual-design.md`     | `visual-design`                                                                                     | `section_plan.md`           |
| 4     | `agents/hyperframes-build.md` | `hyperframes-core` + `hyperframes-cli` + `hyperframes-animation` + `hyperframes-gsap` (+ optionals) | `hyperframes/`              |
| 5     | (you, not a subagent)         | —                                                                                                   | `hyperframes/out/video.mp4` |

## Project layout

```
./                                  # project root (cwd — never leave)
├── context.log                      # phase log (you append after each phase)
├── narrator_scripts.json            # Phase 2 output
├── section_plan.md                  # Phase 3 output
├── extraction/                      # Phase 1 output
└── hyperframes/                     # Phase 4 output (HTML composition)
```

## Dispatch pattern (the "injection")

For Phases 1–4, the dispatch is always the same shape:

1. **Read** the subagent prompt file at `agents/<phase>.md` (relative to this SKILL.md's location).
2. **Construct the Agent tool's `prompt`** by concatenating:
   - The full contents of `agents/<phase>.md` (the wrapper)
   - A `## Dispatch context` section with this run's data (target URL, prev-phase summary, etc.)
3. **Call Agent** with `subagent_type: "general-purpose"`, that prompt, and a short `description`.

The subagent gets a fresh context. Its first action will be to invoke the underlying skill via the Skill tool (per the wrapper's instructions). It then follows the skill's procedure with this pipeline's contract overlaid (cwd rules, out-of-scope flags, output filenames, when-done reporting).

## Mode detection (do this BEFORE dispatching)

Read `./context.log` if it exists:

- **Missing or empty** → first run. Dispatch Phase 1 → 2 → 3 → 4 → 5 in order (autopilot).
- **Has completed phases, last entry not `[interrupted]`** → interactive mode (user is iterating). Dispatch only the phase relevant to their request, then any downstream cascade.
- **Last entry ends with `[interrupted]`** → resume from that phase.

## Phase 1 — dispatch web-extraction

```
1. Read product-launch-video/agents/web-extraction.md
2. Compose prompt = <its contents> + "\n\n## Dispatch context\nTarget URL: <USER_URL>\n"
3. Agent(
     subagent_type: "general-purpose",
     description: "Phase 1: web extraction",
     prompt: <composed>,
   )
```

After it returns: read `extraction/report.json` to confirm shape; relay key facts to the user (pages crawled, asset counts). Proceed to Phase 2.

## Phase 2 — dispatch story-design

```
1. Read product-launch-video/agents/story-design.md
2. Compose prompt = <its contents>
                  + "\n\n## Dispatch context\n"
                  + "Phase 1 summary: <one-paragraph: pages crawled, brand colors, fonts noted>\n"
3. Agent(
     subagent_type: "general-purpose",
     description: "Phase 2: story design",
     prompt: <composed>,
   )
```

After it returns: read `narrator_scripts.json` to verify schema (`sceneNumber` / `narrativeIntent` / `estimatedDuration`). Surface archetype + scene list to the user.

## Phase 3 — dispatch visual-design

```
1. Read product-launch-video/agents/visual-design.md
2. Compose prompt = <its contents>
                  + "\n\n## Dispatch context\n"
                  + "Phase 2 summary: <archetype + scene count + emotional arc>\n"
3. Agent(
     subagent_type: "general-purpose",
     description: "Phase 3: visual design",
     prompt: <composed>,
   )
```

After it returns: read `section_plan.md` to verify scenes are populated with effect names and choreography references.

## Phase 4 — dispatch hyperframes-build

```
1. Read product-launch-video/agents/hyperframes-build.md
2. Compose prompt = <its contents>
                  + "\n\n## Dispatch context\n"
                  + "Phase 3 summary: <scene count + dominant compositions/effects in section_plan.md>\n"
3. Agent(
     subagent_type: "general-purpose",
     description: "Phase 4: HyperFrames build",
     prompt: <composed>,
   )
```

After it returns: verify `hyperframes/index.html` exists and `hyperframes/compositions/` is populated. Then run Phase 5 directly.

## Phase 5 — final render (you, not a subagent)

Follow the canonical render flow from the `/hyperframes-cli` skill. The Phase 4 subagent has already run `lint` + `validate` + `inspect` inside `hyperframes/`, so this step is just the produce-MP4. **Do not invent custom output paths** — the CLI has a sensible default (`renders/<project>_<timestamp>.mp4`); pass `--output` only when you want a stable filename for iteration.

```bash
# Canonical render — high quality for delivery, stable filename for iteration.
# The CLI creates renders/ automatically; no mkdir needed.
(cd hyperframes && npx hyperframes render --quality high --output renders/video.mp4)
```

Quality knob (per `/hyperframes-cli`):

- `--quality draft` while iterating (faster)
- `--quality standard` (default) for review
- `--quality high` for final delivery

Other flags that may help if the first render is wrong:

- `--strict` — fail render on lint errors (belt-and-suspenders even though Phase 4 already lint-cleaned)
- `--fps 60` — higher motion fidelity, doubles render time
- `--format webm` — transparency (rarely needed for launch video)
- `--docker` — byte-identical output, useful when the host's Chrome version drifts

### Post-render verification (do this every time)

`render` reports status via stdout + exit code only — verify success explicitly before claiming done:

```bash
OUTPUT=hyperframes/renders/video.mp4

# 1) File exists and is non-empty
[ -s "$OUTPUT" ] || { echo "✗ render produced no output"; exit 1; }

# 2) Sanity-check duration / codec / bitrate
ffprobe -i "$OUTPUT" -show_format -v error

echo "✓ Render OK — $OUTPUT ($(du -h "$OUTPUT" | cut -f1))"
```

### When render keeps failing — diagnostic checklist

Render failures almost always trace back to composition issues caught by lint/validate, not the render CLI itself. Re-run the gates in order; **fix what they report before re-running render**:

```bash
(cd hyperframes && npx hyperframes lint)       # 1. structural — missing data-composition-id, overlapping tracks, unregistered timelines
(cd hyperframes && npx hyperframes validate)   # 2. runtime — loads in headless Chrome, reports console errors + WCAG contrast
(cd hyperframes && npx hyperframes inspect)    # 3. layout — text spilling out of containers, elements off-canvas
```

Common failure modes:

| Symptom                                               | Likely cause                                                                                                                    | Fix                                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render hangs / produces 0-byte mp4                    | Timeline registered inside `async`/`setTimeout`/`Promise`/event handler → page seek can't find `window.__timelines[<id>]`       | Move timeline build to synchronous top-level script. Lint usually catches this.                                                                    |
| Frames are blank / black                              | Composition references a missing asset (image / video / font)                                                                   | Check `hyperframes/public/` has every file referenced from `index.html` and `compositions/*.html`.                                                 |
| Render fails at "no composition found"                | `index.html` missing `data-composition-id` on root, OR sub-comp `<template>` wrapper missing                                    | Re-read `/hyperframes-core` composition contract.                                                                                                  |
| Render shorter than expected                          | `data-duration` on root doesn't match the GSAP timeline's intrinsic length — render length comes from `data-duration`, NOT GSAP | Set `data-duration` on root to the intended seconds.                                                                                               |
| Render fails strict mode but works without `--strict` | Lint warnings present                                                                                                           | Either fix the warnings, or drop `--strict` for this pass.                                                                                         |
| `npx hyperframes` resolves to wrong version           | Test project's `node_modules/.bin/hyperframes` not linked to local CLI                                                          | Re-run setup (script ensures `file:` dep + `npm install`); verify with `(cd hyperframes && npx hyperframes --version)` matches repo's CLI version. |

If lint/validate/inspect all pass but render still fails, run `npx hyperframes doctor` to surface environment problems (FFmpeg missing, Chrome unreachable, etc.).

### Done

Present the video path to the user and ask: "What would you like to change?"

Append to `./context.log`:

```
## Phase 5: render [done <ISO timestamp>]
Output: hyperframes/renders/video.mp4 (<size>)
```

## Interactive mode (after first autopilot pass)

When `context.log` shows a full pipeline already ran, **don't redispatch everything for a small request**:

- **Small fix** (font color, typo, swap an image) → use Edit / Bash directly, re-run Phase 5
- **Scene-level change** (rebuild scene N) → dispatch Phase 4 subagent with targeted instructions for that scene only (compose the prompt with extra constraints), then re-render
- **Visual plan change** (new effect choice, restructured scene) → dispatch Phase 3, then 4, then render
- **Narrative change** (reorder scenes, new archetype) → dispatch Phase 2, then 3, then 4, then render
- **More assets needed** → dispatch Phase 1 with a scoped URL/scope hint in the Dispatch context, then cascade

## `context.log` format

Each phase appends a markdown section. Read it before doing anything; it's how you know what's already done. The subagent prompt files instruct each subagent to append its own line; you don't write to it during dispatch.

```
## Phase N: <name> [done 2026-05-20T10:42:11Z]
<one line summary>
```

If a phase fails or you abort mid-run, mark `[interrupted]` instead of `[done]`. Resume from that phase on next invocation.

## See also

- `/hyperframes-animation` — scene blueprints + atomic animation rules (Phase 4's main reference)
- `/web-extraction`, `/story-design`, `/visual-design` — the reusable domain skills invoked by Phases 1–3
- `/hyperframes-core`, `/hyperframes-cli`, `/hyperframes-gsap` — composition contract + dev loop + GSAP API
