# Brief contract — interaction mode, shared brief fields, and question rules

Every creation workflow runs its intake step (Step 0 / brief) against this contract. It defines three things: the **interaction mode** (which controls all later gates, not just the brief), the **shared brief fields**, and the **question rules**. Each workflow maps these fields to its own values in its SKILL.md — including its enums, recommendation logic, and extra inputs. This file never includes workflow-specific content. Workflows without a real brief, such as `/motion-graphics`, use only § 1.

## 1. Interaction mode

There are two modes. Default: **collaborative**.

**Signals.**

- **Ongoing autonomous signals** — "autonomous", "surprise me", "decide for me", "just build it", "don't ask, just go", "LFG": the whole flow switches to autonomous from this point on.
- **One-time acceptance** — a bare "go" / "looks good" at a gate accepts only that gate's defaults; the mode does not change.
- The mode is set **once** — during routing (`/hyperframes`) or during the workflow brief — and **carries forward. No later step asks again.** Once a storyboard exists, record it in `STORYBOARD.md` frontmatter (`mode: autonomous`) so resumed sessions inherit it.
- **Mid-run switch**: "stop asking / just finish it" → autonomous for the rest of the run. Clear feedback on a heads-up → collaborative resumes at the next gate.

**Gate types.** Autonomous mode changes only the first two types:

1. **Preference gates** (which preset, voice, caption identity, want a preview?) — autonomous: decide yourself and state the decision with a one-line reason. Never stay silent.
2. **Checkpoint gates** (storyboard approval, pre-render review) — autonomous: post the same summary you would have asked about as an inline heads-up, then continue without waiting.
3. **Quality gates** (`lint` / `validate` / `inspect`, capture completeness, fetch failures, workflow-specific verification checklists) — never skip these in any mode. Errors still stop the run. Reasoning like "autonomous means bias toward action, so I'll skip verification" misuses the mode — bias toward action applies to deciding _what to build_, not _whether to verify_.
4. **Routing and sign-in decisions** — wrong routing is a quality problem: an ambiguous-intent confirmation, such as `/slideshow`'s "is this a deck?", still happens in autonomous mode. Auth sign-in follows `/media-use` → Preflight: show the status as-is; collaborative waits for the user's choice, while autonomous notes it and continues offline.

**Autonomous is not silent.** Every question absorbed by the mode becomes a decision with a receipt — state the choice and its one-line reason inline as you go. Final delivery always includes the contact sheet, so review happens after the fact instead of not happening at all.

## 2. Field registry

The shared brief fields. Each workflow's SKILL.md declares which fields it uses, its own value set, how it derives recommendations, and — decisively — marks each field **ask** (always gets its own question) or **state** (stated in the intro text, never asked). The binding table's ask/state marking is authoritative; the default policies below apply only when a binding doesn't say otherwise. If a workflow does not use a field, such as `/music-to-video` having no narration, that field is simply absent from its binding — don't ask about it.

| Field         | Meaning                                                               | Default policy                                                                                                                                                                                                                   |
| ------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mode`        | collaborative / autonomous (§ 1)                                      | detect signals; never ask again                                                                                                                                                                                                  |
| `destination` | where the video will play (X / LinkedIn feed, YouTube, TikTok, embed) | infer from the request; if unknown **and** it would change aspect or type scale, include ONE question in the brief                                                                                                               |
| `aspect`      | canvas                                                                | derive from destination — social **feed** (X / LinkedIn / Instagram) → square `1080x1080`; TikTok / Reels / Shorts → `1080x1920`; YouTube / website embed / unknown-desktop → `1920x1080`. State the derivation; never ask twice |
| `length`      | target duration                                                       | the workflow derives its own recommendation and states the reason                                                                                                                                                                |
| `language`    | narration + captions                                                  | use the user's language — state it, don't ask                                                                                                                                                                                    |
| `audience`    | who will watch                                                        | infer from the input; confirm only when it would change the beats                                                                                                                                                                |
| `message`     | the ONE thing the video must communicate                              | derive it and echo it in the brief — if the message cannot be stated in one sentence, the video is not ready for storyboarding                                                                                                   |
| `angle`       | what kind of story (workflow enum)                                    | workflow-specific values; recommend one with a receipt                                                                                                                                                                           |
| `narration`   | yes / minimal / no (+ workflow slots such as `VO_MODE`)               | workflow-specific                                                                                                                                                                                                                |

## 3. Question rules

- **Parse the prompt first.** Only ask for what the user has not already specified, and never ask them to confirm what they already said. Pre-fill anything `/hyperframes` or an earlier step has locked.
- **One round, one question per asked field.** Bundle the brief into a single round: every field the workflow's binding marks **ask** gets its own question (native UI: one multi-question call — e.g. angle / length / destination as separate questions), leading with the recommended default plus its receipt; every **state** field goes in the intro text. The ask/state split is fixed by the binding table — **never drop a question because its answer looks inferable**; confidence sharpens the recommended default, it doesn't remove the question. "go" accepts all defaults.
- **Advertise the mode, don't ask it.** Every brief carries a one-line legend: `"go" accepts all defaults · "surprise me" / "just build it" hands me every later decision (autonomous — no more questions, each call comes with its reason)`. In plain text, end the brief message with it; with a native question UI (`AskUserQuestion` or equivalent), put it in the short intro text you send **before** the question call — the UI has no message tail. The mode never gets its own question or option; the legend text is the only place it appears.
- **Receipts.** A recommendation without a reason is a guess — every default states where it came from, for example: "~40s — small change, +44/−13 across 12 files".
- **Channel.** When the environment has a native question UI (`AskUserQuestion` or equivalent), using it for the **ask** fields is **mandatory** in collaborative mode — one multi-question call, each question offering 2–4 options with the recommended one first. A plain-text "here's the brief, reply 'go'" statement is NOT a substitute; that shape is reserved for autonomous mode's heads-up. Only in an environment with no native UI, ask in plain text as one numbered list. Use 2–5 questions max per round.
- **Autonomous brief.** Don't ask at all — state the locked brief, including all fields and receipts, as a heads-up and proceed.
