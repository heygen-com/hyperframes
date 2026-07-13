# The intent layer — understand the video before any workflow runs

How every creation run starts: one conversation at the front door that turns "make me a video" into a confirmed brief — the route, the must-have answers, the run's shape, and everything else in the user's head — handed to whichever workflow executes and made durable as `BRIEF.md` (shape: `hyperframes-core/references/brief-format.md`). Workflows own execution; this layer owns understanding. Every workflow's opening rule points back here, so the questions are asked once no matter which door the user came through.

## When it runs — and when it must not

The intent layer serves **creation intent**: a new video (or deck, or motion graphic) is being asked for. It never fires for:

- **Edit requests** — "fix scene 3", "make the logo bigger", "swap the music": go do the work.
- **A briefed project** — `BRIEF.md` on disk: read it; ask nothing.
- **A pre-BRIEF project** — no `BRIEF.md` but `hyperframes.json` / `STORYBOARD.md` exist: resume from the storyboard's frontmatter (`mode:`, message, audience) plus the recorded preferences; you may backfill `BRIEF.md` from what they already say, but never re-interrogate a half-built project.

## The sequence

**1 — Memory before questions.** Two reads, both mandatory, before anything is asked:

- **Remembered defaults** — `node ../media-use/scripts/prefs.mjs get --hyperframes .`: every remembered value becomes the recommended option for its question, receipt naming the source ("1:1 — you confirmed this in world-cup-explained"). Pre-project this sees the personal tier (`~/.media`) only — don't claim project provenance it can't see.
- **Recipes** — `node ../media-use/scripts/recipe.mjs list --hyperframes .`: on a match (the user named one, said "like last time", or one exists for the probable route), ask one question first — one match: use recipe <name> (approved <date>)?; several: list them all and ask which one, or none. An adopted recipe answers the brief it froze — state those fields as locked with "from recipe <name>" receipts — leaving only the two run-shape questions and any field the recipe doesn't carry. A recipe fills in answers, not approvals: the run's review gates still stand.

**2 — Triage the input.** The router's Before-routing questions: what is the video about — a product, a general site, a PR, a topic, a music track, existing footage? For a genuinely exploratory request ("we need a video but I'm not sure what kind"), don't interrogate — one question at a time: the message first, then audience, then what exists to show.

**3 — Pick the route** (the router's cheat-sheet and disambiguation rules), then open that route's entry in `references/route-briefs.md`. It lists the must-have questions to ask now, the **deferred asks** to announce, and whether the two run-shape questions apply.

**4 — The route's must-haves.** One question per field, recommended option first with its receipt (rules: `hyperframes-core/references/brief-contract.md` § 3). Skip a question only when the request already answered it — inference is not an answer. Then announce the route's deferred asks in one line ("after I probe the clip, I'll offer 2–3 caption identities") so the user hears the run's full shape before it starts.

**5 — The two run-shape questions** — where the route's entry applies them, asked after the must-haves, each on its own:

- **(a) Storyboard?** Review the plan, wireframe sketches, and the finished piece pass by pass on a live board (`hyperframes-core/references/review-loop.md`) — recommended for anything beyond a couple of scenes — or skip the board and get one finished video from the confirmed brief.
- **(b) Automation or companion?** **Automation** — the matched workflow's pipeline executes the brief end to end. **Companion** — build it together in `/general-video` with every HyperFrames capability on the table; the route's answers still describe the video, general-video executes them.

Signals replace questions, never add them: an ongoing "just build it" / "surprise me" / "don't ask" locks `flow: automation, storyboard: no`, and every unanswered field becomes a decision with a receipt in the heads-up. A storyboard request, however phrased, locks `storyboard: yes`. Remembered `flow` / `storyboard` values reorder the recommendations — they never make either question disappear.

**6 — Nice-to-have: show what's possible.** Once the must-haves are locked, one message — an offer, not an interrogation: the capability menu (`references/capability-menu.md`) filtered to this route, plus two open asks — anything here you want? any material of your own (images, clips, logos, data) this video should carry? Capture what comes back verbatim; it lands in `BRIEF.md`'s body (`## Assets`, `## Customizations`, `## Notes`). One round; silence or "no" moves on.

**7 — Hand off.** Present the locked brief as one summary — fields with receipts, deferred asks, the run's shape — then enter the workflow (`flow: companion` → `/general-video`; otherwise the matched route), running `npx hyperframes skills update <workflow>` first as the router requires. The workflow's Setup writes `BRIEF.md` verbatim from this summary as its **first action after `hyperframes init`** (never before — `init` refuses a non-empty directory), then records the preference-backed fields (`brief-format.md` names the subset).

## Mode derivation

The old first question — collaborative or autonomous — is no longer asked. It derives from the two run-shape answers (canonical statement: `hyperframes-core/references/brief-contract.md` § 1): `automation` + `storyboard: yes` → collaborative execution, the review loop's gates live; `automation` + `storyboard: no` → autonomous execution, heads-ups with receipts and one question before render; `companion` → `/general-video`, conversational by nature — and its board still opens when `storyboard: yes`.
