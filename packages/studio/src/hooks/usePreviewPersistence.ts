import { useCallback, useRef, useState } from "react";
import { useMountEffect } from "./useMountEffect";
import {
  installStudioManualEditSeekReapply,
  reapplyPositionEditsAfterSeek,
} from "../components/editor/manualEdits";
import { STUDIO_MOTION_PATH } from "../components/editor/studioMotion";
import type { EditHistoryKind } from "../utils/editHistory";
import { createDomEditSaveQueue, type DomEditSaveDrainResult } from "../utils/domEditSaveQueue";
import {
  flushStudioPendingEdits,
  type StudioPendingEditsDrainResult,
} from "../utils/studioPendingEdits";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { applyUndoRestoreToPreview, type UndoRestoreFile } from "../utils/gsapUndoRestore";
import { usePlayerStore } from "../player";

/** The restore payload the undo/redo preview-sync consumes (from the history store). */
interface HistoryPreviewRestore {
  paths?: string[];
  files?: Record<string, UndoRestoreFile>;
}

// ── Types ──

interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

interface UsePreviewPersistenceParams {
  showToast: (message: string, tone?: "error" | "info") => void;
  readOptionalProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (entry: RecordEditInput) => Promise<void>;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  activeCompPathRef: React.MutableRefObject<string | null>;
  /** Called to reload the preview after undo/redo or external file changes. */
  reloadPreview: () => void;
}

function readIframeDocument(iframe: HTMLIFrameElement): Document | null {
  try {
    return iframe.contentDocument;
  } catch {
    return null;
  }
}

function installManualEditReapply(iframe: HTMLIFrameElement): void {
  const reapply = () => {
    const doc = readIframeDocument(iframe);
    if (doc) reapplyPositionEditsAfterSeek(doc);
  };
  const install = () => {
    reapply();
    if (iframe.contentWindow) installStudioManualEditSeekReapply(iframe.contentWindow, reapply);
  };
  const win = iframe.contentWindow;
  install();
  win?.requestAnimationFrame?.(install);
  for (const delayMs of [80, 250, 500, 1000, 2000]) {
    win?.setTimeout?.(install, delayMs);
  }
}

export async function drainStudioSaveQueues(
  flushPendingFields: () => Promise<StudioPendingEditsDrainResult>,
  waitForDomQueue: () => Promise<DomEditSaveDrainResult>,
): Promise<StudioPendingEditsDrainResult | DomEditSaveDrainResult> {
  const pending = await flushPendingFields();
  if (pending.status !== "clean") return pending;
  return waitForDomQueue();
}

// fallow-ignore-next-line complexity
async function clearLegacyStudioMotionFile(
  readOptionalProjectFile: (path: string) => Promise<string>,
  writeProjectFile: (path: string, content: string) => Promise<void>,
): Promise<void> {
  const content = await readOptionalProjectFile(STUDIO_MOTION_PATH).catch(() => null);
  if (!content) return;
  try {
    const parsed = JSON.parse(content) as { motions?: unknown[] };
    if (!Array.isArray(parsed.motions) || parsed.motions.length === 0) return;
  } catch {
    return;
  }
  await writeProjectFile(STUDIO_MOTION_PATH, JSON.stringify({ version: 1, motions: [] })).catch(
    () => {},
  );
}

// ── Hook ──

