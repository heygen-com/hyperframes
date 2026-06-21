# Story design — PR → narrative

Use this reference in Step 3 to write `STORYBOARD.md` and `SCRIPT.md` for a **PR-to-video** — a code change (the diff, commits, files, +/− stats, and the people behind it) turned into an explainer. There is **no website and no captured assets**; the PR was ingested into `capture/extracted/` in Step 1.

This file defines the story: what the video explains, in what order, and why each frame exists. It does not define layout, effects, animation, or file syntax. For exact storyboard syntax follow `../hyperframes-core/references/storyboard-format.md` and `../hyperframes-core/references/script-format.md`.

## Read first

1. `hyperframes.json` — locked brief: angle (archetype), audience, length, aspect, language.
2. `frame.md` — tone, type, design system (the shipped preset is **claude**: warm editorial, a serif that thinks, scarce coral, a navy code surface).
3. `capture/extracted/visible-text.txt` — the assembled PR brief: title, meta (`base ← head · +N/−M across F files`), people, body, commits, changed files, and a budget-bounded set of **representative diff hunks**. This is your source of **information**.
4. `capture/diff.patch` — the full unified diff, for deeper hunk selection than the brief's excerpt.
5. `capture/extracted/people.json` — contributors (author / committers / reviewers / commenters), bot-filtered, each with an avatar in `assets/<login>.png` (for an optional credits close).

## Output

- `STORYBOARD.md` — the explanation plan, one frame per beat.
- `SCRIPT.md` — the locked narration, only for spoken frames.

Every frame includes the required storyboard-format fields plus the narrative metadata below.

## Core rule

A diff is a list of edits. A video is a guided act of understanding.

Do **not** narrate the diff file-by-file or read the PR description aloud — that is the single most common failure. **Explain the change.** Reorder, merge, omit, compress: surface the one change that matters and drop the incidental churn (lockfile bumps, formatting, generated files) unless it _is_ the story. Scene order comes from narrative design, not from the diff's file order or the commit list.

Default to a **plain, technical, unhurried developer voice** — accurate, specific, no hype, no marketing gloss. You are explaining a real change to engineers; respect their time and intelligence. `frame.md` (claude) tunes the voice toward considered and literary; it does not change the structure.

## PR archetypes

Choose **one** archetype (or name a compound). Each is a complete path through understanding a change — do not splice phases from different archetypes.

- **Changelog** — "here's what shipped." Hook naming the headline → **2–4 roughly co-equal change items** → ship/wrap. Best for release PRs, multi-change PRs, "what's new in vN." Items are parallel → `cut` / `push-slide` between them. Rule-of-three is strongest when changes compress.
- **Feature-reveal** — "we built X; here's what it does." Hook (the new capability) → name it (`change`) → show it working: the new code typing on, the new behavior (`diff`) → why it matters (`impact`) → close. Best for a PR that adds **one notable feature**. The new code is the protagonist.
- **Fix-explainer** — "this was broken; here's the fix." Symptom/bug (`problem`) → root cause (`change`/`diff`) → the fix as a before→after (`diff`) → result, now it works (`impact`). Best for bugfix PRs. The before→after diff **is the turn**; real emotional shape (tension → turn → relief).
- **Refactor-walkthrough** — "same behavior, better shape." Hook (the smell / the why) → old shape → new shape → payoff (cleaner / faster / safer, with numbers). Best for refactors, perf, cleanups, migrations. Heavy on before→after **structure** and **numbers** (lines removed, perf delta, files touched).

**Choosing:** one notable new capability → feature-reveal; a bug fix → fix-explainer; a behavior-preserving cleanup/perf/migration → refactor-walkthrough; many co-equal changes / a release → changelog. Tie-breakers: a feature that also fixes a bug → feature-reveal with the fix as one body beat; a fix that needed a small refactor → fix-explainer (the fix is the headline). **Compound:** write `arc` as `"<outer> with <inner>"`, e.g. `"feature-reveal with changelog"`. Outer = the macro arc the viewer rides; inner = the body rhythm.

