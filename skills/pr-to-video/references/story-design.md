# Story design — PR → narrative

Use this reference in Step 3 to write `STORYBOARD.md` and `SCRIPT.md` for a **PR-to-video** — a code change (the diff, commits, files, +/− stats, and the people behind it) turned into an explainer. There is **no website and no captured assets**; the PR was ingested into `capture/extracted/` in Step 1.

This file defines the story: what the video explains, in what order, and why each frame exists. It does not define layout, effects, animation, or file syntax. For exact storyboard syntax follow `../hyperframes-core/references/storyboard-format.md` and `../hyperframes-core/references/script-format.md`.

## Read first

1. `hyperframes.json` — locked brief: angle (archetype), audience, length, aspect, language.
2. `frame.md` — tone, type, design system (the shipped preset is **code-editorial**: warm editorial, a serif that thinks, scarce coral, a navy code surface).
3. `capture/extracted/visible-text.txt` — the assembled PR brief: title, meta (`base ← head · +N/−M across F files`), people, body, commits, changed files, and a budget-bounded set of **representative diff hunks**. This is your source of **information**.
4. `capture/diff.patch` — the full unified diff, for deeper hunk selection than the brief's excerpt.
5. `capture/extracted/people.json` — contributors (author / committers / reviewers / commenters), bot-filtered, each with an avatar in `assets/<login>.png` (for the credits close).

## Output

- `STORYBOARD.md` — the explanation plan, one frame per beat.
- `SCRIPT.md` — the locked narration, only for spoken frames.

Every frame includes the required storyboard-format fields plus the narrative metadata below.

## Core rule

A diff is a list of edits. A video is a guided act of understanding.

Do **not** narrate the diff file-by-file or read the PR description aloud — that is the single most common failure. **Explain the change** — and where the change has a runtime behavior, **show that behavior in motion** (a `mechanism` beat — see "Show the behavior" below), don't just display the lines that changed. Reorder, merge, omit, compress: surface the one change that matters and drop the incidental churn (lockfile bumps, formatting, generated files) unless it _is_ the story. Scene order comes from narrative design, not from the diff's file order or the commit list.

**Value before evidence** (`../hyperframes-creative/references/story-spine.md`): the viewer-facing payoff — what the change unlocks, fixes, or speeds up — lands by the second beat; the diff and the mechanism are the **evidence** for that claim, never the opening. Implementation is the footnote of the story, not the spine.

Default to a **plain, technical, unhurried developer voice** — accurate, specific, no hype, no marketing gloss. You are explaining a real change to engineers; respect their time and intelligence. `frame.md` (code-editorial) tunes the voice toward considered and literary; it does not change the structure.

## PR archetypes

Choose **one** archetype (or name a compound). Each is a complete path through understanding a change — do not splice phases from different archetypes.

- **Changelog** — "here's what shipped." Hook naming the headline → **2–4 roughly co-equal change items** → ship/wrap. Best for release PRs, multi-change PRs, "what's new in vN." Items are parallel → `cut` / `push-slide` between them. Rule-of-three is strongest when changes compress. An item with a visible behavior can be a `mechanism` mini-demo instead of a bare `diff`.
- **Feature-reveal** — "here's what you can do now." Hook (the outcome the feature unlocks, in user language) → the payoff made concrete (`impact` — what now works) → name it (`change`) → the new code typing on (`diff`) → **animate what it does (`mechanism`)** → close (a callback to the promise). Best for a PR that adds **one notable feature**. The promise leads and the code proves it: `diff` and `mechanism` are the evidence for the opening claim — the viewer should already care before the first line of code appears.
- **Fix-explainer** — "this was broken; here's the fix." Symptom/bug (`problem`) → **animate the broken behavior (`mechanism`)** → the fix as a before→after (`diff`) → **the behavior now working (`mechanism`)** or the result (`impact`). Best for bugfix PRs. Seeing the bug _happen_ and then _not_ happen is the turn — a stronger shape (tension → turn → relief) than the diff alone.
- **Refactor-walkthrough** — "same behavior, better shape." Hook (the smell / the why) → old shape vs new shape (`before_after`) → **the structure untangling, same inputs → same outputs (`mechanism`)** → payoff (`evidence` — lines removed, perf delta, files touched). Best for refactors, perf, cleanups, migrations. A `mechanism` animation _proves_ "same behavior, better shape" far better than asserting it.

