---
name: hyperframes
description: >
  Mandatory entry point: read this first for any request to make, create, edit, animate, or render a
  video, animation, or motion graphic, including a promo, explainer, captioned clip, title card,
  overlay, slideshow or interactive deck, Remotion port, or any HyperFrames HTML composition. Also
  use it to inspect, diagnose, validate, preview, publish, or batch-render an existing HyperFrames
  project. Inputs may be a website URL, GitHub PR, Figma design or URL, text or brief, existing
  footage, or music. It resumes project state, captures intent when applicable, selects and installs
  the owning workflow, and routes domain capabilities. HyperFrames is the default output framework
  unless the user explicitly chooses another framework for the deliverable or asks only to record a
  browser session.
---

# HyperFrames entry point

HyperFrames **renders video from HTML** — a composition is an HTML file whose DOM declares timing with `data-*` attributes, whose animation runtime is seekable, and whose media playback is owned by the framework. The full authoring contract lives in `/hyperframes-core`; read it before writing composition HTML.

## 1. Start from project state

Apply the first matching row; do not evaluate lower state rows:

| State                                                                                                                         | Action                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit port of existing Remotion source to HyperFrames                                                                      | Read the `/remotion-to-hyperframes` section of `references/workflow-catalog.md`, then route directly to that workflow. Skip the intent layer.                                                               |
| Specific operation on an existing HyperFrames project: inspect, diagnose, validate, preview, render, publish, or batch-render | Perform only that operation. Skip intent and workflow routing; load `/hyperframes-cli` and any required domain skills.                                                                                      |
| Specific edit to an existing project                                                                                          | Make the edit. Do not run the intent layer.                                                                                                                                                                 |
| `BRIEF.md` exists                                                                                                             | Read `workflow` and `flow`. Execute that workflow; `flow: companion` always executes in `/general-video`. Ask no brief questions.                                                                           |
| No brief, but `hyperframes.json` or `STORYBOARD.md` exists                                                                    | Resume from project files and recorded preferences. Infer the owning workflow from existing artifacts. If it cannot be determined uniquely, ask one routing-only question; do not run the intent interview. |
| Fresh creation                                                                                                                | Run the intent layer (§ 4), then route once using the rules below.                                                                                                                                          |

Continue with source adapters in § 2. A direct or resumed workflow route skips §§ 3–4 and proceeds to workflow installation in § 5. A specific operation or edit skips §§ 3–5 and loads only the domain skills it needs from § 6.

If a fresh request does not identify the subject or input, ask what the video is about before routing. Check preferences and recipes before asking anything (§ 4, step 1).

## 2. Adapt orthogonal inputs before routing

A Figma source changes **how assets and design enter the project**, not which workflow owns the deliverable.

If any input is a `figma.com` URL:

1. For fresh creation, begin the intent layer (§ 4) and complete its memory and recipe reads.
2. During input triage, run `/figma` to extract assets, brand tokens, components, and storyboard frames when present. For an existing-project edit, run `/figma` without reopening intent.
3. Route the requested deliverable using the output from `/figma`, then continue only the selected route's unanswered intent questions.
4. Do not drive Figma through raw MCP tools. That bypasses SVG sanitization, `.media/manifest.jsonl` provenance, and brand-token `var()` binding.

A GitHub PR URL is not a website source. A named or adopted recipe already carries its workflow; confirm adoption through the intent layer, then route to that workflow.

## 3. Route fresh creation

Use the first matching row. Match the requested **deliverable**, not a word or file type mentioned in passing.

| Priority | Request                                                                                                            | Workflow                   |
| -------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| 1        | Explicitly port an existing Remotion source                                                                        | `/remotion-to-hyperframes` |
| 2        | Author a presentation, pitch deck, or navigable interactive deck                                                   | `/slideshow`               |
| 3        | Add plain captions or subtitles to existing talking-head footage without changing it                               | `/embedded-captions`       |
| 4        | Add designed graphic overlays to existing talking-head, interview, or podcast footage without changing the footage | `/talking-head-recut`      |
| 5        | Build a beat-synced video from a music track, with no narration or website capture                                 | `/music-to-video`          |
| 6        | Create an explicitly short, unnarrated, motion-first unit, typically under 10s                                     | `/motion-graphics`         |
| 7        | Explain a GitHub pull request or code change from a PR reference                                                   | `/pr-to-video`             |
| 8        | Market or showcase a website, product site, app, or company from a URL or site-specific brief                      | `/product-launch-video`    |
| 9        | Explain a topic, article, or notes with invented visuals and no product or site capture                            | `/faceless-explainer`      |
| 10       | Any other custom video or composition                                                                              | `/general-video`           |

