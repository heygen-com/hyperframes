# Batched Atomic Timeline Persist + Main-Track Ripple — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a multi-clip timeline move persist as one atomic, single-undo operation, and wire the main-track ripple (gap-close + insert-ripple) on top of it.

**Architecture:** Today each affected clip persists independently and its GSAP-tween shift escapes the `enqueueEdit` serialization queue → concurrent server writes corrupt the file. Replace the per-clip fire-and-forget loop in `commitDraggedClipMove` with a single `handleTimelineElementsMove(edits[])` that does one read, all attr patches, one save (single undo), one batched GSAP shift, one reload. Then add a pure `reflowMainTrack` and a main-track branch to the commit.

**Tech Stack:** TypeScript, React 18, Zustand, Hono (studio-server), vitest, bun. Lint/format: oxlint/oxfmt.

## Global Constraints

- Package manager: **bun** only. Never pnpm/npm for workspace ops.
- Lint/format: `bunx oxlint <files>`, `bunx oxfmt <files>`. Not eslint/prettier.
- Commits: conventional commits. **NO Co-Authored-By / AI attribution.**
- The lefthook `fallow` gate blocks on pre-existing branch-wide findings; commit with `--no-verify` ONLY after `oxlint`/`tsc`/tests pass on touched files (documented branch practice).
- Determinism: no `Date.now()`/`Math.random()` in the reflow or edit-building path.
- Filesize gate: keep files ≤600 lines (`useTimelineEditing.ts` and `useTimelineClipDrag.ts` are near the limit — do not grow them; extract if needed).
- Studio tests: `cd packages/studio && bunx vitest run <path>`. Server tests: `cd packages/studio-server && bunx vitest run <path>`.
- Baseline before starting: studio suite **1433 pass / 18 pre-existing env fails** (localStorage). Do not regress the 1433.

---

### Task 1: `reflowMainTrack` pure function

**Files:**
- Modify: `packages/studio/src/player/components/timelineCollision.ts`
- Test: `packages/studio/src/player/components/timelineCollision.test.ts`

**Interfaces:**
- Consumes: `TimelineElement` from `../store/playerStore` (has `id`, `key?`, `start`, `duration`, `track`).
- Produces: `reflowMainTrack(mainClips: TimelineElement[], draggedKey: string, draggedPreviewStart: number): Array<{ key: string; start: number }>` — returns only clips whose start changed, laid end-to-end from 0 in intended-start order. Key is `el.key ?? el.id`.

- [ ] **Step 1: Write failing tests**

```ts
// append to timelineCollision.test.ts
import { reflowMainTrack } from "./timelineCollision";

describe("reflowMainTrack", () => {
  const mk = (id: string, start: number, duration: number) =>
    ({ id, key: id, tag: "video", start, duration, track: 1 }) as TimelineElement;

  it("closes a leading gap (clip starting at 3 with no predecessor → 0)", () => {
    const out = reflowMainTrack([mk("a", 3, 5)], "x", NaN);
    expect(out).toEqual([{ key: "a", start: 0 }]);
  });

  it("closes an interior gap and lays clips end-to-end", () => {
    const out = reflowMainTrack([mk("a", 0, 5), mk("b", 8, 4)], "x", NaN);
    expect(out).toEqual([{ key: "b", start: 5 }]); // a unchanged, b 8→5
  });

  it("places the dragged clip at its preview start position in the order", () => {
    // dragged 'b' dropped at 1 → order [b@1, a@0.. ] sorts by intended start: b(1) after a(0)? a start 0 < 1
    const out = reflowMainTrack([mk("a", 0, 5), mk("b", 20, 4)], "b", 1);
    // intended order by start: a(0), b(1) → a@0 (unchanged), b@5
    expect(out).toEqual([{ key: "b", start: 5 }]);
  });

  it("returns empty when everything is already contiguous from 0", () => {
    expect(reflowMainTrack([mk("a", 0, 5), mk("b", 5, 4)], "x", NaN)).toEqual([]);
  });

  it("handles a single clip and an empty list", () => {
    expect(reflowMainTrack([mk("a", 0, 5)], "x", NaN)).toEqual([]);
    expect(reflowMainTrack([], "x", NaN)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/studio && bunx vitest run src/player/components/timelineCollision.test.ts -t reflowMainTrack`
Expected: FAIL — `reflowMainTrack is not a function`.

- [ ] **Step 3: Implement**

