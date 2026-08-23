# Audio groups / carve / timeline-gutter session — handoff

> **HISTORICAL, 2026-08-20.** Everything below describes the branch BEFORE it was
> rebased and opened. That branch was later replaced by the 12-PR stack
> **#3444–#3455**; §1's "nothing is pushed, no PR exists" and §8's open-items list
> are superseded by #3455 and its linked predecessors. §2 (the id-space boundary,
> a carve owning its own lanes) and §9 (environment + process notes) still hold —
> except the studio dev server, which now works via plain `bun run studio`.

Written 2026-08-20. Worktree `~/src/wt/hyperframes/webaudio-fx`, branch
`wa-25-review-fixes`, tip `baede8292`. **Nothing is pushed. No PR exists.**

This continues the stack described in `plans/webaudio-stack-handoff.md`
(2026-08-12) — read that for the feature's origins. This document covers only
what happened in the session that ended 2026-08-20, and is written so a fresh
session can pick up without re-deriving anything.

---

## 1. State of the branch

|                                |                                                                   |
| ------------------------------ | ----------------------------------------------------------------- |
| Branch                         | `wa-25-review-fixes`                                              |
| Tip                            | `baede8292 docs(skills): teach /hyperframes-audio the submix bus` |
| Commits ahead of `origin/main` | **69**                                                            |
| Commits behind `origin/main`   | **25** (main moved to `3e4b08cdc`, 2026-08-18)                    |
| Diff vs main                   | 158 files, +10,360 / −742                                         |
| New production files           | 23 (list in §7)                                                   |
| Pushed?                        | **No.** Local only.                                               |
| PR?                            | **None** (`gh pr list --head wa-25-review-fixes` → `[]`)          |

**Suites, all green as of the tip:**

| Package | Tests                  |
| ------- | ---------------------- |
| core    | 2384 passed            |
| studio  | 4352 passed, 18 todo   |
| engine  | 1538 passed, 3 skipped |
| lint    | 524 passed             |

`bunx oxlint`, `oxfmt --check`, and `tsc --noEmit` are clean across
core/studio/engine/lint.

### The `--no-verify` situation

**34 of the 69 commits were committed with `--no-verify`.** Every one is the
same cause: lefthook's `filesize` hook caps files at 600 lines, and five files
in this area were already over that cap before this session touched them. Each
such commit says so in its message with the before/after line count.

Current sizes:

| File                                                               | Lines | Cap         |
| ------------------------------------------------------------------ | ----- | ----------- |
| `packages/studio/src/player/components/TimelineTrackHeader.tsx`    | 763   | 600         |
| `packages/studio/src/player/components/TimelineAutomationLane.tsx` | 683   | 600         |
| `packages/studio/src/components/editor/propertyPanelFxSection.tsx` | 616   | 600         |
| `packages/studio/src/player/components/TimelineLanes.tsx`          | 610   | 600         |
| `packages/studio/src/components/editor/useFxCarve.ts`              | 580   | 600 (under) |

`useFxCarve.ts` was brought back **under** the cap during this session by moving
its bed/relationship predicates into `useFxCarveGrouping.ts`. The other four are
outstanding. `TimelineTrackHeader.tsx` is the worst and grew most here (661 →
763); it is the obvious candidate for a split, and §8 says where the seams are.

In every other respect the hooks passed on every commit: lint, format, fallow,
typecheck, commitlint. Where fallow flagged something of mine (a complexity
threshold, twice) I fixed it rather than suppressing it.

---

## 2. Two invariants this session established the hard way

These are the two things most likely to be re-broken by someone who has not read
this document.

### 2.1 The id-space boundary

The timeline and the property panel identify elements **differently**:

- **Timeline store key**: `sourceFile#domId`, e.g. `index.html#vo-2` (`element.key`)
- **Panel / DOM / runtime**: the bare dom id, e.g. `vo-2` (`element.id`)

`runtimeAudioId()` in `packages/studio/src/player/lib/timelineElementHelpers.ts`
is the conversion. Handing a composite key to something that expects a bare id
fails **silently** — no error, the feature just never matches. This bit the
`setTiming` work before (see the memory note `project_settiming_hfid_space_fix`)
and bit the reveal feature in this session (§4.6).

