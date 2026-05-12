import { useCallback, useEffect, useRef, useState } from "react";
import { useMountEffect } from "./useMountEffect";
import {
  STUDIO_MANUAL_EDITS_PATH,
  applyStudioManualEditManifest,
  emptyStudioManualEditManifest,
  installStudioManualEditSeekReapply,
  isStudioManualEditManifestPath,
  parseStudioManualEditManifest,
  readStudioFileChangePath,
  serializeStudioManualEditManifest,
  type StudioManualEditManifest,
} from "../components/editor/manualEdits";
import {
  STUDIO_MOTION_PATH,
  applyStudioMotionManifest,
  emptyStudioMotionManifest,
  installStudioMotionSeekReapply,
  isStudioMotionManifestPath,
  parseStudioMotionManifest,
  serializeStudioMotionManifest,
  type StudioMotionManifest,
} from "../components/editor/studioMotion";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import type { EditHistoryKind } from "../utils/editHistory";

// ── Types ──

interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

interface UseManifestPersistenceParams {
  projectId: string | null;
  showToast: (message: string, tone?: "error" | "info") => void;
  readOptionalProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (entry: RecordEditInput) => Promise<void>;
  previewIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  activeCompPathRef: React.MutableRefObject<string | null>;
}

// ── Hook ──

