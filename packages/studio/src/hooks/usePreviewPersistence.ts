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
import { trackStudioEvent } from "../utils/studioTelemetry";

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

// ── Hook ──

export function usePreviewPersistence({
  projectId,
  showToast,
  readOptionalProjectFile: _readOptionalProjectFile,
  writeProjectFile: _writeProjectFile,
  recordEdit: _recordEdit,
  previewIframeRef,
  activeCompPathRef: _activeCompPathRef,
  domEditSaveTimestampRef,
  reloadPreview,
  pendingTimelineEditPathRef,
}: UsePreviewPersistenceParams) {
  void _recordEdit;
  void _activeCompPathRef;

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
    async (_paths: string[] | undefined) => {
      // Motion data is now stored in HTML attributes — any undo/redo that touches HTML
      // files triggers a full reload which picks up the changes automatically.
      reloadPreview();
    },
    [reloadPreview],
  );

  // ── Migrate legacy studio-motion.json ──
  // Projects that used the old JSON-file approach may still have a populated
  // `.hyperframes/studio-motion.json`. The studio no longer reads from it, but
  // the legacy render-script injection in `preview.ts` / `vite.studioMotion.ts`
  // could still fire alongside the new seek-reapply runtime. Empty the file so
  // the legacy codepath no-ops.
  useMountEffect(() => {
    _readOptionalProjectFile(STUDIO_MOTION_PATH)
      .then((content) => {
        if (!content) return;
        try {
          const parsed = JSON.parse(content) as { motions?: unknown[] };
          if (!Array.isArray(parsed.motions) || parsed.motions.length === 0) return;
        } catch {
          return;
        }
        return _writeProjectFile(STUDIO_MOTION_PATH, JSON.stringify({ version: 1, motions: [] }));
      })
      .catch(() => {
        /* best-effort migration — ignore failures */
      });
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
      )
        reloadPreview();
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
