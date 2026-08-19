# Brief contract

The intent layer (`/hyperframes` → `references/intent-interview.md`) asks creation questions once. The executing workflow writes the confirmed result to `BRIEF.md` and does not ask those questions again. This contract defines the canonical run-shape fields, shared brief fields, and question rules. Route-specific options live in `/hyperframes` → `references/routes/<workflow>.md`.

## Contents

- [Run shape](#1-run-shape)
- [Shared fields](#2-shared-fields)
- [Question protocol](#3-question-protocol)

## 1. Run shape

Three terms describe different concerns. Do not substitute one for another.

| Term         | Values                          | Owns                                                                                          |
| ------------ | ------------------------------- | --------------------------------------------------------------------------------------------- |
| `flow`       | `automation` or `companion`     | Who drives execution. `companion` always executes in `/general-video`.                        |
| `storyboard` | `yes` or `no`                   | Whether the live board is used for plan and layout review.                                    |
| `mode`       | `collaborative` or `autonomous` | How later preference and checkpoint gates behave. The user never chooses this label directly. |

Derive `mode` once from the confirmed run shape:

| `flow`       | `storyboard` | Derived `mode`  |
| ------------ | ------------ | --------------- |
| `companion`  | either value | `collaborative` |
| `automation` | `yes`        | `collaborative` |
| `automation` | `no`         | `autonomous`    |

Default to `collaborative` only when a legacy project lacks enough state to derive a mode. `/motion-graphics` is autonomous by design and does not need the two run-shape questions.

### Signals and persistence

- An ongoing signal such as “surprise me”, “decide for me”, “just build it”, or “stop asking” sets `flow: automation`, `storyboard: no`, and therefore `mode: autonomous` when it appears during intent capture.
- A bare “go” or “looks good” at a checkpoint accepts that checkpoint only. It does not change mode.
- After `STORYBOARD.md` exists, persist the derived mode in its frontmatter. On resume, an explicit `mode` in `STORYBOARD.md` overrides the derivation because it may represent a later user change.
- Mid-run “stop asking; finish it” changes only checkpoint behavior. Set `STORYBOARD.md` `mode` to `autonomous` when the file exists. Do not rewrite the already-confirmed `flow` or `storyboard` fields.
- Resume collaborative checkpoints only after an explicit signal such as “let's review together”; ordinary feedback does not change mode.

### Gate behavior

| Gate                                                                            | Collaborative                                                   | Autonomous                                                      |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| Preference: preset, voice, caption identity                                     | Ask when the workflow marks it as required.                     | Decide and state the choice with a one-line reason.             |
| Checkpoint: plan, sketches, pre-render review                                   | Ask and wait.                                                   | Post the same summary, then continue.                           |
| Quality: fetch completeness, `lint`, `hyperframes check`, workflow verification | Run and stop on errors.                                         | Run and stop on errors.                                         |
| Routing ambiguity                                                               | Resolve explicitly; a wrong route changes the deliverable.      | Same requirement.                                               |
| Sign-in or credential unavailable                                               | Show status and wait for sign-in or explicit offline selection. | Show status and continue through an available offline provider. |

Autonomous mode never silently drops a required capability. If the selected workflow has no local, cached, or offline provider for it, surface the blocker instead of omitting the capability. A credential problem does not relax the quality gates.

Rendering remains user-gated in both modes. After checks pass, collaborative runs ask “render now, or what changes?” Autonomous runs ask “preview first, or render?” Render only after the answer.

### Studio comments

Checkpoint feedback may arrive in chat or in `.hyperframes/frame-comments.json` (format: `storyboard-format.md`). When the user replies to a checkpoint, read that file before interpreting the chat reply. Apply only the named frame changes, delete the comments file after handling it, and re-present the affected frames. A board submission does not notify the agent, so tell the user to reply in chat after submitting comments.

Autonomous is not silent: replace absorbed questions with visible decisions and short reasons. Every autonomous visual or video delivery names the final preview or rendered artifact as applicable, reports the actual duration for a time-based deliverable, and includes a contact sheet or snapshot sheet plus relevant frame identifiers when available. For multi-scene work, use scene midpoints; for a single-scene piece, use one or more proof times. This gives the user a review surface even though intermediate checkpoints did not pause.

## 2. Shared fields

Ask only fields used by the selected route. Route entries identify their must-have questions and deferred questions. Values inferred or derived by policy are stated in the brief, not asked.

| Field         | Meaning                                              | Policy                                                                                                                                              |
| ------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flow`        | Who drives execution                                 | Ask at the end of intent capture when the route supports both flows. An autonomous signal answers it.                                               |
| `storyboard`  | Whether to review on the live board                  | Ask before `flow` when the route supports a board. A storyboard request answers it.                                                                 |
| `destination` | Where the video will play                            | Infer from the request. Ask only when unknown and the answer changes aspect, type scale, or composition.                                            |
| `aspect`      | Canvas size                                          | Derive from destination: social feed → `1080x1080`; TikTok/Reels/Shorts → `1080x1920`; YouTube/website/desktop → `1920x1080`. State the derivation. |
| `length`      | Target duration                                      | Let the workflow recommend a range supported by the material; include the reason.                                                                   |
| `language`    | Narration and caption language                       | Use the user's language and state it.                                                                                                               |
| `audience`    | Who will watch                                       | Infer when clear. Ask only when a different answer changes the story or terminology.                                                                |
| `message`     | The one thing the video must communicate             | Derive and echo one sentence. Do not storyboard until this is clear.                                                                                |
| `angle`       | Route-specific story shape                           | Recommend one route-defined option with a reason.                                                                                                   |
| `narration`   | `yes`, `minimal`, or `no`, plus route-specific modes | Follow the selected route.                                                                                                                          |

### Remembered defaults

Let `<MEDIA_DIR>` be the installed `/media-use` skill directory. Let `<MEMORY_ROOT>` be the existing project root. Before scaffolding, use a deliberately nonexistent probe path with no `.media` ancestor, such as `/tmp/hyperframes-intent-memory-<run-id>`; never use the current workspace as the probe. Read merged preferences with:

```bash
node <MEDIA_DIR>/scripts/prefs.mjs get --hyperframes <MEMORY_ROOT> --json
```

For the pre-project probe, `<MEMORY_ROOT>` is the nonexistent probe path, so only the personal tier can contribute. If that path already exists or contains `.media`, choose another. Do not claim project provenance before the real project exists.

A remembered value becomes the recommended answer and names its source. It never overrides the current request and never skips a required question. A confirmed recipe is different: adopting the bundle may fill the fields it contains because adoption itself is the confirmation.

Record only values the user confirmed, never values merely inferred or defaulted. Recording happens after the workflow writes `BRIEF.md`; supported keys are listed in `brief-format.md`. A user who sees the recommendation and accepts it has confirmed it. Personal defaults promote only according to `/media-use` memory rules.

The first time a project records a preference, say one short line that it will be remembered for future runs. Do not re-record a remembered value merely because an autonomous build reused it; only a confirmation in the current run creates a new memory event.

## 3. Question protocol

Follow these invariants:

1. Ask only unanswered fields that materially affect the output.
2. Ask one field per message and wait for its answer before asking the next field.
3. Put the recommended option first and attach a short reason. A numbered choice list is allowed, but every option in that list must answer the same field. Option lists fit factual fields (destination, length, language), where they scaffold recall; a creative field (message, angle, tone) the request has not already shaped takes an anchored open question — a list there steers the answer instead of collecting it.
4. Skip a question when the current request already answers it. Inference alone is not an answer.
5. Ask `storyboard` and then `flow` last, only for routes that support them.
6. Announce deferred questions before hand-off; do not surprise the user later.
7. When an autonomous signal appears, ask no remaining preference or checkpoint questions. State the completed brief and the reasons for decisions, then build.
8. Use native question UI when available. Otherwise send one plain-text question with one numbered option list; never place several fields in the same list.
9. Before the hand-off summary, run one integration check: look for a consequence the combined answers create that no single answer showed, and surface it with a proposed adjustment.
10. The hand-off summary separates fields the user stated from fields that were inferred or defaulted, with receipts on both.
11. Revision is not confirmation: after any correction to the summary, present the updated summary and confirm before executing.

At a checkpoint, “go” accepts that checkpoint's displayed recommendation. If a message explicitly presents a complete brief and says that “go” will accept every displayed default, then “go” may confirm that whole displayed brief; do not assume broader acceptance without that sentence.