export function useManifestPersistence({
  projectId,
  showToast,
  readOptionalProjectFile,
  writeProjectFile,
  recordEdit,
  previewIframeRef,
  activeCompPathRef,
}: UseManifestPersistenceParams) {
  const [, setStudioMotionRevision] = useState(0);

  const domEditSaveTimestampRef = useRef(0);
  const domTextCommitVersionRef = useRef(0);
  const domEditSaveQueueRef = useRef(Promise.resolve());
  const studioManualEditManifestRef = useRef<StudioManualEditManifest>(
    emptyStudioManualEditManifest(),
  );
  const studioManualEditRevisionRef = useRef(0);
  const studioMotionManifestRef = useRef<StudioMotionManifest>(emptyStudioMotionManifest());
  const studioMotionRevisionRef = useRef(0);
  const applyStudioManualEditsToPreviewRef = useRef<
    (
      iframe?: HTMLIFrameElement | null,
      options?: { forceFromDisk?: boolean; readFromDiskFirst?: boolean },
    ) => Promise<void>
  >(async () => {});
  const applyStudioMotionToPreviewRef = useRef<
    (
      iframe?: HTMLIFrameElement | null,
      options?: { forceFromDisk?: boolean; readFromDiskFirst?: boolean },
    ) => Promise<void>
  >(async () => {});
  const studioManualEditProjectRef = useRef<string | null>(projectId);

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

  // ── Apply manual edits ──

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
      const previewDoc = doc;

      const applyManifest = () => {
        applyStudioManualEditManifest(
          previewDoc,
          studioManualEditManifestRef.current,
          activeCompPathRef.current,
        );
      };
      const applyAndInstallSeekHooks = () => {
        applyManifest();
        if (iframe.contentWindow) {
          installStudioManualEditSeekReapply(iframe.contentWindow, applyManifest);
        }
      };

      const win = iframe.contentWindow;
      applyAndInstallSeekHooks();
      win?.requestAnimationFrame?.(applyAndInstallSeekHooks);
      win?.setTimeout?.(applyAndInstallSeekHooks, 80);
      win?.setTimeout?.(applyAndInstallSeekHooks, 250);
      win?.setTimeout?.(applyAndInstallSeekHooks, 500);
      win?.setTimeout?.(applyAndInstallSeekHooks, 1000);
      win?.setTimeout?.(applyAndInstallSeekHooks, 2000);
    },
    [activeCompPathRef, previewIframeRef],
  );

  const applyStudioManualEditsToPreview = useCallback(
    async (
      iframe: HTMLIFrameElement | null = previewIframeRef.current,
      options?: { forceFromDisk?: boolean; readFromDiskFirst?: boolean },
    ) => {
      const readFromDiskFirst = Boolean(options?.forceFromDisk || options?.readFromDiskFirst);
      if (!readFromDiskFirst) {
        applyCurrentStudioManualEditsToPreview(iframe);
        return;
      }
      const readRevision = studioManualEditRevisionRef.current;
      let content: string;
      try {
        content = await readOptionalProjectFile(STUDIO_MANUAL_EDITS_PATH);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to read manual edit manifest";
        showToast(message);
        applyCurrentStudioManualEditsToPreview(iframe);
        return;
      }
      if (options?.forceFromDisk || readRevision === studioManualEditRevisionRef.current) {
        studioManualEditManifestRef.current = parseStudioManualEditManifest(content);
        if (options?.forceFromDisk) studioManualEditRevisionRef.current += 1;
      }
      applyCurrentStudioManualEditsToPreview(iframe);
    },
    [applyCurrentStudioManualEditsToPreview, previewIframeRef, readOptionalProjectFile, showToast],
  );
  applyStudioManualEditsToPreviewRef.current = applyStudioManualEditsToPreview;

  // ── Apply motion ──

  const applyCurrentStudioMotionToPreview = useCallback(
    (iframe: HTMLIFrameElement | null = previewIframeRef.current) => {
      if (!iframe) return;
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
      } catch {
        return;
      }
      if (!doc) return;
      const previewDoc = doc;

      const applyManifest = () => {
        applyStudioMotionManifest(
          previewDoc,
          studioMotionManifestRef.current,
          activeCompPathRef.current,
        );
      };
      const applyAndInstallSeekHooks = () => {
        applyManifest();
        if (iframe.contentWindow) {
          installStudioMotionSeekReapply(iframe.contentWindow, applyManifest);
        }
      };

      const win = iframe.contentWindow;
      win?.requestAnimationFrame?.(applyAndInstallSeekHooks);
      win?.setTimeout?.(applyAndInstallSeekHooks, 120);
    },
    [activeCompPathRef, previewIframeRef],
  );

  const applyStudioMotionToPreview = useCallback(
    async (
      iframe: HTMLIFrameElement | null = previewIframeRef.current,
      options?: { forceFromDisk?: boolean; readFromDiskFirst?: boolean },
    ) => {
      const readFromDiskFirst = Boolean(options?.forceFromDisk || options?.readFromDiskFirst);
      if (!readFromDiskFirst) {
        applyCurrentStudioMotionToPreview(iframe);
        return;
      }
      const readRevision = studioMotionRevisionRef.current;
      let content: string;
      try {
        content = await readOptionalProjectFile(STUDIO_MOTION_PATH);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to read motion manifest";
        showToast(message);
        applyCurrentStudioMotionToPreview(iframe);
        return;
      }
      if (options?.forceFromDisk || readRevision === studioMotionRevisionRef.current) {
        studioMotionManifestRef.current = parseStudioMotionManifest(content);
        if (options?.forceFromDisk) studioMotionRevisionRef.current += 1;
        setStudioMotionRevision((revision) => revision + 1);
      }
      applyCurrentStudioMotionToPreview(iframe);
    },
    [applyCurrentStudioMotionToPreview, previewIframeRef, readOptionalProjectFile, showToast],
  );
  applyStudioMotionToPreviewRef.current = applyStudioMotionToPreview;

  // ── Optimistic commits ──

  const commitStudioManualEditManifestOptimistically = useCallback(
    (
      updateManifest: (manifest: StudioManualEditManifest) => StudioManualEditManifest,
      options: { label: string; coalesceKey: string },
    ) => {
      const previousManifest = studioManualEditManifestRef.current;
      const nextManifest = updateManifest(previousManifest);
      const previousContent = serializeStudioManualEditManifest(previousManifest);
      const nextContent = serializeStudioManualEditManifest(nextManifest);
      if (nextContent === previousContent) {
        return;
      }

      const revision = studioManualEditRevisionRef.current + 1;
      studioManualEditRevisionRef.current = revision;
      studioManualEditManifestRef.current = nextManifest;
      applyCurrentStudioManualEditsToPreview(previewIframeRef.current);

      const save = async () => {
        const originalContent = await readOptionalProjectFile(STUDIO_MANUAL_EDITS_PATH);
        const diskManifest = parseStudioManualEditManifest(originalContent);
        const nextDiskManifest = updateManifest(diskManifest);
        const nextDiskContent = serializeStudioManualEditManifest(nextDiskManifest);
        if (nextDiskContent === originalContent) {
          return;
        }

        const pid = projectIdRef.current;
        if (!pid) throw new Error("No active project");
        domEditSaveTimestampRef.current = Date.now();
        await saveProjectFilesWithHistory({
          projectId: pid,
          label: options.label,
          kind: "manual",
          coalesceKey: options.coalesceKey,
          files: { [STUDIO_MANUAL_EDITS_PATH]: nextDiskContent },
          readFile: async () => originalContent,
          writeFile: writeProjectFile,
          recordEdit,
        });
        domEditSaveTimestampRef.current = Date.now();

        if (studioManualEditRevisionRef.current === revision) {
          studioManualEditManifestRef.current = nextDiskManifest;
          applyCurrentStudioManualEditsToPreview(previewIframeRef.current);
        }
      };

      void queueDomEditSave(save).catch((error) => {
        if (studioManualEditRevisionRef.current === revision) {
          studioManualEditRevisionRef.current += 1;
          studioManualEditManifestRef.current = previousManifest;
          applyCurrentStudioManualEditsToPreview(previewIframeRef.current);
        }
        const message = error instanceof Error ? error.message : "Failed to save manual edit";
        showToast(message);
      });
    },
    [
      applyCurrentStudioManualEditsToPreview,
      recordEdit,
      queueDomEditSave,
      readOptionalProjectFile,
      showToast,
      writeProjectFile,
      previewIframeRef,
    ],
  );

  const commitStudioMotionManifestOptimistically = useCallback(
    (
      updateManifest: (manifest: StudioMotionManifest) => StudioMotionManifest,
      options: { label: string; coalesceKey: string },
    ) => {
      const previousManifest = studioMotionManifestRef.current;
      const nextManifest = updateManifest(previousManifest);
      const previousContent = serializeStudioMotionManifest(previousManifest);
      const nextContent = serializeStudioMotionManifest(nextManifest);
      if (nextContent === previousContent) {
        return;
      }

      const revision = studioMotionRevisionRef.current + 1;
      studioMotionRevisionRef.current = revision;
      studioMotionManifestRef.current = nextManifest;
      setStudioMotionRevision((current) => current + 1);
      applyCurrentStudioMotionToPreview(previewIframeRef.current);

      const save = async () => {
        const originalContent = await readOptionalProjectFile(STUDIO_MOTION_PATH);
        const diskManifest = parseStudioMotionManifest(originalContent);
        const nextDiskManifest = updateManifest(diskManifest);
        const nextDiskContent = serializeStudioMotionManifest(nextDiskManifest);
        if (nextDiskContent === originalContent) {
          return;
        }

        const pid = projectIdRef.current;
        if (!pid) throw new Error("No active project");
        domEditSaveTimestampRef.current = Date.now();
        await saveProjectFilesWithHistory({
          projectId: pid,
          label: options.label,
          kind: "motion",
          coalesceKey: options.coalesceKey,
          files: { [STUDIO_MOTION_PATH]: nextDiskContent },
          readFile: async () => originalContent,
          writeFile: writeProjectFile,
          recordEdit,
        });
        domEditSaveTimestampRef.current = Date.now();

        if (studioMotionRevisionRef.current === revision) {
          studioMotionManifestRef.current = nextDiskManifest;
          setStudioMotionRevision((current) => current + 1);
          applyCurrentStudioMotionToPreview(previewIframeRef.current);
        }
      };

      void queueDomEditSave(save).catch((error) => {
        if (studioMotionRevisionRef.current === revision) {
          studioMotionRevisionRef.current += 1;
          studioMotionManifestRef.current = previousManifest;
          setStudioMotionRevision((current) => current + 1);
          applyCurrentStudioMotionToPreview(previewIframeRef.current);
        }
        const message = error instanceof Error ? error.message : "Failed to save motion edit";
        showToast(message);
      });
    },
    [
      applyCurrentStudioMotionToPreview,
      recordEdit,
      queueDomEditSave,
      readOptionalProjectFile,
      showToast,
      writeProjectFile,
      previewIframeRef,
    ],
  );

  // ── Sync preview after undo/redo ──

  const syncHistoryPreviewAfterApply = useCallback(
    async (paths: string[] | undefined) => {
      const changedPaths = paths ?? [];
      const manualManifestOnly =
        changedPaths.length > 0 && changedPaths.every((path) => path === STUDIO_MANUAL_EDITS_PATH);
      const motionManifestOnly =
        changedPaths.length > 0 && changedPaths.every((path) => path === STUDIO_MOTION_PATH);

      if (manualManifestOnly) {
        await applyStudioManualEditsToPreview(previewIframeRef.current, { forceFromDisk: true });
        return;
      }
      if (motionManifestOnly) {
        await applyStudioMotionToPreview(previewIframeRef.current, { forceFromDisk: true });
        return;
      }

      // Reload the iframe in-place rather than recreating the Player component.
      // This preserves the <hyperframes-player> web component and its shader
      // transition cache — only the iframe document reloads, so transitions that
      // weren't touched by the undo/redo don't need to rebuild from scratch.
      const iframe = previewIframeRef.current;
      if (iframe?.contentWindow) {
        try {
          iframe.contentWindow.location.reload();
          return;
        } catch {
          // Cross-origin or detached — fall through to full refresh
        }
      }
    },
    [applyStudioManualEditsToPreview, applyStudioMotionToPreview, previewIframeRef],
  );

  // ── Reset manifests when project changes ──

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    const previousProjectId = studioManualEditProjectRef.current;
    studioManualEditProjectRef.current = projectId;
    if (!previousProjectId || previousProjectId === projectId) return;
    studioManualEditManifestRef.current = emptyStudioManualEditManifest();
    studioManualEditRevisionRef.current += 1;
    studioMotionManifestRef.current = emptyStudioMotionManifest();
    studioMotionRevisionRef.current += 1;
    setStudioMotionRevision((revision) => revision + 1);
  }, [projectId]);

  // ── Listen for external file changes (HMR / SSE) ──
  // In dev: use Vite HMR. In embedded/production: use SSE from /api/events.
  // Suppress file-change events that echo back from a recent DOM edit save —
  // those changes are already applied to the iframe DOM and a full reload
  // would flash the preview.
  useMountEffect(() => {
    const handler = (payload?: unknown) => {
      const changedPath = readStudioFileChangePath(payload);
      const recentDomEditSave = Date.now() - domEditSaveTimestampRef.current < 1200;
      if (isStudioManualEditManifestPath(changedPath)) {
        if (!recentDomEditSave) {
          void applyStudioManualEditsToPreviewRef.current(previewIframeRef.current, {
            forceFromDisk: true,
          });
        }
        return;
      }
      if (isStudioMotionManifestPath(changedPath)) {
        if (!recentDomEditSave) {
          void applyStudioMotionToPreviewRef.current(previewIframeRef.current, {
            forceFromDisk: true,
          });
        }
        return;
      }
      // Non-manifest file changes are not handled here — the caller is
      // responsible for triggering a preview refresh via onExternalFileChange
      // if needed. This hook only suppresses echoes and handles manifest reloads.
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
    domEditSaveTimestampRef,
    domTextCommitVersionRef,
    domEditSaveQueueRef,
    studioManualEditManifestRef,
    studioManualEditRevisionRef,
    studioMotionManifestRef,
    studioMotionRevisionRef,
    applyStudioManualEditsToPreviewRef,
    applyStudioMotionToPreviewRef,
    studioManualEditProjectRef,
    queueDomEditSave,
    waitForPendingDomEditSaves,
    applyCurrentStudioManualEditsToPreview,
    applyStudioManualEditsToPreview,
    applyCurrentStudioMotionToPreview,
    applyStudioMotionToPreview,
    commitStudioManualEditManifestOptimistically,
    commitStudioMotionManifestOptimistically,
    syncHistoryPreviewAfterApply,
  };
}