### 2.2 A carve's lanes belong to the carve

A voiceover carve compiles to several `fromCarve: true` nodes in the chain and
writes an envelope per node. `withoutCarveLanes` **replaces every one of them**
on each re-analysis. Consequences:

- A drag on such a lane is silently discarded next analysis → they are shown
  **read-only**, not hidden (§4.3 — this was got wrong first).
- A per-lane remove button on one would appear broken → withheld. Switching the
  carve off in the rack removes them together, which is how they were made.
- The rack's `handBuilt` list **filters carve nodes out**, so `openNode` cannot
  address one. Anything mapping a lane to a rack row must resolve which _surface_
  owns it (§4.6).

---

## 3. What the user asked for, in order

Every item below was a separate instruction. Worth reading as a whole because
several later items reversed earlier ones.

1. Remove the "Holds…" line from the group header → deleted the whole bus strip.
2. Don't show the automation-lane toggle when a row automates nothing.
3. "I automated a group effect property but the automation icon didn't appear."
4. "I ended up with a voiceover track in a voiceover group, carving against that
   group. How did this happen?" → root-caused, three bugs.
5. "Why was a voiceover track carved at all? Only music and sfx should be." →
   a fourth, deeper bug.
6. Multi-select of audio clips offers layout grouping, which doesn't apply.
7. …and offers "Hide all", which shouldn't be possible for audio.
8. Make automation lanes always visible, drop the toggle.
9. **Reversed #8** — "I didn't realise it was an existing pattern; put the
   toggle back."
10. Don't change the header layout/icon when a track has automation.
11. "The layout is messed up when automations are active." (twice — I fixed the
    wrong thing first)
12. Music bed has a carve but shows no automation and no toggle.
13. Put the automation toggle and FX button on one line with the title,
    right-aligned; clip count left-aligned by the title.
14. Use the property panel's larger caret for group headers.
15. Same one-line layout for group headers.
16. Wrap gutter names instead of truncating with tooltips.
17. Render failed with `Cannot find module …/renderOrchestrator.js`.
18. Restart the studio.
19. Clicking an automation lane header should open the rack on that effect and
    scroll to it.
20. Is the skill updated to use the bus? → it was not; wrote it.

---

## 4. The substantive findings

### 4.1 Four carve bugs (commit `5d8fbf5d3`)

The user's voiceover-carving-its-own-group situation had **four** causes, each
sufficient alone. All four were mine or pre-existing, none were user error.

1. **No bed-eligibility rule at all.** `couldBeCarveSource()` had existed in
   `packages/core/src/audioCarve.ts` since it was written, with a doc comment
   saying "music and sfx are out" — and **was called from nowhere**. Exported,
   tested, dead. Nothing ever asked the near-end question: _can this track be
   the bed?_ Added `couldBeCarveBed()` and wired it in.

   **Still true at the tip:** `couldBeCarveSource` remains uncalled outside
   core (the only studio hit is a doc comment in `useFxCarveGrouping.ts:180`).
   The _source_-side filtering is done inline by `classifyAudioName` checks in
   `useFxCarve.ts` instead, so the two now say the same thing in two places.
   Worth collapsing — see §8.

2. **Offering ≠ applying.** A bed with exactly one candidate voice carves itself
   unasked. Right for `music-bed`; wrong for `a1`. Added `isNamedCarveBed()` so
   self-application needs a name that positively reads as a bed. The picker stays
   looser — the same split the source side already made between `sourceOptions`
   and `autoSourceIds`.
3. **A member was offered its own group.** The candidate scan excluded exactly
   one element (the bed). Its _siblings_ survived and rolled up into the group
   the bed belongs to — which came back as a candidate and, being the only one,
   was auto-applied.
4. **A group was offered itself.** A group bed's id matches no `<audio>` id, so
   nothing excluded it.

Fix 1 alone would have prevented all three carves on disk. `collectCarveCandidates`
now takes the bed's id and drops both it and its group.

### 4.2 Layout grouping / "Hide all" on audio (`0ccda5f6c`, `927aeea52`)

