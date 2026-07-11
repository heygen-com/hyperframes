import { useCallback } from "react";
import type { MutableRefObject, RefObject } from "react";
import { usePlayerStore } from "../player";
import type { TimelineElement } from "../player";
import { furthestClipEndFromSource } from "../player/lib/timelineElementHelpers";
import type { EditHistoryKind } from "../utils/editHistory";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import { setCompositionDurationToContent } from "../utils/timelineAssetDrop";
import {
  applyPatchByTarget,
  buildPatchTarget,
  buildTimelineMoveTimingPatch,
  patchIframeDomTiming,
  patchIframeRootDuration,
  readFileContent,
  shiftGsapPositionsBatch,
  syncTimingEditPreview,
  type GsapMutationOutcome,
} from "./timelineEditingHelpers";

/** One clip's timing change in a batched move. */
export interface TimelineElementMoveEdit {
  element: TimelineElement;
  updates: Pick<TimelineElement, "start" | "track">;
}

export interface PersistTimelineElementsMoveDeps {
  projectId: string;
  activeCompPath: string | null;
  previewIframe: HTMLIFrameElement | null;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (input: {
    label: string;
    kind: EditHistoryKind;
    coalesceKey?: string;
    files: Record<string, { before: string; after: string }>;
  }) => Promise<void>;
  reloadPreview: () => void;
  forceReloadSdkSession?: () => void;
  domEditSaveTimestampRef: MutableRefObject<number>;
}

interface MoveGroupResult {
  targetPath: string;
  original: string;
  patched: string;
  groupEdits: TimelineElementMoveEdit[];
}

/** Group edits by owning source file (in practice one composition file). Each
 *  group becomes one atomic read/patch/write/shift/reload cycle. */
function groupEditsByFile(
  edits: TimelineElementMoveEdit[],
  activeCompPath: string | null,
): Map<string, TimelineElementMoveEdit[]> {
  const groups = new Map<string, TimelineElementMoveEdit[]>();
  for (const edit of edits) {
    const targetPath = edit.element.sourceFile || activeCompPath || "index.html";
    const bucket = groups.get(targetPath);
    if (bucket) bucket.push(edit);
    else groups.set(targetPath, [edit]);
  }
  return groups;
}

/** Patch one group's source in memory: every clip's start/track attributes. */
function applyGroupTimingPatches(source: string, groupEdits: TimelineElementMoveEdit[]): string {
  let patched = source;
  for (const { element, updates } of groupEdits) {
    const target = buildPatchTarget(element);
    if (!target) continue;
    // buildTimelineMoveTimingPatch drops any non-finite field (#2212 NaN guard),
    // so a bad {start|track} never gets serialized into data-* here.
    for (const patch of buildTimelineMoveTimingPatch(updates)) {
      patched = applyPatchByTarget(patched, target, {
        type: "attribute",
        property: patch.property,
        value: patch.value,
      });
    }
  }
  return patched;
}

/**
 * Phase 1 — patch every group's source in memory (nothing written yet, so a
 * patch failure or no-op can't leave disk half-updated). Also syncs the root's
 * content-driven duration and optimistically reflects the displayed comp's new
 * length in the store + live root. Returns the collected results for one atomic
 * save.
 */
async function patchTimelineMoveGroups(
  groups: Map<string, TimelineElementMoveEdit[]>,
  deps: Pick<PersistTimelineElementsMoveDeps, "projectId" | "activeCompPath" | "previewIframe">,
): Promise<{
  groupResults: MoveGroupResult[];
  filesToSave: Record<string, string>;
  originals: Map<string, string>;
  /** True if the optimistic root-duration set below ran (must be rolled back on a
   *  failed write, same as the caller rolls back start/track). */
  durationChanged: boolean;
}> {
  const groupResults: MoveGroupResult[] = [];
  const filesToSave: Record<string, string> = {};
  const originals = new Map<string, string>();
  let durationChanged = false;
  for (const [targetPath, groupEdits] of groups) {
    const original = await readFileContent(deps.projectId, targetPath);
    let patched = applyGroupTimingPatches(original, groupEdits);
    // Content-driven duration: sync root data-duration to the furthest clip end,
    // read from the PATCHED SOURCE (raw data-duration), not the store — the store
    // holds runtime-TRUNCATED durations, so measuring content from it would feed
    // the truncated value back in and shrink the comp every move.
    const contentEnd = furthestClipEndFromSource(patched);
    patched = setCompositionDurationToContent(patched, contentEnd);
    if (patched === original) continue;

    // Optimistically reflect the new length in the store + live root so the
    // duration readout / seek bar update immediately (a batched move soft-reloads,
    // so a stale root would revert this set). Only for the displayed comp.
    if (contentEnd > 0 && targetPath === (deps.activeCompPath || "index.html")) {
      usePlayerStore.getState().setDuration(contentEnd);
      patchIframeRootDuration(deps.previewIframe, contentEnd);
      durationChanged = true;
    }

    groupResults.push({ targetPath, original, patched, groupEdits });
    filesToSave[targetPath] = patched;
    originals.set(targetPath, original);
  }
  return { groupResults, filesToSave, originals, durationChanged };
}

