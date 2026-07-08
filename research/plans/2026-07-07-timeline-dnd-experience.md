# Timeline Drop Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make getting media onto the HyperFrames Studio timeline feel like CapCut — snapping magnet, live drop ghost, draggable blocks, playhead-targeted insertion, and production-quality inserted markup.

**Architecture:** All external drags (OS files, asset cards, block cards) stay on HTML5 DnD at the boundary; everything visual (ghost, snap guide, row highlight) is computed by new pure modules (`timelineSnapping.ts`, `resolveTimelineDropPreview`) and rendered by the existing DOM timeline. Internal clip move/trim (already pointer-based) is upgraded to the same unified snap targets. Inserts keep the existing write path (string patch → `PUT /files` → reload) but produce better markup.

**Tech Stack:** React 18 + Zustand (`usePlayerStore`), Vitest, oxlint/oxfmt, bun. No new dependencies.

## Global Constraints

- Package manager is **bun** (`bun install`, never pnpm/npm for workspace ops).
- Lint/format with **oxlint/oxfmt**: `bunx oxlint <files>` and `bunx oxfmt <files>` before every commit (lefthook enforces; run `bun install` first or hooks fail with `tsup: command not found`).
- Conventional commits (`feat:`, `fix:`, `test:`, `refactor:`). **Never add Co-Authored-By / AI attribution** (user rule).
- TypeScript: no `any`, no `as T` assertions; prefer type guards/narrowing.
- Tests run with Vitest from the studio package: `cd packages/studio && bunx vitest run <path>`.
- All timeline times round to centiseconds via existing `roundToCenti` (`packages/studio/src/utils/rounding.ts`); frame quantization happens downstream in the engine — do not add frame math here.
- Existing behavior contracts that must not regress: beat snapping on clip move/trim, the music track never snaps to itself (`isMusicTrack`), edge-track creation at 0.55-row threshold, `buildTimelineFileDropPlacements` sequencing.
- No feature flags for these changes (decision: ship directly). Snap toggle defaults **on**.
- Layout constants (import from `packages/studio/src/player/components/timelineLayout.ts`, never redefine): `GUTTER=32`, `TRACK_H=48`, `RULER_H=24`, `CLIP_Y=3`.

**File map (whole plan):**

| File | Role |
|---|---|
| Create `packages/studio/src/player/components/timelineSnapping.ts` | unified snap targets + snap math (pure) |
| Create `packages/studio/src/player/components/timelineSnapping.test.ts` | its tests |
| Create `packages/studio/src/player/components/timelineDropPreview.ts` | drop-preview resolver (pure) |
| Create `packages/studio/src/player/components/timelineDropPreview.test.ts` | its tests |
| Create `packages/studio/src/utils/dragSession.ts` | in-window drag payload registry (pure) |
| Create `packages/studio/src/utils/dragSession.test.ts` | its tests |
| Modify `packages/studio/src/player/store/playerStore.ts` | `timelineSnapEnabled` state |
| Modify `packages/studio/src/utils/studioUiPreferences.ts` | persist `timelineSnapEnabled` |
| Modify `packages/studio/src/components/TimelineToolbar.tsx` | magnet toggle button |
| Modify `packages/studio/src/player/components/useTimelineClipDrag.ts` | unified snapping for move/trim |
| Modify `packages/studio/src/player/components/timelineDragDrop.ts` | drag-over preview state + auto-scroll + snapped drop |
| Modify `packages/studio/src/player/components/Timeline.tsx` | snap targets ref, preview wiring |
| Modify `packages/studio/src/player/components/TimelineCanvas.tsx` | ghost / row highlight / snap guide rendering |
| Modify `packages/studio/src/components/sidebar/AssetsTab.tsx` + `AudioRow.tsx` | drag session + "Add at playhead" menu item |
| Modify `packages/studio/src/components/sidebar/BlocksTab.tsx` | draggable BlockCard |
| Modify `packages/studio/src/utils/timelineAssetDrop.ts` (+ its test) | hf-id, data-volume, fitted geometry |
| Modify `packages/studio/src/utils/studioHelpers.ts` | `resolveDroppedAssetDimensions` |
| Modify `packages/studio/src/hooks/useTimelineEditing.ts` | geometry + `handleAddAssetAtPlayhead` |
| Modify `packages/studio/src/hooks/useStudioContextValue.ts` | global drop places at playhead |
| Modify `packages/studio/src/App.tsx`, `StudioLeftSidebar.tsx`, `sidebar/LeftSidebar.tsx` | prop threading |

---

### Task 1: Unified snapping module

**Files:**
- Create: `packages/studio/src/player/components/timelineSnapping.ts`
- Test: `packages/studio/src/player/components/timelineSnapping.test.ts`

**Interfaces:**
- Consumes: `TimelineElement` from `../store/playerStore` (only `{start, duration, key?, id}` fields).
- Produces (later tasks import these exact names):
  - `type TimelineSnapType = "beat" | "playhead" | "clip-edge"`
  - `interface TimelineSnapTarget { time: number; type: TimelineSnapType }`
  - `const TIMELINE_SNAP_PX = 8`
  - `collectTimelineSnapTargets(input: { elements: ReadonlyArray<Pick<TimelineElement, "start" | "duration" | "key" | "id">>; playheadTime: number | null; beatTimes: readonly number[]; excludeElementKey?: string | null }): TimelineSnapTarget[]`
  - `snapTimelineTime(time: number, targets: readonly TimelineSnapTarget[], thresholdSecs: number): { time: number; target: TimelineSnapTarget | null }`
  - `snapMoveToTargets(start: number, duration: number, targets: readonly TimelineSnapTarget[], pixelsPerSecond: number, timelineDuration: number): { start: number; snapTime: number | null; snapType: TimelineSnapType | null }`

- [ ] **Step 0: One-time setup for the branch (fold into this task)**

```bash
cd /path/to/worktree && bun install
```
Expected: install completes; lefthook pre-commit hooks now work.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/studio/src/player/components/timelineSnapping.test.ts
import { describe, expect, it } from "vitest";
import {
  TIMELINE_SNAP_PX,
  collectTimelineSnapTargets,
  snapMoveToTargets,
  snapTimelineTime,
} from "./timelineSnapping";

describe("collectTimelineSnapTargets", () => {
  const elements = [
    { start: 2, duration: 3, key: "a", id: "a" },
    { start: 10, duration: 1.5, key: "b", id: "b" },
  ];

  it("collects clip starts and ends, playhead, and beats with types", () => {
    const targets = collectTimelineSnapTargets({
      elements,
      playheadTime: 7.25,
      beatTimes: [0.5, 1.0],
    });
    expect(targets).toContainEqual({ time: 2, type: "clip-edge" });
    expect(targets).toContainEqual({ time: 5, type: "clip-edge" });
    expect(targets).toContainEqual({ time: 10, type: "clip-edge" });
    expect(targets).toContainEqual({ time: 11.5, type: "clip-edge" });
    expect(targets).toContainEqual({ time: 7.25, type: "playhead" });
    expect(targets).toContainEqual({ time: 0.5, type: "beat" });
  });

  it("excludes the dragged element's own edges", () => {
    const targets = collectTimelineSnapTargets({
      elements,
      playheadTime: null,
      beatTimes: [],
      excludeElementKey: "a",
    });
    expect(targets.some((t) => t.time === 2)).toBe(false);
    expect(targets.some((t) => t.time === 5)).toBe(false);
    expect(targets).toContainEqual({ time: 10, type: "clip-edge" });
  });

  it("omits playhead when null and dedupes identical times preferring playhead > clip-edge > beat", () => {
    const targets = collectTimelineSnapTargets({
      elements: [{ start: 1, duration: 1, key: "x", id: "x" }],
      playheadTime: 2,
      beatTimes: [2],
    });
    const atTwo = targets.filter((t) => t.time === 2);
    expect(atTwo).toEqual([{ time: 2, type: "playhead" }]);
  });
});

describe("snapTimelineTime", () => {
  const targets = [
    { time: 5, type: "clip-edge" as const },
    { time: 5.3, type: "playhead" as const },
  ];

  it("snaps to the nearest target within threshold", () => {
    expect(snapTimelineTime(5.05, targets, 0.1)).toEqual({
      time: 5,
      target: { time: 5, type: "clip-edge" },
    });
  });

  it("returns input unchanged when nothing is within threshold", () => {
    expect(snapTimelineTime(6, targets, 0.1)).toEqual({ time: 6, target: null });
  });
});

