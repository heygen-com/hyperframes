---
name: hyperframes-promo-video
description: Use when the user wants to generate a rendered promotional video (not just a script) for a PR, feature, or product change — produces a HyperFrames HTML composition, iterates with `npx hyperframes preview`, and outputs mp4 + poster for X/LinkedIn/social.
author: Alem Tuzlak (@AlemTuzlak)
---

# HyperFrames Video

Turn a PR into a rendered short-form promo video with a hook, code moments, and CTA, using HyperFrames. Iterate with live preview via `npx hyperframes preview`, then render `video.mp4` and `poster.jpg` for X/LinkedIn/social.

Unlike `/video-script` (which produces a textual script), this skill produces the actual video file. Counterpart to the `remotion-video` skill — same workflow shape, same storytelling rules, but built on the HyperFrames stack instead of Remotion.

## Triggers

Invoke when the user says: "make a video for this PR", "hyperframes video", "render a promo video", "video for X/LinkedIn", or when selected from `/marketing-pipeline`.

## How this skill relates to the hyperframes ecosystem

This skill carries only the promo-video-from-PR logic: input resolution, narrative planning, motif derivation, hook enforcement, scene-plan auditing, render-time gates. The mechanics of authoring HyperFrames compositions, running the CLI, animating with GSAP, and installing registry components are owned by separate skills you should invoke when their topic comes up:

- **`hyperframes`** — composition authoring rules: DESIGN.md gate, Layout Before Animation, palettes, transitions, typography, motion principles, captions, audio, TTS.
- **`hyperframes-cli`** — every `npx hyperframes <command>` (init, lint, inspect, preview, render, transcribe, tts, doctor, browser, info, upgrade, compositions, docs, benchmark).
- **`gsap`** — GSAP timeline patterns, easing, stagger, performance, position parameter, labels, nesting, playback.
- **`hyperframes-registry`** — registry blocks/components and how to wire them via `hyperframes add`.

When this skill needs to do something covered by one of those skills, defer to that skill's instructions rather than re-deriving them here.

## Process Flow

```
Resolve input
  → Phase 1: Discovery
  → Phase 2: Configuration
  → Phase 3: Narrative planning
  → Phase 4: Scaffold
  → Phase 5: First draft + iterate
  → Phase 6: Render
  → Phase 7: Cleanup
```

Phases 1, 3, 5, and 7 have explicit approval gates. Phase 2 is an interactive Q&A. Phase 5 is a freeform iteration loop that can run many rounds.

## "Use Sane Defaults" / "Don't Ask Questions" — What It Does and Doesn't Override

When the user invokes the skill with phrasing like _"use sane defaults"_, _"don't ask questions"_, _"non-interactive"_, _"just ship it"_, or any equivalent — interpret it precisely:

**It DOES override (skip the prompt, pick the default):**

- Q2.1 duration → derive from scope using the ladder in Q2.1 (still in the 15–60s window); pick the midpoint of the matched scope band and proceed without asking
- Q2.2 aspect ratio → 16:9 landscape
- Q2.3 project location → `marketing/<feature-slug>/hyperframes/`
- Q2.4 brand _confirmation_ (the "use these / customize / provide your own?" question)
- Phase 1.4 scope confirmation
- Phase 3.0 motif confirmation
- Phase 3.1 story-pattern confirmation
- Phase 3.3 scene-plan approval
- Phase 5 freeform iteration loop (the "what would you like to change?" prompt)

**It does NOT override (must always run regardless):**

- Brand color/font/logo **scanning** (Q2.4 detection — see HARD-GATE in Q2.4). Hardcoding colors from training-data assumptions about a project is a forbidden shortcut.
- Phase 5 **preview** (HARD-GATE in Phase 5). Even in fully unattended mode, `npx hyperframes preview` must start and the studio URL must be opened in the browser before the render runs. The user can interrupt; the agent must not pre-decide for them.
- Phase 6 pre-render audits (storytelling, hook rules, motif presence, pacing variance, value-prop timing, contrast). These exist to prevent shipping a generic video.
- Phase 7 cleanup question (the user owns project disposition).

If you're tempted to skip a HARD-GATE because the user "said no questions" — re-read this section. The user said no _questions_, not no _gates_.

## Input Resolution

Resolve the argument (if provided) in this order:

1. Path to a marketing brief (`.md` containing "Executive Summary" or "Key Messages") → **marketing brief**
2. Path to a blog post (`.md` with blog post structure) → **blog post**
3. Path to a changelog → **changelog**
4. GitHub PR URL or `#\d+` pattern → **PR**
5. Matches `<ref>..<ref>` or `<ref>...<ref>` (alphanumeric + `/`, `_`, `.`, `-` on each side) → **git ref range**
6. Resolves to an existing file/directory → **codebase feature**
7. Otherwise → **freeform text**

If no argument is provided, ask: "What should the video be about? You can provide a PR URL/number, marketing brief, blog post, changelog, git ref range, file/directory path, or just describe the feature."

When invoked from the pipeline with a PR _and_ upstream marketing-brief/blog-post paths, read both: PR for technical accuracy, upstream content for positioning/tone.

(Detailed phase specs begin below — see Phase 1.)

## Phase 1: Discovery

### Step 1.1 — Check hyperframes skills availability

Attempt to invoke the `hyperframes` and `hyperframes-cli` skills via the Skill tool. If either is unavailable, present:

> "The `hyperframes` / `hyperframes-cli` skills aren't installed. Options:
> a) proceed with baseline knowledge (quality may be reduced)
> b) wait while you install them
> c) cancel"

If the user picks (a), emit a warning in the final summary noting reduced quality.

### Step 1.2 — Analyze input

| Input type      | What to read                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Marketing brief | positioning, key messages, audience                                                                  |
| Blog post       | headline, narrative, examples                                                                        |
| Changelog       | highest-impact entry                                                                                 |
| PR              | `gh pr view <n> --json title,body,files,labels`, diff (`gh pr diff`), commit messages, linked issues |
| Git refs        | `git diff <range>` + `git log <range> --oneline`                                                     |
| Codebase path   | read the specified files/directories                                                                 |
| Freeform        | parse the user's description                                                                         |

For PRs with 20+ files, filter to user-facing changes only — skip `tests/`, `ci/`, `.github/`, lockfile changes, dep bumps.

**Error handling:**

- `gh` not available → tell the user, ask for an alternative (diff file, freeform description)
- Invalid PR/ref → ask user to verify
- File not found → ask for the correct path

### Step 1.2a — PR deep analysis (when input is a PR)

When the input is a PR, the brief table in Step 1.2 is not enough. PR bodies are routinely vague, outdated, or focused on implementation rather than user value, and a video built off the body alone tends to overclaim or miss the headline angle entirely. Before continuing to Step 1.3, run this structured analysis and produce a written **PR analysis block** that becomes the source of truth for Steps 1.4 (scope confirmation), Q2.1 (duration ladder), and Phase 3 (narrative planning).

**Mandatory steps — do all of them:**

1. **Pull metadata and identify the base branch.**

   ```
   gh pr view <n> --json number,title,body,baseRefName,headRefName,files,labels,commits,additions,deletions
   ```

   Record `baseRefName` (usually `main` / `master` / `develop`) — that is the diff reference. `gh pr diff <n>` automatically compares the PR head against this base.

2. **Pull the full diff against the base.**

   ```
   gh pr diff <n>
   ```

   For very large PRs (>500 lines or >20 files), also list changed files via `gh pr view <n> --json files`.

3. **Filter to user-facing surfaces.** Ignore (do not let these shape the headline angle): `tests/`, `__tests__/`, `*.test.*`, `*.spec.*`, `__mocks__/`, `ci/`, `.github/`, lockfiles, dep bumps without behavior change, generated/build artifacts (`dist/`, `build/`, `.next/`), and formatting-only diffs. What remains is the user-facing surface of the PR.

4. **Enumerate the public-API delta.** From the filtered diff, list every change a user could observe or write code against:
   - New, renamed, or removed `export`s (functions, types, components, hooks, classes, constants)
   - New CLI commands, flags, or environment variables
   - New routes, endpoints, or event names
   - New config keys or schema fields
   - Changed default values for existing public surfaces
   - Changed error messages, log shapes, or response shapes the user could rely on

   Grep the diff for added lines beginning with `export `, new top-level `function`/`class`/`const` in `src/` / `lib/` / `packages/*/src/`, new files in those trees, and changes to public type signatures. **If you cannot point at a line in the diff for a claimed API, the claim is wrong — drop it.**

5. **Enumerate the behavior delta.** Beyond API surfaces, list user-visible behavior changes: UI elements added/changed (with file references), CLI / network output that looks different, side effects firing under new conditions, removed limitations, performance characteristics that changed.

6. **Write the before / after value statement.** Exactly two sentences, both grounded in concrete diff evidence:
   - **Before:** _"Before this PR, a user who wanted to *** had to ***."_
   - **After:** _"After this PR, the same user can \_\_\_."_

   The "had to" half must be a real prior workflow you can describe — copy-pasting an adapter from the docs, installing a second package, writing boilerplate, hitting an error, switching to a different tool. If the honest "Before" sentence is _"they could already do this"_, the PR has no user-visible value delta — see step 8.

7. **Cross-check the PR body against the diff.** Walk the body's claims and the diff side-by-side:
   - **Body claims a feature → does the diff confirm?** If the body says "added X" and the diff has no public surface for X (only tests, only docs, only internal helpers), flag it: _"PR body claims X but the diff doesn't expose X to users — should I shift the angle to <what the diff actually shows>?"_
   - **Diff shows multiple distinct features → body emphasizes one?** Flag the others as candidate angles: _"The body emphasizes A, but the diff also adds B and C. Which is the headline angle?"_
   - **Body is empty / boilerplate / `[BLANK]`?** Infer from the diff; make the inferred angle explicit and confirm with the user at Step 1.4.
   - **List "surprises"** — anything in the diff _not_ mentioned in the body that affects user-visible behavior. Surprises are often the real story.

8. **Bail-out check: is this PR actually user-visible?** If after steps 4–6 you cannot name a single new thing the user can do or observe, the PR is not video-worthy as a feature launch. **Stop and ask the user:**

   > "This PR looks like an internal refactor / test-only / dep-bump PR — I can't find a user-visible value delta. Options:
   > a) shift to a performance / DX / cleanup angle if numbers support it
   > b) pick a different PR or input
   > c) cancel"

   Do not invent a feature angle to fill the gap. A confabulated angle wastes a full iteration round and destroys user trust on the very first draft.

9. **Produce the PR analysis block.** Write the result as a short structured block before continuing to Step 1.3. This block — not the PR body — is the source of truth for everything downstream:

   ```
   PR analysis — #1234 "Add fromZodSchema support"
   Base: main · Head: feature/zod-schema · Author: <login>
   User-facing files: 3 (packages/core/src/index.ts, packages/core/src/zod.ts, packages/core/src/types.ts)
   Filtered out: 5 test files, 2 doc files, lockfile

   Public-API delta:
     + export function fromZodSchema(schema: ZodSchema): StandardSchema
     + export type ZodCompatibleSchema
     ~ default error code for ZodError changed: 'invalid_type' → 'STANDARD/type'

   Behavior delta:
     - Users importing zod schemas no longer need a manual adapter.
     - Error messages from zod paths now use the StandardError shape.

   Before / after:
     Before: copy a 15-line adapter from the docs into every project that mixes zod with this library.
     After:  one import + one call.

   Surprises (in diff but not in PR body):
     - Default error shape change (above) — could be the headline angle for migration-aware audiences.

   Headline angle: "drop the 15-line adapter — one import, one call"
   Scope band for Q2.1: one idea (15–25s)
   ```

   The "Headline angle" line feeds Phase 3.0's motif derivation and Phase 3.3's hook copy. The "Scope band" line feeds Q2.1's scope-derived duration proposal.