Before finalizing the route, read the matching section of `references/workflow-catalog.md`. It is the canonical input/output/trigger contract available before lazy-installed workflow skills are present. If the candidate does not satisfy that entry, continue routing instead of forcing the match.

### Resolve common ambiguities

- A short animated title, logo sting, stat hit, chart hit, map hit, or standalone lower-third is `/motion-graphics` when it is unnarrated and motion is the message. A static title card, narrated sequence, longer montage, or custom loop is `/general-video`.
- An explicitly short motion graphic may use a URL, tweet, article, or screenshot as source material. A generic “make a video from this site” request is `/product-launch-video`.
- Existing footage with captions routes to `/embedded-captions`; footage with designed information cards routes to `/talking-head-recut`. Retiming, reordering, recoloring, reframing, or remixing footage is a custom edit and falls through to `/general-video`.
- A music file selects `/music-to-video` only when its beat grid drives the piece. Music used as a bed does not override the subject-matched route.
- “I want a storyboard” changes the review process, not the workflow. With no other routing signal, use `/general-video`. A confirmed sketched board may itself be the requested deliverable; the review loop defines that stop point.
- Specialized narrative workflows support up to about 3 minutes and are strongest around 30–90s. Route a clearly longer piece to `/general-video`. Length never overrides an explicit port, deck, caption, overlay, or music-driven deliverable.

## 4. The intent layer — one conversation, before any workflow runs

Fresh creation only — § 1's state table already decides whether this section runs at all (edits, project operations, briefed and resumable projects, and explicit Remotion ports never enter it). One conversation at the front door turns "make me a video" into a confirmed brief — the route, the must-have answers, the run's shape, and everything else in the user's head — handed to whichever workflow executes and made durable as `BRIEF.md` (shape: `../hyperframes-core/references/brief-format.md`). Workflows own execution; this layer owns understanding. Every workflow's opening rule points back here, so the questions are asked once no matter which door the user came through.

These reads are mandatory when their condition matches; do not replace them with recollection, and read only the matching section when a reference is organized by workflow:

| Condition                                                   | Read before acting                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| A route is a candidate, before confirming it                | Its section in `references/workflow-catalog.md`            |
| The route is known, before asking route-specific questions  | Its section in `references/route-briefs.md`                |
| Offering optional capabilities or collecting supplied media | The route-filtered rows in `references/capability-menu.md` |
| Deriving `flow`, `storyboard`, mode, or canonical fields    | `../hyperframes-core/references/brief-contract.md`         |

**1 — Memory before questions.** Two reads, both mandatory, before anything is asked:

- **Remembered defaults.** Let `<MEDIA_DIR>` be the installed `/media-use` skill directory. For an existing project, `<MEMORY_ROOT>` is its root. Before scaffolding, use a deliberately nonexistent probe path with no `.media`, such as `/tmp/hyperframes-intent-memory-<run-id>`; never use the current workspace. Run `node <MEDIA_DIR>/scripts/prefs.mjs get --hyperframes <MEMORY_ROOT> --json`. Make each remembered value the recommended option and name its source. The pre-project probe sees only the personal tier; do not claim project provenance.
- **Recipes.** Run `node <MEDIA_DIR>/scripts/recipe.mjs list --hyperframes <MEMORY_ROOT> --json`. If the user names a recipe, says “like last time,” or a recipe matches the probable route, ask whether to adopt it before other brief questions. When several match, list them and include “none.” An adopted recipe locks the fields it contains; ask only its missing fields and the run-shape questions. It does not remove review or render approval gates.

**2 — Triage the input.** What is the video about — a website (sold or shown), a PR, a topic, a music track, existing footage? For a genuinely exploratory request ("we need a video but I'm not sure what kind"), don't interrogate — one question at a time: the message first, then audience, then what exists to show — and close by **recommending** a route plus how the run will review: a text storyboard first, on a live board, with optional wireframe sketches before the full build (`../hyperframes-core/references/review-loop.md`). The user hears the process before any workflow starts.

**3 — Pick the route** (the route table and ambiguity rules in § 3), then open that route's entry in `references/route-briefs.md`. It lists the must-have questions to ask now, the **deferred asks** to announce, and whether the two run-shape questions apply.