describe("snapMoveToTargets", () => {
  // pps=100 → threshold = TIMELINE_SNAP_PX/100 = 0.08s
  const targets = [{ time: 5, type: "playhead" as const }];

  it("snaps the start edge when it is the closer edge", () => {
    const r = snapMoveToTargets(5.05, 2, targets, 100, 60);
    expect(r).toEqual({ start: 5, snapTime: 5, snapType: "playhead" });
  });

  it("snaps the end edge, shifting start so the end lands on the target", () => {
    const r = snapMoveToTargets(3.03, 2, targets, 100, 60);
    expect(r.start).toBeCloseTo(3, 5);
    expect(r.snapTime).toBe(5);
    expect(r.snapType).toBe("playhead");
  });

  it("drops the snap when clamping to timeline bounds pulls it off target", () => {
    // duration 2, timeline 6 → maxStart 4; target at 5.05 wants start 5.05 → clamped to 4
    const r = snapMoveToTargets(5.0, 2, [{ time: 5.05, type: "beat" }], 100, 6);
    expect(r.snapTime).toBeNull();
  });

  it("threshold scales with pixels-per-second", () => {
    // pps=10 → threshold 0.8s: 5.5 snaps; pps=1000 → threshold 0.008s: it does not
    expect(snapMoveToTargets(5.5, 2, targets, 10, 60).snapTime).toBe(5);
    expect(snapMoveToTargets(5.5, 2, targets, 1000, 60).snapTime).toBeNull();
  });

  it("TIMELINE_SNAP_PX matches the historical beat-snap threshold", () => {
    expect(TIMELINE_SNAP_PX).toBe(8);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/studio && bunx vitest run src/player/components/timelineSnapping.test.ts`
Expected: FAIL — `Cannot find module './timelineSnapping'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

The `snapMoveToTargets` semantics are a direct generalization of `snapMoveStartToBeat` in [useTimelineClipDrag.ts:37-69](../../packages/studio/src/player/components/useTimelineClipDrag.ts) — same edge preference, clamping, and highlight-drop rules, but over typed targets.

```typescript
// packages/studio/src/player/components/timelineSnapping.ts
import type { TimelineElement } from "../store/playerStore";

export type TimelineSnapType = "beat" | "playhead" | "clip-edge";

export interface TimelineSnapTarget {
  time: number;
  type: TimelineSnapType;
}

/** Pixel radius within which a time snaps to a target (matches historical beat snap). */
export const TIMELINE_SNAP_PX = 8;

const TYPE_PRIORITY: Record<TimelineSnapType, number> = {
  playhead: 0,
  "clip-edge": 1,
  beat: 2,
};

export function collectTimelineSnapTargets(input: {
  elements: ReadonlyArray<Pick<TimelineElement, "start" | "duration" | "key" | "id">>;
  playheadTime: number | null;
  beatTimes: readonly number[];
  excludeElementKey?: string | null;
}): TimelineSnapTarget[] {
  const byTime = new Map<number, TimelineSnapTarget>();
  const add = (time: number, type: TimelineSnapType) => {
    if (!Number.isFinite(time) || time < 0) return;
    const rounded = Math.round(time * 1000) / 1000;
    const existing = byTime.get(rounded);
    if (!existing || TYPE_PRIORITY[type] < TYPE_PRIORITY[existing.type]) {
      byTime.set(rounded, { time: rounded, type });
    }
  };

  for (const beat of input.beatTimes) add(beat, "beat");
  for (const el of input.elements) {
    if (input.excludeElementKey != null && (el.key ?? el.id) === input.excludeElementKey) continue;
    add(el.start, "clip-edge");
    add(el.start + el.duration, "clip-edge");
  }
  if (input.playheadTime != null) add(input.playheadTime, "playhead");

  return Array.from(byTime.values()).sort((a, b) => a.time - b.time);
}

export function snapTimelineTime(
  time: number,
  targets: readonly TimelineSnapTarget[],
  thresholdSecs: number,
): { time: number; target: TimelineSnapTarget | null } {
  let best: TimelineSnapTarget | null = null;
  let bestDist = thresholdSecs;
  for (const target of targets) {
    const d = Math.abs(target.time - time);
    if (d < bestDist || (d === bestDist && best && TYPE_PRIORITY[target.type] < TYPE_PRIORITY[best.type])) {
      bestDist = d;
      best = target;
    }
  }
  return best ? { time: best.time, target: best } : { time, target: null };
}

/**
 * Snap a moved clip so whichever edge (start or end) is nearest a target lands
 * on it, keeping duration fixed. Mirrors the historical beat-snap semantics:
 * clamp to [0, timelineDuration - duration]; if clamping pulls the clip off the
 * target, drop the highlight.
 */
export function snapMoveToTargets(
  start: number,
  duration: number,
  targets: readonly TimelineSnapTarget[],
  pixelsPerSecond: number,
  timelineDuration: number,
): { start: number; snapTime: number | null; snapType: TimelineSnapType | null } {
  if (targets.length === 0) return { start, snapTime: null, snapType: null };
  const thresholdSecs = TIMELINE_SNAP_PX / Math.max(pixelsPerSecond, 1);
  const startSnap = snapTimelineTime(start, targets, thresholdSecs);
  const endSnap = snapTimelineTime(start + duration, targets, thresholdSecs);
  const startMoved = startSnap.target !== null;
  const endMoved = endSnap.target !== null;

  let candidate = start;
  let target: TimelineSnapTarget | null = null;
  if (
    startMoved &&
    (!endMoved || Math.abs(startSnap.time - start) <= Math.abs(endSnap.time - (start + duration)))
  ) {
    candidate = startSnap.time;
    target = startSnap.target;
  } else if (endMoved) {
    candidate = endSnap.time - duration;
    target = endSnap.target;
  }

  const maxStart = Math.max(0, timelineDuration - duration);
  const clamped = Math.max(0, Math.min(maxStart, Math.round(candidate * 1000) / 1000));
  if (target && Math.abs(clamped - candidate) > 1e-6) target = null;
  return { start: clamped, snapTime: target?.time ?? null, snapType: target?.type ?? null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/studio && bunx vitest run src/player/components/timelineSnapping.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Lint, format, commit**

```bash
bunx oxlint packages/studio/src/player/components/timelineSnapping.ts packages/studio/src/player/components/timelineSnapping.test.ts
bunx oxfmt packages/studio/src/player/components/timelineSnapping.ts packages/studio/src/player/components/timelineSnapping.test.ts
git add packages/studio/src/player/components/timelineSnapping.ts packages/studio/src/player/components/timelineSnapping.test.ts
git commit -m "feat(studio): unified timeline snap targets module (playhead/clip-edge/beat)"
```

---

### Task 2: Snap toggle — store state, persistence, toolbar magnet button

**Files:**
- Modify: `packages/studio/src/utils/studioUiPreferences.ts` (interface at lines 7–19, reader at lines 37–95)
- Modify: `packages/studio/src/player/store/playerStore.ts`
- Modify: `packages/studio/src/components/TimelineToolbar.tsx` (toolbar row starts line 102)
- Test: `packages/studio/src/utils/studioUiPreferences.test.ts` (extend existing file)

**Interfaces:**
- Consumes: `readStudioUiPreferences` / `writeStudioUiPreferences` (existing).
- Produces:
  - `StudioUiPreferences.timelineSnapEnabled?: boolean` (new pref key; note `snapEnabled` already exists but belongs to the **canvas** snap engine — do not reuse it)
  - Store: `timelineSnapEnabled: boolean` (default from prefs, falling back to `true`) and `setTimelineSnapEnabled(enabled: boolean): void` on `usePlayerStore`. The setter also persists via `writeStudioUiPreferences({ timelineSnapEnabled })`.

- [ ] **Step 1: Write the failing test** (append to `packages/studio/src/utils/studioUiPreferences.test.ts`, following that file's existing fake-Storage pattern)

```typescript
// append to packages/studio/src/utils/studioUiPreferences.test.ts
describe("timelineSnapEnabled preference", () => {
  it("round-trips through storage", () => {
    const storage = createFakeStorage(); // reuse the file's existing helper; if it is named
    // differently (e.g. makeStorage/memoryStorage), use that exact existing helper.
    writeStudioUiPreferences({ timelineSnapEnabled: false }, storage);
    expect(readStudioUiPreferences(storage).timelineSnapEnabled).toBe(false);
  });

  it("ignores non-boolean values", () => {
    const storage = createFakeStorage();
    storage.setItem("hf-studio-ui-preferences", JSON.stringify({ timelineSnapEnabled: "yes" }));
    expect(readStudioUiPreferences(storage).timelineSnapEnabled).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/studio && bunx vitest run src/utils/studioUiPreferences.test.ts`
Expected: FAIL — `timelineSnapEnabled` is `undefined` after write (key not whitelisted by `readStorage`).

- [ ] **Step 3: Implement the pref key**

In `studioUiPreferences.ts` add to the interface (after `snapToGrid?: boolean;` on line 18):

```typescript
  /** Timeline magnet: snap clip drags/trims/drops to playhead, clip edges, and beats. */
  timelineSnapEnabled?: boolean;
```

and in `readStorage` (after the `snapToGrid` block at lines 88–90):

```typescript
    if (typeof parsed.timelineSnapEnabled === "boolean") {
      preferences.timelineSnapEnabled = parsed.timelineSnapEnabled;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/studio && bunx vitest run src/utils/studioUiPreferences.test.ts`
Expected: PASS.

- [ ] **Step 5: Add store state**

In `packages/studio/src/player/store/playerStore.ts`, import at top:

```typescript
import { readStudioUiPreferences, writeStudioUiPreferences } from "../../utils/studioUiPreferences";
```

Add to the store's state interface (near `zoomMode`/`manualZoomPercent`):

```typescript
  /** Timeline magnet toggle — when false, clip drags/trims/drops never snap. */
  timelineSnapEnabled: boolean;
  setTimelineSnapEnabled: (enabled: boolean) => void;
```

Add to the store creator (same neighborhood):

```typescript
  timelineSnapEnabled: readStudioUiPreferences().timelineSnapEnabled ?? true,
  setTimelineSnapEnabled: (enabled) => {
    writeStudioUiPreferences({ timelineSnapEnabled: enabled });
    set({ timelineSnapEnabled: enabled });
  },
```

(`readStudioUiPreferences` is SSR-safe — it returns `{}` when `window` is undefined — so module-level initialization is fine.)

- [ ] **Step 6: Add the magnet button to TimelineToolbar**

In `packages/studio/src/components/TimelineToolbar.tsx`:

Import the icon at the top (phosphor is already a studio dependency, used in `TimelineCanvas.tsx:2`):

```typescript
import { Magnet } from "@phosphor-icons/react";
```

Subscribe inside the component (next to `activeTool` at line 80):

```typescript
  const timelineSnapEnabled = usePlayerStore((s) => s.timelineSnapEnabled);
  const setTimelineSnapEnabled = usePlayerStore((s) => s.setTimelineSnapEnabled);
```

Render the button in the left button group, immediately after the razor/selection tool cluster (the `STUDIO_RAZOR_TOOL_ENABLED` block that starts at line 109 — place this right after its closing `)}`):

```tsx
          <Tooltip label={timelineSnapEnabled ? "Snapping on (N)" : "Snapping off (N)"}>
            <button
              type="button"
              onClick={() => setTimelineSnapEnabled(!timelineSnapEnabled)}
              aria-label="Toggle timeline snapping"
              aria-pressed={timelineSnapEnabled}
              className={`flex h-6 w-6 items-center justify-center rounded border transition-colors active:scale-[0.98] ${
                timelineSnapEnabled
                  ? "border-neutral-700 bg-neutral-700 text-neutral-200"
                  : "border-neutral-800 text-neutral-500 hover:text-neutral-300"
              }`}
            >
              <Magnet size={13} weight="bold" aria-hidden="true" />
            </button>
          </Tooltip>
```

Add the `N` shortcut (matches Resolve/FCP). In the same component, after the `useKeyframeKeyboard` call (line 97–100):

```typescript
  // "N" toggles timeline snapping (industry convention: Resolve/FCP).
  // Skip when typing in an input/contenteditable.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tag = target?.tagName?.toLowerCase() ?? "";
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const store = usePlayerStore.getState();
      store.setTimelineSnapEnabled(!store.timelineSnapEnabled);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
```

(add `useEffect` to the existing `react` import on line 1).

- [ ] **Step 7: Type-check, run existing toolbar tests, verify manually**

```bash
cd packages/studio && bunx vitest run src/components/TimelineToolbar.test.tsx src/utils/studioUiPreferences.test.ts
```
Expected: PASS (existing toolbar tests unaffected; if a toolbar snapshot test exists and fails on the new button, update the snapshot deliberately).

Manual check: `npx hyperframes preview` (or `hyperframes studio`) in any test project → magnet button renders in the timeline toolbar, toggles fill state, `N` toggles it, state survives reload.

- [ ] **Step 8: Lint, format, commit**

```bash
bunx oxlint packages/studio/src/utils/studioUiPreferences.ts packages/studio/src/player/store/playerStore.ts packages/studio/src/components/TimelineToolbar.tsx
bunx oxfmt packages/studio/src/utils/studioUiPreferences.ts packages/studio/src/player/store/playerStore.ts packages/studio/src/components/TimelineToolbar.tsx packages/studio/src/utils/studioUiPreferences.test.ts
git add -A packages/studio/src
git commit -m "feat(studio): timeline snap magnet toggle with N shortcut and persistence"
```

---

### Task 3: Unified snapping for clip move and trim

**Files:**
- Modify: `packages/studio/src/player/components/useTimelineClipDrag.ts` (beat-snap helpers at lines 15–69, move preview at lines 189–232, trim snap at lines 344–390)
- Modify: `packages/studio/src/player/components/TimelineCanvas.tsx` (snap highlight consumption at line 273; new guide rendering)
- Modify: `packages/studio/src/player/components/Timeline.tsx` (no structural change; verify `draggedClip` prop flow)

**Interfaces:**
- Consumes (Task 1): `collectTimelineSnapTargets`, `snapMoveToTargets`, `snapTimelineTime`, `TIMELINE_SNAP_PX`, `TimelineSnapType`.
- Consumes (Task 2): `usePlayerStore((s) => s.timelineSnapEnabled)`.
- Produces: `DraggedClipState` gains `snapType: TimelineSnapType | null` (alongside the existing `snapBeatTime: number | null`, which is **renamed** to `snapTime: number | null` — update the one consumer at `TimelineCanvas.tsx:273`).

- [ ] **Step 1: Refactor `useTimelineClipDrag` to unified targets**

1. Delete the local `snapToNearestBeat` and `snapMoveStartToBeat` functions (lines 15–69) and the local `BEAT_SNAP_PX` constant. Import instead:

```typescript
import {
  TIMELINE_SNAP_PX,
  collectTimelineSnapTargets,
  snapMoveToTargets,
  snapTimelineTime,
  type TimelineSnapTarget,
  type TimelineSnapType,
} from "./timelineSnapping";
```

2. In `DraggedClipState` (lines 72–87), replace

```typescript
  /** Beat time the clip will snap to on drop, for the grid-line highlight. */
  snapBeatTime: number | null;
```

with

```typescript
  /** Snap target the clip will land on, for the guide highlight. */
  snapTime: number | null;
  snapType: TimelineSnapType | null;
```

3. Replace the `beatTimesRef` block (lines 167–168) with a full targets ref. Keep `adjustedBeatTimes` exactly as computed (lines 149–165), then:

```typescript
  const elements = usePlayerStore((s) => s.elements);
  const timelineSnapEnabled = usePlayerStore((s) => s.timelineSnapEnabled);
  const snapContextRef = useRef<{ beatTimes: number[]; enabled: boolean }>({
    beatTimes: [],
    enabled: true,
  });
  snapContextRef.current = { beatTimes: adjustedBeatTimes, enabled: timelineSnapEnabled };
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  const buildSnapTargets = useCallback(
    (excludeElementKey: string | null, includeBeats: boolean): TimelineSnapTarget[] => {
      if (!snapContextRef.current.enabled) return [];
      return collectTimelineSnapTargets({
        elements: elementsRef.current,
        playheadTime: usePlayerStore.getState().currentTime,
        beatTimes: includeBeats ? snapContextRef.current.beatTimes : [],
        excludeElementKey,
      });
    },
    [],
  );
```

4. In `updateDraggedClipPreview` (lines 189–232), replace the snap block

```typescript
      // The music track defines the beats, so it must not snap to itself.
      const snap = isMusicTrack(drag.element)
        ? { start: nextMove.start, beat: null }
        : snapMoveStartToBeat(...);
```

with

```typescript
      // The music track defines the beats, so it must not snap to them —
      // but it still snaps to the playhead and other clip edges.
      const targets = buildSnapTargets(
        drag.element.key ?? drag.element.id,
        !isMusicTrack(drag.element),
      );
      const snap = snapMoveToTargets(
        nextMove.start,
        drag.element.duration,
        targets,
        ppsRef.current,
        durationRef.current,
      );
      return {
        ...drag,
        started: true,
        pointerClientX: clientX,
        pointerClientY: clientY,
        previewStart: snap.start,
        previewTrack: nextMove.track,
        snapTime: snap.snapTime,
        snapType: snap.snapType,
      };
```

and add `buildSnapTargets` to the callback's dependency array.

5. In the trim branch of `handleWindowPointerMove` (lines 344–390), replace `const beatTimes = beatTimesRef.current;` and the `beatTimes.length > 0 && !isMusicTrack(...)` gate with targets, keeping every existing clamp exactly as-is:

```typescript
        const trimTargets = buildSnapTargets(
          resize.element.key ?? resize.element.id,
          !isMusicTrack(resize.element),
        );
        if (trimTargets.length > 0) {
          const snapSecs = TIMELINE_SNAP_PX / Math.max(ppsRef.current, 1);
          if (resize.edge === "end") {
            const edgeTime = nextResize.start + nextResize.duration;
            const snapped = snapTimelineTime(edgeTime, trimTargets, snapSecs).time;
            // ... keep the existing end-edge clamp logic (lines 356–359) verbatim,
            //     with `snapped` sourced from snapTimelineTime instead of snapToNearestBeat
          } else {
            const snapped = snapTimelineTime(nextResize.start, trimTargets, snapSecs).time;
            // ... keep the existing start-edge clamp/playbackStart logic (lines 361–389) verbatim
          }
        }
```

6. Everywhere `snapBeatTime: null` is initialized (`TimelineCanvas.tsx:404` sets `snapBeatTime: null` in the pointer-down `setDraggedClip`), change to `snapTime: null, snapType: null`.

- [ ] **Step 2: Update the snap highlight consumers in TimelineCanvas**

At `TimelineCanvas.tsx:273`, the beat highlight becomes type-conditional:

```tsx
                <BeatBackgroundLines
                  beatTimes={beatAnalysis?.beatTimes}
                  beatStrengths={beatAnalysis?.beatStrengths}
                  pps={pps}
                  highlightTime={
                    draggedClip?.started && draggedClip.snapType === "beat"
                      ? draggedClip.snapTime
                      : null
                  }
                />
```

Add a generic vertical snap guide for playhead/clip-edge snaps. In `TimelineCanvas.tsx`, right before the `{/* Drag ghost */}` block (line 480):

```tsx
      {/* Snap guide for non-beat targets during clip drag */}
      {draggedClip?.started && draggedClip.snapTime != null && draggedClip.snapType !== "beat" && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: GUTTER + draggedClip.snapTime * pps,
            top: RULER_H,
            bottom: 0,
            width: 1,
            background: draggedClip.snapType === "playhead" ? "#3CE6AC" : "rgba(255,255,255,0.6)",
            boxShadow: "0 0 6px rgba(60,230,172,0.5)",
            zIndex: 60,
          }}
        />
      )}
```

- [ ] **Step 3: Run the full studio player test suite**

Run: `cd packages/studio && bunx vitest run src/player`
Expected: PASS. If any existing test referenced `snapBeatTime`, update it to `snapTime`/`snapType` (grep first: `grep -rn snapBeatTime packages/studio/src`).

- [ ] **Step 4: Manual verification**

In a project with several clips + a music track: drag a clip near the playhead → green guide line appears and the clip sticks; near another clip's edge → white guide; near a beat → beat column glows (existing behavior); toggle magnet off (`N`) → no sticking anywhere; trim edges snap to playhead/edges/beats; the music clip itself never snaps to beats but does snap to the playhead.

- [ ] **Step 5: Lint, format, commit**

```bash
bunx oxlint packages/studio/src/player/components/useTimelineClipDrag.ts packages/studio/src/player/components/TimelineCanvas.tsx
bunx oxfmt packages/studio/src/player/components/useTimelineClipDrag.ts packages/studio/src/player/components/TimelineCanvas.tsx
git add -A packages/studio/src
git commit -m "feat(studio): clip move/trim snaps to playhead and clip edges, gated by magnet toggle"
```

---

### Task 4: Drag session registry + block drag source

**Files:**
- Create: `packages/studio/src/utils/dragSession.ts`
- Test: `packages/studio/src/utils/dragSession.test.ts`
- Modify: `packages/studio/src/components/sidebar/AssetsTab.tsx` (ImageCard `onDragStart` at lines 62–67)
- Modify: `packages/studio/src/components/sidebar/AudioRow.tsx` (`onDragStart` at lines ~111–117)
- Modify: `packages/studio/src/components/sidebar/BlocksTab.tsx` (BlockCard root div at lines 383–388)

**Why:** HTML5 DnD hides `dataTransfer.getData()` until `drop` (Chrome protected mode), so the drag-over ghost (Task 6) cannot read the payload mid-drag. All these drags originate in the same window, so a module-level registry gives the ghost full knowledge (kind, duration, label). OS-file drags don't pass through it — they fall back to `dataTransfer.items[i].type` MIME hints.

**Interfaces:**
- Produces:
  - `interface DragSessionPayload { source: "asset" | "block"; path?: string; blockName?: string; kind: "image" | "video" | "audio" | "block"; durationSec: number | null; label: string }`
  - `beginDragSession(payload: DragSessionPayload): void`
  - `endDragSession(): void`
  - `getActiveDragSession(): DragSessionPayload | null`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/studio/src/utils/dragSession.test.ts
import { describe, expect, it } from "vitest";
import { beginDragSession, endDragSession, getActiveDragSession } from "./dragSession";

describe("dragSession", () => {
  it("stores and clears the active payload", () => {
    expect(getActiveDragSession()).toBeNull();
    beginDragSession({
      source: "asset",
      path: "assets/a.mp3",
      kind: "audio",
      durationSec: 12.4,
      label: "a.mp3",
    });
    expect(getActiveDragSession()?.kind).toBe("audio");
    endDragSession();
    expect(getActiveDragSession()).toBeNull();
  });

  it("a new begin replaces the previous session", () => {
    beginDragSession({ source: "asset", path: "x.png", kind: "image", durationSec: null, label: "x" });
    beginDragSession({ source: "block", blockName: "confetti", kind: "block", durationSec: 3, label: "Confetti" });
    expect(getActiveDragSession()?.source).toBe("block");
    endDragSession();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/studio && bunx vitest run src/utils/dragSession.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/studio/src/utils/dragSession.ts
/**
 * In-window drag payload registry. HTML5 DnD hides dataTransfer payloads until
 * drop (Chrome protected mode), but drags that originate inside the studio can
 * publish their payload here so drag-over UI (ghost, snap) knows what is being
 * dragged. OS-file drags never appear here — callers must fall back to
 * dataTransfer.items MIME hints.
 */
export interface DragSessionPayload {
  source: "asset" | "block";
  path?: string;
  blockName?: string;
  kind: "image" | "video" | "audio" | "block";
  durationSec: number | null;
  label: string;
}

let active: DragSessionPayload | null = null;

export function beginDragSession(payload: DragSessionPayload): void {
  active = payload;
}

export function endDragSession(): void {
  active = null;
}

export function getActiveDragSession(): DragSessionPayload | null {
  return active;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/studio && bunx vitest run src/utils/dragSession.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire asset drag sources**

In `AssetsTab.tsx`, ImageCard's drag handlers (lines 62–67) become:

```tsx
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "copy";
          e.dataTransfer.setData(TIMELINE_ASSET_MIME, JSON.stringify({ path: asset }));
          e.dataTransfer.setData("text/plain", asset);
          beginDragSession({
            source: "asset",
            path: asset,
            kind: isVideo ? "video" : "image",
            durationSec: null,
            label: name,
          });
        }}
        onDragEnd={endDragSession}
```

with imports `import { beginDragSession, endDragSession } from "../../utils/dragSession";`.
(`isVideo` and `name` already exist in ImageCard scope, lines 51–53.)

In `AudioRow.tsx`, extend its `onDragStart` the same way with `kind: "audio"`, `durationSec: <the row's known duration from manifest metadata if present in scope, else null>`, `label: <the row's display name>`, and add `onDragEnd={endDragSession}`.

- [ ] **Step 6: Make BlockCard draggable**

In `BlocksTab.tsx` BlockCard root div (lines 383–388):

```tsx
    <div
      className="group/card rounded-md overflow-hidden cursor-pointer transition-colors bg-neutral-900 hover:bg-neutral-800"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(TIMELINE_BLOCK_MIME, JSON.stringify({ name }));
        e.dataTransfer.setData("text/plain", name);
        beginDragSession({
          source: "block",
          blockName: name,
          kind: "block",
          durationSec: duration ?? null,
          label: title,
        });
        handleLeave(); // cancel the hover-preview timer so it doesn't fire mid-drag
      }}
      onDragEnd={endDragSession}
      onPointerEnter={handleEnter}
      onPointerLeave={handleLeave}
    >