10. **Forbidden shortcuts** (each is a fast path to a wrong video):
    - Writing the analysis block from the PR title alone — **fail**; you must read the diff.
    - Skipping the cross-check because the body "looks complete" — bodies often look complete and are wrong.
    - Treating the PR body as truth when it conflicts with the diff — **the diff wins**.
    - Filling in a plausible "Before" sentence when the diff doesn't support one — run the bail-out check instead.
    - Collapsing two genuinely distinct user-visible features into one "feature X" bullet to make the scope band look smaller — record both and pick a headline angle at Step 1.4.

**For git-ref-range and codebase-path inputs**, apply the same structure with the diff coming from `git diff <range>` / direct file reads in place of `gh pr diff`. Steps 4–9 (public-API delta → analysis block) are not PR-specific.

### Step 1.3 — Read product context

Read if they exist: `README.md`, `docs/`, `package.json`. If nothing found, ask: "Can you briefly describe the product and who it's for?"

### Step 1.4 — Present understanding + get scope confirmation

**For PR inputs**, the bullets and the compelling angle below **must** be derived from the PR analysis block written in Step 1.2a — not from the PR title or body. Quote the "Headline angle" line directly as the proposed story seed; turn the public-API delta and the before/after statement into the bullets. If the user added clarifying context after Step 1.2a, fold it in here.

**For non-PR inputs**, derive the bullets from the relevant entry in Step 1.2 (marketing brief positioning, blog headline, changelog highlight, codebase reading, freeform description).

Present:

> "Here's what I'll base the video on:
>
> - [feature summary bullet 1 — concrete, grounded in the diff / source]
> - [feature summary bullet 2 — the before → after value, in one line]
>
> The compelling angle: [proposed story seed — for PRs, the "Headline angle" from the analysis block]
>
> Anything to add, remove, or correct?"

**Do not proceed until the user confirms.**

### Step 1.5 — Sensitive content scan

Before continuing, scan for: security patches, internal pricing, credentials, unreleased roadmap items, content marked confidential. Flag anything questionable to the user.

## Phase 2: Configuration

Ask these questions one at a time, in order.

### Q2.1 — Duration (derived from scope, never offered as a menu)

**Do not ask the user to pick a fixed length from a menu.** (This restriction is specific to duration; other questions like aspect ratio use a numbered menu.) A fixed number becomes a constraint, and the dominant failure mode is padding — freeze-frames, repeated beats, black or empty trailing frames, or filler bullets added solely to reach the chosen target. Instead, derive a duration from the _scope of the change_ and present it as a proposal the user can confirm or override.

**Allowed range: 15–60 seconds.** Anything outside this window is wrong by default. Going under 15s means the story can't breathe; going over 60s means it's two videos.

**Scope → duration ladder:**

| Scope of the PR / feature                                                                                      | Distinct payoff beats     | Target     |
| -------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------- |
| One idea (single API addition, single bug fix, one QoL win)                                                    | hook + 1 delivery + CTA   | **15–25s** |
| Typical PR-sized feature (problem → solution → proof, or a multi-chapter code walk)                            | hook + 2–3 delivery + CTA | **25–40s** |
| Multi-faceted release (multiple distinct sub-features, or comparison needing problem + solution + proof beats) | hook + 3–4 delivery + CTA | **40–60s** |

A _distinct payoff beat_ is one new thing the viewer learns. Two scenes whose payoff sentences (see Phase 3.3 item 1) reduce to the same idea are one beat, not two.

**Sanity check before proposing — do this silently first:**

1. List the distinct payoff beats the video must contain.
2. Estimate: hook ≈ 3s, CTA ≈ 5–7s, each delivery beat ≈ 6–10s (longer if it contains a code chapter ladder).
3. Sum the floor and the ceiling. If the floor is under 15s, you're padding the beat list — cut beats or shrink the scope claim. If the ceiling is over 60s, you have two videos — pick one angle.

**Propose to the user (no menu, no fixed lengths):**

> "Based on the scope of this PR, I'm targeting **~Xs** (range Ys–Zs). Beats: <one short sentence listing the beats>. Confirm, or override with a different length anywhere in 15–60s."

**Hard rule — story sets duration, never the other way around.** If at any later phase a scene needs to be stretched, held on a static frame, repeated, backed by black/empty frames, or filled with filler bullets to reach the chosen target — **stop**, shorten the target, re-confirm with the user, and ship the shorter video. Padding to hit a number is the single behavior this rule exists to forbid. If a 30s scope honestly tells in 18s, ship 18s.

**Breathing-room constraint.** Whatever duration is chosen, it must allow every on-screen text element to (a) finish animating in, (b) dwell long enough to be read, and (c) settle for at least ~0.4s before the next scene begins. Cutting to a new scene the instant a line of text finishes appearing is forbidden. See Phase 3.3 (item 3) and the Phase 6 audit for the concrete dwell-time table.

### Q2.2 — Aspect ratio

> "Which aspect ratio?
>
> 1. **16:9 landscape** (1920×1080, default) — desktop X/LinkedIn
> 2. **1:1 square** (1080×1080) — mobile-friendly feed
> 3. **9:16 vertical** (1080×1920) — Reels/Shorts/TikTok
> 4. **Multi-format** — render all three from the same story"

Frame rate is fixed at 30fps.

### Q2.3 — HyperFrames project location

> "Where should the HyperFrames project live?
> Default: `marketing/<feature-slug>/hyperframes/` (fresh per-video)
> Override: specify a path."

### Q2.4 — Brand assets (auto-detect → confirm)

<HARD-GATE>
**The brand scan is mandatory. It is not skippable under any user instruction — including "use sane defaults", "don't ask questions", "just ship it", or "non-interactive". Those instructions affect interactive *confirmation*; they do NOT affect *detection*.**

You MUST run the heuristics in `brand-detection.md` against the actual target repository — the source code that owns the feature, not the `marketing/` output directory — before selecting any color, font, or logo.

**Forbidden shortcuts (these produce wrong colors and waste an iteration):**

- "I know this project — TanStack uses amber, Vercel uses black/white, Stripe uses purple" → **No.** Run the scan. Recall is unreliable; brand details drift between training data and now.
- "It's a dev tool, dark + neon green is fine" → **No.** Generic vibes ≠ this product's brand.
- "User said no questions, so I'll skip detection" → **No.** Detection is silent. Confirmation is what the "no questions" instruction skips.
- Picking from a palette in your head because it "fits the topic" → **No.** Read the repo's CSS/Tailwind/theme files.

**The scan must produce a written record before any composition file is written.** Output a short block listing, for each field: the source file checked, the value found (or `not found`), and the final value used. Example:

```
Brand scan — TanStack/ai
  Primary  : checked tailwind.config.* (none) · packages/*/styles.css (--brand: #0a3d2e) → #0a3d2e
  Accent   : checked theme.json (none) · brand.json (none) · derived from primary → #14b870
  Logo     : checked public/logo.svg → media/header_ai.png
  Font     : checked next/font (none) · @fontsource (none) · README ref → Inter (fallback)
```

If the scan finds nothing for a field, fall through to the neutral defaults below — but **only after** the scan ran and is recorded. Skipping the scan and going straight to defaults is the failure mode this gate exists to prevent.

In interactive mode, present findings (the block above) and ask for confirmation. In non-interactive / "use sane defaults" mode, print the same block and proceed without asking — the _record_ is required either way.
</HARD-GATE>

Present findings as:

> "I found:
>
> - Logo: `media/header_ai.png` (copied from `public/logo.svg`)
> - Primary: `#0066ff` (from `tailwind.config.js`)
> - Font: `Inter` (from `next/font`)
>
> Use these, customize some, or provide your own?"