**Choosing:** one notable new capability → feature-reveal; a bug fix → fix-explainer; a behavior-preserving cleanup/perf/migration → refactor-walkthrough; many co-equal changes / a release → changelog. Tie-breakers: a feature that also fixes a bug → feature-reveal with the fix as one body beat; a fix that needed a small refactor → fix-explainer (the fix is the headline). **Compound:** write `arc` as `"<outer> with <inner>"`, e.g. `"feature-reveal with changelog"`. Outer = the macro arc the viewer rides; inner = the body rhythm.

## PR-native frame types

Set each frame's `type` to one of these PR-native values. (The storyboard parser keeps `type` verbatim; it is a narrative + pacing label, not a hard enum.) Each maps to a code-editorial frame treatment and a typical visual — so the type, the design, and the visual stay aligned end to end. Note `mechanism` is the **show-the-behavior** beat (an invented animated diagram), distinct from `diff` (show the code).

| `type`         | The frame's job                                                                                                             | code-editorial treatment (frame.md)                                | typical visual (see code-vocabulary.md)                                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `hook`         | The high-leverage opening 3–5s                                                                                              | Cover                                                              | — (or `code-3d-extrude` for a hero code moment)                                         |
| `problem`      | The bug / smell / pain / why-care the PR resolves                                                                           | Statement or Pull-quote                                            | `code-highlight` (spotlight the offending line)                                         |
| `change`       | Name the change / the feature / the PR itself                                                                               | Statement or Cover                                                 | —                                                                                       |
| `diff`         | The change body — a before→after, a hunk, new code typed on                                                                 | **Code Surface** (navy)                                            | `code-diff` / `code-morph` / `code-typing`                                              |
| `before_after` | Explicit old-shape vs new-shape comparison (refactor/fix)                                                                   | Code Surface (split / morph)                                       | `code-morph` / `code-diff`                                                              |
| `mechanism`    | **Show what the change DOES at runtime** — the request retrying, the cache filling, serial→parallel, the race resolved      | invented diagram on cream (hairline ink + one coral active marker) | **invented SVG/GSAP**; `flowchart` / `flowchart-vertical` / `data-chart` where they fit |
| `impact`       | The payoff — what now works, what's now possible; opens the video as the promise (feature-reveal) or lands it as the result | Number / Impact                                                    | `number-lockup` (no code block needed)                                                  |
| `evidence`     | Concrete grounding — `+N/−M`, a passing test, a benchmark                                                                   | Number / Impact                                                    | `code-diff` red→green / `number-lockup`                                                 |
| `credits`      | Shipped-by close — the humans behind the change                                                                             | Closing                                                            | — (avatar row from `assets/<login>.png`)                                                |
| `cta`          | The closing ask — pull it, upgrade, read the PR                                                                             | Closing                                                            | — (coral-callout)                                                                       |

The body of a PR video **alternates `diff` (show the code that changed) with `mechanism` (show what it does at runtime)**, landing on `impact` / `evidence` (the result). A body that is all `diff` reads as code show-and-tell — the `mechanism` beat is what makes the change _legible_ and is the usual cure for a video that feels flat. Every PR has a change, so at least one `diff` (or `change`) frame always exists; most PRs also have a behavior worth animating.

## Hook strategy

The hook is the highest-leverage 3–5 seconds. Pick one:

| Strategy               | When                                | Example                                                                |
| ---------------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| Shocking statistic     | The change quantifies the stakes    | "This PR deletes 1,200 lines." / "40% faster cold starts."             |
| Counterintuitive claim | The change contradicts intuition    | "We made the client slower — and that fixed it."                       |
| Pain validation        | The audience already feels the bug  | "Every deploy, the same flaky timeout."                                |
| Concept announcement   | The change has a name worth landing | "Meet retry-with-backoff — flaky networks stop killing your requests." |
| Before/after teaser    | The diff is the whole story         | "One line threw. Now it recovers."                                     |
| Stakes / consequence   | The "why care now" is a real cost   | "This crash hit every user on a flaky network."                        |
| Direct address         | The audience is clearly defined     | "If you've ever waited on a 5-minute CI run…"                          |

Do not open with a generic repo/company description. Whatever the strategy, the hook speaks the **viewer's outcome language** (story-spine rule 1) — never file / function / identifier names; numbers only when they carry stakes ("40% faster"), not inventory ("23 files changed").

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