```

with imports:

```typescript
import { TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";
import { beginDragSession, endDragSession } from "../../utils/dragSession";
```

`name`, `title`, `duration`, `handleLeave` are all already in BlockCard scope.

- [ ] **Step 7: Verify block drop end-to-end (the consumers already exist)**

Manual: run the studio, open Catalog tab, drag a scenes-category block onto the timeline → `onBlockDrop` fires (`timelineDragDrop.ts:73–85` → `NLELayout.tsx` → `handleTimelineBlockDrop` in `useBlockHandlers`) and the block installs at the drop position. Drag one onto the preview canvas → dashed overlay appears (`usePreviewBlockDrop`) and the block installs at the drop point. Also verify asset dragging from the Assets tab still works.

- [ ] **Step 8: Lint, format, commit**

```bash
bunx oxlint packages/studio/src/utils/dragSession.ts packages/studio/src/components/sidebar/AssetsTab.tsx packages/studio/src/components/sidebar/AudioRow.tsx packages/studio/src/components/sidebar/BlocksTab.tsx
bunx oxfmt packages/studio/src/utils/dragSession.ts packages/studio/src/utils/dragSession.test.ts packages/studio/src/components/sidebar/AssetsTab.tsx packages/studio/src/components/sidebar/AudioRow.tsx packages/studio/src/components/sidebar/BlocksTab.tsx
git add -A packages/studio/src
git commit -m "feat(studio): drag session registry; block cards draggable to timeline and canvas"
```

---

### Task 5: Drop preview resolver (pure)

**Files:**
- Create: `packages/studio/src/player/components/timelineDropPreview.ts`
- Test: `packages/studio/src/player/components/timelineDropPreview.test.ts`

**Interfaces:**
- Consumes (Task 1): `snapTimelineTime`, `TIMELINE_SNAP_PX`, `TimelineSnapTarget`, `TimelineSnapType`; (existing) `resolveTimelineAssetDrop` input shape from `timelineLayout.ts:186–211`; (Task 4) `DragSessionPayload`.
- Produces:
  - `interface TimelineDropPreview { start: number; track: number; isNewTrack: boolean; durationSec: number; kind: "image" | "video" | "audio" | "block" | "unknown"; label: string; extraCount: number; snapTime: number | null; snapType: TimelineSnapType | null }`
  - `resolveTimelineDropPreview(input: { drop: Parameters<typeof resolveTimelineAssetDrop>[0]; clientX: number; clientY: number; session: DragSessionPayload | null; fileItems: ReadonlyArray<{ kind: string; type: string }>; snapTargets: readonly TimelineSnapTarget[]; snapEnabled: boolean }): TimelineDropPreview`
  - `const DEFAULT_DROP_PREVIEW_DURATION: Record<"image" | "video" | "audio" | "block" | "unknown", number>` — `{ image: 3, video: 5, audio: 5, block: 5, unknown: 5 }` (image/video/audio values mirror `DEFAULT_TIMELINE_ASSET_DURATION` in `studioHelpers.ts:238–242`).

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/studio/src/player/components/timelineDropPreview.test.ts
import { describe, expect, it } from "vitest";
import { resolveTimelineDropPreview } from "./timelineDropPreview";

const baseDrop = {
  rectLeft: 0,
  rectTop: 0,
  scrollLeft: 0,
  scrollTop: 0,
  pixelsPerSecond: 100,
  duration: 60,
  trackHeight: 48,
  trackOrder: [0, 1],
};
// clientX includes GUTTER(32); clientY includes RULER_H(24).

describe("resolveTimelineDropPreview", () => {
  it("uses the drag session for kind/duration/label", () => {
    const p = resolveTimelineDropPreview({
      drop: baseDrop,
      clientX: 32 + 500, // t = 5s
      clientY: 24 + 10, // row 0
      session: { source: "asset", path: "a.mp3", kind: "audio", durationSec: 12.4, label: "a.mp3" },
      fileItems: [],
      snapTargets: [],
      snapEnabled: true,
    });
    expect(p).toMatchObject({ start: 5, track: 0, isNewTrack: false, durationSec: 12.4, kind: "audio", label: "a.mp3", extraCount: 0 });
  });

  it("falls back to file item MIME hints for OS drags, with default durations and a count", () => {
    const p = resolveTimelineDropPreview({
      drop: baseDrop,
      clientX: 32,
      clientY: 24 + 60, // row 1
      session: null,
      fileItems: [
        { kind: "file", type: "video/mp4" },
        { kind: "file", type: "image/png" },
      ],
      snapTargets: [],
      snapEnabled: true,
    });
    expect(p.kind).toBe("video");
    expect(p.durationSec).toBe(5);
    expect(p.extraCount).toBe(1);
    expect(p.track).toBe(1);
  });

  it("flags a new track when dropped below the last row", () => {
    const p = resolveTimelineDropPreview({
      drop: baseDrop,
      clientX: 32,
      clientY: 24 + 48 * 2 + 10, // row index 2, beyond trackOrder [0,1]
      session: null,
      fileItems: [{ kind: "file", type: "audio/mpeg" }],
      snapTargets: [],
      snapEnabled: true,
    });
    expect(p.isNewTrack).toBe(true);
    expect(p.track).toBe(2); // max(trackOrder)+1
  });

  it("snaps the start to the nearest target when enabled, and not when disabled", () => {
    const targets = [{ time: 5, type: "playhead" as const }];
    const on = resolveTimelineDropPreview({
      drop: baseDrop, clientX: 32 + 503, clientY: 24, session: null,
      fileItems: [{ kind: "file", type: "image/png" }], snapTargets: targets, snapEnabled: true,
    });
    expect(on.start).toBe(5);
    expect(on.snapType).toBe("playhead");
    const off = resolveTimelineDropPreview({
      drop: baseDrop, clientX: 32 + 503, clientY: 24, session: null,
      fileItems: [{ kind: "file", type: "image/png" }], snapTargets: targets, snapEnabled: false,
    });
    expect(off.start).toBeCloseTo(5.03, 2);
    expect(off.snapTime).toBeNull();
  });

  it("reports unknown kind for unrecognized MIME with no session", () => {
    const p = resolveTimelineDropPreview({
      drop: baseDrop, clientX: 32, clientY: 24, session: null,
      fileItems: [{ kind: "file", type: "application/pdf" }], snapTargets: [], snapEnabled: true,
    });
    expect(p.kind).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/studio && bunx vitest run src/player/components/timelineDropPreview.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// packages/studio/src/player/components/timelineDropPreview.ts
import type { DragSessionPayload } from "../../utils/dragSession";
import { resolveTimelineAssetDrop } from "./timelineLayout";
import {
  TIMELINE_SNAP_PX,
  snapTimelineTime,
  type TimelineSnapTarget,
  type TimelineSnapType,
} from "./timelineSnapping";

export type TimelineDropPreviewKind = "image" | "video" | "audio" | "block" | "unknown";

export interface TimelineDropPreview {
  start: number;
  track: number;
  isNewTrack: boolean;
  durationSec: number;
  kind: TimelineDropPreviewKind;
  label: string;
  /** Additional files beyond the first, for OS multi-file drags ("+N more"). */
  extraCount: number;
  snapTime: number | null;
  snapType: TimelineSnapType | null;
}

export const DEFAULT_DROP_PREVIEW_DURATION: Record<TimelineDropPreviewKind, number> = {
  image: 3,
  video: 5,
  audio: 5,
  block: 5,
  unknown: 5,
};

function kindFromMime(mime: string): TimelineDropPreviewKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "unknown";
}

export function resolveTimelineDropPreview(input: {
  drop: Parameters<typeof resolveTimelineAssetDrop>[0];
  clientX: number;
  clientY: number;
  session: DragSessionPayload | null;
  fileItems: ReadonlyArray<{ kind: string; type: string }>;
  snapTargets: readonly TimelineSnapTarget[];
  snapEnabled: boolean;
}): TimelineDropPreview {
  const placement = resolveTimelineAssetDrop(input.drop, input.clientX, input.clientY);
  const files = input.fileItems.filter((item) => item.kind === "file");

  let kind: TimelineDropPreviewKind;
  let durationSec: number;
  let label: string;
  if (input.session) {
    kind = input.session.kind;
    durationSec = input.session.durationSec ?? DEFAULT_DROP_PREVIEW_DURATION[kind];
    label = input.session.label;
  } else if (files.length > 0) {
    kind = kindFromMime(files[0].type);
    durationSec = DEFAULT_DROP_PREVIEW_DURATION[kind];
    label = files.length > 1 ? `${files.length} files` : "File";
  } else {
    kind = "unknown";
    durationSec = DEFAULT_DROP_PREVIEW_DURATION.unknown;
    label = "Drop";
  }

  let start = placement.start;
  let snapTime: number | null = null;
  let snapType: TimelineSnapType | null = null;
  if (input.snapEnabled && input.snapTargets.length > 0) {
    const thresholdSecs = TIMELINE_SNAP_PX / Math.max(input.drop.pixelsPerSecond, 1);
    const snapped = snapTimelineTime(start, input.snapTargets, thresholdSecs);
    if (snapped.target) {
      start = Math.max(0, snapped.time);
      snapTime = snapped.target.time;
      snapType = snapped.target.type;
    }
  }

  return {
    start,
    track: placement.track,
    isNewTrack: !input.drop.trackOrder.includes(placement.track),
    durationSec,
    kind,
    label,
    extraCount: Math.max(0, files.length - 1),
    snapTime,
    snapType,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/studio && bunx vitest run src/player/components/timelineDropPreview.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, format, commit**

```bash
bunx oxlint packages/studio/src/player/components/timelineDropPreview.ts packages/studio/src/player/components/timelineDropPreview.test.ts
bunx oxfmt packages/studio/src/player/components/timelineDropPreview.ts packages/studio/src/player/components/timelineDropPreview.test.ts
git add packages/studio/src/player/components/timelineDropPreview.ts packages/studio/src/player/components/timelineDropPreview.test.ts
git commit -m "feat(studio): pure drop-preview resolver with snapping and MIME fallback"
```

---

### Task 6: Live drop preview — ghost, row highlight, new-track row, auto-scroll

**Files:**
- Modify: `packages/studio/src/player/components/timelineDragDrop.ts` (whole hook, currently 92 lines)
- Modify: `packages/studio/src/player/components/Timeline.tsx` (hook call at lines 371–379, `displayTrackOrder` at 238–246, TimelineCanvas props at 432+)
- Modify: `packages/studio/src/player/components/TimelineCanvas.tsx` (props interface at 40–96, row map at 201, ghost area near 480)

**Interfaces:**
- Consumes: `resolveTimelineDropPreview`, `TimelineDropPreview` (Task 5); `getActiveDragSession` (Task 4); `collectTimelineSnapTargets` (Task 1); `resolveTimelineAutoScroll` from `./timelineEditing` (existing, line 49); `usePlayerStore` for elements/currentTime/snap toggle.
- Produces: `useTimelineAssetDrop` additionally returns `dropPreview: TimelineDropPreview | null`. `TimelineCanvas` gains prop `dropPreview: TimelineDropPreview | null`.

- [ ] **Step 1: Extend `useTimelineAssetDrop`**

Rewrite `timelineDragDrop.ts` with these changes (keep everything else, including the existing drop routing):

```typescript
import { useCallback, useRef, useState, type RefObject } from "react";
import { TIMELINE_ASSET_MIME, TIMELINE_BLOCK_MIME } from "../../utils/timelineAssetDrop";
import { getActiveDragSession } from "../../utils/dragSession";
import { usePlayerStore } from "../store/playerStore";
import { TRACK_H, resolveTimelineAssetDrop } from "./timelineLayout";
import { resolveTimelineDropPreview, type TimelineDropPreview } from "./timelineDropPreview";
import { collectTimelineSnapTargets } from "./timelineSnapping";
import { resolveTimelineAutoScroll } from "./timelineEditing";
import type { TimelineDropCallbacks } from "./timelineCallbacks";
```

Inside the hook add preview state and a shared resolver:

```typescript
  const [dropPreview, setDropPreview] = useState<TimelineDropPreview | null>(null);
  const dropPreviewRef = useRef<TimelineDropPreview | null>(null);

  const buildDropInput = useCallback(() => {
    const scroll = scrollRef.current;
    const rect = scroll?.getBoundingClientRect();
    return {
      rectLeft: rect?.left ?? 0,
      rectTop: rect?.top ?? 0,
      scrollLeft: scroll?.scrollLeft ?? 0,
      scrollTop: scroll?.scrollTop ?? 0,
      pixelsPerSecond: ppsRef.current,
      duration: durationRef.current,
      trackHeight: TRACK_H,
      trackOrder: trackOrderRef.current,
    };
  }, [scrollRef, ppsRef, durationRef, trackOrderRef]);

  const resolvePreview = useCallback(
    (e: React.DragEvent): TimelineDropPreview => {
      const state = usePlayerStore.getState();
      const snapTargets = state.timelineSnapEnabled
        ? collectTimelineSnapTargets({
            elements: state.elements,
            playheadTime: state.currentTime,
            beatTimes: [], // beat times need remapping to composition time; drops snap to
            // playhead + clip edges. (Clip moves still snap to beats via Task 3.)
          })
        : [];
      return resolveTimelineDropPreview({
        drop: buildDropInput(),
        clientX: e.clientX,
        clientY: e.clientY,
        session: getActiveDragSession(),
        fileItems: Array.from(e.dataTransfer.items, (i) => ({ kind: i.kind, type: i.type })),
        snapTargets,
        snapEnabled: state.timelineSnapEnabled,
      });
    },
    [buildDropInput],
  );
```

Replace `handleAssetDragOver` so it also updates the preview and auto-scrolls at the edges:

```typescript
  const handleAssetDragOver = useCallback(
    (e: React.DragEvent) => {
      const hasFiles = e.dataTransfer.types.includes("Files");
      const types = Array.from(e.dataTransfer.types);
      const hasAsset = types.includes(TIMELINE_ASSET_MIME);
      const hasBlock = types.includes(TIMELINE_BLOCK_MIME);
      if (!hasFiles && !hasAsset && !hasBlock) return;
      e.preventDefault();
      if (hasAsset || hasBlock) e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);

      // Edge auto-scroll while hovering with an external drag.
      const scroll = scrollRef.current;
      if (scroll) {
        const rect = scroll.getBoundingClientRect();
        const delta = resolveTimelineAutoScroll(rect, e.clientX, e.clientY);
        if (delta.x !== 0 || delta.y !== 0) {
          scroll.scrollLeft += delta.x;
          scroll.scrollTop += delta.y;
        }
      }

      const next = resolvePreview(e);
      const prev = dropPreviewRef.current;
      if (
        !prev ||
        prev.start !== next.start ||
        prev.track !== next.track ||
        prev.snapTime !== next.snapTime ||
        prev.durationSec !== next.durationSec
      ) {
        dropPreviewRef.current = next;
        setDropPreview(next);
      }
    },
    [resolvePreview, scrollRef],
  );
