# The intent layer — one conversation, before any workflow runs

Fresh creation only — the SKILL.md state table already decides whether this layer runs at all (edits, project operations, briefed and resumable projects, and explicit Remotion ports never enter it). One conversation at the front door turns "make me a video" into a confirmed brief — the route, the must-have answers, the run's shape, and everything else in the user's head — handed to whichever workflow executes and made durable as `BRIEF.md`. Workflows own execution; this layer owns understanding. Every workflow's opening rule points back here, so the questions are asked once no matter which door the user came through.

These reads are mandatory when their condition matches; do not replace them with recollection:

| Condition                                                   | Read before acting                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| The route is picked, before confirming or interviewing      | `routes/<workflow>.md` — the whole file (contract + interview, ~1KB) |
| Triage judged the request unformed, before any concept work | `pitch-round.md`                                                     |
| Offering optional capabilities or collecting supplied media | The route-filtered rows in `capability-menu.md`                      |
| Question rules or field semantics beyond the schema below   | `../../hyperframes-core/references/brief-contract.md`                |

## Adapt orthogonal inputs first

A Figma source changes **how assets and design enter the project**, not which workflow owns the deliverable. If any input is a `figma.com` URL: complete this layer's memory and recipe reads; during input triage run `/figma` to extract assets, brand tokens, components, and storyboard frames when present; route the requested deliverable using the output from `/figma`, then continue only the selected route's unanswered questions. Do not drive Figma through raw MCP tools — that bypasses SVG sanitization, `.media/manifest.jsonl` provenance, and brand-token `var()` binding.

A GitHub PR URL is not a website source. A named or adopted recipe already carries its workflow; confirm adoption below, then route to that workflow.

## The eight steps

**1 — Memory before questions.** Two reads, both mandatory, before anything is asked:

- **Remembered defaults.** Let `<MEDIA_DIR>` be the installed `/media-use` skill directory. For an existing project, `<MEMORY_ROOT>` is its root. Before scaffolding, use a deliberately nonexistent probe path with no `.media`, such as `/tmp/hyperframes-intent-memory-<run-id>`; never use the current workspace. Run `node <MEDIA_DIR>/scripts/prefs.mjs get --hyperframes <MEMORY_ROOT> --json`. Make each remembered value the recommended option and name its source. The pre-project probe sees only the personal tier; do not claim project provenance.
- **Recipes.** Run `node <MEDIA_DIR>/scripts/recipe.mjs list --hyperframes <MEMORY_ROOT> --json`. If the user names a recipe, says "like last time," or a recipe matches the probable route, ask whether to adopt it before other brief questions — and make the offer earn the yes: say why it matches and what adopting saves ("this matches your launch-promo recipe — adopting fills destination, aspect, language, and the design spec; you'd confirm the message and the two run-shape questions"). When several match, list them and include "none." An adopted recipe locks the fields it contains; ask only its missing fields and the run-shape questions. It does not remove review or render approval gates.

**2 — Triage the input.** What is the video about — a website (sold or shown), a PR, a topic, a music track, existing footage? And is the request **formed** — the message, the material, and the occasion readable from what the user gave — or **unformed**, a subject with no take on it? Source material doesn't settle this by itself: a site, document, or PR carries its own thesis, but five tellings of that thesis are five different videos — a request whose only shape comes from its source ("make a video about this URL") is formed about the facts and unformed about the telling, and enters the round to pitch the telling. A formed request runs the layer exactly as it always has; nothing below is added for it. An unformed one goes through the pitch round after routing (step 4) and earns one question here, before anything is generated: what is the user already picturing? Their answer seeds the round (`pitch-round.md`). A user who says they don't know video at all gets that reference's decision map instead of a question sequence. For a genuinely exploratory request ("we need a video but I'm not sure what kind"), don't interrogate — establish the subject and what exists to show, one question at a time, then close by **recommending** a route plus how the run will review: a text storyboard first, on a live board, with optional wireframe sketches before the full build (`../../hyperframes-core/references/review-loop.md`). The user hears the process before any workflow starts.

**3 — Pick the route** (the route table and ambiguity rules in the SKILL.md), then read `routes/<workflow>.md`. Its Interview section lists the must-have questions to ask now, the **deferred asks** to announce, whether the two run-shape questions apply, and which fields the pitch round may answer.

**4 — The pitch round** — unformed requests only; formed requests and recipe adoptions go straight to the must-haves. Sample five concepts along five genuinely different paths, at least two from the distribution's tail, and present them all before recommending one — pick, mix, and redirect are all answers. Each pitch names the capability or two it rides, in the plain language of `capability-menu.md` — the toolbox experienced as concepts, not listed as a menu. On an autonomous run the same gate runs internally, and the heads-up names the direction chosen and the typical one left behind. The procedure — the sampling gate, the presentation discipline, and the decision map for users new to video — is `pitch-round.md`. The chosen concept answers the route's pitch-eligible fields and lands in `BRIEF.md` under `## Intent`; the capabilities it named are confirmed with it, under `## Customizations`.

**5 — The route's must-haves.** One question per field, recommended option first with its receipt (rules: `../../hyperframes-core/references/brief-contract.md` § 3). Skip a question only when the request already answered it — inference is not an answer, but a chosen pitch is: fields the pitch round settled are locked with the pitch as their receipt. Then announce the route's deferred asks in one line ("after I probe the clip, I'll offer 2–3 caption identities") so the user hears the run's full shape before it starts.