## PR-native frame types

Set each frame's `type` to one of these PR-native values. (The storyboard parser keeps `type` verbatim; it is a narrative + pacing label, not a hard enum.) Each maps to a claude frame treatment and a typical code animation block — so the type, the design, and the visual stay aligned end to end.

| `type`         | The frame's job                                             | claude treatment (frame.md)  | typical `code-*` block (see code-vocabulary.md) |
| -------------- | ----------------------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| `hook`         | The high-leverage opening 3–5s                              | Cover                        | — (or `code-3d-extrude` for a hero code moment) |
| `problem`      | The bug / smell / pain / why-care the PR resolves           | Statement or Pull-quote      | `code-highlight` (spotlight the offending line) |
| `change`       | Name the change / the feature / the PR itself               | Statement or Cover           | —                                               |
| `diff`         | The change body — a before→after, a hunk, new code typed on | **Code Surface** (navy)      | `code-diff` / `code-morph` / `code-typing`      |
| `before_after` | Explicit old-shape vs new-shape comparison (refactor/fix)   | Code Surface (split / morph) | `code-morph` / `code-diff`                      |
| `impact`       | The payoff — what now works, what's now possible            | Number / Impact              | `number-lockup` (no code block needed)          |
| `evidence`     | Concrete grounding — `+N/−M`, a passing test, a benchmark   | Number / Impact              | `code-diff` red→green / `number-lockup`         |
| `credits`      | Shipped-by close — the humans behind the change             | Closing                      | — (avatar row from `assets/<login>.png`)        |
| `cta`          | The closing ask — pull it, upgrade, read the PR             | Closing                      | — (coral-callout)                               |

The body of a PR video is usually a run of `diff` (the changes/hunks), interleaved with `impact` and `evidence`. Every PR has a change, so at least one `diff` (or `change`) frame always exists.

## Hook strategy

The hook is the highest-leverage 3–5 seconds. Pick one:

| Strategy               | When                                | Example                                                    |
| ---------------------- | ----------------------------------- | ---------------------------------------------------------- |
| Shocking statistic     | The change quantifies the stakes    | "This PR deletes 1,200 lines." / "40% faster cold starts." |
| Counterintuitive claim | The change contradicts intuition    | "We made the client slower — and that fixed it."           |
| Pain validation        | The audience already feels the bug  | "Every deploy, the same flaky timeout."                    |
| Concept announcement   | The change has a name worth landing | "Meet retry-with-backoff."                                 |
| Before/after teaser    | The diff is the whole story         | "One line threw. Now it recovers."                         |
| Stakes / consequence   | The "why care now" is a real cost   | "This crash hit every user on a flaky network."            |
| Direct address         | The audience is clearly defined     | "If you've ever waited on a 5-minute CI run…"              |

Do not open with a generic repo/company description.

## Clarity / rhetoric technique catalog

Each frame's `persuasion` is a **named** technique, not "explain the change." Combine when several are active:

