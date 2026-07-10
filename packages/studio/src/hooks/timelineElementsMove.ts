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
  formatTimelineAttributeNumber,
  patchIframeDomTiming,
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
 * store update). GSAP-shift failures are logged, not thrown (matches the
 * single-clip path — a shift miss is non-fatal, the next reload re-syncs).
 */
export async function persistTimelineElementsMove(
  edits: TimelineElementMoveEdit[],
  deps: PersistTimelineElementsMoveDeps,
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
  for (const { element, updates } of edits) {
    patchIframeDomTiming(previewIframe, element, [
      ["data-start", formatTimelineAttributeNumber(updates.start)],
      ["data-track-index", String(updates.track)],
    ]);
  }

  // Group by owning source file (in practice one composition file). Each group
  // is one atomic read/patch/write/shift/reload cycle.
  const groups = new Map<string, TimelineElementMoveEdit[]>();
  for (const edit of edits) {
    const targetPath = edit.element.sourceFile || activeCompPath || "index.html";
    const bucket = groups.get(targetPath);
    if (bucket) bucket.push(edit);
    else groups.set(targetPath, [edit]);
  }

  // Phase 1 — patch every group's source in memory. Nothing is written yet, so a
  // patch failure here (or a no-op) cannot leave the disk half-updated. The
  // per-group results (rewritten content + the `original` used for history) are
  // collected so ALL files land in ONE atomic save below.
  const groupResults: {
    targetPath: string;
    original: string;
    patched: string;
    groupEdits: TimelineElementMoveEdit[];
  }[] = [];
  const filesToSave: Record<string, string> = {};
  const originals = new Map<string, string>();
  for (const [targetPath, groupEdits] of groups) {
    const original = await readFileContent(projectId, targetPath);
    let patched = original;
    for (const { element, updates } of groupEdits) {
      const target = buildPatchTarget(element);
      if (!target) continue;
      patched = applyPatchByTarget(patched, target, {
        type: "attribute",
        property: "start",
        value: formatTimelineAttributeNumber(updates.start),
      });
      patched = applyPatchByTarget(patched, target, {
        type: "attribute",
        property: "track-index",
        value: String(updates.track),
      });
    }
    // Content-driven duration: sync the root data-duration to the furthest clip
    // end, read from the PATCHED SOURCE (raw data-duration), not the store. The
    // store holds runtime-TRUNCATED durations (a clip is clamped to the comp
    // length), so measuring content from it would feed the truncated value back
    // in and shrink the composition every move (HANDOFF-3 §6.1 feedback loop).
    const contentEnd = furthestClipEndFromSource(patched);
    patched = setCompositionDurationToContent(patched, contentEnd);
    if (patched === original) continue;

    // Optimistically reflect the new composition length in the player store so
    // the duration readout + seek bar update immediately (they bind to
    // store.duration; without this the number stays frozen until a manual
    // refresh). Only for the composition currently displayed.
    if (contentEnd > 0 && targetPath === (activeCompPath || "index.html")) {
      usePlayerStore.getState().setDuration(contentEnd);
    }

    groupResults.push({ targetPath, original, patched, groupEdits });
    filesToSave[targetPath] = patched;
    originals.set(targetPath, original);
  }

  if (groupResults.length === 0) return;

  // Phase 2 — ONE atomic write of every affected file + ONE history entry.
  // saveProjectFilesWithHistory writes all files then records a single edit,
  // and rolls back every written file if any write fails. This is the fix for
  // the per-group persist gap: a multi-file move (clips spanning sub-comps)
  // previously did N writes + N history entries in this loop, so a partial
  // failure left earlier files written + a stray history entry while the caller
  // rolled the store all the way back. All-or-nothing on disk now matches the
  // caller's all-or-nothing store rollback, and undo is a single step.
  domEditSaveTimestampRef.current = Date.now();
  await saveProjectFilesWithHistory({
    projectId,
    label: edits.length > 1 ? "Move timeline clips" : "Move timeline clip",
    kind: "timeline",
    files: filesToSave,
    readFile: async (path) => originals.get(path) ?? "",
    writeFile: writeProjectFile,
    recordEdit,
  });

  // Phase 3 — post-save preview sync, per group. These are non-fatal cosmetic
  // steps (GSAP shift misses re-sync on the next reload), so they run after the
  // durable write and never throw back into the caller's rollback path.
  forceReloadSdkSession?.();
  for (const { targetPath, groupEdits } of groupResults) {
    // One batched GSAP position shift for every clip whose start changed.
    const shifts = groupEdits
      .filter((e) => e.element.domId && e.updates.start - e.element.start !== 0)
      .map((e) => ({
        elementId: e.element.domId as string,
        delta: e.updates.start - e.element.start,
      }));
    let shiftOutcome: GsapMutationOutcome = { scriptText: null };
    if (shifts.length > 0) {
      shiftOutcome = await shiftGsapPositionsBatch(projectId, targetPath, shifts).catch((err) => {
        console.error("[Timeline] Failed to batch-shift GSAP positions", err);
        return { scriptText: null };
      });
    }

    // Soft-reload with the batch's rewritten script — a multi-clip move is
    // timing-only (DOM + store already patched), so swap the script in place to
    // avoid the all-clips flash; full reload is the fallback (see syncTimingEditPreview).
    syncTimingEditPreview(
      previewIframe,
      shiftOutcome,
      usePlayerStore.getState().currentTime,
      reloadPreview,
    );
  }
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
    (edits: TimelineElementMoveEdit[]): Promise<void> => {
      if (isRecordingRef?.current) {
        showToast("Cannot edit timeline while recording", "error");
        return Promise.resolve();
      }
      const pid = projectIdRef.current;
      if (!pid) return Promise.resolve();
      return persistTimelineElementsMove(edits, {
        projectId: pid,
        activeCompPath,
        previewIframe: previewIframeRef.current,
        writeProjectFile,
        recordEdit,
        reloadPreview,
        forceReloadSdkSession,
        domEditSaveTimestampRef,
      });
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