**Persistence:** write chosen brand to `.marketing/brand.json` (relative to repo root) and to a generated `DESIGN.md` inside the project (the file the `hyperframes` skill's Visual Identity Gate requires). On subsequent runs, ask:

> "I loaded brand settings from `.marketing/brand.json`. Use saved, or re-detect?"

**Fallback when nothing detected:** ask explicitly with these neutral defaults. These are intentionally neutral — auto-detection of the project's actual brand is always preferred, and these values should only appear when detection turns up nothing.

- Primary: `#3B82F6` (neutral blue)
- Accent: `#8B5CF6` (neutral violet)
- Background: `#0A0A0A` (near-black, dark mode)
- Text: `#FFFFFF` (white)
- Muted: `#9CA3AF`
- Success: `#22C55E`
- Danger: `#EF4444`
- Font: `Geist` (loaded via Google Fonts `<link>` in `index.html`)
- Logo: none

Confirm with the user before scaffolding.

**Note on fonts:** The default scaffold loads **Geist** via a `<link>` to `https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700;900&display=swap`. To use a different Google Font, edit `DESIGN.md`, update `.marketing/brand.json`, and the skill regenerates `index.html` and `styles.css` accordingly. Non-Google fonts require manual self-hosting.

## Phase 3: Narrative Planning

### Step 3.0 — Derive the signature motif from context

Before picking a story pattern, identify the **signature visual motif** that will carry the narrative across scenes. This is the single most important call for not looking generic.

1. **Finish this sentence in one verb**: "This feature lets developers \_\_\_ something."
   - Examples: _compose_ music, _sync_ state, _validate_ inputs, _secure_ tokens, _deploy_ functions, _route_ requests.
2. **Translate the verb into a physical / spatial metaphor**: a waveform for audio composition, packets traveling edges for sync, squiggle underlines for type validation, a padlock for auth, a rocket/checkpoint line for deploy, a switchboard for routing.
3. **Pick the state-change axis**: the motif must visibly change between Problem and Solution scenes (broken ↔ unified, empty ↔ full, disconnected ↔ connected). Pick ONE axis and hold it across the video.
4. **Look up the motif** in `references/visual-motifs.md` — the catalog maps 20+ common verbs to motifs, state axes, and example custom elements. If the verb isn't listed, apply the heuristic in that file.

**Confirm with user:**

> "The core verb is **compose music**, so I'll use an **animated waveform** as the signature motif — smooth/clean in the hook and solution, jagged/red in the problem. This thread will appear in scenes 1, 2, and 4. Approve, pick a different motif, or let me propose alternatives?"

Do NOT skip this step. A video without a derived motif defaults to generic bullet-list storytelling and fails the generic test (Storytelling Rule 10).

### Step 3.1 — Detect story pattern

Scan the PR/input for signals and pick one of 5 patterns. See the detection signals table in `patterns/README.md` — that file is the single source of truth.

Load the matching pattern spec from `patterns/<pattern>.md`.

**Confirm with user:**

> "This looks like an **[API/Library feature]** PR. I'll use that story template. Override? Options: api-library / ui / performance / bugfix / generic / describe a custom pattern"

### Step 3.2 — Decide code sourcing (hybrid)

Per pattern:

- **api-library-feature** → **synthesize** realistic usage examples that show how developers will actually use the feature
- **ui-feature** → **screenshots / mock components** (no code block scenes)
- **performance-win** → metric cards + optional code
- **bug-fix** → before (broken) + after (working) snippets, synthesized if raw diff is noisy
- **generic-fallback** → bullet benefits, no code

Offer user override:

> "For code snippets, I'll **synthesize realistic usage examples** rather than paste raw diff. Override: use-diff / synthesize / mix"

### Step 3.2b — Ground synthesized code in the real library

Before synthesizing usage code for a PR, verify the library's actual public API. Do **not** invent method names, argument shapes, or import paths.

For each snippet the skill plans to include:

1. Locate the real library code locally (e.g., `packages/<name>/src/index.ts`, docs examples in `docs/`, test fixtures in `tests/`).
2. Confirm every imported name exists as exported.
3. Confirm every method/function signature matches (argument names, shape, async vs sync).
4. Prefer patterns from the library's own docs over inferred shapes.

If the library isn't available locally and the skill can't verify, **ask the user** before synthesizing. A wrong API in the first draft destroys user trust and wastes a full iteration round.

### Step 3.3 — Self-improve the draft, then present for approval

This step has two parts: a **silent self-improvement loop** that you run before the user sees anything, and the **user-facing approval gate** that follows.

**Do not show the user the first thing you wrote.** The first version of a scene plan is almost always weaker than the second. The agent's job here is to hand the user the _strongest_ plan it can build given the rules in this skill, not the first draft.

#### Self-improvement loop (silent — run before presenting)

After drafting an initial scene plan, run a deliberate improvement pass against the rule sections listed below. Iterate **at least twice**. Stop only when one full pass produces zero further changes — the draft has stabilized.

**On every pass, for each scene and for the plan as a whole, ask:** _"Does this satisfy this rule? If not, can I rewrite, merge, drop, split, or reorder a scene to fix it?"_ Apply the fix in-place, then continue the pass.

The five **Core checks** below must be satisfied — every plan, no exceptions. On top of those, scan against the broader rule sections at the end of this step.

**Core checks (every plan must satisfy all five):**

1. **Per-scene payoff**: for each scene, write one sentence of the form _"The new thing a viewer knows at the end of this scene is \_\_\_."_ If two scenes produce the same sentence, one is redundant — merge or cut. If a scene's sentence is vague (e.g., _"the product is good"_), the scene is filler — redesign.
2. **Pacing variance**: scene durations must reflect cognitive load, not a uniform slice. Reference shape for a **30s** target — **scale proportionally** for shorter (15–25s) or longer (40–60s) videos:
   - Hook: ~10–12% of total (≈3s @ 30s; ≈1.8s @ 15s; ≈6s @ 60s) — a single punch
   - Problem / setup: ~15–20% (≈5s @ 30s) — enough to land one concrete claim
   - Delivery (code / swap / comparison): ~45–55%, with internal chapters if the beat exceeds ~8s
   - CTA: ~18–25%, **never below 4s** regardless of total — the CTA always breathes and never rushes

   Reject plans where the shortest and longest scene differ by less than ~2×. Equal-slice plans are the single strongest "AI-generated" tell. Reject plans where the CTA is under 4s — a rushed CTA destroys the conversion the rest of the video bought.

3. **Breathing room (no rush-cuts on text)**: a scene must not transition out while a text element is still being read. Minimum on-screen dwell time, measured from the moment the element _finishes_ animating in to the moment the scene _begins_ transitioning out:

   | Element                                       | Minimum dwell |
   | --------------------------------------------- | ------------- |
   | Short headline / one phrase (≤6 words)        | ≥ 1.5s        |
   | Long headline / single sentence (7–14 words)  | ≥ 2.5s        |
   | Two-line text / short paragraph (15–30 words) | ≥ 3.5s        |
   | Code chapter (per chapter, after focus lands) | ≥ 3s          |
   | CTA URL / handle (must be clearly readable)   | ≥ 3s          |

   Every scene must also include a **~0.4s settle hold** between the last animation completing and the transition starting. Cutting on the same frame an animation finishes is forbidden — the eye needs a beat to confirm what it saw, and transitions that arrive on the resolve-frame feel cluttered and amateur. If the proposed scene durations cannot accommodate these minima, **shorten the beat list, do not shrink the dwell times**.

4. **Value prop by ~t=8s** (or by ~25–30% of total duration, whichever is earlier): by the end of scene 2, the viewer must know what the feature does, who it's for, and why it matters. If that's not true with the current plan, restructure before scaffolding. Do NOT bury the value in the delivery scene.
5. **Motif presence and state-change**: the signature motif chosen in Phase 3.0 must appear in at least 2 scenes (typically 3: hook + problem + CTA) and visibly change state between at least one adjacent pair (e.g., clean → glitchy → clean again).

**Broader rule sections to scan on every improvement pass.** Search this file (or the linked file) for each section heading and walk it against the current draft:

- **Hook enforcement** (`hooks/hook-rules.md`) — applied to the HookTitle scene. If it fails any check, rewrite the headline; don't just record the failure.
- **Storytelling & Visual Uniqueness Rules** (the numbered "Rule N" sections later in this file) — generic-test, no plain bullet lists, signature motif as load-bearing element, anti-clickbait, side-by-side contrasts, insight tagline, counter-expectation beat, pattern-interrupt vs information, first-10s value prop, et al.
- **Code Scene Rules** — chapters mandatory for ≥5s code beats, synchronized per-chapter narration, per-chapter dwell (~3s), line-length per scene type, diagnostic-comment color, elide unimportant config with `/*…*/`, pre-break long imports.
- **Layout Rules** — single alignment per scene, foreground readability over decoration, no accidental overlap, hero-text size on aspect changes.
- **Visual Cognition Rules** — ≤4 visual chunks per frame, one pre-attentive cue per focal element, reading-flow matched to scene type, reading-saccade limits.
- **Anti-padding rule** (Q2.1) — if any scene exists solely to fill time, **cut it and shorten the target**. Do not carry it forward.
- **Pattern spec** loaded in Step 3.1 (`patterns/<pattern>.md`) — the scene sequence and payoffs should be coherent with the template; deviations must have a clear justification.
- **Step 3.0 motif & Step 3.2b grounded code** — verify motif state-change still applies and any synthesized code still maps to real exports/signatures after the rewrites.

**Improvements you may apply silently during the loop (no user question needed):**

- Rewrite headlines, payoff sentences, captions, and CTA copy for stronger hook discipline and clearer payoff
- Merge two scenes whose payoff sentences collapse to the same idea
- Drop a scene whose only function is to fill time, and shorten the target accordingly
- Split a delivery scene into chaptered sub-beats when a single block exceeds ~8s
- Re-assign motif state per scene to produce a visible state-change between at least one adjacent pair
- Reorder scenes to move the value prop earlier
- Adjust per-scene durations to satisfy pacing variance and breathing-room minima — only by **trimming**, never by stretching or padding
- Replace generic bullets with concrete artifacts (real API shapes, real error messages, real metrics) drawn from the input

**Changes that must wait for the user — flag them, do not apply silently:**

- Moving the target duration outside the ±20% band confirmed at Q2.1
- Changing the signature motif chosen at Step 3.0
- Changing the story pattern chosen at Step 3.1
- Adding or removing major scenes that alter the headline narrative claim

**Stop condition.** End the loop when one full pass over all rule sections (Core checks + broader sections) produces zero changes. If you hit five passes without stabilizing, you have a structural problem the loop can't fix — stop and ask the user for guidance instead of churning.

#### Present the (already-improved) scene plan for approval

When presenting to the user, include a brief **"Self-review notes"** line near the top of the response so the user can see the improvement work was actually done. List the 2–5 most material changes the loop applied. Example:

> _Self-review notes: tightened the hook line from "Add validation easily" to "Swap validation libs with one line"; merged a redundant "why it matters" scene into the problem setup; trimmed delivery 14s → 11s so the CTA dwells ≥4s._

If the loop produced no material changes (rare — usually means the first draft was already strong, or the agent isn't pushing hard enough), say so explicitly: _"Self-review notes: draft was stable on first pass; no rewrites needed."_

Example output:

> "Here's the plan (30s target):
>
> 1. **HookTitle** (0–3s, 90f) — `"Swap validation libs with one line"`
>    — _payoff: there's one line that replaces N SDKs_
> 2. **ProblemSetup** (3–8s, 150f) — three evidence cards with concrete conflicting API shapes
>    — _payoff: viewer sees the real API-shape conflict they live with today_
> 3. **LibrarySwap** (8–22s, 420f) — shared Standard Schema code, import line cycles zod → valibot → arktype
>    — _payoff: viewer sees the "one line change" literally happen on screen_
> 4. **CTAEndScreen** (22–30s, 240f) — `"Ship it"` + link to standardschema.dev
>    — _payoff: viewer knows exactly where to go next_
>
> Pacing: hook 3s / problem 5s / delivery 14s / CTA 8s (ratio ~4.7×) — passes variance check.
> Motif: schema-interop glyph (interlocking rings) appears in scenes 1, 2, 4; rings are disconnected in scene 2, unified in 1 and 4.
>
> Approve or adjust any section?"

**Do not scaffold until the user approves the scene plan.**

See `patterns/README.md` for how patterns map to scene plans.

### Step 3.4 — Plan scene transitions (match-cuts)

Hard cuts between scenes are acceptable; **match-cuts are what make a video feel crafted**. When the signature motif (Phase 3.0) appears in adjacent scenes, the motif must carry over as a match-cut, not restart from zero.

Rules:

1. When the same motif component appears in scene N and scene N+1, render it in the last ~8 frames of scene N with the entering state of scene N+1 already beginning. The motif's position, scale, and core geometry must be continuous across the cut — only its _state_ (color, amplitude, opacity, shape) changes.
2. When adjacent scenes use different motifs, a text/background element may bridge them: e.g., the last word of scene N's tagline becomes the first word of scene N+1's caption, kept at the same position during the transition.
3. When scenes have NO common element, use a directional motion cue — a brand-primary bar sweeping left-to-right that covers the cut — never a generic fade-to-black.
4. The `data-bg` variant must change between adjacent scenes (no two adjacent scenes share a variant). This is enforced at pre-render.

Write the planned transitions into the scene plan before scaffolding:

> Transition 1→2: waveform carries over at the same position; color fades from brand.primary → brand.danger; amplitude jitters from smooth to glitchy over 8 frames.
> Transition 2→3: glitch waveform contracts into a flat line → that line becomes the top border of the code card in scene 3.
> Transition 3→4: active-provider pill in scene 3 slides down and morphs into the URL pill of the CTA.

### Step 3.5 — UI moment (when a UI surface exists)

If the feature has a visible UI surface — a generated image, a rendered audio player, a dashboard, a settings toggle, a diff view — the video must include at least one beat that shows that surface. Research on product-launch video is consistent: "show the product in action" is the strongest single predictor of viewer recall.

Options (in order of preference):

1. **Real screen capture**: a short 2–3s clip of the feature running in the example app. Embedded via `<video src=… autoplay muted playsinline loop>` inside a `UIShowcase` scene with `data-media-kind="video"`.
2. **Static screenshot with kinetic overlay**: a high-res shot of the UI with brand-primary-tinted call-out boxes or arrows animating in. Easiest to author; works for any UI.
3. **Mock UI rendered in HTML**: a stylized recreation of the UI inside the scene — buttons, progress bars, output previews — using only the scene's brand palette. Preferred when no screen capture is available and the UI is simple enough to fake convincingly.

Place the UI moment in the delivery scene (Scene 3 in the default structure), ideally at its midpoint so the viewer gets code-plus-result. A code-only delivery feels like a reference doc; code-plus-UI feels like a demo.

Skip this step only if the feature is purely API-level with no user-visible surface (a parser, a compiler pass, a type-level utility).

### Step 3.6 — Per-aspect narrative adjustment (multi-format)

When the user picked option 4 (Multi-format) in Q2.2, the skill must plan **per-aspect narrative variants** — a 9:16 vertical video is not just a cropped 16:9.

#### Rule 0 (the load-bearing one): **Fill the canvas. Don't just shrink content.**

The most common failure mode when porting a 16:9 layout to 1:1 or 9:16: the agent keeps the original element sizes, only changes the canvas dimensions, and ships a video where content occupies ~50% of the new canvas with huge dead margins on top/bottom (vertical) or sides (square).

The right move is the **opposite of intuition**: when the canvas gets _smaller_ in one axis, the content's per-element size needs to get _bigger_, not smaller. Less competing content = each element earns more visual space.

Concrete defaults when porting from 1920×1080 (landscape) to other aspects:

- **Hero text** (hook/CTA headlines): same px size or +10–25%. A 132px landscape headline becomes ~116–144px on 1:1 and ~140–160px on 9:16. Going _down_ to 88px is wrong.
- **Body text & captions**: +20–40% for 9:16 (a 22px caption → 28–32px). On 1:1, hold or grow slightly.
- **Padding & margins**: increase scene padding 1.5–2× to consume edge space. A 32px landscape scene padding becomes ~70px on 1:1 and ~140–200px on 9:16 (especially top/bottom on 9:16).
- **Inter-element gaps**: the `.hook-stack` gap of 56px on landscape becomes ~80px on 9:16. Whitespace is doing brand work — keep it generous.
- **Element heights / min-heights**: code-card mount-card heights, browser-mock chat min-height — all should grow on 9:16 to use the tall canvas.
- **Code font**: code that was 18px on landscape often goes to ~17–18px on 1:1 (less width to spare) but **bigger** on 9:16 where there's less content competing — 16–20px is fine.

Run the **fill check** mentally before rendering and as a hard pre-render audit:

> At the hero frame (peak content) of every scene at every aspect, the bounding box of the foreground content reaches within ~80–100px of every canvas edge. If any scene at any aspect has more than ~120px of dead margin on either axis, the override CSS is wrong — the content is undersized.

If you're tempted to keep all the landscape sizes "since they look fine on landscape" — stop. They look fine on landscape _because_ they fill landscape. They will not fill a different aspect at the same sizes.

#### Layout-shape adjustments

- **Horizontal-heavy scenes**: side-by-side `BeforeAfter`, multi-pill pill rows, and wide `LibrarySwap` layouts must switch to stacked (top/bottom) or single-item-at-a-time layouts on 9:16. The bundled scenes use `[data-aspect="vertical"]` selectors to fall back to single-column grids; verify each scene's CSS includes that fallback before rendering vertical.
- **Multi-column grids**: a 6-col framework grid becomes 4-col on 1:1, 3-col on 9:16. A 5-card mount row becomes a 3-col grid (with 2 wrapping to a second row) on 1:1, or a 2-col grid (with the 5th wrapping) on 9:16.
- **Motif sizing**: waveform/thread widths should scale with composition width via `vw`/`%` units, not hardcoded pixels. Review any reusable motif fragment for responsive sizing before scaffolding.
- **Pacing**: vertical-first platforms (Reels, TikTok) favor a faster cut rhythm than desktop X/LinkedIn. Consider shaving 3–5s from a 30s landscape plan when producing the 9:16 variant.
- **CTA URL placement**: URL pills are harder to scan on narrow aspects — consider shortening the URL shown (e.g., `tanstack.com/ai` instead of `https://tanstack.com/ai/audio-generation`) for 9:16.

Write the per-aspect deltas into the scene plan as a short section, even if most scenes render identically. Example:

> **9:16 deltas**: Scene 3 `LibrarySwap` stacks the code card above the provider pills (same content, vertical flow). Headline 132px → 144px (kept large). Padding 32px → 200px top/bottom. Code font 18px → 18px (held). Total duration shaved to 26s (hook 2.5s / problem 4s / delivery 12s / CTA 7.5s).

Skip this step if the user picked a single aspect.

(Caption emphasis syntax, text alignment, background variants, and code-block theming are governed by the **Layout and Typography Rules** section below.)

## Phase 4: Scaffold

### Step 4.1 — Create the project skeleton

At the location chosen in Q2.3 (default `marketing/<feature-slug>/hyperframes/`):

```bash
npx hyperframes init <project-path> --non-interactive --example blank
```

If `--example blank` is not available in the installed CLI version, run `npx hyperframes init --help` to see the current example list and pick the most neutral one (an empty / minimal template). Document the substitution in the final summary.

This creates the HyperFrames skeleton (`package.json`, base `index.html`, `compositions/`, registry config, FFmpeg + Chrome integration). The skill then **overlays** these files from `skills/hyperframes-promo-video/templates/`:

```
<project-root>/
├── DESIGN.md                  # written from templates/project/DESIGN.md.template + Q2.4 brand
├── styles.css                 # written from templates/project/styles.css.template + brand tokens
├── index.html                 # replaces init-generated; from templates/project/index.html.template
├── .hyperframes/
│   └── shiki-theme.json       # from templates/project/shiki-theme.json.template + brand colors
├── .marketing/
│   └── brand.json             # machine-readable brand record (also copied to repo root)
└── compositions/
    └── scenes/                # all 9 scene HTMLs from templates/scenes/
```

Verify the init-generated `index.html` clip-include syntax and mirror it in the overlay. If the CLI version uses a different include shape (e.g. `<iframe>`, shadow includes, or a JS manifest), the overlay must follow that shape — read the init output before substituting `{{sceneIncludes}}`.

### Step 4.2 — Install dependencies

`npx hyperframes init` handles its own install. The skill additionally installs `shiki` as a dev dependency. shiki runs at scaffold time AND during iteration when code or brand changes — the highlighted-HTML output is regenerated by Phase 5.2 / Step 4.3c, not hand-edited. shiki is NOT shipped to the rendered video output (the HTML it produces is baked in):

Detect package manager from lockfile (`pnpm-lock.yaml` → pnpm, `bun.lockb` → bun, `yarn.lock` → yarn, `package-lock.json` → npm). Default repository preference: use the lockfile's package manager. Example (pnpm):

```bash
pnpm --dir marketing/<feature-slug>/hyperframes install --save-dev shiki
```

### Step 4.3 — Pre-highlight code at scaffold time

For every scene with code (`CodeSnippet`, `BeforeAfter`, `LibrarySwap`):

1. Run shiki via Node API with the brand-derived theme generated from `.marketing/brand.json` into `<project>/.hyperframes/shiki-theme.json` (substituted from `templates/project/shiki-theme.json.template`).
2. Wrap each highlighted line in `<span data-line="N">…</span>` so the chapters mechanism can target lines.
3. Embed the resulting HTML inside the scene's `<pre class="hf-code">…</pre>` block.

Brand-derived theme: keywords in `var(--brand-primary)`, strings in `var(--brand-accent)`, comments in `var(--brand-muted)`, transparent background. Do NOT fall back to `vitesse-dark`, `github-dark`, or any other stock theme unless the brand is explicitly monochrome.

### Step 4.3b — Multi-format compositions

When the user picked option 4 (Multi-format) in Q2.2, the skill writes **three** composition files instead of one:

- `index-landscape.html` — `data-composition-id="MainLandscape"`, 1920×1080, `data-aspect="landscape"`
- `index-square.html` — `data-composition-id="MainSquare"`, 1080×1080, `data-aspect="square"`
- `index-vertical.html` — `data-composition-id="MainVertical"`, 1080×1920, `data-aspect="vertical"`

All three reference the same scene snippets in `compositions/scenes/`; per-aspect layout adjustments come from `[data-aspect="..."]` selectors in `styles.css` and from any `aspectOverrides` hints in the approved scene plan.

### Step 4.3c — Custom scene extension slot

When the story plan calls for a scene shape the 9 bundled templates can't express, generate a custom scene under `compositions/scenes/custom/<Name>.html`.

**Rules (enforced by the skill):**

1. Self-contained HTML fragment with scoped `<style>` + GSAP `<script>`.
2. May reference only project-level `styles.css` brand tokens, the global GSAP include, and shared `data-bg` variants. No external CSS frameworks, no other animation libs.
3. Must pass `npx hyperframes lint` and `npx hyperframes inspect --json` before render — skill self-corrects up to 2 times on failure.
4. Animation must use a GSAP timeline scoped to the scene root via `[data-clip-id="..."]` (see the `gsap` skill). No `setTimeout`-based animation.
5. Must respect `data-duration` from its entry in the parent composition.
6. Must be referenced from `index.html`'s clip list alongside the bundled scenes.

Use the `hyperframes` skill's authoring guidance (Layout Before Animation, palette discipline, motion principles) when writing the custom scene.

## Phase 5: First Draft + Iterate

<HARD-GATE>
**The preview is mandatory and must be visibly running in the user's browser before any render. This gate is non-negotiable.**

It is not skipped by "use sane defaults", "don't ask questions", "non-interactive", "just ship it", "just render it", or any equivalent instruction. Those phrases govern _configuration questions_ (Q2.1–Q2.4 confirmations) and _iteration prompting_ — they do NOT authorize skipping straight to render. The user is always given the chance to see the first draft moving on screen and steer it before render burns time.

**Forbidden shortcuts:**

- "User said sane defaults, so I'll just `npx hyperframes render`" → **No.** Render is gated by Phase 6, which is gated by Phase 5.
- "I'll do a draft render and show them frames instead" → **No.** Frames are not motion. Rendering is also slow (1–2 minutes for 30s) — preview is instant and HMRs.
- "Preview's optional because the lint+inspect already passed" → **No.** Lint catches structural errors. Preview catches storytelling, pacing, motion, and copy errors.

**Required actions in this phase, in order:**

1. Start `npx hyperframes preview --port 3010` as a background process (fall through 3011/3012/3013 if busy).
2. Wait for `Studio running` in the process output before proceeding.
3. **Open the URL in the user's browser** with the platform-appropriate command (`open` on macOS, `xdg-open` on Linux, `start` on Windows). Do this once, automatically — do not just print the URL and assume the user will click it.
4. Tell the user the URL is open and ask for freeform feedback (in interactive mode) or proceed straight to the standard render after a short visible pause (in non-interactive mode — but the preview tab is still opened so the user can intervene).

If the user has explicitly disabled the preview gate in advance (e.g., a CLAUDE.md note, a one-off "render only, no preview"), record that override in the final summary. Vague "use defaults" phrasing is NOT such an override.
</HARD-GATE>

### Step 5.1 — Start the preview server

Run as a background process, scoped to the scaffolded project directory:

```bash
npx hyperframes preview --port 3010
```

(Fall back: try 3011, 3012, 3013 if 3010 is in use. Fail loud if all taken.)

Wait for `Studio running` in the preview process output, then open the URL in the user's browser:

```bash
# macOS
open http://localhost:3010
# Linux
xdg-open http://localhost:3010
# Windows
start http://localhost:3010
```

Then present to the user:

> "Preview is running and I've opened http://localhost:3010 in your browser. Review the first draft.
>
> What do you want to change? (freeform — 'make the hook punchier', 'swap scenes 2 and 3', 'use arktype instead of yup', 'drop the problem scene', 'longer pause on the code', anything you want.)"

### Step 5.2 — Accept freeform feedback → edit → lint+inspect → HMR refresh

Parse the user's request and decide which file to edit:

| Request kind                                       | File to edit                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Content / copy change                              | scene HTML's text/caption/code (re-run shiki for code changes)                           |
| Timing / ordering change                           | parent `index.html` clip order + `data-duration`                                         |
| Visual / animation tweak on a bundled scene        | `compositions/scenes/<Scene>.html`                                                       |
| Novel visual request the bundled set can't express | `compositions/scenes/custom/<Name>.html` (create) + reference in `index.html`            |
| Brand change (colors, font, logo)                  | `DESIGN.md` + `.marketing/brand.json` + regenerate `styles.css` + regenerate shiki theme |

After each edit:

1. Run `npx hyperframes lint` silently (current directory).
2. Run `npx hyperframes inspect --json` silently.
3. If either reports errors, self-correct (up to 2 attempts) before telling the user.
4. The preview HMRs automatically — no manual refresh needed.

Re-prompt:

> "Saved. Preview should have refreshed. Next change, or ready to render?"

### Step 5.3 — Loop until approved

User signals "ready to render", "looks good", "ship it", "render", "done", or similar → move to Phase 6.

### Step 5.4 — Drift guard

Each iteration stores a snapshot of the parent `index.html` content + scene contents in an in-memory session history. If the iteration loop hits 10 rounds without approval:

> "We've iterated 10 times. Options:
>
> 1. Reset to an earlier draft (I'll show the history)
> 2. Keep going
> 3. Render the current draft as-is"

If the user picks (1), show a numbered list of snapshot summaries (hook text of each draft) and let them pick.

## Phase 6: Render

#### Render quality is not optional

The preview is pristine; the render pipeline must preserve that.
Two structural problems ruin h264 output of otherwise-perfect HTML scenes:

1. **Chroma subsampling (YUV 4:2:0)** halves color resolution. Pink text
   on dark backgrounds, thin colored lines, and subpixel anti-aliasing get
   blurred. The fix is **supersampling**: render at 2x composition
   dimensions so ffmpeg downsamples from a sharper source.

2. **8-bit quantization** gives only 256 luminance steps — gradients band.
   The fix must be **at the source**, not at the codec: every scene's
   `[data-bg]` block ships a subtle SVG noise overlay (the `.scene::after`
   `feTurbulence` layer in `styles.css`) that dithers the quantization
   below perception. 8-bit h264 encoding is the only format
   that plays reliably across Windows 11 Films & TV, Discord, browsers,
   VLC, and social upload pipelines. Do NOT default to 10-bit
   (`yuv420p10le`) — consumer GPU decoders often skip h264 high10 without
   falling back to software, producing black frames on Win11/Discord.

**Edge case — 10-bit opt-in:** only use when the creator has verified
their end-to-end pipeline supports h264 high10 profile (e.g., shipping
to a known YouTube upload that always transcodes, or to a target audience
on mpv/VLC only). Never use as a default.

**Never** render with low-quality JPEG intermediates. Use PNG or HyperFrames'
default lossless intermediate.

**How the NoiseDither overlay works:** every `.scene` element has an
`::after` pseudo-element that paints an SVG `feTurbulence fractalNoise`
filter at ~4% opacity in overlay blend mode. The noise breaks up the 8-bit
gradient-quantization step boundaries perceptually, turning visible bands
into faint grain. This is the same technique Figma and export pipelines use.

### Step 6.1 — Pre-render checks (fail loud)

Before rendering, all of these must pass. If any fail, report exactly what and where, and do not render.

**Technical checks:**

- [ ] `npx hyperframes lint` passes with zero errors
- [ ] `npx hyperframes inspect --json` finds no overflow / off-canvas / clipped-container issues
- [ ] Sum of `<clip>.dataset.duration` across the composition is within the **15–60s** window AND within ±20% of the scope-derived target proposed in Q2.1 (or matches an explicit user override). If the natural story comes in shorter than the proposed target, the target was wrong — re-derive from scope, do not pad.
- [ ] **No padding scenes**: no scene exists solely to extend duration. A scene fails this check if any of: its payoff sentence (Phase 3.3 item 1) is blank, vague, or duplicates another scene's; the composition contains trailing black/empty/freeze frames after the last animation resolves; any scene holds a static frame with no on-screen change for more than 1.5s without a narrative reason captured in the scene plan
- [ ] **Dwell-time spot check (manual)**: Open the preview at `localhost:30XX`, watch the longest text-heavy scene, and confirm each substantial caption stays on screen ≥1.5s after its animate-in completes. If any caption flashes faster than that, slow the animate-in or add a hold before the scene-out.
- [ ] Every scene with code renders without shiki errors at scaffold time (test by running the highlighter on each snippet)
- [ ] Every brand asset referenced in `DESIGN.md` exists on disk
- [ ] Render flags include the supersampling + 8-bit yuv420p intent (see Step 6.2 — pass when the CLI exposes them, otherwise post-process via ffmpeg)

**Storytelling audit (refuse to render if any fail — report to user and ask for a fix before proceeding):**

- [ ] Hook enforcement rules (see `hooks/hook-rules.md`) pass on the HookTitle scene's headline text
- [ ] **Motif presence**: the signature motif from Phase 3.0 appears in ≥2 scenes (check by grepping the motif fragment's class or include across `compositions/scenes/`)
- [ ] **State-change observed**: the motif's visual state (color, amplitude, geometry, opacity) differs between at least one adjacent scene pair — not identical across the whole deck
- [ ] **Pacing variance**: `max(scene.duration) / min(scene.duration) ≥ 2.0`. Uniform-duration plans refuse to render.
- [ ] **Value prop by ~t=8s**: sum of the first two scenes' durations is ≤ `0.30 × total duration`. If more than 30% of the video elapses before scene 3 begins, the value prop is buried.
- [ ] **No adjacent-scene background repeat**: consecutive scenes must use different `data-bg` variants (prevents the "same color for 15 seconds" flatness)
- [ ] **UI moment when applicable**: if the feature has a user-visible surface, at least one scene must include a UI showcase (screen capture, screenshot with overlay, or mock UI). See Phase 3.5.
- [ ] **Per-scene payoff**: every scene has a recorded payoff sentence from Phase 3.3. If any is missing, blank, or duplicates another, refuse.
- [ ] **Anti-clickbait**: the hook's promise is delivered by at least one non-hook scene (existing rule).
- [ ] **Transitions planned**: for each adjacent scene pair sharing a motif, a match-cut is described in the scene plan (Phase 3.4).
- [ ] **Single alignment per scene**: every scene's text elements share ONE alignment (centered / left / right). Mixed alignments within a scene (or within one column of a two-column scene) fail this check. See Layout Rule 2.
- [ ] **Foreground readability over decoration**: every scene with background decoration (streaming feeds, ambient motion, low-opacity logos) renders the foreground text at WCAG AA contrast. If decoration effective opacity exceeds ~0.25 anywhere behind hero text, a local scrim (z=1 between bg and fg) must exist. See Layout Rule 6.
- [ ] **No accidental overlap**: at the hero frame of every scene, no focal element's bounding box overlaps a non-foreground element by more than ~10% without an explicit `z-index` declaration. `npx hyperframes inspect` covers most of this; verify any newly-added decorations against the rendered hero frame, not the empty initial frame. See Layout Rule 7.
- [ ] **Code beats ≥5s have chapters**: any scene with code visible for >5 seconds defines `chapters[]` (or equivalent timeline-driven `[data-active]` progressions). Static one-shot code dumps fail this check. See Code Scene Rules — _Tell a story with chapters_.
- [ ] **Every chapter has a synchronized title**: any scene with `chapters[]` (or staged code focus) MUST have a heading/caption variant per chapter that swaps in lockstep with the focus change. A code highlight without a synchronized title saying _why_ we're looking at it fails this check. See Code Scene Rules — _Synchronized chapter narration_.
- [ ] **Per-aspect canvas fill** (when multi-format selected in Q2.2): for each aspect (1:1, 9:16) at every scene's hero frame, the bounding box of foreground content reaches within ~80–100px of every canvas edge. If any scene leaves >120px of dead margin on either axis, the per-aspect overrides are wrong — content is undersized for the aspect. See Step 3.6 — _Fill the canvas_.
- [ ] **Visual chunk cap (≤4 per frame)**: every scene's hero frame contains ≤4 distinct visual chunks (where a chunk is a Gestalt group, not a single element). Counts: title, motif, code card, trace tree = 4 chunks. Adding an attribute chip row pushes to 5 — must merge via similarity (chips and tree share color/font) or split scene. See Visual Cognition Rule A.
- [ ] **One pre-attentive cue per focal element**: each focal element is marked by exactly one dominant cue (color OR size OR motion OR orientation), not multiple. Two or more competing cues force conjunction search and double parse time. See Visual Cognition Rule B.
- [ ] **Reading flow matches scene type**: hero/sparse scenes lay out for Z-pattern, code-heavy scenes for F-pattern, multi-card scenes for layer-cake. Misplaced elements (e.g. CTA URL in top-left of a sparse scene, code caption far from the focused line) fail this check. See Visual Cognition Rule C.

### Step 6.2 — Render mp4 + poster

Stop the preview background process first.

For a single-aspect video:

```bash
npx hyperframes render --output out/video.mp4
```

For multi-format (user picked 4 in Q2.2), render each composition by id:

```bash
npx hyperframes render --composition MainLandscape --output out/video-landscape.mp4
npx hyperframes render --composition MainSquare    --output out/video-square.mp4
npx hyperframes render --composition MainVertical  --output out/video-vertical.mp4
```

**Render-flag mapping (intent ports, exact flags depend on CLI version):**

Read `npx hyperframes render --help` once at scaffold time and pick the closest flag for each intent. Pass them when supported; fall through to the post-process step when not.

| Intent                               | Pass when supported                               | Post-process fallback                                                                                                                            |
| ------------------------------------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Supersampling (`--scale 2` analogue) | Pass the CLI's scale/upsample flag                | None — accept HyperFrames' default render path (it likely already supersamples internally; verify by inspecting the Chrome viewport setup)       |
| 8-bit yuv420p                        | Pass the CLI's pixel-format flag set to `yuv420p` | `ffmpeg -i out/video.mp4 -c:v libx264 -crf 14 -pix_fmt yuv420p -movflags +faststart out/video-final.mp4 && mv out/video-final.mp4 out/video.mp4` |
| CRF 14                               | Pass the CLI's CRF flag                           | Covered by the post-process step above                                                                                                           |

**Poster (first-frame still):**

Try the CLI's still flag first (e.g. `--still`, `--poster`, or whatever the current version exposes — check `--help`). Fall back to ffmpeg:

```bash
ffmpeg -ss 0 -i out/video.mp4 -frames:v 1 out/poster.jpg
```

Move artifacts from `<project>/out/` to `marketing/<feature-slug>/`:

- `video.mp4` (or per-aspect files)
- `poster.jpg` (or per-aspect files)

### Step 6.3 — Print summary

```
✓ Rendered: marketing/<feature-slug>/video.mp4 (30s, 16:9, <size>)
✓ Poster:   marketing/<feature-slug>/poster.jpg
```

## Phase 7: Cleanup

Ask the user what to do with the scaffolded HyperFrames project:

> "Video is ready. What do you want to do with the HyperFrames project at `marketing/<feature-slug>/hyperframes/`?
>
> 1. **Keep it** — useful for re-rendering or variants later
> 2. **Delete it** — keep only the mp4 and poster
> 3. **Archive** — move to `marketing/<feature-slug>/hyperframes.zip` and delete the folder"

Execute the chosen action. End.

## Storytelling & Visual Uniqueness Rules

The default failure mode of an AI-generated promo video is _generic_: a hook, three bullet points, a code block, a CTA. Every scene stacked vertically, same rhythm, same layout language as ten thousand other "new feature launch" reels. Viewers scroll past in under 2 seconds. Technically correct ≠ memorable.

These rules exist to push back against that default.

### Rule 1: No plain bullet lists

A vertical stack of bullet points with icons is the most overused and forgettable scene shape in dev-marketing video. When the story asks for a "list of pains / benefits / reasons", the skill MUST transform the list into a structure that _visualizes what it's saying_:

- Fragmented APIs? Tilted "evidence cards" with real conflicting property names, connected by broken-chain glyphs (`≠`, `↯`).
- Slow-vs-fast? A physical race lane with two markers at different frame-sync'd positions.
- Many → one? Scattered inputs flying inward into a single funnel.
- Three providers compete? Provider logos or name pills with active-state indicators and crossfade swaps.

Every beat should ideally have a form that _only makes sense for that beat_. If the same bullet shape could hold "our five pillars of happiness" or "three reasons our API is fast", it is too generic — redesign it.

### Rule 2: Build a signature visual thread

Every promo video should have one recurring visual element tied to the subject matter — a "thread" that appears in 2–4 scenes (typically hook, problem, and CTA) and carries the theme.

The motif is **derived in Phase 3.0** from the product's core verb. See `references/visual-motifs.md` for the full catalog (20+ verb → motif mappings) and the heuristic for deriving a motif when the verb isn't listed.

Key principles (full detail in the catalog):

- The motif should be the _physical / spatial metaphor_ for what the product does, not a decorative element. Stripe's gradients = money flowing. Linear's lines = motion. The test: would this motif make sense on an unrelated product? If yes, it's generic.
- The motif must **change state** between scenes to do narrative work. A clean magenta waveform in the hook becoming a jagged red glitch-wave in ProblemSetup, then resolving back to a confident unified wave in the CTA, delivers a complete three-act arc without a single caption.
- Motif reappearance with a new state is the oldest trick in cinematic storytelling (stairs in _Parasite_, mirrors in _Black Swan_). Same element, different meaning each time.

In HyperFrames, when a motif needs to recur across scenes, create a small reusable fragment under `compositions/motifs/<name>.html` (this directory is not part of the bundled scaffold — create it on demand) and include it from each scene that needs it. Implement it once, vary state via CSS classes / `data-state` attributes the GSAP timeline toggles. Never rebuild the thread scene-by-scene.

### Rule 3: Custom scenes over bundled, when it matters

The 9 bundled scenes (`HookTitle`, `ProblemSetup`, `CodeSnippet`, `LibrarySwap`, `BeforeAfter`, `MetricCompare`, `BulletList`, `CTAEndScreen`, `UIShowcase`) cover ~80% of cases and should be used when the story fits. They should NOT be the excuse for a lazy story.

If a beat's visual shape would be unique and memorable, create a `Custom` scene under `compositions/scenes/custom/<Name>.html` rather than bending a bundled scene into something it isn't. Examples that warrant Custom scenes:

- A split-screen showing two API shapes side by side with a rotating "≠" between them
- A synchronized pair of animations where one depends on the other (input → output pipeline)
- A physics-driven element (spring-chained cards falling into place, orbiting nodes)
- A kinetic-typography moment (words swapping in place, letters re-arranging)

The rule of thumb: if your first instinct is "I'll just use `BulletList`" and the content is interesting, stop. Either upgrade to a Custom scene or upgrade the bundled scene's _internal_ storytelling (tilts, connection glyphs, staggered physics, per-item glyph variation).

### Rule 4: Replace abstract prose with concrete evidence

Inside any scene that describes a pain or a benefit, prefer _real, verifiable detail_ over abstract claims. This makes the video technically credible and visually unique because the evidence IS the design element.

| Abstract (generic)            | Concrete (unique + credible)                                          |
| ----------------------------- | --------------------------------------------------------------------- |
| "Every provider is different" | `music_length_ms` vs `seconds_total` vs `duration` shown side-by-side |
| "Our SDK is type-safe"        | A screenshot-like TS diagnostic with red squiggles on the bad line    |
| "10× faster"                  | Two progress bars racing, finishing at t=500ms and t=50ms             |
| "Works anywhere"              | Animated pills of the supported runtimes lighting up in sequence      |

When pulling evidence from a PR or codebase, quote the actual symbol names, parameter names, or model ids that appear in the source. If a viewer who uses those libraries recognizes the exact string you're showing, you've won credibility and memorability in the same frame.

### Rule 5: Animate with intent, not with defaults

Every animation should deliver information, not just "look animated". If removing an animation would not change what the viewer understands, it is decoration and should be reconsidered. Use GSAP timelines (see the `gsap` skill) — the timeline structure makes intent explicit.

Good:

- **Text fades in AFTER the headline lands** → tells the viewer "the headline is the promise; what follows delivers it"
- **Cards stagger-enter at different tilts** → creates a "chaos / fragmentation" feel that matches the message
- **Waveform amplitude rises when a provider pill becomes active** → shows "this one is now playing"

Bad:

- All elements fade in together with identical timing (no narrative layer)
- Arbitrary bounces on every text element (dilutes emphasis)
- Continuous looping animations on every background element (fatigues the viewer)

### Rule 6: Fly-in taglines as insight delivery

After any multi-beat scene (evidence wall, problem pile-up, comparison), the viewer needs a one-line synthesis to carry forward. Reserve the last 25–35% of a scene's duration for a fly-in tagline that states the insight:

- After "three conflicting APIs" → "Same goal. Different shapes."
- After "three slow steps" → "That's a full coffee break."
- After "five different SDKs" → "Five SDKs to learn. Or one."

The tagline should:

- Land AFTER all the evidence has arrived (don't overlap with stagger-in)
- Use distinct styling from the beats (different font weight or color — typically lower saturation so it reads as "narrator voice, not beat")
- Be ≤ 6 words per half, ≤ 2 halves

This is the single biggest lever for turning "nice visual" into "actually communicates a point".

### Rule 7: Motion with a payload — kinetic type restraint

Research on high-performing kinetic typography and motion graphics is consistent: **text moves only when motion adds clarity**, never because there's a 3-second hole to fill. Motion without a payload is the single biggest "looks AI-generated" tell.

Good motion choices:

- A word scales up because it's the answer the previous scene teed up
- Letters slide in one-by-one because the sequence _is_ the message ("M · U · S · I · C" on a music feature)
- A headline morphs into a different headline because the topic shifted

Bad motion choices (generic):

- Every headline bouncing into place with the same ease on every scene
- Continuous shimmer/pulse/loop on every text layer (visual fatigue, no signal)
- Emoji or icon wobble without a narrative reason
- Every letter fading in one-by-one on every text element — reserve that for the one letter-by-letter beat of the video

Counter-expectation is underused: when the default register is fast-and-loud, going **still-and-soft** for one beat can land harder than any spring animation. If the surrounding scenes are busy, let the insight tagline (see Rule 6) sit dead-still for 1.5 seconds.

### Rule 8: Color script — emotion across scenes, not palette within one

The brand palette is static; a **color script** is the scene-to-scene emotional arc layered on top. Individual scenes should feel different from each other along a temperature or saturation dimension:

- **Hook** — warm, on-brand, confident (`data-bg="primary-glow"`)
- **Problem** — cooler, red-accented, tense (`data-bg="vignette"` — the variant ships a danger-tinted accent overlay)
- **Solution / LibrarySwap / BeforeAfter** — transitional, forward-leaning (`data-bg="diagonal"`)
- **CTA** — return to warm, saturated, resolved (`data-bg="primary-glow"` again)

The arc should support the narrative ("confident → tense → resolved"). A problem scene that uses the same warm glow as the hook robs the narrative of its tension beat. A CTA that stays cool/red reads as unresolved.

Implementation: the existing `data-bg` variants in `styles.css` are the lightweight color-script surface. For a more cinematic arc, nudge the gradient alphas in `styles.css`, add a brand-danger-tinted overlay in Problem scenes via a custom variant, or add a subtle saturation boost in the CTA.

### Rule 9: First-10-seconds value prop

By the ~10-second mark, the viewer must know (a) what this feature does, (b) who it's for, (c) why it matters. This is a research finding from every major product-launch-video study: the single strongest predictor of completion rate is value clarity before the ~10s mark.

Mapping to the standard 30s structure:

- Hook (0–3s): promises the value
- ProblemSetup (3–8s): reveals the stakes / gives the "why"
- LibrarySwap or CodeSnippet (8–22s): delivers the "how"
- CTA (22–30s): converts

During Phase 3.3 (scene-plan approval), explicitly self-check: "By the end of scene 2 (around t=8s), does the viewer know what the product does and why?" If no, the scene plan is wrong — restructure before scaffolding. Don't bury the value in the LibrarySwap.

### Rule 10: The generic test

Before rendering, run this self-check against every scene. If the answer to ANY is "no", the scene is generic and should be redesigned:

1. Could I swap the topic from "audio generation" to "image generation" and this scene would look identical?
2. Does every visual element in this scene have a reason to exist that ties to THIS story?
3. Is there at least one element per scene a viewer would remember 10 minutes later?

If a scene fails the test, the fix is rarely "change the copy". It's a layout or visual-element change: add a signature thread appearance, introduce a domain-specific glyph, replace a bullet with a concrete evidence card, pull a real symbol name from the source.

## Hook Enforcement Rules

Hard rules applied whenever the skill writes or edits HookTitle scene text. See `hooks/hook-rules.md` and `hooks/hook-patterns.md` for details.

1. **Max 7 words** on the hook caption (string length check)
2. **Blocked openings** — reject if the hook starts with any blocked phrase. See the full list in `hooks/hook-rules.md` (Rule 2).
3. **Required pattern** — the hook must match one of: Result, Mistake, Secret, Comparison, Pattern-interrupt, Curiosity-gap, or Visual-hook (see `hooks/hook-patterns.md`)
4. **Visual reinforces text** — the HookTitle scene's `data-visual-variant` (`pattern-interrupt` / `curiosity-gap` / `social-proof`) must align with the text (checked at scene-plan approval in Phase 3.3)
5. **Anti-clickbait check** — before render, verify the hook's promise is delivered by at least one non-hook scene. If not, refuse to render and ask the user to adjust.

If any rule fails, the skill proposes up to 3 alternative hooks that comply.

### Layout and Typography Rules

Applied whenever the skill generates or edits any scene.

1. **Backgrounds**: every scene root carries `data-bg="…"` — variants: `primary-glow` (radial glow of the brand primary at top-left), `vignette` (dark vignette around the edges for focus scenes; ships with a danger-tinted overlay on the problem side), `diagonal` (subtle accent→primary linear gradient), `flat` (no overlay). Flat background fills are banned by default — if a scene absolutely needs one (e.g. UIShowcase, where the captured UI carries the visual), document why in a leading HTML comment and use `data-bg="flat"` explicitly.
2. **Text alignment — pick ONE per scene, never mix.** A single scene must use ONE text alignment for every text element it contains. Mixing alignments inside a scene (e.g., left-aligned headline + centered tagline + left-aligned caption) reads as broken — the eye has no anchor to track and the layout looks like assembled fragments rather than a designed scene.
   - **Centered scenes**: hooks, titles, CTAs, emphatic one-liners — every text element in the scene is centered, including any sub-captions or taglines that follow the headline.
   - **Left-aligned scenes**: lists, prose paragraphs, side-by-side panels, code-card scenes — every text element is left-aligned, including the section captions above each panel.
   - **Right-aligned scenes**: rare; only for intentional "log feed" / "right-rail" treatments where every element is right-aligned.
   - Justify only when there's a strong reason; otherwise left or center.

   In two-column scenes (left = code, right = trace tree, or before/after panels), each column is its own alignment context, but each column must be internally consistent — a column's caption, body, and tagline all share one alignment. Never have the right column centered while the left column is left-aligned. The pre-render audit (Phase 6.1) flags scenes with mixed alignments inside one column.

3. **Emphasis**: in any caption, headline, or other authored string, wrap key words with `**word**` at the story-plan level. The skill substitutes those at scaffold time to `<span class="hf-emph">word</span>` — `.hf-emph` is styled in `var(--brand-primary)` by `styles.css`. Limit 1–2 emphasized runs per caption. Example: `"Mix providers wrong — **ship a landmine**."`
4. **Code blocks**: always render as `<pre class="hf-code">…</pre>` containing pre-highlighted HTML produced by shiki at scaffold time using a brand-derived theme (keywords in `var(--brand-primary)`, strings in `var(--brand-accent)`, comments in `var(--brand-muted)`, transparent background — emitted via the `.hf-tok-*` classes in `styles.css`). Do NOT fall back to `vitesse-dark`, `github-dark`, or any other stock theme unless the brand is explicitly monochrome. If the brand palette shifts, regenerate `.hyperframes/shiki-theme.json` and re-highlight every snippet — never hardcode `#0d1117` or any GitHub-dark-derived color. Container background = `rgba(255,255,255,0.04)` with `1px solid rgba(255,255,255,0.08)` border and a brand-primary-tinted box-shadow (already wired into `.hf-code`).
5. **Spacing rhythm — harmony, not extremes**: follow a single consistent scale across every scene so the eye doesn't have to relearn the layout. Defaults that work:
   - **Scene padding**: 80–100px outer (the bundled `.scene` rule uses 90/100)
   - **Title → next element**: 72–80px (titles always get breathing room; never ≤48px gap — text crowds into the thing below)
   - **Peer content elements** (cards, code block and pills, caption and content): 40–56px
   - **Tight pairs** (glyph+text, number+label): 16–24px
   - **Ambient decorations** (waveforms, background particles): position absolutely with ≥70px edge inset and low opacity (≤0.5); never place them within ~100px of a focal element

   If a layout feels "too airy", the gap is probably ≥120px between peers — tighten to the 40–56px band. If a title feels "stuck to" what's below, the gap is ≤48px — push to 72+. When in doubt, pick ONE scale and use it everywhere; inconsistent gaps look more "generic AI slideshow" than any single choice.

6. **Background-versus-foreground readability — load-bearing contrast.** Whenever decorative elements sit behind a focal text element (streaming background traces, ambient particles, low-opacity logos, looping motion threads), the foreground text MUST remain unambiguously readable. Defaults that work:
   - **Background decoration opacity**: ≤0.22 against a brand-background of `#0A0A0A`. Above 0.25 it competes with foreground; above 0.4 it actively obscures.
   - **Local scrim behind hero text**: when a decoration must run across the whole canvas (e.g., a streaming event feed in the CTA), add a centered radial-gradient scrim (`color-mix(in srgb, var(--brand-background) 78%, transparent)` at the center, fading to transparent at ~70% radius) on a z-layer **between** the decoration and the text. Keeps the decoration visible at the edges, keeps text on a clean dark base.
   - **Test by squinting**: if you squint at the scene and the text shape disappears into the background, contrast is insufficient. The viewer scrolling past on mobile is squinting.
   - **Never reduce text contrast to "balance" the bg**: foreground text must always meet WCAG AA (4.5:1 for body, 3:1 for ≥24px display). If the bg is too busy, fix the bg, not the foreground. `npx hyperframes inspect --json` reports the per-element contrast ratios; verify against WCAG AA before render.

7. **Z-stack discipline — no unintended overlap.** Every focal element (headline, code line, span row, attribute chip, CTA button) must be either fully visible or intentionally and obviously layered. The failure modes this rule exists to catch:
   - A decoration positioned with negative offsets or overlapping bounds that visually clips a focal element ("the chips appear half behind the trace tree"). Verify the rendered position of decorative elements at the hero frame, not just the empty initial frame.
   - A foreground element whose bounding box happens to land underneath a higher-z-index ambient layer ("the redaction overlay covers half the title"). Background elements get `z-index: 0`; scrims/vignettes get `z-index: 1`; foreground content gets `z-index: 2+`. Stick to a known scale; don't sprinkle ad-hoc z-index values.
   - Streaming elements that overshoot their container, partially exiting the visible canvas mid-animation. Either clip them (`overflow: hidden` on the container) or constrain their travel distance to stay inside.

   **Layout intent vs. layout accident**: a logo deliberately framed behind a CTA URL pill is intentional (z-stack, transparency, designed). The same logo crashing into the URL pill at an unintended position is an accident. The pre-render audit (Phase 6.1) flags any focal element whose bounding box overlaps a non-foreground element by more than ~10% of its area without an explicit `z-index` declaration.

### Visual Cognition & Attention Rules

These rules are grounded in established research on how the human visual system actually digests information: Cowan on working memory capacity, Treisman's Feature Integration Theory on pre-attentive processing, Nielsen Norman Group eye-tracking studies on scanning patterns, Gestalt principles of perceptual grouping, and Rayner's reading-saccade research. They explain _why_ certain layouts feel intuitive and others feel like "AI-generated noise," and they are checked at scene-plan approval (Phase 3.3) and pre-render (Phase 6.1).

#### Rule A: ≤ 4 distinct visual chunks per frame

Visual working memory tops out at about **3–4 chunks** (Cowan, refining Miller's 7±2). When a frame shows 5+ distinct elements (icons, cards, badges, numbers, captions, motifs), the viewer cannot hold them simultaneously — the eye samples 3–4 and drops the rest.

- A "chunk" is one visual unit a viewer parses as a single thing. A row of 6 evenly-spaced provider logos that share color and size is ONE chunk (parsed as a group via Gestalt similarity), not 6.
- **Hero scenes (hook, CTA)**: 2–3 chunks ideal — title + supporting motif + URL/action.
- **Showcase scenes**: max 4 distinct foreground chunks. A trace tree with 5–7 rows that share bar geometry counts as ONE chunk; an attribute chip row is a second chunk; a code card is a third.
- If a scene plan has 5+ chunks that don't merge via similarity/proximity, restructure before scaffolding — re-group with shared color/size/shape, or split into two scenes.

#### Rule B: One pre-attentive cue marks the focal element per frame

Pre-attentive processing (Treisman, Feature Integration Theory) detects **color, motion, orientation, and size** in parallel and unconsciously within ~200 ms. A single pre-attentive feature is found in constant time regardless of distractor count; conjunctions of features require slow serial attention.

- Pick ONE cue per frame to mark "look here":
  - Brand-primary color on a near-black canvas = strong attention magnet (color cue)
  - Largest text on the frame = anchor (size cue)
  - The only moving element while everything else is still (motion cue)
  - Sole vertical element among horizontals (orientation cue)
- If two or more pre-attentive cues compete (a primary-colored button AND a moving particle AND the largest text), the eye stalls in conjunction search and parse time doubles. Pick one focal cue. Supporting elements get _secondary_ cues (smaller size, lower saturation, no motion).
- The redaction safety beat is the canonical example: the entire chart goes still (background motion stops), the redaction card slides in (sole motion), AND the content is danger-red (single discrete color shift). Three cues align on one element — viewer's attention locks instantly.

#### Rule C: Reading flow — Z for hero, F for code, layer-cake for lists

Nielsen Norman Group eye-tracking studies identified four dominant scanning patterns. Match the scene's layout to the expected pattern; mismatches add ~0.5 s of parse time per scene (≈2% of a 30 s budget per misplacement).

- **Hero / sparse scenes (hook, CTA)** — **Z-pattern**. Eye lands top-left → top-right → bottom-left → bottom-right. Place the headline along the top, the action verb on the diagonal axis, the URL or supporting element bottom-right. Match-cut transitions should preserve this trajectory across cuts.
- **Code-heavy scenes** — **F-pattern**. Eye scans the top line, then the leftmost characters of subsequent lines. Code captions and chapter highlights anchor to the leftmost character of the focused line; never float captions at center-right where the eye won't land.
- **Multi-card / list scenes** — **layer-cake pattern**. The eye locks onto headings and skips body text. Make every card's label larger AND brighter than its body, or viewers miss the body entirely. The "evidence cards" pattern (Storytelling Rule 1) depends on this — the conflicting property names must read as headings, not buried in body text.

#### Rule D: Gestalt grouping carries meaning before reading begins

Use perceptual grouping to encode relationships _before_ the viewer reads any text. Done right, the layout _is_ the message; done wrong, you need callout lines to explain what relates to what.

- **Proximity**: elements within 24–32 px of each other read as one group; elements ≥ 56 px apart read as separate. Use spacing alone to encode hierarchy.
- **Similarity**: shared color/size/shape = same category. Three OTel iteration spans rendered in the same primary tint communicate "all the same kind of thing." A tool span in a different tint communicates "different kind." Don't waste this signal on decoration.
- **Common region**: a card, border, or background panel groups everything inside it. Use for event-content panels, code blocks, attribute panels — each `gen_ai.*.message` event lands in its own bordered region.
- **Figure / ground**: the smaller, higher-contrast element reads as the figure (the message); the larger, lower-contrast element reads as the ground (context). If your decoration is more saturated than your headline, the viewer parses the decoration as the message. Always.
- If a layout _requires_ drawn lines or callouts to clarify what groups with what, the Gestalt grouping is wrong — fix the spacing or color, not the callout.

#### Rule E: Saccade-aware text — every caption lands in 1–2 fixations

A reading fixation lasts ~200–300 ms; viewers make ~3–4 fixations per second; a typical reading saccade covers 7–9 letter spaces (Rayner). Video viewers do **not** backtrack — if a caption isn't readable in the time it's on screen, it gets skipped entirely.

- **Hook (3 s budget, ≈10 fixations)**: ≤ 7 words. Reason: 7 words ≈ 2 fixations in central vision = one glance. Already enforced (Rule 1).
- **Scene captions** (≥ 2 s on screen): ≤ 9 words, single line, ≥ 32 px on a 1920×1080 frame. Wraps require a re-orientation saccade and steal a fixation from comprehension.
- **Code lines focused via chapter**: ≤ 45–50 chars at half-width, ≤ 75 chars at full-width. Already enforced. The line in focus must be readable in one fixation.
- **Numbers and key terms first**: place the number or key term at the leftmost saccade landing point (left edge for left-aligned text, first 3 words for centered text). Trailing numbers require regression saccades and lose ~30% of viewers.

#### Rule F: Motion is a budget — spend it on direction, not decoration

Sudden motion in peripheral vision triggers the **orienting response** — the eye snaps toward it within ~150 ms involuntarily. This is the strongest attention pull in the entire visual system. It's also exhausting if abused.

- **One motion-attention pull per scene**, timed to direct the eye to where the next message lands. A continuous loop in the corner steals attention from every subsequent beat.
- **Entrance animations spend budget**. Every moving element costs viewer attention. Stagger entrances so they land sequentially (≥0.1 s apart), not simultaneously — viewer can track one focal point at a time.
- **Foreground motion must be ≥3× faster (or larger) than background motion**. If foreground and background move at similar rates, the eye has no figure/ground to lock onto and parsing collapses. The CTA streaming-events backdrop succeeds because the streams move slowly (one row per ~1 s) while the headline lands instantly — clear figure/ground.
- **No infinite loops on focal elements**. Viewer fatigue sets in within ~3 cycles; after that the loop becomes peripheral noise and the underlying message is lost.

### Code Scene Rules

#### Tell a story with chapters

**Mandatory for any code beat ≥5 seconds.** A 15-line dump on screen with no progressive emphasis is the strongest "AI-generated reference doc" tell — the viewer's eye hunts for what to read first, can't find an anchor, and disengages. Code must be staged as a _narrative arc_ the viewer can follow:

- **Chapter 1 — the world before**: highlight the imports / the prior approach / what the developer writes today (the empathy beat).
- **Chapter 2 — the change**: focus on the one new line, the new import, or the new call site that activates the feature (the wow beat).
- **Chapter 3 — the consequence**: shift focus to the line(s) that show the _result_ — what the new feature unlocks downstream (the payoff beat). Often the consequence is shown alongside a sibling visual (a trace tree appearing, a UI updating, a metric flipping).
- **Chapter 4 — victory beat** (optional, ~1–2s): all lines visible, no dimming, viewer's eye can rest.

If the code beat is a single 15-line snapshot with no progression — no `chapters[]` in the scene config, no `tl.set()` activating different `[data-active]` lines — refuse the scene plan in Phase 3.3 and ask for a chapter breakdown before scaffolding.

Code scenes (`CodeSnippet`, `BeforeAfter`) walk the viewer through the code over time, not dump everything at once. The bundled scenes embed a `<script type="application/json" data-chapters>` block consumed by the scene's GSAP timeline; each chapter object has the shape:

```json
{ "startFrame": 0, "durationFrames": 90, "focusLines": [3, 4], "captionIndex": 0 }
```

Use the `chapters` array on the scene to sequence emphasis:

1. **Imports arrive** — highlight all imports (~3s)
2. **The new import** — zoom to the key import line (~3s)
3. **The usage site** — shift focus to where the import is consumed (~3–4s)
4. **Victory beat** — full clarity, all lines visible (~1–2s)

Non-focused lines dim to ~0.22 opacity with a slight blur; 700ms CSS transitions animate the change (already wired in `styles.css`). On `BeforeAfter`, the non-focused panel additionally fades (to ~0.35 effective opacity), blurs 1.5px, and scales down slightly via 600ms transitions.

Rules:

- Give viewers ~3s per chapter (90 frames at 30fps). 1–2s feels rushed — they haven't finished reading before the focus shifts.
- Sum of chapter `durationFrames` should match the scene's total `data-duration × fps`. Extra frames hold on the last chapter; missing frames truncate.
- Each chapter may swap to a different pre-rendered caption via `captionIndex`. The caption stack is pre-rendered server-side in HTML; the timeline toggles which one has `[data-active]`. The 300ms cross-fade comes from the `transition: opacity 0.3s ease` rule in the scene's CSS.
- `chapters` is preferred over a static one-shot focus for any code beat longer than ~3s.
- **No chapterless dumps**: any code beat scoped at >5s is required to define `chapters[]` (or equivalent timeline-driven `[data-active]` progressions). A static one-shot focus is only acceptable for ≤3s flashes. The pre-render audit refuses to render code scenes >5s without a chapter breakdown.

#### Synchronized chapter narration — every chapter needs a title that says WHY

A code highlight without a synchronized title is half a beat. The viewer sees something dimmed and something focused, but doesn't know whether the focused part is the _new feature_, the _result_, the _bug being fixed_, or the _foundation everyone already has_ — so they can't reason about it.

**Every chapter must include a synchronized narration line that swaps in lockstep with the focus change.** The narration sits above the code (or in a fixed slot near it) and tells the viewer the verb of what's happening:

- _"Wrap with the provider."_
- _"Add a custom tool."_
- _"Render it inline."_
- _"Plug into the runtime."_
- _"Mount in any framework."_

Implementation pattern (HyperFrames):

1. Build a `code-heading-stack` container above the code card with one `<div class="code-heading code-heading-variant" data-beat="N">` per chapter. Each variant is `position: absolute; top: 0; left: 0; width: 100%; white-space: nowrap; opacity: 0;` — give the stack an explicit `width` (e.g. `1500px` for landscape) so the absolutely-positioned children don't collapse to natural-content width.
2. The active variant's `opacity: 1` is driven by GSAP — typically a 0.45s fade out / 0.55s fade in with ~0.1s overlap, scheduled at the chapter boundary.
3. The chapter's GSAP `tl.call()` that swaps `[data-active]` lines runs ~0.2s **after** the title swap starts — viewer reads title first, then sees the highlight resolve.

Authoring rules:

- **Action language only**: titles describe what's _happening_ (verb-led), not what's labelled. _"Wrap with the provider."_ not _"The provider"_. _"Add a tool."_ not _"Tool registration."_
- **End-to-end narrative arc**: read all the chapter titles back-to-back as a sentence. They should flow as a tour or set of instructions: _"Set up the client. Wrap with the provider. Drop in your components. Add a custom tool. Render it inline."_ — not random captions.
- **Match the visual to the words**: when the title says _"add a custom tool"_, the focused lines must literally show the tool being added (the import, the call site, or the JSX). Misalignment between what the title claims and what's highlighted breaks viewer trust harder than a missing title.
- **Pair with synchronized side activity**: if the scene has a sibling visual (a chat mock, a trace tree, a UI panel), its content reveal should sync to the title beat too — _"Render it inline."_ fires the same time the WeatherCard appears in the chat. Title + code highlight + side visual all change together.
- **One title beat = one chapter**: don't reuse a title across chapters; each chapter earns its own line.

Pre-render audit: any chapter with `focusLines` (or equivalent active-line targeting) but no synchronized heading swap fails the gate. Refuse to render chaptered code scenes without narration.

#### Make code fit the slide

- **Single-panel `CodeSnippet`** (full width): lines up to ~75 chars fit comfortably at 36px.
- **Side-by-side `BeforeAfter`** (half width each): lines must stay under **~45–50 chars** at 20px. Long imports and long JSX lines overflow at the original 28px — the scene CSS uses 20px with tighter padding (24/28) on `[data-panel="half"]` as the floor.
- **Break long imports** in side-by-side contexts across two lines — it reads naturally at 20px:
  ```ts
  import { webSearchTool } from "@tanstack/ai-anthropic/tools";
  ```
- The `BeforeAfter` panel ships with `min-width: 0` on the flex child and `overflow: hidden` on the code container as a safety net, but you should still keep lines short rather than relying on truncation.

#### Render errors as errors

TypeScript diagnostic comments (`// TS2322 ...`, `// ~~~~~~~~~~~~~`, `// TS2345 ...`) are the visual punchline of "wrong provider" / "broken code" scenes. Any dark theme renders comments in a muted color, which destroys the signal.

Mark error lines on a `BeforeAfter` panel via `data-error-lines="9,10"` (comma-separated 1-indexed line numbers). The scene's runtime script walks the highlighted HTML and applies `color: var(--brand-danger)` to those `[data-line]` elements, overriding shiki:

```html
<div class="before-after-panel" data-side="before" data-error-lines="9,10">...</div>
```

Rule of thumb: any line whose comment starts with `TS\d+`, contains squiggle indicators (`~~~~`), or explains why the preceding line is wrong should be an error line.

#### CTA slide rule

The end-screen CTA is the last frame viewers see. It must match the deck's visual language — no outlier treatment.

- Use `data-bg="primary-glow"` (same as most other scenes).
- **NO** full-bleed solid-color or gradient backgrounds — they break visual cohesion with every other scene in the deck.
- Headline in `var(--brand-text)` (white) with `<span class="hf-emph">…</span>` accents on the key words.
- Action verb in solid `var(--brand-primary)` at large weight (160px, 900) with a `text-shadow` glow derived from the primary — the primary is the star _against_ the dark bg, not fighting a colored background.
- URL pill: translucent white bg (`rgba(255,255,255,0.06)`) + thin primary-tinted border (`color-mix(...) 50%`) + subtle primary outer glow (`box-shadow: 0 0 40px color-mix(... 20%)`). All wired into `.cta-url` in the bundled scene.

#### Format synthesized code for video readability

Video code is displayed at 20-36px on a static frame — not in an IDE with horizontal scroll. Format for that medium, not for what `prettier` would emit.

Rules:

1. **Multi-line arrays when any element spans multiple lines.** If an array element is itself a multi-line call or object literal, put each element on its own line with the brackets on their own lines:

   ```ts
   // Bad — hard to parse at display size
   tools: [webSearchTool({ name: "web_search", type: "web_search_20250305" })];

   // Good — readable
   tools: [
     webSearchTool({
       name: "web_search",
       type: "web_search_20250305",
     }),
   ];
   ```

2. **Elide configs with `/*…*/`** when the config shape isn't the point of the scene. A video has ~2–4 seconds per chapter — don't spend those seconds on boilerplate:

   ```ts
   // Good — highlights the tool, not its config
   tools: [computerUseTool(/*…*/)];
   ```

3. **Break long imports across lines in side-by-side scenes.** At 20px font with ~50% of the slide width, imports longer than ~45 chars overflow. Pre-break them:

   ```ts
   import { computerUseTool } from "@tanstack/ai-anthropic/tools";
   ```

4. **No trailing semicolons in captions that reference line numbers.** Line numbers in `chapters[].focusLines` are 1-indexed over the raw template string — every newline matters for accurate line-number references.

#### Choose meaningful wrong/right comparisons

For `BeforeAfter` scenes that show a compile error → fix, pick a comparison that teaches something non-obvious:

- **Weak**: "wrong provider's tool with a different provider's adapter" — viewers already expect this to fail; it's not a surprise.
- **Strong**: "same tool, two different models of the same provider" — shows that the library's type system is _per-model_, not just _per-provider_. This is the insight most devs don't expect.
- **Strong**: "old API vs new API on the same feature" — shows the migration path and the diagnostic UX.

The compile error is the punchline; make sure the setup earns it. Look at the library's actual capabilities map (e.g., `<Provider>ChatModelToolCapabilitiesByName`) for real model/tool mismatches that exist in the current release — don't fabricate mismatches that wouldn't actually fire.

## Error Handling

| Failure                                                                               | Response                                                                                                                                                       |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gh` CLI not available                                                                | Tell user, offer alternative input (diff file / freeform description)                                                                                          |
| Invalid PR or ref                                                                     | Ask user to verify                                                                                                                                             |
| Node / package manager not available                                                  | Fail loud, tell user what to install                                                                                                                           |
| `hyperframes` / `hyperframes-cli` skill missing                                       | Per Phase 1.1: offer (a) proceed, (b) install, (c) cancel                                                                                                      |
| `npx hyperframes lint` fails after 2 self-correct attempts                            | Show errors, ask user to describe fix in freeform, retry                                                                                                       |
| `npx hyperframes inspect` reports overflow / off-canvas after 2 self-correct attempts | Same fall-through                                                                                                                                              |
| Render crashes                                                                        | Show hyperframes' error; offer (a) retry, (b) simplify failing scene, (c) abort                                                                                |
| Port 3010 in use                                                                      | Try 3011, 3012, 3013 in order; fail loud if all taken                                                                                                          |
| Preview process crashes mid-iteration                                                 | Restart once; if it crashes again, surface the error and ask user                                                                                              |
| Brand auto-detection finds nothing                                                    | Ask user explicitly with sensible defaults (see Phase 2.4 fallback block for the full primary/accent/background/text/font/logo list)                           |
| Shiki highlighting fails on a snippet                                                 | Show the snippet + error, ask user to fix the code or change the language hint                                                                                 |
| FFmpeg missing                                                                        | Fail loud — HyperFrames render needs it; link to install instructions                                                                                          |
| `npx hyperframes init` fails                                                          | Surface the CLI's error verbatim, suggest `npx hyperframes doctor` for diagnosis                                                                               |
| Font not loading at runtime (text shows in fallback sans-serif)                       | Verify the `<link>` to `https://fonts.googleapis.com/css2?family=...` is present in `index.html` and the family name URL-encodes any spaces (e.g. `Open+Sans`) |

## What This Skill Does NOT Do

- Write blog posts, social copy, changelogs, or scripts (separate skills exist)
- Upload the video anywhere
- Generate thumbnails beyond the first-frame poster
- Handle voiceover or audio (silent + captions only — see the `hyperframes` skill for TTS / captions if the user wants narration)
- Maintain a cross-project asset library (every video scoped to its own directory; `.marketing/brand.json` is the only shared state)
- Re-run on previously-rendered videos without user invocation
- Make editorial judgments about whether a PR is worth a video — if invoked, it runs
