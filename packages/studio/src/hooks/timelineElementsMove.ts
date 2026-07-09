import { useCallback } from "react";
import type { MutableRefObject, RefObject } from "react";
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
 * patch-all → write → one batched GSAP shift → one reload, grouped per owning
 * source file. Mirrors the atomic pattern already used by delete / asset-drop.
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

    domEditSaveTimestampRef.current = Date.now();
    await saveProjectFilesWithHistory({
      projectId,
      label: edits.length > 1 ? "Move timeline clips" : "Move timeline clip",
      kind: "timeline",
      files: { [targetPath]: patched },
      readFile: async () => original,
      writeFile: writeProjectFile,
      recordEdit,
    });

    // One batched GSAP position shift for every clip whose start changed.
    const shifts = groupEdits
      .filter((e) => e.element.domId && e.updates.start - e.element.start !== 0)
      .map((e) => ({
        elementId: e.element.domId as string,
        delta: e.updates.start - e.element.start,
      }));
    if (shifts.length > 0) {
      await shiftGsapPositionsBatch(projectId, targetPath, shifts).catch((err) =>
        console.error("[Timeline] Failed to batch-shift GSAP positions", err),
      );
    }

    forceReloadSdkSession?.();
    reloadPreview();
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
