import { useCallback, useRef, useState } from "react";
import { useMountEffect } from "./useMountEffect";
import {
  installStudioManualEditSeekReapply,
  reapplyPositionEditsAfterSeek,
  readStudioFileChangePath,
} from "../components/editor/manualEdits";
import { STUDIO_MOTION_PATH } from "../components/editor/studioMotion";
import type { EditHistoryKind } from "../utils/editHistory";
import { createDomEditSaveQueue } from "../utils/domEditSaveQueue";
import { flushStudioPendingEdits } from "../utils/studioPendingEdits";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { applyUndoRestoreToPreview, type UndoRestoreFile } from "../utils/gsapSoftReload";
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
  projectId: string | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  readOptionalProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (entry: RecordEditInput) => Promise<void>;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  activeCompPathRef: React.MutableRefObject<string | null>;
  /** Shared timestamp ref — written by any studio save (code tab, timeline, DOM edits).
   *  Used to suppress file-change echoes so we don't reload after our own saves. */
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  /** Tracks in-flight timeline edits that patch the iframe DOM directly. File-change
   *  events for these paths are always suppressed since the preview is already up-to-date. */
  pendingTimelineEditPathRef?: React.MutableRefObject<Set<string>>;
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

function shouldReloadForStudioFileChange(
  payload: unknown,
  pendingTimelineEditPathRef: React.MutableRefObject<Set<string>> | undefined,
  domEditSaveTimestampRef: React.MutableRefObject<number>,
): boolean {
  const changedPath = readStudioFileChangePath(payload);
  if (!changedPath) return false;
  const pendingTimelinePaths = pendingTimelineEditPathRef?.current;
  if (pendingTimelinePaths?.has(changedPath)) {
    pendingTimelinePaths.delete(changedPath);
    return false;
  }
  return Date.now() - domEditSaveTimestampRef.current >= 4000;
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
  projectId,
  showToast,
  readOptionalProjectFile: _readOptionalProjectFile,
  writeProjectFile: _writeProjectFile,
  recordEdit: _recordEdit,
  previewIframeRef,
  activeCompPathRef,
  domEditSaveTimestampRef,
  reloadPreview,
  pendingTimelineEditPathRef,
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
        const message = "Auto-save is paused. Check your connection.";
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

  // Keep a ref to the latest projectId so async save callbacks always read the
  // current value, even when the callback was captured in a stale closure.
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  // ── Queue / drain helpers ──

  const queueDomEditSave = useCallback((save: () => Promise<void>) => {
    return domEditSaveQueueRef.current?.enqueue(save) ?? save();
  }, []);

  const waitForPendingDomEditSaves = useCallback(async () => {
    await flushStudioPendingEdits();
    await domEditSaveQueueRef.current?.waitForIdle();
  }, []);

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
      applyUndoRestoreToPreview(
        previewIframeRef.current,
        activeCompPathRef.current,
        restore.files,
        usePlayerStore.getState().currentTime,
        reloadPreview,
      );
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

  // ── Listen for external file changes (HMR / SSE) ──
  useMountEffect(() => {
    const handler = (payload?: unknown) => {
      if (
        shouldReloadForStudioFileChange(
          payload,
          pendingTimelineEditPathRef,
          domEditSaveTimestampRef,
        )
      ) {
        // fallow-ignore-next-line code-duplication
        reloadPreview();
      }
    };
    if (import.meta.hot) {
      import.meta.hot.on("hf:file-change", handler);
      return () => import.meta.hot?.off?.("hf:file-change", handler);
    }
    // SSE fallback for embedded studio server
    const es = new EventSource("/api/events");
    es.addEventListener("file-change", handler);
    return () => es.close();
  });

  return {
    domTextCommitVersionRef,
    domEditSaveQueueRef,
    applyStudioManualEditsToPreviewRef,
    queueDomEditSave,
    waitForPendingDomEditSaves,
    domEditSaveQueuePaused,
    resetDomEditSaveQueueBreaker,
    applyCurrentStudioManualEditsToPreview,
    applyStudioManualEditsToPreview,
    syncHistoryPreviewAfterApply,
  };
}