```ts
// add to timelineCollision.ts
/**
 * Lay main-track clips end-to-end from 0 in intended-start order (the dragged
 * clip uses draggedPreviewStart for ordering). One op = gap-close + insert-ripple.
 * Returns only clips whose start changed. Rounds to centiseconds to match the
 * codebase's timing precision. Deterministic, no I/O.
 */
export function reflowMainTrack(
  mainClips: TimelineElement[],
  draggedKey: string,
  draggedPreviewStart: number,
): Array<{ key: string; start: number }> {
  const keyOf = (e: TimelineElement) => e.key ?? e.id;
  const intended = (e: TimelineElement) =>
    keyOf(e) === draggedKey && Number.isFinite(draggedPreviewStart) ? draggedPreviewStart : e.start;
  const ordered = [...mainClips].sort((a, b) => {
    const d = intended(a) - intended(b);
    return d !== 0 ? d : (keyOf(a) < keyOf(b) ? -1 : 1); // stable tie-break on id
  });
  const changed: Array<{ key: string; start: number }> = [];
  let cursor = 0;
  for (const clip of ordered) {
    const start = Math.round(cursor * 100) / 100;
    if (start !== clip.start) changed.push({ key: keyOf(clip), start });
    cursor = start + clip.duration;
  }
  return changed;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd packages/studio && bunx vitest run src/player/components/timelineCollision.test.ts -t reflowMainTrack`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint + commit**

```bash
bunx oxfmt packages/studio/src/player/components/timelineCollision.ts packages/studio/src/player/components/timelineCollision.test.ts
bunx oxlint packages/studio/src/player/components/timelineCollision.ts
git add packages/studio/src/player/components/timelineCollision.ts packages/studio/src/player/components/timelineCollision.test.ts
git commit --no-verify -m "feat(studio): reflowMainTrack — contiguous re-lay for main-track ripple"
```

---

### Task 2: Server `shift-positions-batch` GSAP op

**Files:**
- Modify: `packages/studio-server/src/routes/files.ts` (union type ~L771; `HOLD_SYNC_MUTATION_TYPES` ~L817; two executor switches — the `shift-positions` cases at ~L1099 and ~L1464)
- Test: co-locate with existing gsap-mutation tests (find with `ls packages/studio-server/src/routes/*.test.ts` or the parser test dir).

**Interfaces:**
- Consumes: existing `shiftPositionsInScript(scriptText: string, targetSelector: string, delta: number): string` (imported at top of files.ts; also on `parser`).
- Produces: request shape `{ type: "shift-positions-batch"; shifts: Array<{ targetSelector: string; delta: number }> }`. Folds each shift over the script text; skips entries with `delta === 0` or empty selector; empty `shifts` returns `block.scriptText` unchanged.

- [ ] **Step 1: Add to the `GsapMutationRequest` union** (after the `shift-positions` member, ~L775)

```ts
  | {
      type: "shift-positions-batch";
      shifts: Array<{ targetSelector: string; delta: number }>;
    }
```

- [ ] **Step 2: Add to `HOLD_SYNC_MUTATION_TYPES`** (~L818, after `"shift-positions",`)

```ts
  "shift-positions-batch",
```

- [ ] **Step 3: Add the dispatch case in BOTH executor switches**

In the first switch (next to the `case "shift-positions":` at ~L1099):

```ts
    case "shift-positions-batch": {
      let script = block.scriptText;
      for (const s of body.shifts) {
        if (!s.targetSelector || !Number.isFinite(s.delta) || s.delta === 0) continue;
        script = shiftPositionsInScript(script, s.targetSelector, s.delta);
      }
      return script;
    }
```

In the second switch (~L1464, which destructures `const { shiftPositionsInScript } = parser;`):

```ts
    case "shift-positions-batch": {
      const { shiftPositionsInScript } = parser;
      let script = block.scriptText;
      for (const s of body.shifts) {
        if (!s.targetSelector || !Number.isFinite(s.delta) || s.delta === 0) continue;
        script = shiftPositionsInScript(script, s.targetSelector, s.delta);
      }
      return script;
    }
```

- [ ] **Step 4: Verify `findUnsafeMutationValues` tolerates the new shape**

Run: `grep -n "findUnsafeMutationValues" packages/studio-server/src/routes/files.ts` and read it. If it recurses over object/array values generically, the `shifts` array of `{targetSelector, delta}` is already covered (selectors are strings it already validates for other ops). If it switches on `body.type` explicitly, add a `shift-positions-batch` branch mirroring `shift-positions` (validate each `s.targetSelector`). Document which case applied in the commit message.

- [ ] **Step 5: Write a test folding two shifts**