```

Clear the preview on leave and drop — add a small helper used by both:

```typescript
  const clearDropPreview = useCallback(() => {
    dropPreviewRef.current = null;
    setDropPreview(null);
    setIsDragOver(false);
  }, []);
```

In `handleAssetDrop`, call `clearDropPreview()` right after `e.preventDefault()` (replacing `setIsDragOver(false)`), and use the **snapped** placement: replace both `resolveTimelineAssetDrop(dropInput, e.clientX, e.clientY)` call sites with

```typescript
  const preview = resolvePreview(e);
  const placement = { start: preview.start, track: preview.track };
```

computed once at the top of the drop handler and passed to `onFileDrop`/`onAssetDrop`/`onBlockDrop`. Return `{ isDragOver, setIsDragOver, handleAssetDragOver, handleAssetDrop, clearDropPreview, dropPreview }`.

> Note on Esc-cancel: pressing Escape during a native drag fires `dragleave` → `clearDropPreview` runs via the existing `onDragLeave` wiring; no extra key handling needed. The one behavior change to wire in `Timeline.tsx:416`: `onDragLeave={() => clearDropPreview()}` instead of `onDragLeave={() => setIsDragOver(false)}` (same for the `TimelineEmptyState` at lines 384–391).

- [ ] **Step 2: Extend `displayTrackOrder` and pass the preview down (Timeline.tsx)**

Update the hook destructuring (line 371):

```typescript
  const { isDragOver, setIsDragOver: _setIsDragOver, handleAssetDragOver, handleAssetDrop, clearDropPreview, dropPreview } =
    useTimelineAssetDrop({ scrollRef, ppsRef, durationRef, trackOrderRef, onFileDrop, onAssetDrop, onBlockDrop });
