# Web Audio FX stack — session handoff

Written 2026-08-12. Worktree `~/src/wt/hyperframes/webaudio-fx`, branch
`wa-20d7-fx-telemetry` (the stack tip). Everything below is pushed; local and
origin are in sync across all 47 branches.

---

## 1. What this is

47 open PRs, one continuous chain from `main` to `wa-20d7-fx-telemetry`,
grouped as **GitHub stack #3237**. ~32k added lines, of which **15,374 are
production code** — the rest is tests (14,277, a 0.93:1 ratio) and docs.

The feature: audio effects for HyperFrames compositions. A registry of effects,
one Web Audio graph shared by preview and offline render, a studio rack panel,
19 presets / 5 named jobs / 5 one-knob profiles, voiceover carve, a levelling
script, automation lanes, and telemetry.

**Scope observation worth acting on:** automation lanes are 9,175 lines — 28% of
everything, `wa-9` through `wa-17`. That is a general timeline-envelope editor
that audio FX is merely the first consumer of. It reviews as a separate feature
and arguably should have been one.

---

## 2. Current state

|                                |                                        |
| ------------------------------ | -------------------------------------- |
| Open `wa-*` PRs                | 47                                     |
| Drafts                         | 0                                      |
| Approved                       | 1 (#3210)                              |
| Changes requested              | 1 (#3209 — **fixed, needs re-review**) |
| Awaiting a verdict             | 45                                     |
| Branches over the 600-line cap | 0                                      |
| Studio tests at the tip        | 3,748 pass                             |
| Chain                          | continuous, bases verified unchanged   |

Tip commits (newest first):

```
631f6d9e3 style: run oxfmt over the markdown this stack added
ec86035b3 docs(skills): correct the claim that a pause spectrum reveals a filter
2a1708c43 docs(skills): fix two things a retest showed the diagnosis guidance got wrong
dc0933279 docs(skills): teach the audio skill to diagnose a file nobody described
e0b36f46b feat(studio): instrument the audio FX rack, including work an agent did
eca192716 fix(core): stop the rack telling a music bed it will thin the voice out
1cc4781e0 feat(studio): title the carve, hide voice presets off voice tracks, fix panel contrast
```

---

## 3. Traps — read before running anything

**Rebuild core after any rebase or branch switch.** `packages/core/src/generated/`
is gitignored and derived from core sources. Stale, it fails **~157 studio tests**
with `Cannot read properties of undefined`. This looked exactly like a real
regression twice this session and was not.

```bash
cd packages/core && bun run build
```

**Mid-stack commits do not individually typecheck.** Several branches have real
`tsc` errors that only resolve further up. Verified byte-identical to the
original history — do not "fix" them. Check the branch tip, not each commit.

**`bun run format:check` covers markdown.** Running `oxfmt` on `.ts/.tsx` only
is how 51 Preflight failures happened. Format the whole repo before committing
docs.

**`gh stack link` tries to re-base the bottom PR onto `main`.** It attempted this
twice and GitHub's validation blocked it both times. Always snapshot every base
before and diff after:

```bash
gh pr list --state open --limit 400 --json number,baseRefName > /tmp/before.json
# ... operation ...
# diff number->baseRefName; expect zero changes
```

**`while read` drops a final line without a trailing newline.** Silently skipped
`#3019` when marking drafts ready. Verify counts after batch loops.

**Cascading a fix down-stack:** `git rebase --update-refs --onto <fixed-branch>
<old-sha> <tip>` rewrites all 47 refs in one pass. Git 2.50 supports it. Back up
first: `git for-each-ref --format='%(refname:short) %(objectname)' 'refs/heads/wa-*' > /tmp/backup.txt`.

---

## 4. Open work, highest value first

### 4.1 #3209 needs re-review (blocker was fixed)

`wa-18c-box-select` deleted #3207's edge-stretch feature — 248-line hook, its
test, `retimeRange`, and the lane wiring. All four reviewer claims verified true.
Restored and folded into the consolidated hook.

**One arbitration call needs your ruling.** #3207's rule: a selection's edge
outranks a point sitting on it (because every range op leaves a breakpoint on the
edge it created, so point-first broke the second stretch). #3209 changed the
selection to a **box**, where that contradicts its own test — which presses at
t=0/v=1, simultaneously the t0 edge and a selected point.

I inverted it: **selected content wins, the edge stretches everywhere it is not
also selected content.** Defensible under a box, but it is a product decision
between two deliberate designs. Confirm or reverse.

### 4.2 CI failures not yet investigated

`regression`, `preview-regression`, `player-perf` across many PRs. `main` is
green, so these are ours. Needs per-PR log analysis; may be flaky. Not touched.

### 4.3 Two files over the 600-line cap at the tip

`propertyPanelFxSection.tsx` (1017) and `propertyPanelAudioFxGroup.tsx` (1003).
Pre-existing, grown by the telemetry PR. **CI's path filter skipped the check on
#3229**, so nothing catches it. Real violation hiding behind a filter.

### 4.4 Three pre-existing test failures

`FxSection carve` "toFixed" on `wa-2-fx-preview`. Confirmed pre-existing by
stashing. Separate from anything done this session.

### 4.5 Review throughput

45 of 47 have no verdict. 13 were drafts until this session. The stack merges
bottom-up, so #3019 → #3020 → … is the order. Landing the bottom few unblocks
everything.

---

## 5. Telemetry and dashboard

**[PostHog dashboard 1986431](https://us.posthog.com/project/356858/dashboard/1986431)**
"Audio FX rack — usage", project **356858**. 12 HogQL tiles, every query verified
to execute. **Tiles stay empty until a build carrying `studio:audio_fx_*` ships** —
that is expected, not broken.

Two things to know:

- **`agent_runtime` is on EVERY `studio:*` event**, not just audio. The CLI
  detects the driving agent from its own env (12 vendors,
  `cli/src/telemetry/agent_runtime.ts`) and publishes it as
  `window.__HF_CLI_AGENT_RUNTIME`; studio reads it via
  `telemetry/agentRuntime.ts`. Encoded as the string `"none"`, never omitted —
  this project has already produced one wrong conclusion from comparing a
  populated sentinel against an absence.
- **Agent-applied effects are only visible via `audio_fx_chain_observed`.** An
  agent edits the composition HTML or runs `carve.mjs`, so no panel event fires.
  That event carries `authored_outside` (no panel edits behind the change).
  `carve.mjs` is deliberately NOT instrumented — its output is already
  identifiable by the `fromCarve` tag.

**You cannot verify telemetry locally.** `browserTelemetryAllowed()` is false
under Vite dev, and the CLI's `isDevMode()` is true whenever it runs from `.ts`
source. Both guards exist to stop developers polluting production. Do not defeat
them; first real data arrives from a released build.

Read the vault page `posthog-cli-telemetry-query-traps` before writing any HogQL —
it carries the `is_ci` denominator and clock-boundary traps.

---

## 6. The `/hyperframes-audio` skill

Extended this session with `references/presets.md` (the catalogue) and
`references/diagnosis.md` (how to diagnose a file you cannot hear).

**Evaluated, not assumed.** Blind runs on damaged audio, agent holding the skill,
no labels. **2 of 4 correct** — and three rounds of doc improvements did not move
that number, which is the finding.

The structural result:

> **Additive defects are solvable. Filter defects are not, from the file alone.**

Measured, gap spectrum vs the clean take: rumble (noise added) shows **+44.7 dB**
in the pause — unmissable. Boomy (+7 dB @ 200 Hz), sibilant (+10 dB @ 7 kHz) and
dull (−9 dB shelf) show **nothing**. A filter multiplies; applied to a take whose
gaps sit at the quantisation floor it leaves them there.

So the pause answers _"was something added?"_ and cannot answer _"was something
filtered?"_. The doc now says never to rule out EQ on a null pause result — one
run did exactly that and shipped a high-pass for an inaudible −72 dBFS rumble on
a file whose real problem was no top end.

**Implication:** the fix is a better _reference_, not better prose. An agent that
applies effects knows the before state; one handed someone else's finished audio
is in the genuinely under-determined case.

### Test bench

`packages/studio/data/projects/fx-test-bench` — one clean 7 s narration damaged
11 ways, one per shipped fix. Lint and browser gate pass. `GROUND-TRUTH.md` is
the answer key and is **marked keep-away-from-anything-being-evaluated**.
Untracked scratch; will not land in a PR.

---

## 7. Corrections made this session — do not re-derive

- **"44 unreviewed" was wrong.** A _commented_ review leaves `reviewDecision` as
  `REVIEW_REQUIRED`. 30 of those had been reviewed. Count reviews, not verdicts.
- **"47/47 have descriptions" was wrong.** I tested body _length_; the unfilled
  PR template passes it. 13 PRs — the whole lower half — carried the template.
  All 13 now have real bodies written from their own commits, and 6 had
  placeholder titles (`"wa 1 fx registry"`) which were rewritten.
- **PR #3058 is closed**, superseded by the #3207–#3215 split. `wa-18-lane-stretch`
  and `wa-20d-rack-design` are dead local branches backing zero PRs. Do not push
  them — `wa-20d-rack-design` would re-add ~2,153 lines of stripped handoff docs.
- **Case B's sibilance diagnosis was right for unverifiable reasons.** It claimed
  to measure the room-tone gaps; the gap shows nothing at 7 kHz. Right answer,
  reasoning I could not reproduce.

---

## 8. Conventions

- `bun`, not pnpm/npm. `oxlint` / `oxfmt`, not eslint/prettier/biome.
- Commits need `--no-verify` (pre-commit hooks are slow and sometimes fight
  mid-rebase state).
- Do not push or update PRs unless asked.
- Signed commits are required; `filter-branch` strips signatures and the push is
  rejected with GH013.
- Composition changes: `npx hyperframes lint` then `npx hyperframes check`.