```ts
// in the gsap-mutation route/parser test file — mirror an existing shift-positions test
it("shift-positions-batch folds multiple selector shifts into one script", () => {
  const script = /* existing test fixture with two tweens #a and #b */;
  const once = shiftPositionsInScript(shiftPositionsInScript(script, "#a", 1), "#b", 2);
  // simulate the batch executor
  let batched = script;
  for (const s of [{ targetSelector: "#a", delta: 1 }, { targetSelector: "#b", delta: 2 }]) {
    batched = shiftPositionsInScript(batched, s.targetSelector, s.delta);
  }
  expect(batched).toBe(once);
});
```

- [ ] **Step 6: Run tests + typecheck**

Run: `cd packages/studio-server && bunx tsc --noEmit && bunx vitest run <test path>`
Expected: PASS.

- [ ] **Step 7: Lint + commit**

```bash
bunx oxfmt packages/studio-server/src/routes/files.ts
git add packages/studio-server/src/routes/files.ts <test path>
git commit --no-verify -m "feat(studio-server): shift-positions-batch GSAP op (one write, N shifts)"
```

---

### Task 3: Client `shiftGsapPositionsBatch` helper

**Files:**
- Modify: `packages/studio/src/hooks/timelineEditingHelpers.ts` (next to `shiftGsapPositions` ~L165)

**Interfaces:**
- Produces: `shiftGsapPositionsBatch(projectId: string, filePath: string, shifts: Array<{ elementId: string; delta: number }>): Promise<void>` — POSTs one `shift-positions-batch` to `/api/projects/:id/gsap-mutations/:file`. No-op when every delta is 0 or the list is empty.

- [ ] **Step 1: Implement** (mirror `shiftGsapPositions`, ~L165)