```

Extend `displayTrackOrder` (lines 238–246) to also include the drop preview's pending track:

```typescript
  const displayTrackOrder = useMemo(() => {
    const pendingTracks: number[] = [];
    if (draggedClip?.started && !trackOrder.includes(draggedClip.previewTrack)) {
      pendingTracks.push(draggedClip.previewTrack);
    }
    if (dropPreview?.isNewTrack && !trackOrder.includes(dropPreview.track)) {
      pendingTracks.push(dropPreview.track);
    }
    if (trackOrder.length === 0 || pendingTracks.length === 0) return trackOrder;
    return [...new Set([...trackOrder, ...pendingTracks])].sort((a, b) => a - b);
  }, [draggedClip, dropPreview, trackOrder]);
```

Pass `dropPreview={dropPreview}` to `<TimelineCanvas …>` (props block starting line 432).

- [ ] **Step 3: Render ghost + row highlight + snap guide (TimelineCanvas.tsx)**

Add to `TimelineCanvasProps` (after `beatAnalysis` at line 95):

```typescript
  dropPreview: TimelineDropPreview | null;
```

with `import type { TimelineDropPreview } from "./timelineDropPreview";`.

Row highlight — inside the track row map (the row `<div>` at lines 218–226), extend the `style`:

```typescript
              style={{
                height: TRACK_H,
                background:
                  dropPreview?.track === trackNum
                    ? "rgba(60, 230, 172, 0.06)"
                    : rowBackground,
                borderBottom: `1px solid ${theme.rowBorder}`,
              }}