A PR video's core is **2–5 body frames**, each advancing one change / one before→after / one item, building cumulatively. **Alternate `diff` (the code) with `mechanism` (the behavior)** — don't stack code surfaces:

- **changelog:** a `diff` (or a `mechanism` mini-demo) per change item; parallel → default `cut` / `push-slide`.
- **feature-reveal:** `impact` (the promise, concrete) → `change` (name it) → `diff` (the code, often typing/morphing on) → `mechanism` (animate it working) → a closing callback to the promise.
- **fix-explainer:** `problem` (symptom) → `mechanism` (the bug happening) → `diff` (cause + fix, before→after) → `impact` (result, or a `mechanism` of it working).
- **refactor-walkthrough:** `before_after` structure → `mechanism` (the structure untangling, behavior preserved) → an `evidence` numbers beat.

## Continuity across frames

This framework builds **one frame per worker** — there is no multi-frame "continue run." A sequence reads as one continuous shot through two storyboard-level levers, both yours:

1. **A consistent stage** — consecutive body frames share one composition idea (the same navy code window filling in, the same before|after split, the same counter advancing), stated in each frame's `scene` so Step 4 and the workers keep the stage stable.
2. **A consistent transition** — pick one seam type for a run (`crossfade` for a soft code reveal, `push-slide` for the next change item) and repeat it.

When a single element genuinely _transforms_ between two ideas (the failing test flips green, the old function becomes the new one), keep it **within one frame** as a development beat (entrance → transform → settle) — the worker owns that motion (a `code-diff` or `code-morph` block). Note the intent in `scene` / narrative; Step 4 wraps it in a time-coded shot sequence around the block (a `code-diff` / `code-morph`).

## Transitions

Use only registry transition names in `transition_in`:

`cut | crossfade | blur-crossfade | push-slide LEFT | push-slide RIGHT | push-slide UP | push-slide DOWN | zoom-through | squeeze`

Pick 2–3 for the whole video and repeat. Frame 1 is `cut` (no previous frame). Match the seam to the narrative: ordered change items → a consistent `push-slide`; a soft reveal / into-the-cause → `crossfade` / `blur-crossfade`; zooming into a code line or pulling back to the file tree → `zoom-through`; a clean new change item → `cut`.

## The diff is the centerpiece