**6 — The two run-shape questions** — where the route's entry applies them, asked after the must-haves, each on its own:

- **(a) Storyboard?** Review the plan, wireframe sketches, and the finished piece pass by pass on a live board (`../../hyperframes-core/references/review-loop.md`) — recommended for anything beyond a couple of scenes — or skip the board and get one finished video from the confirmed brief.
- **(b) Automation or companion?** **Automation** — the matched workflow's pipeline executes the brief end to end. **Companion** — build it together in `/general-video` with every HyperFrames capability on the table; the route's answers still describe the video, general-video executes them.

These two are **orthogonal — never merge them into one menu.** All four `flow` × `storyboard` combinations are valid user choices (a companion run reviews on the live board too when `storyboard: yes`); a flattened three-option list ("storyboard review / one shot / companion") silently makes companion-with-storyboard unselectable. When a diagram or source material summarizes the outcomes as three branches, that is the derived behavior (`brief-contract.md` § 1), not the question shape. In a form-style question UI, keep (a) and (b) as two separate selects.

Signals replace questions, never add them: an ongoing "just build it" / "surprise me" / "don't ask" locks `flow: automation, storyboard: no`, and every unanswered field becomes a decision with a receipt in the heads-up. A storyboard request, however phrased, locks `storyboard: yes`. Remembered `flow` / `storyboard` values reorder the recommendations — they never make either question disappear. The run's collaborative/autonomous execution mode derives from these two answers — the old first question is never asked; the canonical mapping is `../../hyperframes-core/references/brief-contract.md` § 1.

**7 — Nice-to-have: recommend, then show.** Skip this step when the selected route file says to skip the front-door capability offer. Otherwise, once the must-haves are locked, send one offer, not an interrogation — recommendations first, catalog on request. Capabilities the chosen pitch already named are settled with the concept — this step recommends from what the pitch didn't cover, and after a pitch round it is often just the two open asks and the design ask:

- **One or two rows** of `capability-menu.md` that this brief specifically calls for, each traced to something in the confirmed concept — a key number wants the count-up treatment, product shots want staging and a grade, a music bed means cuts on its grid. A suggestion that would fit any video fails that test; drop it. At most one may be a labeled **challenger**: higher ceiling, named cost ("the standard cut carries it; shader transitions would lift the close, at render-time cost").
- **Material answered on arrival.** When the user hands over a logo, a clip, or data, answer with its concrete use ("the logo could close the video as a sting — want that?") rather than silently filing it.
- **The two open asks stay:** anything here you want, and is there any material of your own (images, clips, logos, data) the video should carry?
- **The design spec keeps its own three-state ask** — use an existing spec, pick a shipped preset by eye, or leave the decision to the workflow (`capability-menu.md` § The design ask).

The full route-filtered slice appears only when the user asks what else is possible. An accepted recommendation is a confirmed answer: when it lands on a preference-backed field (a preset, a voice, a caption identity), it records like any other confirmation, and `/media-use`'s promotion rules make it the next run's recommended default. Capture answers verbatim in `BRIEF.md` under `## Assets`, `## Customizations`, or `## Notes`. One round; silence or "no" moves on.

**8 — Hand off.** Three disciplines close the conversation (invariants: `../../hyperframes-core/references/brief-contract.md` § 3):

- **One integration check.** Read the combined answers for a consequence no single answer showed — vertical at 90 seconds with a chart-dense concept means charts a phone can't read — and surface it with a proposed adjustment now, not at the sketch pass.
- **Stated and inferred, apart.** Present the locked brief as one summary — deferred asks and the run's shape included — with what the user answered and what was inferred or defaulted as two visibly separate groups, receipts on both. The inferred group is where corrections live; an autonomous heads-up is mostly that group.
- **Revision is not confirmation.** When the user corrects the summary, fold the change in and present it again; never execute an edited-but-unconfirmed brief.

Then enter the workflow (`flow: companion` → `/general-video`; otherwise the matched route), installing it first per the SKILL.md's install step. The workflow's Setup writes `BRIEF.md` from this summary as its **first action after `hyperframes init`** (never before — `init` refuses a non-empty directory), using the canonical frontmatter below and preserving the user's important wording in the body — the chosen pitch, when there is one, under `## Intent`. It then records the preference-backed fields (`../../hyperframes-core/references/brief-format.md` names the subset), and asks no brief question again.

## BRIEF.md frontmatter — the carry-away artifact

The interview's deliverable. Every later "what did the route require?" re-reads this ~1KB file, never this document. One key per confirmed field, canonical normalized values (full shape and body sections: `../../hyperframes-core/references/brief-format.md`):

| Key                                                                       | Meaning                                                                                                 | Example                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------- |
| `workflow`                                                                | the executing workflow (companion runs record `general-video`)                                          | `faceless-explainer`        |
| `flow`                                                                    | `automation` — the matched workflow's pipeline · `companion` — co-creation in `/general-video`          | `automation`                |
| `storyboard`                                                              | `yes` — plan, sketches, and build reviewed on the live board · `no` — one shot from the confirmed brief | `yes`                       |
| `message`                                                                 | the ONE thing the video must communicate                                                                | `"Ship it in an afternoon"` |
| `destination` / `aspect` / `language` / `audience` / `length` / `angle` … | the registry fields this route confirmed                                                                | —                           |
