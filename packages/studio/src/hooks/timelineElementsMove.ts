import { useCallback } from "react";
import type { MutableRefObject, RefObject } from "react";
import { usePlayerStore } from "../player";
import type { TimelineElement } from "../player";
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

const elementKey = (el: Pick<TimelineElement, "key" | "id">): string | number => el.key ?? el.id;
const fileOf = (el: Pick<TimelineElement, "sourceFile">, activeCompPath: string | null): string =>
  el.sourceFile || activeCompPath || "index.html";

/**
 * Furthest clip end in `targetPath`, using each edit's NEW start for the clips
 * that moved and every other clip's live start. Mirrors the content-driven
 * duration calc the single-clip move path does inline (useTimelineEditing.ts) so
 * a batched lane-change/insert move keeps the root `data-duration` in sync with
 * content — without it the saved file's duration goes stale (research HANDOFF-3
 * §6.1: "moved audio, data-duration=15.18 but audio ends 19.53"). Pure so it can
 * be unit-tested independently of the persist plumbing.
 */
export function resolveMovedContentEnd(
  elements: TimelineElement[],
  edits: TimelineElementMoveEdit[],
  targetPath: string,
  activeCompPath: string | null,
): number {
  const movedStart = new Map<string | number, number>();
  for (const { element, updates } of edits) {
    movedStart.set(elementKey(element), updates.start);
  }
  return elements.reduce((max, te) => {
    if (fileOf(te, activeCompPath) !== targetPath) return max;
    const start = movedStart.get(elementKey(te)) ?? te.start;
    return Math.max(max, start + te.duration);
  }, 0);
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
    // Content-driven duration: after moving these clips, sync the root
    // data-duration to the furthest clip end in this file (grow OR shrink) so the
    // saved source — and any render off it — matches what the player shows. The
    // single-clip move path does this inline; the batched path used to skip it,
    // leaving the file's duration stale (HANDOFF-3 §6.1).
    const contentEnd = resolveMovedContentEnd(
      usePlayerStore.getState().elements,
      groupEdits,
      targetPath,
      activeCompPath,
    );
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