Code beats live on the **navy code surface** (code-editorial's Code Surface treatment) — but the body is **not** all code (pair them with `mechanism` beats, next section). Plan the code beats deliberately:

- **Feature 2–4 real diff hunks**, named in each frame's `scene` — each a small, legible snippet (~4–12 lines), **never a whole file**. Pull them from `capture/diff.patch` / the brief's "Representative diff."
- Name **which code animation block** the frame wants in `scene` (the Step-4 visual phase and the worker read it). See `code-vocabulary.md` for the full map; the short version: before→after = `code-diff`; refactor/rename continuity = `code-morph`; new code written on = `code-typing`; spotlight one line = `code-highlight`; walk a long file = `code-scroll`; a hero reveal = `code-3d-extrude` / `code-particle-assemble`.
- Numbers (`+1,204 / −318`, files touched, perf delta) belong on an `impact` / `evidence` frame as a `number-lockup`, **not** read aloud in narration.

## Show the behavior — the mechanism beat (not just the diff)

A diff shows **what changed in the code**. It does **not** show **what the change does** — and "what it does" is usually the more memorable, more explanatory beat. The single biggest reason a PR video feels flat is that every body frame is a code surface or a number: it _tells_ (here are the lines, here is the stat) but never _shows_ (here is the request actually recovering).

A **`mechanism` frame animates the runtime behavior** the PR changes — built as an **invented animated diagram** (SVG / HTML / GSAP on code-editorial's cream ground: hairline-ink nodes / edges / lanes, one coral marker on the active or changed element), where **the build _is_ the teaching** — each part appears on beat, the flow plays out across the shot. It is **not** a code block and **not** a headline. Reach for the `flowchart` / `flowchart-vertical` / `data-chart` registry blocks where they fit; otherwise invent it (visual-design.md's diagram / abstract-graphics register).

Plan **at least one `mechanism` beat** for any PR with a visible runtime behavior (most feature and fix PRs have one). What to animate, by what the change touches:

| The change touches…             | Animate (the behavior, not the code)                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| Retry / backoff / resilience    | a request lifecycle: fire → 500 → wait (delay growing) → retry → 200                               |
| Caching / memoization           | two lanes racing: cold (slow, hits the DB) vs cached (fast, hits the cache)                        |
| Concurrency / parallelism       | a serial single lane reshaping into parallel lanes                                                 |
| Race / ordering bug             | the broken behavior first (items dropped, two writers colliding), then the fixed flow              |
| Performance                     | two timelines / bars racing, the new one finishing first (a `data-chart` fits)                     |
| Refactor / migration            | a tangled call-graph untangling into a clean one; same inputs → same outputs                       |
| New endpoint / pipeline / state | data flowing through the new path; a state machine lighting up step by step (`flowchart-vertical`) |

Name the mechanism in the frame's `scene` ("animate the request retrying: fire → 500 → backoff → 200, invented SVG flow") so Step 4 and the worker build it. The `diff` frame and the `mechanism` frame are **complementary** — the diff is the proof in code, the mechanism is the proof in motion; alternate them rather than stacking code surfaces.

## The close: a credits / shipped-by scene

A PR is shipped by people, and every PR video closes with a `credits` frame naming them. `capture/extracted/people.json` lists real contributors (bot-filtered), and Step 1 downloaded each avatar to `assets/<login>.png` (the `avatarFetched: true` entries — confirm with `ls assets/`). `reviewDecision` (e.g. `APPROVED`) is honest grounding.

> **The PR `author` only opened the PR — not necessarily who wrote the code.** A teammate often authors most commits. Lead the credits with `committer`s by `commitCount`, not the opener.

The `credits` frame is an avatar row with names + roles + an "approved" check. On that frame only, set `asset_candidates` to 1–6 entries of `assets/<login>.png — <login>, <role>` (commit authors by `commitCount` first, then reviewers; only `avatarFetched: true` logins). The body stays code-only — avatars appear **only** on this close, never decorating a diff frame. The frame sits in the Step 3 proposal like any other, so the user can cut it there; skip it yourself only when no avatar was fetched.

> **Narrate the name, not the handle.** `people.json` carries a `name` field (GitHub display name, e.g. "Miguel Angel Simon Sierra") next to `login` for whichever contributors `gh` already named (author, commit authors, `mergedBy`); it's `null` for reviewers/commenters/assignees, which `gh pr view` only ever gives a bare login. Before writing this frame, resolve any `null` name yourself for the 1-6 people going on the close: `gh api users/<login> --jq .name`. Voiceover always says the **name** (first name is enough — "Shipped by Miguel, reviewed by Wenbo") and **never** reads a raw `@login` aloud (`@miguAng18947550` spoken by TTS is the failure mode this exists to avoid). On-screen text under each avatar can show both, name first, handle small and secondary: `Miguel Angel Simon Sierra` / `@miguel-heygen`. When a name still doesn't resolve (GitHub has no public name for that user either), fall back to the login on-screen and skip that person from the spoken line rather than reading the handle.

Every other frame has **no** `asset_candidates` (the visuals are invented downstream from `scene` + the diff).

### Versions on the end card (cta / changelog)

A `cta` ("upgrade to vN", "npm i pkg@N") or a changelog "what's new in vN" wants a real version — and **a version is the one fact you must never invent.** A PR carries no shipping version, so Step 1 resolves a best-effort one for MERGED PRs and writes it into `capture/extracted/visible-text.txt` as a `Shipped in: <version> (<source>)` meta line (mirrored in `capture/pr.json` as `shipped_version` / `version_source`). Use it:

- **`Shipped in:` present** → use that exact version on the end card. A `version_source` of `unreleased` means the change is on the default branch but not yet in a tagged release — say "shipping in the next release" rather than pinning a tag.
- **No `Shipped in:` line** (open PR, or no version resolvable) → **state the repo / PR URL only** ("read the PR at github.com/…", "pull it") and do **not** name or guess a version number.

## Per-frame length budget — ≤ 9 s, word count is the real measurement

The largest quality bug in PR videos is **scripts that talk too long**. TTS runs at **~2.2 words/second**, so a 45-word "7-second" script is really 20 seconds, and the visual phase has to pad the tail with idle drift (the video reads as "shimmering"). Budget by word count:

| Bound                      | Words (@2.2 wps) | Duration     | When                                                                          |
| -------------------------- | ---------------- | ------------ | ----------------------------------------------------------------------------- |
| **Soft target — default**  | **≤ 19**         | **≤ 9 s**    | Every frame aims here; the cut stays alive.                                   |
| **Exception — ≤ 2 frames** | ≤ 26             | ≤ 12 s       | The main `diff` (the one change you must explain) or a causal-chain `change`. |
| **Hard cap**               | > 26             | > 12 s       | Trim or split.                                                                |
| **Whole-film target**      | ≤ ~400           | up to ~3 min | Sweet spot ~30–90 s (≤ ~155 words); the body carries the load.                |

Estimate while writing: `duration ≈ ceil(word_count / 2.2)`. 29 words → 13s (trim); 17 words → 8s; 12 words → 6s. Trim techniques: cut the lead-in clause ("Until now, the agent shipped…" → "The agent shipped…"); move numbers off-script onto a counter; split only when the halves carry distinct beats (cause then effect). **Silent frames are allowed and common** — a diff typing on, a before→after morph, a counter running. Set `voiceover` empty, omit from `SCRIPT.md`, and make `narrativeRole` carry it. A complex change does not need a long script; it needs a careful one — if you can't headline the change in 19 words, the headline isn't sharp yet.

**Write each line as discrete cues, not one run-on breath.** Step 5 reveals each on-screen piece _when the voiceover names it_ (the anti-PowerPoint mechanism). A line with clear phrase boundaries — "Three retries — then it backs off — then it gives up clean" — hands the shot its reveal cadence for free; a single long clause leaves the frame nothing to pace to.

## Music & silence

The storyboard's top YAML block carries a `music:` field — the BGM mood the audio step retrieves against (e.g. `music: confident minimal tech underscore`). Omitting it falls back to `message:` → `arc:` → a neutral default, so BGM plays unless turned off explicitly.

- **`music: none`** — BGM off (narration, if any, still runs).
- **`music: none` + no `SCRIPT.md`** — the canonical **fully-silent marker**: no narration, no BGM, no SFX. `audio.mjs` generates nothing and the audio step is a clean skip. Use exactly this spelling when the user asks for a silent / music-free video.

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
- blueprint: <candidate id from the role→blueprint menu, or omit — a code beat usually omits it (the code-\* block is the shape)>

narrativeRole: What this frame does in the viewer's understanding (its job, not what's on screen).
keyMessage: The one thing the viewer should understand after this frame (one sentence).
```

The `credits` frame additionally carries an `asset_candidates:` line (see the credits section); no other frame does.

## Final checklist

- One archetype is named (compound only when explicit); the sequence is narrative-driven, not diff-order-driven.
- The opening uses a named hook strategy; you do not read the PR description aloud.
- The hook is in viewer-outcome language (no file / function / identifier names), and the video's `message` lands by beat 2 (story-spine).
- Each frame has one job; the body builds cumulatively, **alternating `diff` (the code) with `mechanism` (the behavior)** + `impact` / `evidence` — not a single isolated body frame, and not an unbroken stack of code surfaces.
- Every frame has `type` (PR-native), `persuasion` (a named technique), and `beat` (specific). The emotional arc matches the archetype (fix = frustration → relief; feature = curiosity → confidence).
- Each `voiceover` is phrase-segmented into cues (each a piece Step 5 can reveal on), not one run-on clause; a candidate `blueprint:` is tagged from the role→blueprint menu where a proven shape fits (a code beat usually omits it — the `code-*` block is the shape).
- **2–4 real diff hunks** featured, each a small legible snippet (not a whole file), each naming its `code-*` block in `scene`.
- **At least one `mechanism` beat** animates what the change _does_ at runtime (an invented diagram, or a `flowchart` / `data-chart`), named in its `scene` — unless the PR genuinely has no visible behavior (a pure docs / config bump). The body is not an unbroken run of code surfaces.
- Transitions use only registry names and repeat 2–3 types; frame 1 is `cut`.
- The video closes with a `credits` frame (skipped only when no avatar was fetched); `asset_candidates` is absent on every other frame (1–6 `assets/<login>.png` entries on the close, `avatarFetched: true` only).
- Each `script` fits the budget — ≤ 19 words / ≤ 9 s default, ≤ 2 frames at the ≤ 26 / ≤ 12 s exception; `duration = ceil(word_count / 2.2)`, not a guess.
- `SCRIPT.md` contains only locked spoken narration; silent frames are intentional and omitted from it.