/** The batched GSAP position shifts for one group's clips whose start changed. */
function groupGsapShifts(group: MoveGroupResult): Array<{ elementId: string; delta: number }> {
  return group.groupEdits
    .filter((e) => e.element.domId && e.updates.start - e.element.start !== 0)
    .map((e) => ({
      elementId: e.element.domId as string,
      delta: e.updates.start - e.element.start,
    }));
}

/**
 * Phase 3 — post-save preview sync.
 *
 * `shiftGsapPositionsBatch` is a DURABLE server mutation (shift-positions-batch →
 * file write) that rewrites each file's GSAP tween positions to match the moved
 * clip timings. It is NOT a cosmetic preview step, so it must run for EVERY changed
 * group (against that group's own targetPath). Skipping it for a non-active group
 * leaves that file's persisted clip timings out of sync with its GSAP script
 * PERMANENTLY — a reload re-reads the same desynced file, so it never heals. (Only
 * the endpoint FAILING is non-fatal and logged: the write simply didn't happen.)
 *
 * The preview is a SINGLE shared iframe showing the ACTIVE composition, so only the
 * active comp's group can be soft-reloaded (its rewritten script swapped in place).
 * If any OTHER file changed too — e.g. a sub-comp group in a multi-file move — a
 * per-group soft-reload would either apply that file's script to the wrong (root)
 * document or fire a second clobbering reloadPreview; do ONE full reload instead so
 * every changed file is reflected.
 */
async function syncTimelineMovePreviews(
  groupResults: MoveGroupResult[],
  deps: Pick<
    PersistTimelineElementsMoveDeps,
    "projectId" | "activeCompPath" | "previewIframe" | "reloadPreview"
  >,
): Promise<void> {
  const activePath = deps.activeCompPath || "index.html";
  const activeGroup = groupResults.find((g) => g.targetPath === activePath);
  const otherFileChanged = groupResults.some((g) => g.targetPath !== activePath);

  // Run the durable batch shift for every changed group, each against its own file.
  let activeShiftOutcome: GsapMutationOutcome = { scriptText: null };
  for (const group of groupResults) {
    const shifts = groupGsapShifts(group);
    if (shifts.length === 0) continue;
    const outcome = await shiftGsapPositionsBatch(deps.projectId, group.targetPath, shifts).catch(
      (err) => {
        console.error("[Timeline] Failed to batch-shift GSAP positions", err);
        return { scriptText: null };
      },
    );
    if (group === activeGroup) activeShiftOutcome = outcome;
  }

  if (otherFileChanged || !activeGroup) {
    // A non-active file changed (or nothing touched the active comp) — the shared
    // iframe can't soft-reload those, so full-reload once to reflect them all. The
    // durable shifts above have already been written to every file.
    deps.reloadPreview();
    return;
  }

  // Only the active comp changed → soft-reload with its rewritten script — a
  // multi-clip move is timing-only (DOM + store already patched), so swap the script
  // in place to avoid the all-clips flash; full reload is the fallback.
  syncTimingEditPreview(
    deps.previewIframe,
    activeShiftOutcome,
    usePlayerStore.getState().currentTime,
    deps.reloadPreview,
  );
}

/**
 * Persist a multi-clip timeline move as ONE atomic, single-undo operation.
 *
 * This is the fix for the per-clip persist race (research HANDOFF §7.1): the old
 * path fired one fire-and-forget `onMoveElement` per clip, each doing its own
 * source-write + GSAP shift + reload, and the concurrent GSAP round-trips
 * corrupted the file. Here every affected clip is folded into a single read →
 * patch-all → write → one batched GSAP shift → one reload. Clips are grouped per
 * owning source file for patching + preview sync, but ALL groups are written in a
 * single atomic save with ONE history entry, so a multi-file move (clips spanning
 * sub-comps) is all-or-nothing on disk and one undo step. Mirrors the atomic
 * pattern already used by delete / asset-drop.
 *
 * Note: this always takes the server path. Single-clip moves keep their existing
 * SDK-cutover-aware handler; multi-clip ripple/insert is new behavior with no
 * prior SDK expectation. When SDK cutover ships, add an sdkSession.batch() branch
 * here for single-undo atomicity on that path too.
 *
 * Throws if a source write fails (so the caller can roll back its optimistic
 * store update). A GSAP shift-batch ENDPOINT failure is logged, not thrown (matches
 * the single-clip path) — but note it does NOT self-heal: shiftGsapPositionsBatch is
 * a durable file rewrite, so if it fails the file's tween positions stay desynced
 * from the clip timings until the next successful shift; a reload just re-reads the
 * un-rewritten file. The console error is the signal.
 */