- **Make-concrete** — Worked example (one real request/input) · Analogy (backoff as "knock, wait longer, knock again") · Concretization (abstract change → one tangible code line)
- **Reveal-in-order** — Progressive disclosure (the diff one line at a time) · Build-up (the simple call, then the edge case) · Signposting ("before… after…")
- **Contrast** — Before/after diff · Old shape vs new shape · The bug vs the fix · Two approaches compared
- **Structure** — Rule of three (three changes) · Numbered enumeration · Question→answer · Frame-then-fill (state the shape, then the code)
- **Evidence** — `+N/−M` stat · Passing test / green check · Benchmark / perf delta · Causal chain (request → 5xx → retry → success)
- **Memory & landing** — Callback (return to the hook's bug) · Distillation (the change in one line) · Generalization (this fix → the principle)

## Emotional beats

`beat` is one word or a short compound (e.g. "Recognition and relief"). Avoid generic "positive". A PR video rides a comprehension arc:

- **Negative valley** — _open the gap_ (`hook`/`problem`): curiosity · frustration · recognition · concern · "ugh, that bug"
- **Pivot** — _orient_ (`change`): clarity · orientation · anticipation · focus
- **Build** — _build understanding_ (`diff`/`before_after`/`impact`/`evidence`): comprehension · "aha" · confidence · momentum · conviction · relief (for a fix)
- **Resolution** — _land_ (`credits`/`cta`): satisfaction · resolve · "ship it" · inevitability

Compound beats are often strongest: "Recognition _and_ relief" (a fix), "Curiosity _and_ confidence" (a feature).

## The body is a sequence

A PR video's core is **2–5 body frames**, each advancing one change / one before→after / one item, building cumulatively:

- **changelog:** a `diff` per change item; parallel → default `cut` / `push-slide`.
- **feature-reveal:** `change` (name it) → `diff` (the code working, often typing/morphing on) → `impact`.
- **fix-explainer:** `problem` (symptom) → `diff` (cause + fix, before→after) → `impact` (result).
- **refactor-walkthrough:** `before_after` structure across the body → an `evidence` numbers beat.

## Continuity across frames

This framework builds **one frame per worker** — there is no multi-frame "continue run." A sequence reads as one continuous shot through two storyboard-level levers, both yours:

1. **A consistent stage** — consecutive body frames share one composition idea (the same navy code window filling in, the same before|after split, the same counter advancing), stated in each frame's `scene` so Step 4 and the workers keep the stage stable.
2. **A consistent transition** — pick one seam type for a run (`crossfade` for a soft code reveal, `push-slide` for the next change item) and repeat it.

When a single element genuinely _transforms_ between two ideas (the failing test flips green, the old function becomes the new one), keep it **within one frame** as a development beat (entrance → transform → settle) — the worker owns that motion (a `code-diff` or `code-morph` block). Note the intent in `scene` / narrative; Step 4 turns it into the block + `effects`.

## Transitions

Use only registry transition names in `transition_in`:

`cut | crossfade | blur-crossfade | push-slide LEFT | push-slide RIGHT | push-slide UP | push-slide DOWN | zoom-through | squeeze`

Pick 2–3 for the whole video and repeat. Frame 1 is `cut` (no previous frame). Match the seam to the narrative: ordered change items → a consistent `push-slide`; a soft reveal / into-the-cause → `crossfade` / `blur-crossfade`; zooming into a code line or pulling back to the file tree → `zoom-through`; a clean new change item → `cut`.

## The diff is the centerpiece

The body of a PR video lives on the **navy code surface** (claude's Code Surface treatment). Plan it deliberately:

- **Feature 2–4 real diff hunks**, named in each frame's `scene` — each a small, legible snippet (~4–12 lines), **never a whole file**. Pull them from `capture/diff.patch` / the brief's "Representative diff."
- Name **which code animation block** the frame wants in `scene` (the Step-4 visual phase and the worker read it). See `code-vocabulary.md` for the full map; the short version: before→after = `code-diff`; refactor/rename continuity = `code-morph`; new code written on = `code-typing`; spotlight one line = `code-highlight`; walk a long file = `code-scroll`; a hero reveal = `code-3d-extrude` / `code-particle-assemble`.
- Numbers (`+1,204 / −318`, files touched, perf delta) belong on an `impact` / `evidence` frame as a `number-lockup`, **not** read aloud in narration.

## Optional close: a credits / shipped-by scene

A PR is shipped by people. `capture/extracted/people.json` lists real contributors (bot-filtered), and Step 1 downloaded each avatar to `assets/<login>.png` (the `avatarFetched: true` entries — confirm with `ls assets/`). `reviewDecision` (e.g. `APPROVED`) is honest grounding.

> **The PR `author` only opened the PR — not necessarily who wrote the code.** A teammate often authors most commits. Lead the credits with `committer`s by `commitCount`, not the opener.

You **may** add one closing `credits` frame naming the humans — an avatar row with names + roles + an "approved" check. On that frame only, set `asset_candidates` to 2–6 entries of `assets/<login>.png — <login>, <role>` (commit authors by `commitCount` first, then reviewers; only `avatarFetched: true` logins). The body stays code-only — avatars appear **only** on this close, never decorating a diff frame. This is **optional and tasteful**: a one-line hotfix or a solo PR with no reviews doesn't need a credits roll; a feature or release the team rallied around earns one.

Every other frame has **no** `asset_candidates` (the visuals are invented downstream from `scene` + the diff).

## Per-frame length budget — ≤ 9 s, word count is the real measurement

The largest quality bug in PR videos is **scripts that talk too long**. TTS runs at **~2.2 words/second**, so a 45-word "7-second" script is really 20 seconds, and the visual phase has to pad the tail with idle drift (the video reads as "shimmering"). Budget by word count:

| Bound                      | Words (@2.2 wps) | Duration     | When                                                                          |
| -------------------------- | ---------------- | ------------ | ----------------------------------------------------------------------------- |
| **Soft target — default**  | **≤ 19**         | **≤ 9 s**    | Every frame aims here; the cut stays alive.                                   |
| **Exception — ≤ 2 frames** | ≤ 26             | ≤ 12 s       | The main `diff` (the one change you must explain) or a causal-chain `change`. |
| **Hard cap**               | > 26             | > 12 s       | Trim or split.                                                                |
| **Whole-film target**      | ≤ ~400           | up to ~3 min | Sweet spot ~30–90 s (≤ ~155 words); the body carries the load.                |

Estimate while writing: `duration ≈ ceil(word_count / 2.2)`. 29 words → 13s (trim); 17 words → 8s; 12 words → 6s. Trim techniques: cut the lead-in clause ("Until now, the agent shipped…" → "The agent shipped…"); move numbers off-script onto a counter; split only when the halves carry distinct beats (cause then effect). **Silent frames are allowed and common** — a diff typing on, a before→after morph, a counter running. Set `voiceover` empty, omit from `SCRIPT.md`, and make `narrativeRole` carry it. A complex change does not need a long script; it needs a careful one — if you can't headline the change in 19 words, the headline isn't sharp yet.

## Frame template

```md
## Frame N — Short name

- scene: one clear visual idea — name the hunk/file + the code-\* block ("the request() retry block, ~6 lines, code-diff")
- voiceover: "spoken guide text, or empty"
- duration: ceil(word_count / 2.2) seconds
- transition_in: crossfade
- status: outline
- src: compositions/frames/NN-short-name.html
- type: diff
- persuasion: Before/after contrast
- beat: comprehension

narrativeRole: What this frame does in the viewer's understanding (its job, not what's on screen).
keyMessage: The one thing the viewer should understand after this frame (one sentence).
```

The `credits` frame additionally carries an `asset_candidates:` line (see the credits section); no other frame does.

## Final checklist

- One archetype is named (compound only when explicit); the sequence is narrative-driven, not diff-order-driven.
- The opening uses a named hook strategy; you do not read the PR description aloud.
- Each frame has one job; the body builds cumulatively (a run of `diff` / `impact` / `evidence`), not a single isolated body frame.
- Every frame has `type` (PR-native), `persuasion` (a named technique), and `beat` (specific). The emotional arc matches the archetype (fix = frustration → relief; feature = curiosity → confidence).
- **2–4 real diff hunks** featured, each a small legible snippet (not a whole file), each naming its `code-*` block in `scene`.
- Transitions use only registry names and repeat 2–3 types; frame 1 is `cut`.
- `asset_candidates` is absent on every frame except an optional `credits` close (2–6 `assets/<login>.png` entries, `avatarFetched: true` only).
- Each `script` fits the budget — ≤ 19 words / ≤ 9 s default, ≤ 2 frames at the ≤ 26 / ≤ 12 s exception; `duration = ceil(word_count / 2.2)`, not a guess.
- `SCRIPT.md` contains only locked spoken narration; silent frames are intentional and omitted from it.
