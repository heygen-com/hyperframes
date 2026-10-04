# Working on Studio

Read this before your first change in `packages/studio`. It is the handful of
things that are not visible from the source, and that cost real time to
rediscover.

## The shape of the thing

Studio renders the user's composition in an **iframe**, and draws its own
chrome — selection box, handles, dashed outlines, toolbars — in **Studio's own
document**, positioned over the iframe. Nothing Studio draws lives inside the
composition, because a render would capture it and the composition's styling
would inherit into it.

Two consequences you will meet immediately:

- Reaching a preview element from a driver or a test means going through the
  iframe: `iframe.contentDocument.getElementById(...)`. Studio's own panels may
  be inside shadow roots, so a plain `document.querySelector` finds neither.
- Every overlay box is a _measurement_ of an element, not the element. When
  chrome disagrees with the pixels underneath it, the bug is almost always in
  the measurement, in `components/editor/domEditOverlayGeometry.ts`.

## Where a canvas edit goes

Paths are under `src/`; bare file names are in `src/components/editor/`. Each
line names the owner; read it there.

1. **Gesture.** `DomEditSelectionChrome.tsx` starts it, `domEditOverlayStartGesture.ts`
   arms it, `useDomEditOverlayGestures.ts` (`onPointerUp`) hands it off. Nudge,
   crop and inline text enter through `useDomEditNudge.ts`, `DomEditCropHandles.tsx`
   and `useInlineTextEditing.tsx`. `hooks/useDomEditSession.ts` wires the handlers.
2. **GSAP or plain.** The predicates `gsapWritesPosition`, `gsapWritesRotation`
   and `gsapWritesBox` live in `hooks/gsapRuntimeKeyframes.ts`. The router is
   `hooks/useGsapAwareEditing.ts`. Move and a plain rotation keep the route
   chosen at press. A GSAP rotation checks ownership again at commit, and resize
   decides at commit through `hooks/gsapResizeIntercept.ts`.
3. **Writers.** Plain edits go through `hooks/elementOffsetStager.ts`,
   `hooks/useDomGeometryCommits.ts` and `hooks/plainRotation.ts`, then
   `hooks/useDomEditPositionPatchCommit.ts`. GSAP edits: `hooks/gsapRuntimeBridge.ts`
   (the drag and rotate intercepts), `hooks/gsapDragCommit.ts`,
   `hooks/gsapDragPositionCommit.ts` (keyframe at the playhead) and
   `hooks/gsapWholePropertyOffsetCommit.ts`. Styles, text, attributes and groups:
   `hooks/domStyleCommit.ts`, `hooks/useDomEditTextCommits.ts`,
   `hooks/useDomEditAttributeCommits.ts`, `hooks/useGroupCommits.ts`.
4. **Save.** There are three paths. A single DOM edit goes through
   `hooks/useDomEditPersist.ts`. It first offers the edit to the SDK path
   (`utils/sdkCutover.ts`, wired in `useDomEditSession.ts`), which writes the
   file itself. Otherwise it posts studio-server's `file-mutations/patch-element`.
   Atomic DOM batches go through `hooks/useDomEditCommits.ts` to
   `patch-element-batches`. Script edits go through `hooks/useGsapScriptCommits.ts`,
   to `gsap-mutations` or to the SDK path. The routes are in
   `packages/studio-server/src/routes/files.ts`. The own-write token is in
   `utils/studioFileVersion.ts`, and `hooks/useExternalFileChangeCoordinator.ts`
   drops the echo.
5. **Reload.** Each save path decides its own reload. After a `patch-element`
   save, `useDomEditPersist.ts` reloads unless `skipRefresh` is set. For script
   edits, `useGsapScriptCommits.ts` (`applyPreviewSync`) picks one of three: an
   instant patch, `utils/gsapSoftReload.ts`, or a reload.
   A reload bumps `refreshKey`, and `refreshPlayer` in
   `player/hooks/useTimelinePlayer.ts` either swaps the scene or runs
   `player/hooks/useShadowPreviewReload.ts`, which waits while a gesture or a
   save is in flight.
6. **Undo.** `hooks/usePersistentEditHistory.ts` records the edit.
   `hooks/useEditHistoryActions.ts` steps through history.
   `utils/gsapUndoRestore.ts` repaints the preview.

## Driving Studio for verification

