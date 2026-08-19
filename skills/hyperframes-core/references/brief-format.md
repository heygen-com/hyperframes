# Brief format — `BRIEF.md`

Defines the **intent document** — the file a confirmed brief becomes. The questions that fill it live in the intent layer (`/hyperframes` → `references/intent-interview.md` + its `references/routes/<workflow>.md`); the field semantics live in `brief-contract.md` § 2. This file defines only the artifact: its shape, its home, and its lifecycle.

`BRIEF.md` sits at the project root, and the project's files read as four layers: **`BRIEF.md`** (why, for whom, and everything the user asked for) → **`STORYBOARD.md`** (what, frame by frame) → **`frame.md`** (how it looks) → **`compositions/`** (the thing itself).

## Frontmatter — the confirmed fields

YAML block at the top: one key per deterministic field — the run's shape first, then the registry fields (`brief-contract.md` § 2) used by the route. Store canonical normalized values. Some values come directly from the user; others, such as `workflow`, `aspect`, and `language`, are routed, derived, or normalized and must use the vocabulary defined by the contract. Preserve the user's own wording in the body when it matters.

| Key                                                                       | Meaning                                                                                                                    | Example                     |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `workflow`                                                                | the executing workflow (companion runs record `general-video`)                                                             | `faceless-explainer`        |
| `flow`                                                                    | `automation` — the matched workflow's pipeline · `companion` — co-creation in `/general-video`                             | `automation`                |
| `storyboard`                                                              | `yes` — plan, sketches, and build reviewed on the live board (`review-loop.md`) · `no` — one shot from the confirmed brief | `yes`                       |
| `message`                                                                 | the ONE thing the video must communicate                                                                                   | `"Ship it in an afternoon"` |
| `destination` / `aspect` / `language` / `audience` / `length` / `angle` … | the registry fields this route confirmed                                                                                   | —                           |

**Which keys are memory.** Only the preference-backed subset — `destination`, `aspect`, `language`, `flow`, `storyboard`, `voice`, `style_preset` — is recorded with `media-use` → `scripts/prefs.mjs record` (the store rejects any other key). `style_preset` is stored per workflow: record it with `--workflow <w>` (the store refuses it bare — a look confirmed for one genre is not a default for the others). `message`, `audience`, `length`, `angle` live in the frontmatter only: they describe this video, not the user.

## Body — the intent in prose

Four sections, each optional — write what the intent layer actually learned, omit what it didn't:

- `## Intent` — a short paragraph: what the video is, for whom, why now; tone and feel in the user's own words.
- `## Assets` — the user's own material, one line each: `path — what it is, where it belongs`. Files named here are staged by the workflow, never re-discovered.
- `## Customizations` — capabilities the user opted into from the menu (`/hyperframes` → `references/capability-menu.md`) and any bespoke asks ("count-up on the revenue stat", "capture the pricing page too"), each with enough detail to act on.
- `## Notes` — everything true that fits no field: constraints, references, things to avoid.

Body prose is **project-local** — nothing in it enters cross-project memory. (Frozen recipes carry a blanked skeleton of it; a future prose-memory layer would extract from here, under its own approval rules.)

## Lifecycle

- **Created once, by the workflow's Setup, as its first action after `hyperframes init`** — never before (`init` refuses a non-empty directory). The intent layer confirms the answers pre-project; Setup makes them durable, then records the preference-backed fields. Later confirmed changes update this same file.
- **It is the no-repeat token.** A workflow that finds `BRIEF.md` reads it and asks no brief question. Its `workflow:` names the executor — a workflow that finds another's name there is in the wrong room: load that skill and hand over, don't re-route through the intent layer. No `BRIEF.md` but the project exists (`hyperframes.json` / `STORYBOARD.md` on disk) → a pre-BRIEF project: resume from the storyboard's frontmatter and the recorded preferences, optionally backfilling `BRIEF.md` from what they already say — never re-interrogate a half-built project.
- **It stays the run's truth.** A mid-run decision updates it as it happens: an explicit change to a frontmatter field ("make it 9:16 after all") rewrites the field and re-records the preference — a changed mind is a confirmed answer; an accepted capability, adopted material, or bespoke ask lands as one line in the matching body section. Resume reads this file, so write-back is what makes a dead session resumable — a decision that lives only in chat is a decision resume never sees.
- **Execution mode derives; the storyboard's copy wins on resume.** `flow` × `storyboard` derive collaborative/autonomous checkpoint behavior (`brief-contract.md` § 1). Persist the derived mode in `STORYBOARD.md` frontmatter when that file exists. A mid-run mode-only switch updates `STORYBOARD.md`, not the already-confirmed `flow` or `storyboard`; an explicit change to either run-shape field still updates `BRIEF.md`.
- **`message` / `audience` live here first.** `STORYBOARD.md` frontmatter keeps its copies — the board and the parser read them — but when the two disagree, `BRIEF.md` holds what the user confirmed.
- **Recipes carry its skeleton.** Freezing a recipe (`review-loop.md` § 4) captures `brief-skeleton.md` — frontmatter structure kept, run-shape and content values blanked — so the next run starts pre-filled yet still confirms its own two run-shape answers.

## Example

```markdown
---
workflow: faceless-explainer
flow: automation
storyboard: yes
message: "Compound interest is a snowball, not a ladder"
destination: x-feed
aspect: 1080x1080
language: en
length: 60s
angle: concept
---

## Intent

Teach retail investors why starting early beats contributing more. Confident,
a little playful — closer to a bar-napkin sketch than a lecture.

## Assets

- public/growth-curve.png — the real 30-year S&P chart; the proof beat builds on it.

## Customizations

- Count-up on the final dollar figure.

## Notes

- No stock-photo aesthetics; keep it typographic.
```