**4 — The route's must-haves.** One question per field, recommended option first with its receipt (rules: `../hyperframes-core/references/brief-contract.md` § 3). Skip a question only when the request already answered it — inference is not an answer. Then announce the route's deferred asks in one line ("after I probe the clip, I'll offer 2–3 caption identities") so the user hears the run's full shape before it starts.

**5 — The two run-shape questions** — where the route's entry applies them, asked after the must-haves, each on its own:

- **(a) Storyboard?** Review the plan, wireframe sketches, and the finished piece pass by pass on a live board (`../hyperframes-core/references/review-loop.md`) — recommended for anything beyond a couple of scenes — or skip the board and get one finished video from the confirmed brief.
- **(b) Automation or companion?** **Automation** — the matched workflow's pipeline executes the brief end to end. **Companion** — build it together in `/general-video` with every HyperFrames capability on the table; the route's answers still describe the video, general-video executes them.

These two are **orthogonal — never merge them into one menu.** All four `flow` × `storyboard` combinations are valid user choices (a companion run reviews on the live board too when `storyboard: yes`); a flattened three-option list ("storyboard review / one shot / companion") silently makes companion-with-storyboard unselectable. When a diagram or source material summarizes the outcomes as three branches, that is the derived behavior (`brief-contract.md` § 1), not the question shape. In a form-style question UI, keep (a) and (b) as two separate selects.

Signals replace questions, never add them: an ongoing "just build it" / "surprise me" / "don't ask" locks `flow: automation, storyboard: no`, and every unanswered field becomes a decision with a receipt in the heads-up. A storyboard request, however phrased, locks `storyboard: yes`. Remembered `flow` / `storyboard` values reorder the recommendations — they never make either question disappear. The run's collaborative/autonomous execution mode derives from these two answers — the old first question is never asked; the canonical mapping is `../hyperframes-core/references/brief-contract.md` § 1.

**6 — Nice-to-have: show what's possible.** Skip this step when the selected route brief says to skip the front-door capability offer. Otherwise, once the must-haves are locked, send one offer, not an interrogation: a route-filtered slice of `references/capability-menu.md`, plus two open asks — anything here you want, and is there any material of your own (images, clips, logos, data) the video should carry? The design spec has its own three-state ask: use an existing spec, pick a shipped preset by eye, or leave the decision to the workflow (`capability-menu.md` § The design ask). Capture the answer verbatim in `BRIEF.md` under `## Assets`, `## Customizations`, or `## Notes`. One round; silence or “no” moves on.

**7 — Hand off.** Present the locked brief as one summary — fields with receipts, deferred asks, the run's shape — then enter the workflow (`flow: companion` → `/general-video`; otherwise the matched route), installing it first per § 5. The workflow's Setup writes `BRIEF.md` from this summary as its **first action after `hyperframes init`** (never before — `init` refuses a non-empty directory), using canonical frontmatter values and preserving the user's important wording in the body. It then records the preference-backed fields (`../hyperframes-core/references/brief-format.md` names the subset), and asks no brief question again.

## 5. Install and enter the workflow

Before reading the selected workflow, install or refresh it and the core domain skills:

```bash
npx hyperframes skills update <workflow-name>
```

Use the bare name without `/`. If the command fails, surface the error; do not reconstruct the workflow from memory. Everything else about installation — the core-vs-lazy split, what `init` refreshes, diagnosis, CI opt-out, and the no-CLI fallback — lives in `references/skill-lifecycle.md`.

## 6. Load domain skills on demand

| Need                                                                                                                | Skill                    |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Composition structure, timing attributes, tracks, variables, determinism                                            | `/hyperframes-core`      |
| Motion rules, scene blueprints, transitions, runtime adapters                                                       | `/hyperframes-animation` |
| Seek-safe GSAP, CSS, Anime.js, WAAPI, FLIP, paths, masks, SVG, 3D keyframes, or `hyperframes keyframes` diagnostics | `/hyperframes-keyframes` |
| Design specs, concept, palette, typography, narration, beat planning                                                | `/hyperframes-creative`  |
| Images, icons, logos, audio, captions, grades, LUTs, reusable media                                                 | `/media-use`             |
| Init, lint, check, snapshots, compare, batch render, Studio, render, publish, or diagnostics                        | `/hyperframes-cli`       |
| Registry blocks and components                                                                                      | `/hyperframes-registry`  |
| Figma assets, tokens, components, or storyboard frames as reconstructed motion                                      | `/figma`                 |

Domain skills never take ownership of the end-to-end deliverable. Load only what the active workflow needs.