A pixel-precise click inside the preview is not something an automated driver
can reliably land, and some gestures cannot be synthesised at all: the canvas
overlay takes pointer capture and recognises a double press itself, so
`page.mouse` click pairs do not open a text edit no matter how they are timed.

Use the dev-only hook instead. In a dev build `window.__studioTest` exposes:

```js
await window.__studioTest.selectByDomId("headline"); // selects, reveals the inspector
```

That is the same selection a click produces. The general lesson: from a settled
selection, keyboard paths are dependable where pointer paths are not. Prefer a
key over a synthesised gesture whenever the feature offers one.

`useStudioTestHooks` also carries the timeline performance fixtures. The hook is
gated on `STUDIO_TEST_HOOKS_ENABLED` (dev or development mode only), so
`window.__studioTest` is absent in production builds — feature-detect it.

## Tracing decisions

The interesting failures here are decisions, not crashes: a preview that
reloads when it should not, a shift-click that selects the wrong element.
Nothing throws, so a trace of the decision is the only way to avoid guessing.

Channels are off by default. Turn one on and reload:

```js
localStorage.setItem("hf-drag-debug", "1"); // then grep the console for [hf-drag]
```

Live channels: `reload`, `select`, `drag`, `resize`, `commit`. Add one with
`makeStudioDebugLogger("<name>")` in `utils/studioDebug.ts`.

## Running the tests

Studio's tests are **vitest**, not `bun test`. Running bare `bun test` in this
package collects the files with the wrong runner and reports failures that are
not real:

```bash
bun run --cwd packages/studio test                       # all of them
bun run --cwd packages/studio test src/components/editor # one directory
```

happy-dom is not a browser. It does not reflect the individual transform
properties (`rotate`, `scale`, `translate`) into computed style, and it has no
`DOMMatrix` — the geometry tests carry their own stand-in. When a behaviour
depends on real layout or real computed style, prove it in a browser and keep
the unit test on the pure function underneath.

## The edit accuracy bench

`tests/e2e/edit-accuracy/` performs real gestures in the built CLI's Studio and
checks the saved file, the reloaded preview, undo and a producer frame. It
needs the built CLI (`packages/cli/dist/cli.js`, from `bun run build`) and
`chrome-headless-shell` (`npx hyperframes browser ensure`):

```bash
bun run --cwd packages/studio test:edit-accuracy -- --grid pr --filter '^resize-' --jobs 1
```

- Case ids come from `grid.mjs`; `--filter` is a regex on them. `--grid pr` is
  the smaller slice, `full` is what CI runs.
- Each run writes its results, a table and a candidate baseline to
  `tests/e2e/evidence/edit-accuracy/<run>/` (git-ignored; `--out` moves it); a
  failing case also gets its screens and saved files under `cases/<id>/`.
- CI runs the full grid in shards and `ratchet.mjs` gates the result against the
  base branch's `baseline.json`; its header states the rules. When cases newly
  pass, commit the `baseline.json` from the `edit-accuracy-gate` artifact.

## Gates that will fail your PR

- **600 lines per file.** CI checks only non-test files your PR changed. A file
  that grows past it has to be split in the same PR that grew it.
- **`bunx fallow audit --base origin/main --fail-on-issues`** — complexity per
  function, duplication, unused exports. Adding branches to an already-complex
  function trips it; extract rather than nest.
- **oxlint and oxfmt**, not eslint or prettier.
- **Before and After captures.** A PR that changes code under `packages/studio`
  or `packages/player` needs `## Before` and `## After` sections in its
  description, each with an image or video. The exemptions (a small change with
  no visible effect, Markdown, tests) are defined in `scripts/check-pr-captures.mjs`.

## Traps worth knowing

- **`rotate` is not `transform`.** Studio's rotate handle writes the CSS
  `rotate` property, which is an individual transform property and does not
  appear in `getComputedStyle(el).transform`. Anything measuring an angle has to
  read both and compose them the way CSS does, individual properties first.
- **A seek re-renders the whole timeline**, not the tween you patched. Patching
  several elements one at a time and seeking after each repaints the ones still
  queued from their un-patched tweens. Batch, then render once.
- **Studio's own writes must not reload the preview.** Writes carry a token so
  the file-watcher event can be recognised as ours; a new write path that
  forgets it makes the preview flash on every edit.
- **Preserving a selection set that does not contain the id empties it.** Check
  `preserveSet` semantics before reusing it.