```

Ghost + snap guide — insert right before the existing `{/* Drag ghost */}` block (line 480):

```tsx
      {/* External drag-over drop preview */}
      {dropPreview && (
        <>
          <div
            className="absolute pointer-events-none rounded"
            style={{
              left: GUTTER + dropPreview.start * pps,
              top: RULER_H + displayTrackOrder.indexOf(dropPreview.track) * TRACK_H + CLIP_Y,
              width: Math.max(dropPreview.durationSec * pps, 4),
              height: TRACK_H - CLIP_Y * 2,
              border: "1px dashed rgba(60, 230, 172, 0.8)",
              background: "rgba(60, 230, 172, 0.12)",
              zIndex: 45,
              display: "flex",
              alignItems: "center",
              overflow: "hidden",
            }}
          >
            <span
              className="px-2 text-[10px] font-medium truncate"
              style={{ color: "rgba(60, 230, 172, 0.95)" }}
            >
              {dropPreview.label}
              {dropPreview.extraCount > 0 ? ` +${dropPreview.extraCount} more` : ""}
            </span>
          </div>
          {dropPreview.snapTime != null && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: GUTTER + dropPreview.snapTime * pps,
                top: RULER_H,
                bottom: 0,
                width: 1,
                background: dropPreview.snapType === "playhead" ? "#3CE6AC" : "rgba(255,255,255,0.6)",
                boxShadow: "0 0 6px rgba(60,230,172,0.5)",
                zIndex: 60,
              }}
            />
          )}
        </>
      )}
```

(When `dropPreview.isNewTrack`, `displayTrackOrder` from Step 2 already contains the pending track and the row map renders an extra empty row — the existing `isPendingTrack` "New track" label at lines 284–298 applies because the row has no clips; extend its condition at line 204–205 to also cover drop previews:)

```typescript
          const isPendingTrack =
            ((draggedClip?.started === true) || dropPreview?.isNewTrack === true) &&
            !trackOrder.includes(trackNum) &&
            els.length === 0;
```

- [ ] **Step 4: Run the player suite**

Run: `cd packages/studio && bunx vitest run src/player`
Expected: PASS.

- [ ] **Step 5: Manual verification (the money shot)**

Run the studio with a real project:
1. Drag an audio row from Assets over the timeline → translucent dashed ghost with the file name, sized to its real duration, follows the pointer; target row tints; nearing the playhead snaps the ghost with a green guide line.
2. Drag below the last row → a "New track" row appears and the ghost sits in it.
3. Drag a file from Finder → ghost appears with MIME-derived kind and 5s width; multi-file shows "+N more".
4. Drag a block from Catalog → ghost with block title.
5. Press Escape mid-drag → ghost clears. Drag out of the timeline → ghost clears.
6. Drop in all cases → clip lands exactly where the ghost showed (snapped), including on the new track.
7. Hold a drag at the right edge → timeline auto-scrolls.

- [ ] **Step 6: Lint, format, commit**

```bash
bunx oxlint packages/studio/src/player/components/timelineDragDrop.ts packages/studio/src/player/components/Timeline.tsx packages/studio/src/player/components/TimelineCanvas.tsx
bunx oxfmt packages/studio/src/player/components/timelineDragDrop.ts packages/studio/src/player/components/Timeline.tsx packages/studio/src/player/components/TimelineCanvas.tsx
git add -A packages/studio/src
git commit -m "feat(studio): live drop ghost with snapping, row highlight, new-track row, edge auto-scroll"
```

---

### Task 7: Production-quality inserted markup (hf-id, volume, fitted geometry)

**Files:**
- Modify: `packages/studio/src/utils/timelineAssetDrop.ts` (`buildTimelineAssetInsertHtml` at lines 99–122, `resolveTimelineAssetInitialGeometry` at lines 82–97)
- Modify: `packages/studio/src/utils/studioHelpers.ts` (add `resolveDroppedAssetDimensions` next to `resolveDroppedAssetDuration` at line 244)
- Modify: `packages/studio/src/hooks/useTimelineEditing.ts` (`handleTimelineAssetDrop` at lines 408–491)
- Test: `packages/studio/src/utils/timelineAssetDrop.test.ts` (extend existing)

**Interfaces:**
- Consumes: `generateId` from `../utils/generateId` (existing).
- Produces:
  - `buildTimelineAssetInsertHtml` input gains `hfId: string` and emits `data-hf-id="…"` on all three kinds; audio additionally emits `data-volume="1"`.
  - `fitTimelineAssetGeometry(natural: { width: number; height: number } | null, comp: { width: number; height: number }): { left: number; top: number; width: number; height: number }` — contain-fit at natural size capped to the composition, centered; `null` natural → full-frame at composition size (current behavior).
  - `resolveTimelineAssetCompositionSize(source: string): { width: number; height: number }` — extracted from the current `resolveTimelineAssetInitialGeometry` (which is then deleted; its two call sites migrate).
  - `resolveDroppedAssetDimensions(projectId: string, assetPath: string, kind: TimelineAssetKind): Promise<{ width: number; height: number } | null>` in `studioHelpers.ts` — loads `<img>`/`<video>` metadata like `resolveDroppedAssetDuration` does (3s timeout → `null`); returns `null` for audio.

- [ ] **Step 1: Write the failing tests** (append to `timelineAssetDrop.test.ts`)

```typescript
import { buildTimelineAssetInsertHtml, fitTimelineAssetGeometry } from "./timelineAssetDrop";

