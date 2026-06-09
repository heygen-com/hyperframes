import { useCallback, useEffect, useRef } from "react";
import { usePlayerStore } from "../player";
import type { TimelineElement } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { LeftSidebarHandle } from "../components/sidebar/LeftSidebar";
import { STUDIO_MOTION_PATH } from "../components/editor/studioMotion";
import { shouldHandleTimelineToggleHotkey, isEditableTarget } from "../utils/timelineDiscovery";
import { shouldIgnoreHistoryShortcut } from "../utils/studioHelpers";

/** Safely resolves contentWindow for a potentially cross-origin iframe. */
function iframeContentWindow(iframe: HTMLIFrameElement | null): Window | null {
  try {
    return iframe?.contentWindow ?? null;
  } catch {
    return null;
  }
}

/**
 * Handles Cmd/Ctrl+Z (undo) and Cmd/Ctrl+Shift+Z / Ctrl+Y (redo) key events.
 * Returns true if the event was handled, false otherwise.
 */
// fallow-ignore-next-line complexity
function handleUndoRedoKey(event: KeyboardEvent, onUndo: () => void, onRedo: () => void): boolean {
  const key = event.key.toLowerCase();
  if (key === "z" && !event.shiftKey) {
    event.preventDefault();
    onUndo();
    return true;
  }
  if ((key === "z" && event.shiftKey) || (event.ctrlKey && !event.metaKey && key === "y")) {
    event.preventDefault();
    onRedo();
    return true;
  }
  return false;
}

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
  handleTimelineElementSplit: (element: TimelineElement, splitTime: number) => Promise<void>;
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
  handleCopy: () => boolean;
  handlePaste: () => Promise<void>;
  handleCut: () => Promise<boolean>;
  onResetKeyframes: () => boolean;
  onDeleteSelectedKeyframes: () => void;
  onAfterUndoRedo?: () => void;
  onToggleRecording?: () => void;
}

// ── Hook ──