export async function persistTimelineElementsMove(
  edits: TimelineElementMoveEdit[],
  deps: PersistTimelineElementsMoveDeps,
  coalesceKey?: string,
): Promise<void> {
  if (edits.length === 0) return;
  const {
    projectId,
    activeCompPath,
    previewIframe,
    writeProjectFile,
    recordEdit,
    reloadPreview,
    forceReloadSdkSession,
    domEditSaveTimestampRef,
  } = deps;

  // 1. Optimistic live DOM patch — instant feedback before the write lands.
  //    Non-finite fields are dropped by buildTimelineMoveTimingPatch (#2212).
  for (const { element, updates } of edits) {
    patchIframeDomTiming(
      previewIframe,
      element,
      buildTimelineMoveTimingPatch(updates).map((p): [string, string] => [p.attr, p.value]),
    );
  }

  // Phase 1 — group by owning file and patch each group's source in memory.
  const groups = groupEditsByFile(edits, activeCompPath);
  const previousDuration = usePlayerStore.getState().duration;
  const { groupResults, filesToSave, originals, durationChanged } = await patchTimelineMoveGroups(
    groups,
    { projectId, activeCompPath, previewIframe },
  );

  if (groupResults.length === 0) return;

  // Phase 2 — ONE atomic write of every affected file + ONE history entry.
  // saveProjectFilesWithHistory writes all files then records a single edit,
  // and rolls back every written file if any write fails. This is the fix for
  // the per-group persist gap: a multi-file move (clips spanning sub-comps)
  // previously did N writes + N history entries, so a partial failure left
  // earlier files written + a stray history entry while the caller rolled the
  // store all the way back. All-or-nothing on disk now matches the caller's
  // all-or-nothing store rollback, and undo is a single step.
  domEditSaveTimestampRef.current = Date.now();
  try {
    await saveProjectFilesWithHistory({
      projectId,
      label: edits.length > 1 ? "Move timeline clips" : "Move timeline clip",
      kind: "timeline",
      // Shared per-gesture key (from the drag commit) so a lane change's move
      // entry merges with its follow-up z-reorder entry into one undo step.
      coalesceKey,
      // The z entry lands only after this persist's round-trip — the default
      // 300ms merge window can miss it, silently splitting the gesture into two
      // undo steps. A generous window keeps the pair one step (same key required).
      coalesceMs: coalesceKey ? 5000 : undefined,
      files: filesToSave,
      readFile: async (path) => originals.get(path) ?? "",
      writeFile: writeProjectFile,
      recordEdit,
    });
  } catch (error) {
    // Revert the optimistic live-iframe timing attrs patched in step 1. The caller
    // rolls back the store's {start,track}, but the iframe DOM would otherwise keep
    // the un-persisted values (data-start/data-track-index the saved source never
    // got), desyncing the preview from disk until the next reload. The element's own
    // pre-move start/track are the restore values (always finite).
    for (const { element } of edits) {
      patchIframeDomTiming(
        previewIframe,
        element,
        buildTimelineMoveTimingPatch({ start: element.start, track: element.track }).map(
          (p): [string, string] => [p.attr, p.value],
        ),
      );
    }
    // Roll back the optimistic root-duration set alongside the caller's start/track
    // rollback — otherwise a failed write leaves the store + live root advertising a
    // duration the saved source never got.
    if (durationChanged) {
      usePlayerStore.getState().setDuration(previousDuration);
      patchIframeRootDuration(previewIframe, previousDuration);
    }
    throw error;
  }

  // Phase 3 — post-save preview sync.
  forceReloadSdkSession?.();
  await syncTimelineMovePreviews(groupResults, {
    projectId,
    activeCompPath,
    previewIframe,
    reloadPreview,
  });
}

export interface UseTimelineElementsMoveDeps {
  projectIdRef: MutableRefObject<string | null>;
  activeCompPath: string | null;
  previewIframeRef: RefObject<HTMLIFrameElement | null>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: PersistTimelineElementsMoveDeps["recordEdit"];
  reloadPreview: () => void;
  forceReloadSdkSession?: () => void;
  domEditSaveTimestampRef: MutableRefObject<number>;
  isRecordingRef?: RefObject<boolean>;
  showToast: (message: string, tone?: "error" | "info") => void;
}

/** React wrapper: guards (recording / no-project) + binds the current refs. */
export function useTimelineElementsMove(deps: UseTimelineElementsMoveDeps) {
  const {
    projectIdRef,
    activeCompPath,
    previewIframeRef,
    writeProjectFile,
    recordEdit,
    reloadPreview,
    forceReloadSdkSession,
    domEditSaveTimestampRef,
    isRecordingRef,
    showToast,
  } = deps;
  return useCallback(
    (edits: TimelineElementMoveEdit[], coalesceKey?: string): Promise<void> => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return Promise.resolve();
      }
      const pid = projectIdRef.current;
      if (!pid) return Promise.resolve();
      return persistTimelineElementsMove(
        edits,
        {
          projectId: pid,
          activeCompPath,
          previewIframe: previewIframeRef.current,
          writeProjectFile,
          recordEdit,
          reloadPreview,
          forceReloadSdkSession,
          domEditSaveTimestampRef,
        },
        coalesceKey,
      );
    },
    [
      projectIdRef,
      activeCompPath,
      previewIframeRef,
      writeProjectFile,
      recordEdit,
      reloadPreview,
      forceReloadSdkSession,
      domEditSaveTimestampRef,
      isRecordingRef,
      showToast,
    ],
  );
}