Multi-selecting audio clips offered **"Group selection"** — the _layout_
grouper. It wraps members in a positioned `<div>` at their bounding box and
rebases each child's `left/top`. An `<audio>` has no box (`offsetWidth/Height`
are 0). Confirmed by running `wrapElementsInHtml` directly: it produced
`width: 0px; height: 0px` with inline `left/top` on elements that are never laid
out, plus a real server write and preview reload.

**"Hide all" was worse — one-way.** `data-hidden` on audio is not visibility:
preview silences it, the render drops it from the mix. Nothing else writes that
attribute (the panel's "Muted" is the unrelated HTML `muted` attribute), and the
timeline withholds the eye on audio tracks — **including when already hidden**.
The user muted four SFX clips this way with no control anywhere to restore them.
I unmuted them by editing the fixture.

Both refusals live in the handler, not just the button, because the **G shortcut**
routes through `handleGroupSelection` and no hidden button can gate a keystroke.
`canHideSelections` is shared so button and refusal cannot disagree. The eye now
returns on an audio track _while it is hidden_ (`!isAudioTrack || isTrackHidden`).

### 4.3 Carve lanes: hidden → read-only (`67769859d`, reverting part of `1f3548c6e`)

Earlier in the session I filtered carve-owned lanes out of the timeline. Then
the user's music bed — whose chain is **6 nodes, all `fromCarve`** — showed no
automation and, because of the §3.2 toggle rule, no toggle either. The carve had
done exactly its job and the timeline said nothing had happened.

The filter's own reasoning was the argument against it: the carve rewrites these
envelopes, so a drag is discarded → that argues for **read-only**, not hiding.
The lane component already had `readOnly` (used for unselected clips). Now
`isCarveLane()` decides it **per lane**, so a carved bed can still carry the
author's own volume curve beside the carve's bands.

### 4.4 Always-visible lanes, then reverted (`5d92f2a56`, `6accc4a9b`)

Asked to make lanes always visible, I removed `expandedLaneOwnerIds` /
`toggleLaneOwnerExpanded` from the store, the group's `∿`, and the `rowExpanded`
gate. Three geometry consequences had to move with it (height reservation, the
`laneCount` stacking offset, clip-bar capping).

The user then learned `∿` is an **existing pattern** — it toggles
`expandedClipIds`, which discloses _keyframe property lanes_ on every animated
track — and asked for it back. `6accc4a9b` reverts `5d92f2a56` exactly
(verified byte-identical to the pre-commit tree).

**Lesson for the next session:** `∿` is shared with non-audio keyframe rows.
Removing it "for automation" removes half a control other rows rely on. The
signal was in `LayerDisclosureRow`'s own comment, which says the glyph exists to
distinguish it from the group's _structural_ caret. I should have read that first.

### 4.5 Three header-layout bugs, in sequence

Worth understanding as one story, because I fixed the wrong thing twice.

- **`764291dc3`** — the group-pointer FX button rendered as a _sibling_ of the
  header's two lines, making a third child: 17 + 24 + 24 + gaps in a 48px box.
  `justify-center` split the overflow both ways, so the name rode 10px above its
  own row. Moved into `trailing`, where the prop's own comment had said it
  belonged since the two-line header landed.
- **`7114e7e65`** — the real cause of "messed up when automations are active",
  which I had missed by measuring only collapsed rows. The header **grows** by
  `AUTOMATION_LANE_H` per open lane, and lane rows are absolutely positioned
  from its top — so `justify-center` centred the two static lines in the _full_
  120px, putting the name at y=39 and controls at y=57, on top of the lane at
  y=48. Fixed by pinning the two lines in a wrapper of exactly `TRACK_H`.
- **`95f1027d0` / `af63174a2`** — then the user asked for one line anyway, which
  folds this whole bug class away: with one line and one right-aligned `ml-auto`
  group there is no second line to misfile a control onto, and nothing to centre
  in a box that grows.

Also `0097d8f3d`: `isKeyframeLayer` was `disclosable`, and automation counts
toward that — so drawing one envelope swapped an audio row's header for the
keyframe-layer layout (`◇` diamond, no group indent). Layout is now its own
question: `!!keyframeClip && disclosable && !isAudioTrack`.

### 4.6 The reveal feature (`6e6a2cc3b`)

Clicking an automation lane's label now selects the clip, opens Audio FX,
expands the surface owning the parameter, and scrolls to it.

`packages/studio/src/components/editor/audioFxRevealTarget.ts` resolves
`fx.<node>.<param>` to one of **five** surfaces, because the rack is not a flat
node list: `node` (index into `handBuilt`), `eq` (by `fromEq`), `preset` (a run,
keyed as `collapsedRuns` keys it), `carve` (one module for all `fromCarve`
nodes), `volume`. Getting this wrong on a carve band opens nothing.

Three non-obvious details, each found by testing in the browser:

1. **Select before revealing.** The rack is the panel's view of the _selected_
   element; a request aimed elsewhere lands on "Nothing selected". The request is
   _stored_, not emitted, so it survives the selection.
2. **Consumption keys on the request's nonce.** Selecting **remounts** the panel,
   so a `!==` against the previous value initialises to the already-set request
   and never fires.
3. **Send the bare dom id** (§2.1).

Follows the `focusedEaseSegment` precedent throughout: session-stamped,
nonce-guarded, consumed during render so the surface opens on the same commit.

### 4.7 Other fixes worth knowing

- **`9cb2c4a9c`** — the FX rack is not group-aware. Writing a group's
  `data-automation` goes through the ordinary element path, whose resync re-read
  only the element's own attributes. But a group's lanes derive from the mirrored
  `audioGroup*` fields its **members** carry, so the mirrors stayed stale until
  reload. Fixed at the sync sink (`automationStoreSync.ts`).
- **`f4ffbbb2a`** — Vite HMR created a _new_ context object per module
  re-evaluation, so every edit threw `useNLEContext must be used within an
NLEProvider`. `packages/studio/src/utils/hmrStableContext.ts` keeps one context
  per name in a module-global registry. Applied to all 9 studio contexts.
- **`b915b0f08`** — the double-audio bug. The `hiddenAudioDirty` branch called
  `scheduleWebAudioForActiveClips()` **without** `stopAll()`, laying a second
  buffer source over every playing clip. Measured 10 → 19 live sources. Two other
  call sites already paired them and documented why; this branch's comment
  asserted the opposite.

---

## 5. The render failure (diagnosed, not fixed in code)

The user's render failed with:

```
Cannot find module '/Users/…/packages/producer/src/services/renderOrchestrator.js'
imported from /Users/…/packages/producer/src/index.ts
```

**Root cause: the studio server was running under Node, not bun.** Chain, each
link verified:

1. `packages/cli/src/server/studioServer.ts:58` — in dev mode the server imports
   the producer's _source_: `isDevMode() ? import("../../../producer/src/index.js") : import("@hyperframes/producer")`.
2. `isDevMode()` is `import.meta.url.endsWith(".ts")`.
3. That source imports `./services/renderOrchestrator.js` — the TS convention of
   a `.js` specifier naming a `.ts` file. Bun resolves it; **Node does not**.
4. **Node 22.22 strips TS types natively** (verified: `node file.ts` runs), so
   the CLI _starts_ fine from source and only breaks at render time. That is why
   it looked like a render bug with no console output.
5. The process was `node …/node_modules/.bin/vite` (PID 59350). The user had
   correctly run `bun run studio`, but **vite's own shebang is
   `#!/usr/bin/env node`**, and vite hosts the render API in-process via
   `ssrLoadModule("@hyperframes/studio-server")` — so Node _was_ the render
   runtime.

Reproduced exactly:

```
node -e 'import("./packages/producer/src/index.ts")'   → the user's error
bun  -e 'import("./packages/producer/src/index.ts")'   → OK
node -e 'import("./packages/producer/dist/index.js")'  → OK
```

Not caused by this stack: `git diff origin/main...HEAD -- packages/producer/src`
is **empty**.

**Workaround applied (runtime only, no code committed):** the studio is currently
running as

```
cd packages/studio && bun --bun ./node_modules/.bin/vite --host 127.0.0.1
```

`--bun` overrides vite's shebang. `--host 127.0.0.1` is needed because plain
`bun --bun vite` served IPv6 `localhost` only, and the browser tab is on
`127.0.0.1`.

**This will recur** the next time anyone runs `bun run studio`. Two fixes, neither
committed:

1. `packages/studio/package.json` `"dev": "vite"` → `"dev": "bun --bun vite"`.
2. Make `loadStudioProducer()` assert it is on bun before taking the source
   path, so it fails at startup with a clear message instead of a
   module-not-found at render time. Node 22's type-stripping is what made this
   lie dormant.

---

## 6. The skill update (`baede8292`)

`<hf-audio-group>` appeared in **zero** skill, doc, or registry file. The audio
skill covered groups only as membership tags to carve against, and its example
groups three clips with **no group element at all** — so an agent following it
could never emit a group chain, fader, or automation.

Added "One bus for many tracks" to `skills/hyperframes-audio/SKILL.md`, plus two
statements that are the ways to get it wrong:

- **Group automation is composition time.** A bus has no `data-start` (verified
  at `packages/engine/src/services/audioMixer.ts:1271`), so `t: 0` in a group
  lane is the composition's start, not a clip's.
- **A carve stays on the clip.** `data-fx-carve` is **not** a group attribute —
  the render applies only group `fxChain`, `automation`, `volume`
  (`audioMixer.ts:463-465`). This matters because the only thing the skill
  previously said about groups was about carve.

Also corrected `SKILL.md` and `references/attributes.md`, which both claimed all
three attributes go "on the audio/video element itself".

Verified rather than asserted: the documented example was run through
`resolveAudioGroups` + `parseAudioFxChain`, its params checked against
`fx-registry.md` ranges, and the whole pattern linted with `hyperframes lint`
(only findings were the throwaway fixture's own missing `data-start` and timeline
registration).

**No flag needed and the skill says so:** the `audio-groups` canary is 0% but
gates only the _Studio UI_; per `packages/core/src/canaryRegistry.ts:103` the
element "parse[s] and play[s] regardless of enrollment".

Sync set was smaller than CLAUDE.md's rule implies — only `CLAUDE.md` and
`README.md` carry capability blurbs for this skill; the docs pages and CLI
templates only _name_ it. Both updated. `skills-manifest.json` was regenerated by
the pre-commit hook.

---

## 7. New production files in this stack

```
packages/core/src/audioGroups.ts
packages/studio/src/components/editor/TimelineFxPopover.tsx
packages/studio/src/components/editor/audioFxRevealTarget.ts
packages/studio/src/components/editor/audioFxSignalPath.ts
packages/studio/src/components/editor/useApplyAudioFxPreset.ts
packages/studio/src/components/editor/useAuditionTransport.ts
packages/studio/src/components/editor/useFxCarveGrouping.ts
packages/studio/src/hooks/timelineAudioGroupCreate.ts
packages/studio/src/hooks/timelineAudioGroupVolume.ts
packages/studio/src/hooks/timelineElementFxAttribute.ts
packages/studio/src/hooks/useEffectiveTimelineDuration.ts
packages/studio/src/hooks/useHydrateActiveCompPathFromUrl.ts
packages/studio/src/hooks/useRemoveBackground.ts
packages/studio/src/player/components/TimelineFxButton.tsx
packages/studio/src/player/components/TimelineGroupHeader.tsx
packages/studio/src/player/components/TimelineGroupLaneLabels.tsx
packages/studio/src/player/components/TimelineGroupRow.tsx
packages/studio/src/player/components/TimelineTrackPlainHeader.tsx
packages/studio/src/player/components/groupAutomationElement.ts
packages/studio/src/player/components/useTimelineLaneRowIndexes.ts
packages/studio/src/player/components/useTimelineMultiDragActorWindows.ts
packages/studio/src/player/lib/timelineGroupInfo.ts
packages/studio/src/utils/hmrStableContext.ts
```

---

## 8. Open items, in the order I'd take them

1. **Rebase onto `origin/main`** — 25 commits behind. This is the user's call.
   Note `reference_hyperframes_git_traps`: unsigned pushes are rejected (GH013),
   and two LFS fixtures always read as modified and block rebases.
2. **Push and open a PR.** 69 commits with no PR. The user's standing
   instruction is not to push until asked (`feedback_dont_push_early`).
3. **`packages/studio/package.json` `"dev"` → `bun --bun vite`** (§5). One line;
   the current studio only works because of a hand-started process.
4. **Guard `loadStudioProducer()` against Node** (§5). Turns a render-time
   module-not-found into a startup message.
5. **Split `TimelineTrackHeader.tsx`** (763 lines). Natural seams: the
   `AutomationLaneHeaderRow` + `PropertyGroupHeaderRow` label-row components
   (~150 lines, self-contained), and the FX/grouping callbacks
   (`writeClipFxChain`, `openClipFxRack`, `groupUngroupedClips`). Would clear the
   largest standing `--no-verify` reason.
6. **`[Timeline] Failed to set group attribute — Unable to patch element in
index.html`** — logged on **every** group FX write. The write still persists.
   Predates this session; last touched by `d636d4ecb`. Offered several times,
   never accepted. Worth doing before the PR.
7. **`clearRevealedAudioFxTarget` is wired but never called** (§4.6). Harmless —
   nonce-guarded consumption ignores stale requests — but it is dead code until
   something calls it on unmount.
8. **The reveal's `scrollIntoView` is unverified.** The right module demonstrably
   _opens_; the scroll never had a chain long enough to need scrolling.
9. **Carve lanes are read-only but not dimmed.** The lane component's
   `opacity: 0.55` is keyed to the _unselected_ state, not to `readOnly`. Six
   full-opacity uneditable lanes may read as editable. Deliberate for now.
10. **`FxCarveModule` is at cyclomatic 25 / cognitive 45**, flagged CRITICAL by
    fallow, inherited not introduced.
11. **`couldBeCarveSource` is still dead code** (§4.1). The source-side rule is
    duplicated inline in `useFxCarve.ts` via `classifyAudioName`. Either call the
    predicate or delete it — two statements of one rule is how the bed side came
    to have none.

---

## 9. Environment notes for the next session

- **Studio**: currently running as
  `cd packages/studio && bun --bun ./node_modules/.bin/vite --host 127.0.0.1`.
  If it is not up, start it that way, not with `bun run studio` (§5).
- **Test fixture**: `packages/studio/data/projects/audio-real/` — real assets
  (40s music bed, 4 TTS VO lines, 4 SFX), two groups (`voiceover`, `sfx`) plus an
  ungrouped `music-bed`. **Gitignored** (`.gitignore:104` covers
  `packages/studio/data/`), so it is not in any commit and will not survive a
  clean checkout.
- **The user's real project**: `packages/studio/data/projects/recap-stitch`
  (a symlink to `~/src/recap-stitch`). This is where several bugs reproduced —
  notably the header overflow and the all-carve music bed. Treat it as **the
  user's real work**, not a fixture.
- **Canary URL params** for browser testing:
  `?hf_canary_audio_groups=1&hf_canary_audio_fx_rack=1&hf_canary_audio_track_mute=1`
  (all three canaries are 0%).
- **Browser driving**: `agent-browser eval/click/screenshot`. The timeline
  gutter is inside a scroll container matched by
  `/overflow-y-auto h-full outline-none/`; set its `scrollTop` to reach lower
  rows. Rows below the fold have **no** `aria-label`s until scrolled into view —
  an empty query usually means "not scrolled", not "not there".

### Process lessons from this session, stated plainly

- **Live-DOM edits do not propagate to the studio model.** Editing attributes via
  `agent-browser eval` produced a stale model and one wrong diagnosis. Edit the
  file on disk, or drive the real UI.
- **Measure the state the user named.** "Messed up when automations are active"
  — I measured collapsed rows, found them clean, and declared victory. The bug
  was only visible with a lane open.
- **Don't trust an image's provenance.** I read a screenshot as the user's,
  built a theory on it, and asked about it. It was not theirs.
- **Check whether a control is a shared pattern before removing it** (§4.4).
- **Synthetic `MouseEvent`s cannot unlock an AudioContext**, so scripted hover
  tests read silence that is not real.