describe("buildTimelineAssetInsertHtml markup quality", () => {
  const base = {
    id: "clip_1",
    hfId: "hf-test-1",
    assetPath: "assets/a.mp4",
    start: 1,
    duration: 4,
    track: 2,
    zIndex: 3,
  };

  it("stamps data-hf-id on all kinds", () => {
    for (const kind of ["image", "video", "audio"] as const) {
      expect(buildTimelineAssetInsertHtml({ ...base, kind })).toContain('data-hf-id="hf-test-1"');
    }
  });

  it("audio gets an explicit data-volume", () => {
    expect(buildTimelineAssetInsertHtml({ ...base, kind: "audio" })).toContain('data-volume="1"');
  });
});

describe("fitTimelineAssetGeometry", () => {
  const comp = { width: 1920, height: 1080 };

  it("centers a smaller-than-comp asset at natural size", () => {
    expect(fitTimelineAssetGeometry({ width: 640, height: 360 }, comp)).toEqual({
      left: 640, top: 360, width: 640, height: 360,
    });
  });

  it("scales an oversized asset down to fit, preserving aspect, centered", () => {
    // 4000x1000 → capped to 1920 wide → 1920x480, centered vertically
    expect(fitTimelineAssetGeometry({ width: 4000, height: 1000 }, comp)).toEqual({
      left: 0, top: 300, width: 1920, height: 480,
    });
  });

  it("falls back to full-frame when natural size is unknown", () => {
    expect(fitTimelineAssetGeometry(null, comp)).toEqual({
      left: 0, top: 0, width: 1920, height: 1080,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/studio && bunx vitest run src/utils/timelineAssetDrop.test.ts`
Expected: FAIL — `hfId` not in input type / `fitTimelineAssetGeometry` not exported.

- [ ] **Step 3: Implement in `timelineAssetDrop.ts`**

Replace `resolveTimelineAssetInitialGeometry` (lines 82–97) with:

```typescript
export function resolveTimelineAssetCompositionSize(source: string): {
  width: number;
  height: number;
} {
  const width = Number.parseFloat(source.match(/\bdata-width=(["'])([^"']+)\1/i)?.[2] ?? "");
  const height = Number.parseFloat(source.match(/\bdata-height=(["'])([^"']+)\1/i)?.[2] ?? "");
  return {
    width: Number.isFinite(width) && width > 0 ? Math.round(width) : 640,
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : 360,
  };
}

/**
 * CapCut-style placement: natural size when it fits, scaled-to-fit when
 * oversized, always centered. Unknown natural size → full-frame.
 */
export function fitTimelineAssetGeometry(
  natural: { width: number; height: number } | null,
  comp: { width: number; height: number },
): { left: number; top: number; width: number; height: number } {
  if (!natural || natural.width <= 0 || natural.height <= 0) {
    return { left: 0, top: 0, width: comp.width, height: comp.height };
  }
  const scale = Math.min(1, comp.width / natural.width, comp.height / natural.height);
  const width = Math.round(natural.width * scale);
  const height = Math.round(natural.height * scale);
  return {
    left: Math.round((comp.width - width) / 2),
    top: Math.round((comp.height - height) / 2),
    width,
    height,
  };
}
```

In `buildTimelineAssetInsertHtml` (lines 99–122): add `hfId: string;` to the input type, and change:

```typescript
  const sharedAttrs = `id="${input.id}" data-hf-id="${input.hfId}" class="clip" src="${input.assetPath}" data-start="${input.start}" data-duration="${input.duration}" data-track-index="${input.track}"`;
```

and the audio branch:

```typescript
  return `<audio ${sharedAttrs} data-volume="1" style="z-index: ${input.zIndex}"></audio>`;
```

- [ ] **Step 4: Add `resolveDroppedAssetDimensions` to `studioHelpers.ts`** (below `resolveDroppedAssetDuration`, reusing its element-metadata pattern from lines 244–281)

```typescript
export async function resolveDroppedAssetDimensions(
  projectId: string,
  assetPath: string,
  kind: TimelineAssetKind,
): Promise<{ width: number; height: number } | null> {
  if (kind === "audio") return null;
  const src = `/api/projects/${projectId}/preview/${assetPath}`;

  if (kind === "image") {
    return new Promise((resolve) => {
      const img = new Image();
      const timeout = window.setTimeout(() => resolve(null), 3000);
      img.addEventListener("load", () => {
        window.clearTimeout(timeout);
        resolve(
          img.naturalWidth > 0 && img.naturalHeight > 0
            ? { width: img.naturalWidth, height: img.naturalHeight }
            : null,
        );
      }, { once: true });
      img.addEventListener("error", () => {
        window.clearTimeout(timeout);
        resolve(null);
      }, { once: true });
      img.src = src;
    });
  }

  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    const timeout = window.setTimeout(() => resolve(null), 3000);
    const finalize = (value: { width: number; height: number } | null) => {
      window.clearTimeout(timeout);
      video.src = "";
      video.load();
      resolve(value);
    };
    video.addEventListener("loadedmetadata", () => {
      finalize(
        video.videoWidth > 0 && video.videoHeight > 0
          ? { width: video.videoWidth, height: video.videoHeight }
          : null,
      );
    }, { once: true });
    video.addEventListener("error", () => finalize(null), { once: true });
    video.src = src;
  });
}
```

- [ ] **Step 5: Wire into `handleTimelineAssetDrop` (`useTimelineEditing.ts:408–491`)**

Add imports: `generateId` from `../utils/generateId`, `resolveDroppedAssetDimensions` from `../utils/studioHelpers`, and swap `resolveTimelineAssetInitialGeometry` for `resolveTimelineAssetCompositionSize` + `fitTimelineAssetGeometry` from `../utils/timelineAssetDrop`.

Inside the handler, after `const newId = …` (line 438):

```typescript
        const hfId = `hf-${generateId()}`;
        const compSize = resolveTimelineAssetCompositionSize(originalContent);
        const natural =
          kind === "audio" ? null : await resolveDroppedAssetDimensions(pid, assetPath, kind);
```

and in the `buildTimelineAssetInsertHtml` call (lines 449–458) pass:

```typescript
            hfId,
            geometry: fitTimelineAssetGeometry(natural, compSize),
```

(delete the old `geometry: resolveTimelineAssetInitialGeometry(originalContent)` line). Update any other `resolveTimelineAssetInitialGeometry` call sites (grep: `grep -rn resolveTimelineAssetInitialGeometry packages/studio/src` — `blockInstaller.ts` may use the composition-size part; migrate those to `resolveTimelineAssetCompositionSize` with `{left:0, top:0, …}` semantics preserved).

- [ ] **Step 6: Run tests**

Run: `cd packages/studio && bunx vitest run src/utils/timelineAssetDrop.test.ts src/hooks`
Expected: PASS (fix any existing `buildTimelineAssetInsertHtml` test fixtures that now need the `hfId` field — update them deliberately).

- [ ] **Step 7: Manual verification**

Drop a small PNG → it appears centered at natural size (not full-frame at 0,0). Drop a 4K video into a 1080p comp → scaled to fit, centered. View source: elements carry `data-hf-id`; audio carries `data-volume="1"`. Move the new clip on the timeline → persists correctly (hf-id is the preferred patch target).

- [ ] **Step 8: Lint, format, commit**

```bash
bunx oxlint packages/studio/src/utils/timelineAssetDrop.ts packages/studio/src/utils/studioHelpers.ts packages/studio/src/hooks/useTimelineEditing.ts
bunx oxfmt packages/studio/src/utils/timelineAssetDrop.ts packages/studio/src/utils/studioHelpers.ts packages/studio/src/hooks/useTimelineEditing.ts packages/studio/src/utils/timelineAssetDrop.test.ts
git add -A packages/studio/src
git commit -m "feat(studio): dropped assets get data-hf-id, audio volume, centered fitted geometry"
```

---

### Task 8: "Add at playhead" from asset cards

**Files:**
- Modify: `packages/studio/src/hooks/useTimelineEditing.ts` (new `handleAddAssetAtPlayhead`, returned from the hook at lines 565–577)
- Modify: `packages/studio/src/App.tsx` (thread the new callback into the left sidebar wiring)
- Modify: `packages/studio/src/components/StudioLeftSidebar.tsx`, `packages/studio/src/components/sidebar/LeftSidebar.tsx` (prop pass-through; AssetsTab usage at `LeftSidebar.tsx:227–233`)
- Modify: `packages/studio/src/components/sidebar/AssetsTab.tsx` (ImageCard context menu; `AssetsTabProps` at lines 20–26), `packages/studio/src/components/sidebar/AudioRow.tsx` (same)

**Interfaces:**
- Consumes: `handleTimelineAssetDrop` (existing), `buildTimelineFileDropPlacements` + `getTimelineAssetKind` from `../utils/timelineAssetDrop`, `resolveDroppedAssetDuration` from `../utils/studioHelpers`, `usePlayerStore`.
- Produces: `handleAddAssetAtPlayhead(assetPath: string): Promise<void>` on the `useTimelineEditing` return value; prop `onAddAssetToTimeline?: (path: string) => void` threaded to `AssetsTab`.

- [ ] **Step 1: Implement `handleAddAssetAtPlayhead` in `useTimelineEditing.ts`**

Add after `handleTimelineFileDrop` (line 543):

```typescript
  const handleAddAssetAtPlayhead = useCallback(
    async (assetPath: string) => {
      const pid = projectIdRef.current;
      if (!pid) return;
      const kind = getTimelineAssetKind(assetPath);
      if (!kind) {
        showToast("Only image, video, and audio assets can be added to the timeline.");
        return;
      }
      const start = usePlayerStore.getState().currentTime;
      const duration = await resolveDroppedAssetDuration(pid, assetPath, kind);
      const resolvedTargetPath = activeCompPath || "index.html";
      const occupied = timelineElements
        .filter((te) => (te.sourceFile || activeCompPath || "index.html") === resolvedTargetPath)
        .map((te) => ({ start: te.start, duration: te.duration, track: te.track }));
      // Reuse the file-drop placement rule: target track 0, bump to a clear
      // track when the span overlaps (FCP-style "never reject").
      const [placement] = buildTimelineFileDropPlacements({ start, track: 0 }, [duration], occupied);
      await handleTimelineAssetDrop(assetPath, placement, duration);
    },
    [activeCompPath, handleTimelineAssetDrop, showToast, timelineElements],
  );
```

(`getTimelineAssetKind`, `buildTimelineFileDropPlacements`, `resolveDroppedAssetDuration`, `usePlayerStore` are already imported in this file — verify and add any missing to the import lists at the top.) Add `handleAddAssetAtPlayhead` to the hook's return object (lines 565–577).

- [ ] **Step 2: Thread the prop**

- `App.tsx`: locate where `<StudioLeftSidebar …>` receives its props (grep `onImportFiles` in App.tsx to find the wiring) and add `onAddAssetToTimeline={timelineEditing.handleAddAssetAtPlayhead}`.
- `StudioLeftSidebar.tsx`: accept `onAddAssetToTimeline?: (path: string) => void` and pass to `<LeftSidebar …>`.
- `LeftSidebar.tsx`: accept it and pass to `<AssetsTab … onAddAssetToTimeline={onAddAssetToTimeline} />` (line 227–233).
- `AssetsTab.tsx`: add to `AssetsTabProps` (line 20–26) and to `AssetsTab`'s destructuring (line 222–228); pass down into `ImageCard` and `AudioRow` where `onDelete`/`onRename` already flow (lines 169–170, 554–555).

- [ ] **Step 3: Add the menu entry**

In `ImageCard`'s context menu (rendered from the `contextMenu` state, alongside the existing Copy path / Delete / Rename items — locate the menu JSX below line 60), add as the **first** item:

```tsx
            {onAddAssetToTimeline && (
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-[11px] text-neutral-200 hover:bg-neutral-800"
                onClick={() => {
                  onAddAssetToTimeline(asset);
                  setContextMenu(null);
                }}
              >
                Add at playhead
              </button>
            )}
```

(match the exact classNames of the sibling menu items in that file — copy the Delete item's classes if they differ from the above). Do the same in `AudioRow`'s context menu.

- [ ] **Step 4: Manual verification**

Right-click an image in Assets → "Add at playhead" → clip appears starting at the playhead on the lowest clear track, centered geometry (Task 7). With a clip already occupying that span, the new clip lands on a bumped track instead. Toast on non-media files.

- [ ] **Step 5: Run hooks tests, lint, format, commit**

```bash
cd packages/studio && bunx vitest run src/hooks && cd ../..
bunx oxlint packages/studio/src/hooks/useTimelineEditing.ts packages/studio/src/components/sidebar/AssetsTab.tsx packages/studio/src/components/sidebar/AudioRow.tsx packages/studio/src/components/StudioLeftSidebar.tsx packages/studio/src/components/sidebar/LeftSidebar.tsx packages/studio/src/App.tsx
bunx oxfmt packages/studio/src/hooks/useTimelineEditing.ts packages/studio/src/components/sidebar/AssetsTab.tsx packages/studio/src/components/sidebar/AudioRow.tsx packages/studio/src/components/StudioLeftSidebar.tsx packages/studio/src/components/sidebar/LeftSidebar.tsx packages/studio/src/App.tsx
git add -A packages/studio/src
git commit -m "feat(studio): add-at-playhead action on asset cards"
```

---

### Task 9: Global OS file drop places at playhead

**Files:**
- Modify: `packages/studio/src/hooks/useStudioContextValue.ts` (`useDragOverlay` at lines 106–134)
- Modify: `packages/studio/src/App.tsx` (line ~362: `useDragOverlay(fileManager.handleImportFiles)`)
- Modify: `packages/studio/src/components/StudioGlobalDragOverlay.tsx` (copy text)

**Interfaces:**
- Consumes: `handleTimelineFileDrop(files, placement?)` from `useTimelineEditing` (existing — uploads then places with collision bump), `usePlayerStore` for `currentTime`.
- Produces: no new exports; behavior change only. Timeline-targeted drops still win (they `preventDefault()` first; the global handler already checks `e.defaultPrevented`).

- [ ] **Step 1: Change the App wiring**

In `App.tsx`, replace the `useDragOverlay(fileManager.handleImportFiles)` call with a placing callback:

```typescript
  const handleGlobalFileDrop = useCallback(
    (files: FileList) => {
      // CapCut behavior: dropping media anywhere imports AND places at the playhead.
      // handleTimelineFileDrop uploads first, then sequences clips from the given
      // start, bumping to a clear track on overlap.
      const start = usePlayerStore.getState().currentTime;
      void timelineEditing.handleTimelineFileDrop(Array.from(files), { start, track: 0 });
    },
    [timelineEditing],
  );
  const dragOverlay = useDragOverlay(handleGlobalFileDrop);
```

(`usePlayerStore` import path in App.tsx: `./player` — match the file's existing import if present.) Note `handleTimelineFileDrop` skips non-media files' placement (kind `null` → duration 0 and `handleTimelineAssetDrop` toasts) while the upload still succeeds — fonts dropped globally still land in the project, matching today's import behavior closely enough.

- [ ] **Step 2: Update the overlay copy**

In `StudioGlobalDragOverlay.tsx`, change the label text `"Drop files to import into project"` to `"Drop to add at the playhead"` (keep the visual structure).

- [ ] **Step 3: Manual verification**

Drop a video from Finder onto the preview area (not the timeline) → uploads and appears on the timeline starting at the playhead. Drop onto the timeline itself → still lands at the drop position (timeline handler wins). Drop onto the Assets tab → import-only (panel handler wins). Drop a `.ttf` → imported, toast about non-timeline asset.

- [ ] **Step 4: Lint, format, commit**

```bash
bunx oxlint packages/studio/src/App.tsx packages/studio/src/components/StudioGlobalDragOverlay.tsx packages/studio/src/hooks/useStudioContextValue.ts
bunx oxfmt packages/studio/src/App.tsx packages/studio/src/components/StudioGlobalDragOverlay.tsx packages/studio/src/hooks/useStudioContextValue.ts
git add -A packages/studio/src
git commit -m "feat(studio): global OS file drop imports and places at the playhead"
```

---

### Task 10: Integration pass — full suite, lint sweep, QA checklist

**Files:** none new; fixes only.

- [ ] **Step 1: Full studio test suite**

Run: `cd packages/studio && bun run test`
Expected: PASS. Fix any fallout (most likely: stale `snapBeatTime` references, `buildTimelineAssetInsertHtml` fixtures missing `hfId`).

- [ ] **Step 2: Workspace build + lint**

```bash
bun run build
bunx oxlint packages/studio/src
```
Expected: build succeeds; no new lint errors (`fallow-ignore` complexity annotations may need extending if a modified function crossed the threshold — prefer extracting a helper over adding an ignore).

- [ ] **Step 3: Full manual QA sweep** (studio running against a real project with clips + music)

| # | Scenario | Expected |
|---|---|---|
| 1 | Drag clip near playhead / other clip edge / beat | snaps with green/white guide or beat glow |
| 2 | `N` / magnet button | disables all snapping incl. drops; persists across reload |
| 3 | Trim edges near targets | same snapping, clamps intact (no negative playbackStart) |
| 4 | Drag asset card over timeline | ghost with real duration + label, row tint, snap guide |
| 5 | Drag OS file(s) over timeline | ghost from MIME hint, "+N more" for multi |
| 6 | Drag below last row | "New track" row + ghost in it; drop creates the track |
| 7 | Drag block card to timeline and to canvas | installs at drop position / drop point |
| 8 | Drop → position | lands exactly where the ghost showed |
| 9 | Esc / drag-out mid-drag | ghost clears, nothing inserted |
| 10 | Hold drag at right edge | auto-scroll |
| 11 | Drop small PNG / oversized video | centered natural size / scaled-to-fit centered |
| 12 | Inserted markup | `data-hf-id` present; audio `data-volume="1"` |
| 13 | Assets context menu → Add at playhead | clip at playhead, clear track |
| 14 | OS drop on preview area | import + place at playhead |
| 15 | Undo after each insert | removes the clip cleanly |
| 16 | Music clip drag | snaps to playhead/edges but never to beats |

- [ ] **Step 4: Commit any fixes; done**

```bash
git add -A && git commit -m "test(studio): integration fixes for timeline drop experience"
```

---

## Self-review notes (already applied)

- Spec coverage: G-1 (T6), G-2 (T1–T3, T5–T6), G-3 (T8), G-4 (T8 reuses the bump rule; full insert/overwrite semantics deferred to Plan 3's track model by design), G-5 (T9), G-6 (T4), G-8/G-9/G-10 (T7), G-18 (T6: auto-scroll + Esc-via-dragleave; settle animation deliberately dropped as low-value polish).
- Beat-time remapping for **drop** snapping is intentionally skipped (drops snap to playhead + clip edges only) because the composition-remapped beat times live inside `useTimelineClipDrag`'s memo; lifting them is noted inline in Task 6 code comments as follow-up if beat-snapped drops are wanted.
- Type consistency: `TimelineSnapTarget/TimelineSnapType` (T1) are the single source used by T3, T5, T6; `DragSessionPayload` (T4) used by T5, T6; `TimelineDropPreview` (T5) used by T6; `hfId` (T7) threaded from `useTimelineEditing`.
- Line numbers reference `main @ cebce603d`; re-anchor by symbol name if the file has drifted.