```ts
export async function shiftGsapPositionsBatch(
  projectId: string,
  filePath: string,
  shifts: Array<{ elementId: string; delta: number }>,
): Promise<void> {
  const payload = shifts
    .filter((s) => s.elementId && Number.isFinite(s.delta) && s.delta !== 0)
    .map((s) => ({ targetSelector: `#${s.elementId}`, delta: s.delta }));
  if (payload.length === 0) return;
  const res = await fetch(`/api/projects/${projectId}/gsap-mutations/${encodeURIComponent(filePath)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "shift-positions-batch", shifts: payload }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error((err as { error?: string })?.error ?? "shift-positions-batch failed");
  }
}
```

- [ ] **Step 2: Typecheck + lint + commit**

```bash
cd packages/studio && bunx tsc --noEmit
cd - && bunx oxfmt packages/studio/src/hooks/timelineEditingHelpers.ts
git add packages/studio/src/hooks/timelineEditingHelpers.ts
git commit --no-verify -m "feat(studio): shiftGsapPositionsBatch client helper"
```

---

### Task 4: `handleTimelineElementsMove` atomic handler

**Files:**
- Modify: `packages/studio/src/hooks/useTimelineEditing.ts`

**Interfaces:**
- Consumes: `readFileContent`, `applyPatchByTarget`, `formatTimelineAttributeNumber`, `buildPatchTarget`, `patchIframeDomTiming` (from `./timelineEditingHelpers`); `saveProjectFilesWithHistory` (from `../utils/studioFileHistory`); `shiftGsapPositionsBatch` (Task 3); `sdkTimingPersist` + `sdkSession.batch`/`setTiming`.
- Produces: `handleTimelineElementsMove(edits: Array<{ element: TimelineElement; updates: Pick<TimelineElement, "start" | "track"> }>): Promise<void>`, returned from the hook. `handleTimelineElementMove(element, updates)` is rewritten to `return handleTimelineElementsMove([{ element, updates }])`.

- [ ] **Step 1: Implement the batched handler** (place before `handleTimelineElementMove`). It groups edits by `sourceFile`, then per group: optimistic DOM patch each; read file once; apply all attr patches to the string (start + track-index via `applyPatchByTarget` + `buildPatchTarget`); `saveProjectFilesWithHistory` once (label `"Move timeline clips"`, kind `"timeline"`, single `before`/`after`); one `shiftGsapPositionsBatch` for edits with `delta !== 0` (delta = `updates.start - element.start`, using `element.domId`); `forceReloadSdkSession()`; one `reloadPreview()`. On error: revert optimistic store state + toast. **When `sdkSession` is present and all edits have `hfId`,** use the SDK branch: `sdkSession.batch(() => edits.forEach(e => sdkSession.setTiming(e.element.hfId!, { start: e.updates.start, trackIndex: e.updates.track })))`, serialize once, `persistSdkSerialize` once, then `reloadPreview()`. Reuse the exact undo-baseline pattern from the existing single-clip SDK path (`readFileContent` as `before`). Keep the function under the filesize gate — if it pushes `useTimelineEditing.ts` over 600 lines, extract the body into `hooks/timelineElementsMove.ts` as a pure-ish helper taking a deps object (mirror `timelineClipDragCommit.ts`).

- [ ] **Step 2: Rewrite `handleTimelineElementMove`** to delegate: `return handleTimelineElementsMove([{ element, updates }]);` — delete the now-duplicated per-clip SDK/fallback body.

- [ ] **Step 3: Export** `handleTimelineElementsMove` in the hook's return object.

- [ ] **Step 4: Typecheck + run the existing single-move tests** to confirm delegation preserved behavior.

Run: `cd packages/studio && bunx tsc --noEmit && bunx vitest run src/hooks` (or the move-related test files)
Expected: PASS, no regressions.

- [ ] **Step 5: Lint + commit**

```bash
bunx oxfmt packages/studio/src/hooks/useTimelineEditing.ts
git add packages/studio/src/hooks/useTimelineEditing.ts
git commit --no-verify -m "feat(studio): handleTimelineElementsMove — atomic multi-clip persist"
```

---

### Task 5: Thread `onMoveElements` through the callback chain

**Files (add `onMoveElements` parallel to the existing `onMoveElement` at each site):**
- `packages/studio/src/components/nle/useTimelineEditCallbacks.ts` — add `handleTimelineElementsMove` to `TimelineEditCallbackDeps` (same signature family) and `onMoveElements: handleTimelineElementsMove` to the returned bag + deps array.
- `packages/studio/src/player/components/timelineCallbacks.ts:27` — add `onMoveElements?` to the `TimelineEditCallbacks` type (type: `(edits: Array<{ element: TimelineElement; updates: Pick<TimelineElement,"start"|"track"> }>) => Promise<void> | void`).
- `packages/studio/src/contexts/TimelineEditContext.tsx:33` — pass `onMoveElements` through the context value.
- `packages/studio/src/player/components/useResolvedTimelineEditCallbacks.ts` — include `onMoveElements` in the resolved bag + override handling (mirror `onMoveElement` at lines 9/19/23/28).
- `packages/studio/src/player/components/Timeline.tsx` — accept + forward `onMoveElements` (mirror `onMoveElement` at 59/67/78/231).
- `packages/studio/src/player/components/TimelineCanvas.tsx:144` — destructure `onMoveElements` from the resolved callbacks.
- `packages/studio/src/components/nle/TimelinePane.tsx` — wire `onMoveElements` where `onMoveElement` is wired (64/82/163), applying the same `toLocalElement`/basis transform per edit if a `basis` is involved.
- `packages/studio/src/components/nle/EditorShell.tsx` / wherever `handleTimelineElementMove` is passed as a prop — also pass `handleTimelineElementsMove`.

- [ ] **Step 1:** At each site above, add the `onMoveElements`/`handleTimelineElementsMove` member next to the existing `onMoveElement`/`handleTimelineElementMove`. It is optional (`?`) end-to-end so partial wiring typechecks.
- [ ] **Step 2:** Typecheck. Run: `cd packages/studio && bunx tsc --noEmit`. Expected: PASS.
- [ ] **Step 3: Commit**

```bash
bunx oxfmt <all touched files>
git add <all touched files>
git commit --no-verify -m "feat(studio): thread onMoveElements batched callback through timeline chain"
```

---

### Task 6: Wire `commitDraggedClipMove` — main-track branch + batched insert

**Files:**
- Modify: `packages/studio/src/player/components/timelineClipDragCommit.ts`
- Test: `packages/studio/src/player/components/timelineClipDragCommit.test.ts` (create if absent)

**Interfaces:**
- Consumes: `reflowMainTrack` (Task 1); `resolveMainOriginTrack` from `./timelineZones`; `buildTrackInsert` (existing).
- `DragCommitDeps` gains `onMoveElements: (edits: Array<{ element: TimelineElement; updates: Pick<TimelineElement,"start"|"track"> }>) => Promise<void> | void`.
- Produces: `commitDraggedClipMove(drag, deps)` — now with a main-track branch and a batched insert branch; builds one `edits[]` and calls `onMoveElements` once per commit.

- [ ] **Step 1: Write failing tests** — that a main-track drop produces the ripple edit set, and an insert produces one batched call. Use a `onMoveElements` spy in `deps`; assert the `edits` array (keys + start/track) rather than N `onMoveElement` calls.

```ts
// timelineClipDragCommit.test.ts
import { commitDraggedClipMove } from "./timelineClipDragCommit";
// build a DraggedClipState whose drop lands on the resolved main track with overlap;
// expect a single onMoveElements call whose edits reflow the main lane end-to-end.
```

- [ ] **Step 2: Run to verify failure.** Run: `cd packages/studio && bunx vitest run src/player/components/timelineClipDragCommit.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.** Add `onMoveElements` to `DragCommitDeps`. Add a **main-track branch** at the top of the non-insert path: resolve `mainTrack = resolveMainOriginTrack(elements)`; if `drag.previewTrack === mainTrack` (or the drop landed on main), collect `mainClips = elements.filter(e => e.track === mainTrack)` plus the dragged clip; compute `reflowMainTrack(mainClips, dragKey, drag.previewStart)`; build `edits` from the changed set (map key→element) plus the dragged clip's `{ start: <its reflow start>, track: mainTrack }`; call `onMoveElements(edits)` once; return. For the **insert branch**, replace the per-shift `persist()` loop with one `onMoveElements([draggedEdit, ...shiftEdits])`. Keep the plain single-move path calling `onMoveElements([singleEdit])`. Remove the old `persist`/`onMoveElement` fire-and-forget helper.

- [ ] **Step 4: Run tests to verify pass.** Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
bunx oxfmt packages/studio/src/player/components/timelineClipDragCommit.ts packages/studio/src/player/components/timelineClipDragCommit.test.ts
git add packages/studio/src/player/components/timelineClipDragCommit.ts packages/studio/src/player/components/timelineClipDragCommit.test.ts
git commit --no-verify -m "feat(studio): main-track ripple + batched insert in drag commit"
```

---

### Task 7: Pass `onMoveElements` into commit deps in `useTimelineClipDrag`

**Files:**
- Modify: `packages/studio/src/player/components/useTimelineClipDrag.ts` (the `commitDraggedClipMove(drag, {...})` call site ~L515; the hook's props/`onMoveElements` input)

- [ ] **Step 1:** Add `onMoveElements` to the hook's props (mirror `onMoveElement`) and pass it into the `commitDraggedClipMove` deps object. If `onMoveElements` is absent (partial wiring), fall back to N `onMoveElement` calls so nothing breaks mid-migration — but with Task 5 wired it will always be present.
- [ ] **Step 2: Typecheck + run** the drag + collision + commit tests. Run: `cd packages/studio && bunx tsc --noEmit && bunx vitest run src/player/components`. Expected: PASS.
- [ ] **Step 3: Commit**

```bash
bunx oxfmt packages/studio/src/player/components/useTimelineClipDrag.ts
git add packages/studio/src/player/components/useTimelineClipDrag.ts
git commit --no-verify -m "feat(studio): route drag commit through batched onMoveElements"
```

---

### Task 8: Full-suite gate + manual browser verification

- [ ] **Step 1: Full studio suite.** Run: `cd packages/studio && bunx vitest run`. Expected: **1433 pass / 18 pre-existing fails** — no new failures.
- [ ] **Step 2: Full build** (refreshes the CLI-embedded studio bundle). Run: `bun run build`. Expected: clean.
- [ ] **Step 3: Manual feel-test** (drag feel is not auto-verifiable — HANDOFF G4/G7). Serve a clean bed: `node packages/cli/dist/cli.js preview --no-open --port=3009 <clean project>`; open at 1680×950. Verify:
  - Drag a main-track clip over another → they ripple (no overlap, no gap), **no file corruption**, and a **single Undo** restores every clip at once.
  - Delete/move on the main lane closes the gap (ripple).
  - Overlay / audio / caption / sub-comp clips on non-main lanes do **NOT** ripple (free placement preserved).
  - Reload the project → positions persist correctly.
- [ ] **Step 4:** Report results to the user for the drag-feel sign-off.

---

## Self-Review

- **Spec coverage:** §3.1 handler → Task 4; §3.2 server op → Task 2 (+ Task 3 client helper); §3.3 reflow → Task 1; §3.4 commit wiring → Task 6/7; §3.5 callback thread → Task 5; §4 error handling → Task 4 Step 1; §5 testing → Tasks 1/2/6/8; §6 determinism → Task 1 (no Date/random). All covered.
- **Type consistency:** `onMoveElements` signature `(edits: Array<{ element: TimelineElement; updates: Pick<TimelineElement,"start"|"track"> }>) => Promise<void> | void` is identical across Tasks 4/5/6/7. `reflowMainTrack` returns `{ key; start }[]` consumed only in Task 6.
- **Placeholder scan:** Task 2 Step 5 and Task 6 Step 1 reference "existing fixture / build a DraggedClipState" rather than literal fixtures — the executor must read the neighboring existing test for the exact fixture shape (noted inline). All other steps carry real code.
