import { useCallback, useRef } from "react";
import { useMountEffect } from "./useMountEffect";
import {
  installStudioManualEditSeekReapply,
  reapplyPositionEditsAfterSeek,
  readStudioFileChangePath,
} from "../components/editor/manualEdits";
import { STUDIO_MOTION_PATH } from "../components/editor/studioMotion";
import type { EditHistoryKind } from "../utils/editHistory";

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

// ── Hook ──

export function usePreviewPersistence({
  projectId,
  showToast: _showToast,
  readOptionalProjectFile: _readOptionalProjectFile,
  writeProjectFile: _writeProjectFile,
  recordEdit: _recordEdit,
  previewIframeRef,
  activeCompPathRef: _activeCompPathRef,
  domEditSaveTimestampRef,
  reloadPreview,
  pendingTimelineEditPathRef,
}: UsePreviewPersistenceParams) {
  void _showToast;
  void _recordEdit;
  void _activeCompPathRef;

  const domTextCommitVersionRef = useRef(0);
  const domEditSaveQueueRef = useRef(Promise.resolve());
  const applyStudioManualEditsToPreviewRef = useRef<
    (iframe?: HTMLIFrameElement | null) => Promise<void>
  >(async () => {});

  // Keep a ref to the latest projectId so async save callbacks always read the
  // current value, even when the callback was captured in a stale closure.
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;

  // ── Queue / drain helpers ──

  const queueDomEditSave = useCallback((save: () => Promise<void>) => {
    const queuedSave = domEditSaveQueueRef.current.catch(() => undefined).then(save);
    domEditSaveQueueRef.current = queuedSave.then(
      () => undefined,
      () => undefined,
    );
    return queuedSave;
  }, []);

  const waitForPendingDomEditSaves = useCallback(async () => {
    await domEditSaveQueueRef.current.catch(() => undefined);
  }, []);

  // ── Apply manual edits (HTML-baked — install seek hooks) ──
  // reapplyPositionEditsAfterSeek now also handles motion reapply from DOM attributes.

  const applyCurrentStudioManualEditsToPreview = useCallback(
    (iframe: HTMLIFrameElement | null = previewIframeRef.current) => {
      if (!iframe) return;
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
      } catch {
        return;
      }
      if (!doc) return;

      const reapply = () => {
        let d: Document | null = null;
        try {
          d = iframe.contentDocument;
        } catch {
          return;
        }
        if (d) reapplyPositionEditsAfterSeek(d);
      };
      const install = () => {
        reapply();
        if (iframe.contentWindow) installStudioManualEditSeekReapply(iframe.contentWindow, reapply);
      };

      const win = iframe.contentWindow;
      install();
      win?.requestAnimationFrame?.(install);
      win?.setTimeout?.(install, 80);
      win?.setTimeout?.(install, 250);
      win?.setTimeout?.(install, 500);
      win?.setTimeout?.(install, 1000);
      win?.setTimeout?.(install, 2000);
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
      const changedPath = readStudioFileChangePath(payload);
      if (!changedPath) return;
      const recentDomEditSave = Date.now() - domEditSaveTimestampRef.current < 4000;
      if (pendingTimelineEditPathRef?.current.has(changedPath)) {
        pendingTimelineEditPathRef.current.delete(changedPath);
        return;
      }
      if (!recentDomEditSave) {
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
    applyCurrentStudioManualEditsToPreview,
    applyStudioManualEditsToPreview,
    syncHistoryPreviewAfterApply,
  };
}
