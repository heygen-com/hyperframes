import { useCallback, useEffect, useRef } from "react";
import { usePlayerStore } from "../player";
import type { TimelineElement } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { LeftSidebarHandle } from "../components/sidebar/LeftSidebar";
import { STUDIO_MANUAL_EDITS_PATH } from "../components/editor/manualEdits";
import { STUDIO_MOTION_PATH } from "../components/editor/studioMotion";
import { shouldHandleTimelineToggleHotkey, isEditableTarget } from "../utils/timelineDiscovery";
import { shouldIgnoreHistoryShortcut } from "../utils/studioHelpers";

// ── Types ──

interface EditHistoryHandle {
  undo: (callbacks: {
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<void>;
  }) => Promise<{
    ok: boolean;
    reason?: string;
    label?: string;
    paths?: string[];
  }>;
  redo: (callbacks: {
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<void>;
  }) => Promise<{
    ok: boolean;
    reason?: string;
    label?: string;
    paths?: string[];
  }>;
}

interface UseAppHotkeysParams {
  toggleTimelineVisibility: () => void;
  handleTimelineElementDelete: (element: TimelineElement) => Promise<void>;
  handleDomEditElementDelete: (selection: DomEditSelection) => Promise<void>;
  domEditSelectionRef: React.MutableRefObject<DomEditSelection | null>;
  clearDomSelectionRef: React.MutableRefObject<() => void>;
  editHistory: EditHistoryHandle;
  readOptionalProjectFile: (path: string) => Promise<string>;
  readProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  showToast: (message: string, tone?: "error" | "info") => void;
  syncHistoryPreviewAfterApply: (paths: string[] | undefined) => Promise<void>;
  waitForPendingDomEditSaves: () => Promise<void>;
  leftSidebarRef: React.RefObject<LeftSidebarHandle | null>;
}

// ── Hook ──

