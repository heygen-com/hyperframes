# Task 5 Report: studio — "Make room for voiceover" panel UI

## Status: BLOCKED (implementation complete, tested, and staged; commit rejected by repo gates)

## What was implemented

In `packages/studio/src/components/editor/propertyPanelVstSection.tsx`:

- Extended the `vstChainFile` import with `appendCarveBands`, `projectRelativeAssetPath`, and the `CarveBand` type; added an import of `isAudioTimelineElement` from `../../utils/timelineInspector`.
- Added `amountToMaxCutDb(amount)` — maps the 0-100 slider to 2-6 dB `maxCutDb`. (Per an earlier controller decision noted in the task brief, `resolveWavPath` was intentionally NOT added — the `/vst/carve` route resolves project-relative paths server-side, so no client-side wav-path round trip is needed.)
- Added `fetchCarveBands(projectId, musicPath, voicePath, maxCutDb)` — a small module-scope helper that POSTs to `/api/vst/carve` and validates the response shape, returning `CarveBand[] | null`. This was extracted out of `handleCarve` specifically to keep that handler's own cyclomatic complexity down (see "Concerns" below) — it's my own contribution being simplified, not a change to pre-existing code.
- Added component state (declared before the `if (!vstHost) return` early-return guard, to respect the Rules of Hooks): `elements` (via `usePlayerStore((s) => s.elements)`), `carveOpen`, `carveAmount`, `carveVoId` (with a `useEffect` keeping the selection valid as tracks change), and the derived `voCandidates` (other audio tracks, excluding the current track, requiring a `src`) / `defaultVoId` (first `timelineRole === "voiceover"` candidate, else the first candidate).
- Added `handleCarve` (a plain async function, defined alongside the other handlers after the early-return, since it isn't itself a hook): resolves both tracks' `src` to project-relative sub-paths via `projectRelativeAssetPath`, calls `fetchCarveBands`, reads the existing chain via `readChainFile`, appends bands via `appendCarveBands`, writes via `writeChainFile`, stamps `domEditSaveTimestampRef`, calls `onSetAttribute("vst-chain", path)`, and bumps `usePlayerStore.getState().bumpVstChainRevision()`.
- Added the render block: a "Make room for voiceover" button (`data-vst-carve-open`) that reveals a VO-track `<select>` (`data-vst-carve-voice`), an amount `<input type="range">` (`data-vst-carve-amount`), and Apply (`data-vst-carve-apply`) / Cancel buttons. Only rendered when `voCandidates.length > 0`.

In `packages/studio/src/components/editor/propertyPanelVstSection.test.tsx`:

- Added a new `describe("VstSection — make room for voiceover", ...)` block with one test, adapted to this file's actual query style (`renderInto`/`act`/`host.querySelector`/`flushAsyncWork`/`makeAudioElement`/`makeVstHost`/`jsonResponse`/`requestUrl` — the file does NOT use `@testing-library/react`'s `render`/`screen`/`fireEvent`/`waitFor` as the brief's literal snippet assumed). The test seeds `usePlayerStore` with a music + voiceover track, opens the carve panel, asserts the VO `<select>` pre-selects the voiceover track, clicks Apply, and asserts a PUT whose body contains a `PeakFilter` plugin.

**Deviation from the brief's literal Rules-of-Hooks placement:** the brief's Step 3d showed the new `usePlayerStore`/`useState`/`useEffect` calls being added _after_ `handleRemovePlugin`, which in the current file is itself already after the `if (!vstHost) { return ...}` early-return. Adding hook calls there would violate the Rules of Hooks (a conditional hook-call path). I moved the hook declarations (state + the `voCandidates`/`defaultVoId` derivations + the "keep selection valid" `useEffect`) to just above the early return, alongside the file's other hooks, and kept only the plain `handleCarve` function (not a hook itself) after the return, next to the other handlers. Behavior is identical to the brief's intent; only hook-call ordering was corrected.

## TDD evidence

**RED** — reverted only the component file (via `git apply -R` of the diff) while keeping the new test, then ran:

```
cd packages/studio && bunx vitest run src/components/editor/propertyPanelVstSection.test.tsx
```

Result: 11 passed, 1 failed —

```
× VstSection — make room for voiceover > carves a voiceover pocket: calls /vst/carve and appends PeakFilter bands
  → expected null not to be null
  ❯ src/components/editor/propertyPanelVstSection.test.tsx:687:28
    expect(openButton).not.toBeNull();
```

(no `data-vst-carve-open` element existed yet — failed for the right reason)

**GREEN** — re-applied the component change, re-ran the same command:

```
✓ src/components/editor/propertyPanelVstSection.test.tsx (12 tests) 50ms
Test Files  1 passed (1)
     Tests  12 passed (12)
```

Also ran `bun run typecheck` (`tsc --noEmit`) in `packages/studio` — clean, no errors.

## Files changed

- `/Users/vanceingalls/src/wt/hyperframes/bug-fixes/packages/studio/src/components/editor/propertyPanelVstSection.tsx`
- `/Users/vanceingalls/src/wt/hyperframes/bug-fixes/packages/studio/src/components/editor/propertyPanelVstSection.test.tsx`

No other files were touched.

## Lint / format

```
bunx oxlint packages/studio/src/components/editor/propertyPanelVstSection.tsx packages/studio/src/components/editor/propertyPanelVstSection.test.tsx
→ Found 0 warnings and 0 errors.

bunx oxfmt packages/studio/src/components/editor/propertyPanelVstSection.tsx  (formatter applied, no test-file changes needed)
bunx oxfmt --check <both files>  (from repo root)
→ All matched files use the correct format.
```

## Commit attempt (pathspec-scoped, exact form used)

```
git add packages/studio/src/components/editor/propertyPanelVstSection.tsx packages/studio/src/components/editor/propertyPanelVstSection.test.tsx
git commit -m "feat(studio): Make room for voiceover — carve action in VST FX panel

Adds a \"Make room for voiceover\" button to the VST FX panel that opens a
VO-track dropdown (pre-selecting a data-timeline-role=\"voiceover\" track)
and an amount slider, then calls POST /vst/carve and appends the returned
PeakFilter bands to the music track's chain via appendCarveBands." -- packages/studio/src/components/editor/propertyPanelVstSection.tsx packages/studio/src/components/editor/propertyPanelVstSection.test.tsx
```

**Result: REJECTED by the pre-commit hook. No commit was created** (confirmed: `git log --oneline -3` still shows the pre-existing tip `6c5564a96`, not a new commit).

`git status --short` immediately after the rejected attempt (all 20 files, including my 2, sit as staged `M ` — i.e. staged content = working-tree content, nothing committed, nothing unstaged):

```
M  packages/core/src/runtime/init.ts
M  packages/engine/src/services/vstBounce.test.ts
M  packages/engine/src/services/vstBounce.ts
M  packages/player/src/hyperframes-player.test.ts
M  packages/player/src/hyperframes-player.ts
M  packages/player/src/parent-media.test.ts
M  packages/player/src/parent-media.ts
M  packages/studio/src/components/StudioRightPanel.test.tsx
M  packages/studio/src/components/editor/propertyPanelVstSection.test.tsx
M  packages/studio/src/components/editor/propertyPanelVstSection.tsx
M  packages/studio/src/components/nle/NLEContext.tsx
M  packages/studio/src/hooks/useVstHost.test.tsx
M  packages/studio/src/hooks/useVstHost.ts
M  packages/studio/src/player/hooks/useVstPreview.test.tsx
M  packages/studio/src/player/hooks/useVstPreview.ts
M  packages/studio/src/player/lib/timelineIframeHelpers.ts
M  packages/studio/src/player/lib/vstRingBuffer.test.ts
M  packages/studio/src/player/lib/vstRingBuffer.ts
M  packages/studio/src/player/lib/vstStreamWorklet.js
M  packages/studio/src/player/store/playerStore.ts
```

The other 18 files are untouched by me and remain exactly as staged before I started — nothing was swept in, and my pathspec-scoped commit form did what it was supposed to (it just never got to actually create the commit object, because the hook rejected it before that step).

## Self-review

- VO-track dropdown correctly excludes the current track (`el.id !== trackId`) and pre-selects a `timelineRole === "voiceover"` track when one exists, else falls back to the first eligible candidate, else `""`. Confirmed by the test asserting `voSelect.value === "vo"`.
- Amount slider maps 0→2dB, 100→6dB via `amountToMaxCutDb`.
- `handleCarve` calls `/api/vst/carve` with project-relative paths (via `projectRelativeAssetPath`), appends the returned bands via `appendCarveBands`, writes the chain file via `writeChainFile`, and bumps `vstChainRevision` via `usePlayerStore.getState().bumpVstChainRevision()` — verified in the passing test (PUT body contains a `PeakFilter` plugin).
- Commit form used is pathspec-scoped exactly as instructed (`git commit -m "..." -- <file> <file>`), confirmed the other 18 staged files were unaffected.
- Fixed a real Rules-of-Hooks bug I introduced when first transcribing the brief verbatim (hooks called after a conditional early return) — caught and corrected before running any tests.
- Extracted `fetchCarveBands` out of `handleCarve` specifically to reduce `handleCarve`'s own cyclomatic complexity (13→11) after the fallow audit flagged it — this is my own new code, so simplifying it was in-scope per the task's instructions. It did not fully clear the finding (still counted among fallow's "13 above threshold", unlabeled severity, same as before) because 11 cyclomatic branches for "guard on track resolution, guard on path resolution, guard on fetch success, guard on chain write success, optional timestamp stamp" is close to an irreducible minimum for this handler's actual behavior without changing what it does.

## Concerns — full gate output (both gates hit, neither resolvable within this task's scope)

### 1. `filesize` gate — caused by my own code, not fixable within the 2-file constraint

```
ERROR: packages/studio/src/components/editor/propertyPanelVstSection.tsx has 733 lines (max 600)
```

The file was 592 lines before this task (under the 600-line cap enforced by `lefthook.yml`'s `filesize` hook, scoped to `packages/studio/**/*.{ts,tsx}`, excluding tests). My addition (button + VO dropdown + amount slider + `handleCarve` + `fetchCarveBands` + `amountToMaxCutDb` + the carve state/effect) added ~140 lines net (721 before the complexity-driven refactor, 733 after — the `fetchCarveBands` extraction added lines rather than removing them, since oxfmt wrapped a long call onto multiple lines).

To fit under 600 I would need to cut roughly 130+ lines from my own ~140-line addition — i.e., essentially remove the feature, not "simplify" it. The one architecturally correct way to actually solve this (split the carve UI into its own component file) is explicitly out of scope per the task's "Code Organization" instruction: "Only these 2 files change... No other files." I did not create a third file. I also did not touch any of the pre-existing 592 lines to try to shrink them (per the instruction not to refactor unrelated pre-existing code). This gate is unresolvable by me without violating one of those two constraints.

### 2. `fallow audit --base origin/main --fail-on-issues` gate — mostly inherited from the other 18 staged files, not mine

Full complexity section from the final attempt:

```
Audit scope: 68 changed files vs origin/main (6c5564a96..HEAD)

── Duplication ────────────────────────────────────
✗ 1,262 lines (0.4%) duplicated across 22 files (0.52s)
  (46 clone groups — none of the ones I inspected involve code I added; the
  clone groups touching propertyPanelVstSection.test.tsx are all within the
  pre-existing "native-editor state persistence" describe block, lines
  188-237 and 439-610, well before my new describe block at the end of the
  file.)

── Complexity ─────────────────────────────────────
● High complexity functions (13)
  packages/studio/src/player/lib/timelineIframeHelpers.ts
    :286 <arrow> CRITICAL        53 cyclomatic  57 cognitive  111 lines  659.7 CRAP
  packages/cli/src/commands/lambda.ts
    :198 run CRITICAL            42 cyclomatic  48 cognitive  253 lines  423.0 CRAP
  packages/engine/src/services/audioMixer.ts
    :567 <arrow> CRITICAL        25 cyclomatic  37 cognitive  139 lines  160.0 CRAP
  packages/studio/src/player/lib/timelineIframeHelpers.ts
    :41 autoHealMissingCompositionIds   17 cyclomatic  23 cognitive  35 lines
  packages/engine/src/services/audioMixer.ts
    :389 mixAudioTracks HIGH     17 cyclomatic  13 cognitive  140 lines  79.4 CRAP
  packages/studio/src/player/hooks/useVstPreview.ts
    :457 <arrow> HIGH            13 cyclomatic  26 cognitive   81 lines  49.5 CRAP
  packages/engine/src/services/audioMixer.ts
    :255 extractAudioFromVideo   12 cyclomatic   8 cognitive   37 lines  43.1 CRAP
    :94 simplifyVolumeKeyframes  11 cyclomatic  17 cognitive   45 lines  37.1 CRAP
  packages/studio/src/components/editor/propertyPanelVstSection.tsx
    :518 handleCarve             11 cyclomatic   8 cognitive   30 lines  37.1 CRAP   ← mine
    :310 seed                    10 cyclomatic  11 cognitive   29 lines  31.6 CRAP   ← pre-existing (flagged before I touched the file, per task brief)
  packages/engine/src/services/audioMixer.ts
    :140 buildVolumeExpression   10 cyclomatic  11 cognitive   51 lines  31.6 CRAP
  packages/studio/src/player/hooks/useVstPreview.ts
    :250 loadVstTrack            10 cyclomatic   7 cognitive   59 lines  31.6 CRAP
    :425 <arrow>                 10 cyclomatic   7 cognitive  118 lines  31.6 CRAP

✗ 13 above threshold · 1646 analyzed (0.06s)
✗ complexity: 13 findings · duplication: 46 clone groups · 68 changed files (0.94s)
  audit gate excluded 20 inherited findings (run with --gate all to enforce)
```

Of these 13 complexity findings, only `handleCarve` (mine) is in a file this task touches. The other 12 (`timelineIframeHelpers.ts`, `lambda.ts`, `audioMixer.ts` x5, `useVstPreview.ts` x3, plus the pre-existing `seed` in this same file) are all in the other 18 already-staged files from the pre-existing "VST Studio Integration" work, or in files I never touched at all (`lambda.ts`). `fallow`'s `--base origin/main` scope covers the **entire branch diff** (68 changed files), not just the files in my commit — so this gate would fail on a bare-minimum, zero-line commit of my two files too, purely because of the other 18 files already sitting in the index. This matches the task brief's own framing of this as "a separate, already-escalated issue, not yours to solve." I made one honest attempt to reduce my own contribution's complexity (`handleCarve` 13→11 cyclomatic via the `fetchCarveBands` extraction) but did not touch any of the other 12 findings, all pre-existing and out of scope.

### Net result

Implementation is complete, correct, tested (12/12 passing, RED→GREEN verified), typechecked, linted, and formatted. It is staged in the git index exactly as it should be for a future commit once the two blocking gates (filesize architecture cap, whole-branch fallow audit) are resolved by whoever owns that already-escalated issue — at which point the pathspec-scoped commit command in this report should go through unchanged.