export function usePreviewPersistence({
  showToast,
  readOptionalProjectFile: _readOptionalProjectFile,
  writeProjectFile: _writeProjectFile,
  recordEdit: _recordEdit,
  previewIframeRef,
  activeCompPathRef,
  reloadPreview,
}: UsePreviewPersistenceParams) {
  void _recordEdit;

  const [domEditSaveQueuePaused, setDomEditSaveQueuePaused] = useState<string | null>(null);

  const domTextCommitVersionRef = useRef(0);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const domEditSaveQueueRef = useRef<ReturnType<typeof createDomEditSaveQueue> | null>(null);
  const applyStudioManualEditsToPreviewRef = useRef<
    (iframe?: HTMLIFrameElement | null) => Promise<void>
  >(async () => {});

  if (!domEditSaveQueueRef.current) {
    domEditSaveQueueRef.current = createDomEditSaveQueue({
      onOpen: (event) => {
        const message =
          event.statusCode === 409
            ? "Save paused: this file changed elsewhere. Reload and review the latest version before reapplying your edit."
            : "Auto-save is paused. Check your connection.";
        setDomEditSaveQueuePaused(message);
        showToastRef.current(message, "error");
        trackStudioEvent("save_queue_paused", {
          source: "dom_edit",
          error_message: event.errorMessage,
          status_code: event.statusCode,
          consecutive_failures: event.consecutiveFailures,
        });
      },
      onReset: () => {
        setDomEditSaveQueuePaused(null);
      },
    });
  }

  // ── Queue / drain helpers ──

  const queueDomEditSave = useCallback(<T>(save: () => Promise<T>): Promise<T> => {
    return domEditSaveQueueRef.current?.enqueue(save) ?? save();
  }, []);

  const drainPendingDomEditSaves = useCallback(async () => {
    return drainStudioSaveQueues(flushStudioPendingEdits, async () => {
      return (await domEditSaveQueueRef.current?.waitForIdle()) ?? { status: "clean" as const };
    });
  }, []);

  const waitForPendingDomEditSaves = useCallback(async (): Promise<void> => {
    const result = await drainPendingDomEditSaves();
    if (result.status !== "clean") throw result.error;
  }, [drainPendingDomEditSaves]);

  const resetDomEditSaveQueueBreaker = useCallback(() => {
    domEditSaveQueueRef.current?.reset();
    setDomEditSaveQueuePaused(null);
  }, []);

  useMountEffect(() => () => {
    domEditSaveQueueRef.current?.destroy();
  });

  // ── Apply manual edits (HTML-baked — install seek hooks) ──
  // reapplyPositionEditsAfterSeek now also handles motion reapply from DOM attributes.

  const applyCurrentStudioManualEditsToPreview = useCallback(
    (iframe: HTMLIFrameElement | null = previewIframeRef.current) => {
      if (!iframe) return;
      if (!readIframeDocument(iframe)) return;
      installManualEditReapply(iframe);
    },
    [previewIframeRef],
  );

  const applyStudioManualEditsToPreview = useCallback(
    async (iframe: HTMLIFrameElement | null = previewIframeRef.current) => {
      applyCurrentStudioManualEditsToPreview(iframe);
    },
    [applyCurrentStudioManualEditsToPreview, previewIframeRef],
  );
  applyStudioManualEditsToPreviewRef.current = applyStudioManualEditsToPreview;

  // ── Sync preview after undo/redo ──

  const syncHistoryPreviewAfterApply = useCallback(
    async (restore: HistoryPreviewRestore) => {
      // Prefer an in-place soft reload for a soft-reloadable restore (the change
      // is confined to the active comp's element attributes / inline-style and/or
      // its GSAP script) — a full iframe remount blanks the frame black and
      // re-flashes the WebGL context. applyUndoRestoreToPreview syncs the reverted
      // attributes onto the live DOM and re-runs the timeline at the SAME playhead,
      // falling back to reloadPreview for anything structural (split/delete undo),
      // multi-file, sub-comp, or a permanent soft-reload failure.
      const strategy = applyUndoRestoreToPreview(
        previewIframeRef.current,
        activeCompPathRef.current,
        restore.files,
        usePlayerStore.getState().currentTime,
        reloadPreview,
      );
      if (strategy === "full") {
        const player = usePlayerStore.getState();
        player.setElements([]);
        player.setSelectedElementId(null);
        player.setTimelineReady(false);
      }
    },
    [previewIframeRef, activeCompPathRef, reloadPreview],
  );

  // ── Migrate legacy studio-motion.json ──
  // Projects that used the old JSON-file approach may still have a populated
  // `.hyperframes/studio-motion.json`. The studio no longer reads from it, but
  // the legacy render-script injection in `preview.ts` / `vite.studioMotion.ts`
  // could still fire alongside the new seek-reapply runtime. Empty the file so
  // the legacy codepath no-ops.
  useMountEffect(() => {
    void clearLegacyStudioMotionFile(_readOptionalProjectFile, _writeProjectFile);
  });

  return {
    domTextCommitVersionRef,
    domEditSaveQueueRef,
    applyStudioManualEditsToPreviewRef,
    queueDomEditSave,
    drainPendingDomEditSaves,
    waitForPendingDomEditSaves,
    domEditSaveQueuePaused,
    resetDomEditSaveQueueBreaker,
    applyCurrentStudioManualEditsToPreview,
    applyStudioManualEditsToPreview,
    syncHistoryPreviewAfterApply,
  };
}