export function useAppHotkeys({
  toggleTimelineVisibility,
  handleTimelineElementDelete,
  handleDomEditElementDelete,
  domEditSelectionRef,
  clearDomSelectionRef,
  editHistory,
  readOptionalProjectFile,
  readProjectFile,
  writeProjectFile,
  domEditSaveTimestampRef,
  showToast,
  syncHistoryPreviewAfterApply,
  waitForPendingDomEditSaves,
  leftSidebarRef,
}: UseAppHotkeysParams) {
  const previewHotkeyWindowRef = useRef<Window | null>(null);
  const handleAppKeyDownRef = useRef<((event: KeyboardEvent) => void) | undefined>(undefined);
  const previewHistoryHotkeyCleanupRef = useRef<(() => void) | null>(null);

  // ── Timeline toggle hotkey ──

  const handleTimelineToggleHotkey = useCallback(
    (event: KeyboardEvent) => {
      if (!shouldHandleTimelineToggleHotkey(event)) return;
      event.preventDefault();
      toggleTimelineVisibility();
    },
    [toggleTimelineVisibility],
  );

  // ── History file read/write helpers ──

  const readHistoryProjectFile = useCallback(
    async (path: string): Promise<string> => {
      return path === STUDIO_MANUAL_EDITS_PATH || path === STUDIO_MOTION_PATH
        ? readOptionalProjectFile(path)
        : readProjectFile(path);
    },
    [readOptionalProjectFile, readProjectFile],
  );

  const writeHistoryProjectFile = useCallback(
    async (path: string, content: string): Promise<void> => {
      domEditSaveTimestampRef.current = Date.now();
      await writeProjectFile(path, content);
    },
    [domEditSaveTimestampRef, writeProjectFile],
  );

  // ── Undo / Redo ──

  const handleUndo = useCallback(async () => {
    await waitForPendingDomEditSaves();
    const result = await editHistory.undo({
      readFile: readHistoryProjectFile,
      writeFile: writeHistoryProjectFile,
    });
    if (!result.ok && result.reason === "content-mismatch") {
      showToast("File changed outside Studio. Undo history was not applied.", "info");
      return;
    }
    if (result.ok && result.label) {
      clearDomSelectionRef.current();
      await syncHistoryPreviewAfterApply(result.paths);
      showToast(`Undid ${result.label}`, "info");
    }
  }, [
    clearDomSelectionRef,
    editHistory,
    readHistoryProjectFile,
    showToast,
    syncHistoryPreviewAfterApply,
    waitForPendingDomEditSaves,
    writeHistoryProjectFile,
  ]);

  const handleRedo = useCallback(async () => {
    await waitForPendingDomEditSaves();
    const result = await editHistory.redo({
      readFile: readHistoryProjectFile,
      writeFile: writeHistoryProjectFile,
    });
    if (!result.ok && result.reason === "content-mismatch") {
      showToast("File changed outside Studio. Redo history was not applied.", "info");
      return;
    }
    if (result.ok && result.label) {
      clearDomSelectionRef.current();
      await syncHistoryPreviewAfterApply(result.paths);
      showToast(`Redid ${result.label}`, "info");
    }
  }, [
    clearDomSelectionRef,
    editHistory,
    readHistoryProjectFile,
    showToast,
    syncHistoryPreviewAfterApply,
    waitForPendingDomEditSaves,
    writeHistoryProjectFile,
  ]);

  // ── Stable refs for the consolidated keydown handler ──

  const handleToggleRef = useRef(handleTimelineToggleHotkey);
  handleToggleRef.current = handleTimelineToggleHotkey;
  const handleDeleteRef = useRef(handleTimelineElementDelete);
  handleDeleteRef.current = handleTimelineElementDelete;
  const handleDomEditDeleteRef = useRef(handleDomEditElementDelete);
  handleDomEditDeleteRef.current = handleDomEditElementDelete;
  const handleUndoRef = useRef(handleUndo);
  handleUndoRef.current = handleUndo;
  const handleRedoRef = useRef(handleRedo);
  handleRedoRef.current = handleRedo;

  // ── Consolidated keydown handler ──

  handleAppKeyDownRef.current = (event: KeyboardEvent) => {
    // Shift+T — toggle timeline
    handleToggleRef.current(event);

    // Cmd/Ctrl+Z — undo, Cmd/Ctrl+Shift+Z or Ctrl+Y — redo
    if (event.metaKey || event.ctrlKey) {
      if (!shouldIgnoreHistoryShortcut(event.target)) {
        const key = event.key.toLowerCase();
        if (key === "z" && !event.shiftKey) {
          event.preventDefault();
          void handleUndoRef.current();
          return;
        }
        if ((key === "z" && event.shiftKey) || (event.ctrlKey && !event.metaKey && key === "y")) {
          event.preventDefault();
          void handleRedoRef.current();
          return;
        }
      }

      // Cmd/Ctrl+1 — sidebar: Compositions tab
      if (event.key === "1") {
        event.preventDefault();
        leftSidebarRef.current?.selectTab("compositions");
        return;
      }

      // Cmd/Ctrl+2 — sidebar: Assets tab
      if (event.key === "2") {
        event.preventDefault();
        leftSidebarRef.current?.selectTab("assets");
        return;
      }
    }

    // Delete / Backspace — remove selected element (timeline clip or preview selection)
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !isEditableTarget(event.target)
    ) {
      const { selectedElementId, elements } = usePlayerStore.getState();
      if (selectedElementId) {
        const element = elements.find((el) => (el.key ?? el.id) === selectedElementId);
        if (element) {
          event.preventDefault();
          void handleDeleteRef.current(element);
          return;
        }
      }
      const domSelection = domEditSelectionRef.current;
      if (domSelection) {
        event.preventDefault();
        void handleDomEditDeleteRef.current(domSelection);
      }
    }
  };

  // ── Window keydown listener ──

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    function handleAppKeyDown(event: KeyboardEvent) {
      handleAppKeyDownRef.current?.(event);
    }
    window.addEventListener("keydown", handleAppKeyDown, true);
    return () => window.removeEventListener("keydown", handleAppKeyDown, true);
  }, []);

  // ── Preview iframe keydown forwarding ──

  const previewAppKeyDownHandler = useCallback((event: KeyboardEvent) => {
    handleAppKeyDownRef.current?.(event);
  }, []);

  const syncPreviewTimelineHotkey = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      const nextWindow = iframe?.contentWindow ?? null;
      if (previewHotkeyWindowRef.current === nextWindow) return;
      if (previewHotkeyWindowRef.current) {
        previewHotkeyWindowRef.current.removeEventListener("keydown", previewAppKeyDownHandler);
      }
      previewHotkeyWindowRef.current = nextWindow;
      nextWindow?.addEventListener("keydown", previewAppKeyDownHandler, true);
    },
    [previewAppKeyDownHandler],
  );

  useEffect(
    () => () => {
      if (previewHotkeyWindowRef.current) {
        previewHotkeyWindowRef.current.removeEventListener("keydown", previewAppKeyDownHandler);
        previewHotkeyWindowRef.current = null;
      }
    },
    [previewAppKeyDownHandler],
  );

  // ── History hotkey for iframe forwarding ──

  const handleHistoryHotkey = useCallback((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (shouldIgnoreHistoryShortcut(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      void handleUndoRef.current();
      return;
    }
    if ((key === "z" && event.shiftKey) || (event.ctrlKey && !event.metaKey && key === "y")) {
      event.preventDefault();
      void handleRedoRef.current();
    }
  }, []);

  const syncPreviewHistoryHotkey = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      previewHistoryHotkeyCleanupRef.current?.();
      previewHistoryHotkeyCleanupRef.current = null;

      const win = iframe?.contentWindow ?? null;
      let doc: Document | null = null;
      try {
        doc = iframe?.contentDocument ?? null;
      } catch {
        doc = null;
      }
      if (!win && !doc) return;

      win?.addEventListener("keydown", handleHistoryHotkey, true);
      doc?.addEventListener("keydown", handleHistoryHotkey, true);
      previewHistoryHotkeyCleanupRef.current = () => {
        win?.removeEventListener("keydown", handleHistoryHotkey, true);
        doc?.removeEventListener("keydown", handleHistoryHotkey, true);
      };
    },
    [handleHistoryHotkey],
  );

  useEffect(
    () => () => {
      previewHistoryHotkeyCleanupRef.current?.();
      previewHistoryHotkeyCleanupRef.current = null;
    },
    [],
  );

  return {
    handleUndo,
    handleRedo,
    syncPreviewTimelineHotkey,
    syncPreviewHistoryHotkey,
    handleTimelineToggleHotkey,
  };
}