export function useAppHotkeys({
  toggleTimelineVisibility,
  handleTimelineElementDelete,
  handleTimelineElementSplit,
  handleDomEditElementDelete,
  domEditSelectionRef,
  editHistory,
  readOptionalProjectFile,
  readProjectFile,
  writeProjectFile,
  domEditSaveTimestampRef,
  showToast,
  syncHistoryPreviewAfterApply,
  waitForPendingDomEditSaves,
  leftSidebarRef,
  handleCopy,
  handlePaste,
  handleCut,
  onResetKeyframes,
  onDeleteSelectedKeyframes,
  onAfterUndoRedo,
  onToggleRecording,
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
      return path === STUDIO_MOTION_PATH ? readOptionalProjectFile(path) : readProjectFile(path);
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
      onAfterUndoRedo?.();
      await syncHistoryPreviewAfterApply(result.paths);
      showToast(`Undid ${result.label}`, "info");
    }
  }, [
    editHistory,
    readHistoryProjectFile,
    showToast,
    syncHistoryPreviewAfterApply,
    waitForPendingDomEditSaves,
    writeHistoryProjectFile,
    onAfterUndoRedo,
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
      onAfterUndoRedo?.();
      await syncHistoryPreviewAfterApply(result.paths);
      showToast(`Redid ${result.label}`, "info");
    }
  }, [
    editHistory,
    readHistoryProjectFile,
    showToast,
    syncHistoryPreviewAfterApply,
    waitForPendingDomEditSaves,
    writeHistoryProjectFile,
    onAfterUndoRedo,
  ]);

  // ── Stable refs for the consolidated keydown handler ──

  const handleToggleRef = useRef(handleTimelineToggleHotkey);
  handleToggleRef.current = handleTimelineToggleHotkey;
  const handleDeleteRef = useRef(handleTimelineElementDelete);
  handleDeleteRef.current = handleTimelineElementDelete;
  const handleSplitRef = useRef(handleTimelineElementSplit);
  handleSplitRef.current = handleTimelineElementSplit;
  const handleDomEditDeleteRef = useRef(handleDomEditElementDelete);
  handleDomEditDeleteRef.current = handleDomEditElementDelete;
  const handleUndoRef = useRef(handleUndo);
  handleUndoRef.current = handleUndo;
  const handleRedoRef = useRef(handleRedo);
  handleRedoRef.current = handleRedo;
  const handleCopyRef = useRef(handleCopy);
  handleCopyRef.current = handleCopy;
  const handlePasteRef = useRef(handlePaste);
  handlePasteRef.current = handlePaste;
  const handleCutRef = useRef(handleCut);
  handleCutRef.current = handleCut;
  const onResetKeyframesRef = useRef(onResetKeyframes);
  onResetKeyframesRef.current = onResetKeyframes;
  const onDeleteSelectedKeyframesRef = useRef(onDeleteSelectedKeyframes);
  onDeleteSelectedKeyframesRef.current = onDeleteSelectedKeyframes;
  const onToggleRecordingRef = useRef(onToggleRecording);
  onToggleRecordingRef.current = onToggleRecording;

  // ── Consolidated keydown handler ──

  handleAppKeyDownRef.current = (event: KeyboardEvent) => {
    // Shift+T — toggle timeline
    handleToggleRef.current(event);

    // Cmd/Ctrl+Z — undo, Cmd/Ctrl+Shift+Z or Ctrl+Y — redo
    if (event.metaKey || event.ctrlKey) {
      if (
        !shouldIgnoreHistoryShortcut(event.target) &&
        handleUndoRedoKey(
          event,
          () => void handleUndoRef.current(),
          () => void handleRedoRef.current(),
        )
      ) {
        return;
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

      // Cmd/Ctrl+C — copy (only preventDefault if we actually have something to copy)
      const copyPasteKey = event.key.toLowerCase();
      if (
        copyPasteKey === "c" &&
        !event.shiftKey &&
        !event.altKey &&
        !isEditableTarget(event.target)
      ) {
        if (handleCopyRef.current()) {
          event.preventDefault();
        }
        return;
      }

      // Cmd/Ctrl+V — paste
      if (
        copyPasteKey === "v" &&
        !event.shiftKey &&
        !event.altKey &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        void handlePasteRef.current();
        return;
      }

      // Cmd/Ctrl+X — cut (only preventDefault if there's a selected element to cut)
      if (
        copyPasteKey === "x" &&
        !event.shiftKey &&
        !event.altKey &&
        !isEditableTarget(event.target)
      ) {
        const hasSelection =
          !!usePlayerStore.getState().selectedElementId || !!domEditSelectionRef.current;
        if (hasSelection) {
          event.preventDefault();
          void handleCutRef.current();
        }
        return;
      }
    }

    // F — toggle fullscreen preview
    if (
      event.key.toLowerCase() === "f" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !isEditableTarget(event.target)
    ) {
      event.preventDefault();
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        document.querySelector<HTMLElement>("[data-studio-fullscreen-target]")?.requestFullscreen();
      }
      return;
    }

    // S — split selected clip at playhead
    if (
      event.key === "s" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !isEditableTarget(event.target)
    ) {
      const { selectedElementId, elements, currentTime } = usePlayerStore.getState();
      if (selectedElementId) {
        const element = elements.find((el) => (el.key ?? el.id) === selectedElementId);
        if (
          element &&
          ["video", "audio", "img"].includes(element.tag) &&
          currentTime > element.start &&
          currentTime < element.start + element.duration
        ) {
          event.preventDefault();
          void handleSplitRef.current(element, currentTime);
          return;
        }
      }
    }

    // Delete / Backspace — remove selected keyframes > reset keyframes > remove element
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !isEditableTarget(event.target)
    ) {
      // Priority: selected keyframes take precedence over clip deletion
      const { selectedKeyframes } = usePlayerStore.getState();
      if (selectedKeyframes.size > 0) {
        onDeleteSelectedKeyframesRef.current();
        usePlayerStore.getState().clearSelectedKeyframes();
        event.preventDefault();
        return;
      }

      // Backspace: try resetting keyframes first; fall through to delete if none found
      if (event.key === "Backspace") {
        const { selectedElementId, keyframeCache } = usePlayerStore.getState();
        if (selectedElementId && keyframeCache.has(selectedElementId)) {
          if (onResetKeyframesRef.current()) {
            event.preventDefault();
            return;
          }
        }
      }

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

    // R — toggle gesture recording
    if (
      event.key === "r" &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !isEditableTarget(event.target) &&
      onToggleRecordingRef.current
    ) {
      event.preventDefault();
      onToggleRecordingRef.current();
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
      const nextWindow = iframeContentWindow(iframe);
      if (previewHotkeyWindowRef.current === nextWindow) return;
      if (previewHotkeyWindowRef.current) {
        try {
          previewHotkeyWindowRef.current.removeEventListener("keydown", previewAppKeyDownHandler);
        } catch {
          /* cross-origin iframe */
        }
      }
      previewHotkeyWindowRef.current = nextWindow;
      try {
        nextWindow?.addEventListener("keydown", previewAppKeyDownHandler, true);
      } catch {
        /* cross-origin iframe */
      }
    },
    [previewAppKeyDownHandler],
  );

  useEffect(
    () => () => {
      if (previewHotkeyWindowRef.current) {
        try {
          previewHotkeyWindowRef.current.removeEventListener("keydown", previewAppKeyDownHandler);
        } catch {
          /* cross-origin iframe */
        }
        previewHotkeyWindowRef.current = null;
      }
    },
    [previewAppKeyDownHandler],
  );

  // ── History hotkey for iframe forwarding ──

  const handleHistoryHotkey = useCallback((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (shouldIgnoreHistoryShortcut(event.target)) return;
    handleUndoRedoKey(
      event,
      () => void handleUndoRef.current(),
      () => void handleRedoRef.current(),
    );
  }, []);

  const syncPreviewHistoryHotkey = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      previewHistoryHotkeyCleanupRef.current?.();
      previewHistoryHotkeyCleanupRef.current = null;

      const win = iframeContentWindow(iframe);
      let doc: Document | null = null;
      try {
        doc = iframe?.contentDocument ?? null;
      } catch {
        doc = null;
      }
      if (!win && !doc) return;

      try {
        win?.addEventListener("keydown", handleHistoryHotkey, true);
      } catch {
        /* cross-origin */
      }
      doc?.addEventListener("keydown", handleHistoryHotkey, true);
      previewHistoryHotkeyCleanupRef.current = () => {
        try {
          win?.removeEventListener("keydown", handleHistoryHotkey, true);
        } catch {
          /* cross-origin */
        }
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
