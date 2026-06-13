import { useCallback, useEffect, useRef } from "react";
import { usePlayerStore } from "../player";
import type { TimelineElement } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";
import type { LeftSidebarHandle } from "../components/sidebar/LeftSidebar";
import { STUDIO_MOTION_PATH } from "../components/editor/studioMotion";
import { shouldHandleTimelineToggleHotkey, isEditableTarget } from "../utils/timelineDiscovery";
import { shouldIgnoreHistoryShortcut } from "../utils/studioHelpers";
import { canSplitElement } from "../utils/timelineElementSplit";
import { STUDIO_RAZOR_TOOL_ENABLED } from "../components/editor/manualEditingAvailability";

/** Safely resolves contentWindow for a potentially cross-origin iframe. */
function iframeContentWindow(iframe: HTMLIFrameElement | null): Window | null {
  try {
    return iframe?.contentWindow ?? null;
  } catch {
    return null;
  }
}

/** Cross-origin-safe addEventListener/removeEventListener wrapper. */
function safeAddListener(target: EventTarget | null, type: string, handler: EventListener, capture = false) {
  try { target?.addEventListener(type, handler, capture); } catch { /* cross-origin */ }
}
function safeRemoveListener(target: EventTarget | null, type: string, handler: EventListener) {
  try { target?.removeEventListener(type, handler); } catch { /* cross-origin */ }
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

interface HistoryFileCallbacks {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
}

interface HistoryResult {
  ok: boolean;
  reason?: string;
  label?: string;
  paths?: string[];
}

interface EditHistoryHandle {
  undo: (callbacks: HistoryFileCallbacks) => Promise<HistoryResult>;
  redo: (callbacks: HistoryFileCallbacks) => Promise<HistoryResult>;
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

  const applyHistory = useCallback(
    async (direction: "undo" | "redo") => {
      await waitForPendingDomEditSaves();
      const historyCallbacks = { readFile: readHistoryProjectFile, writeFile: writeHistoryProjectFile };
      const result = await editHistory[direction](historyCallbacks);
      if (!result.ok && result.reason === "content-mismatch") {
        showToast(`File changed outside Studio. ${direction === "undo" ? "Undo" : "Redo"} history was not applied.`, "info");
        return;
      }
      if (result.ok && result.label) {
        onAfterUndoRedo?.();
        await syncHistoryPreviewAfterApply(result.paths);
        showToast(`${direction === "undo" ? "Undid" : "Redid"} ${result.label}`, "info");
      }
    },
    [editHistory, readHistoryProjectFile, showToast, syncHistoryPreviewAfterApply, waitForPendingDomEditSaves, writeHistoryProjectFile, onAfterUndoRedo],
  );

  const handleUndo = useCallback(() => applyHistory("undo"), [applyHistory]);
  const handleRedo = useCallback(() => applyHistory("redo"), [applyHistory]);

  // ── Single ref for all mutable callbacks ──

  const callbacks = {
    toggleTimelineVisibility,
    handleTimelineElementDelete,
    handleTimelineElementSplit,
    handleDomEditElementDelete,
    handleUndo,
    handleRedo,
    handleCopy,
    handlePaste,
    handleCut,
    onResetKeyframes,
    onDeleteSelectedKeyframes,
    onToggleRecording,
  };
  const cbRef = useRef(callbacks);
  cbRef.current = callbacks;

  // ── Declarative keydown dispatch ──

  const handleAppKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const cb = cbRef.current;

      // Shift+T — timeline toggle (has its own guard via shouldHandleTimelineToggleHotkey)
      if (shouldHandleTimelineToggleHotkey(event)) {
        event.preventDefault();
        cb.toggleTimelineVisibility();
        return;
      }

      const hasMod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      // ── Modifier commands (Cmd/Ctrl+…) ──
      if (hasMod) {
        // Undo / Redo
        if (
          !shouldIgnoreHistoryShortcut(event.target) &&
          handleUndoRedoKey(
            event,
            () => void cb.handleUndo(),
            () => void cb.handleRedo(),
          )
        ) {
          return;
        }

        // Sidebar tabs
        if (event.key === "1") {
          event.preventDefault();
          leftSidebarRef.current?.selectTab("compositions");
          return;
        }
        if (event.key === "2") {
          event.preventDefault();
          leftSidebarRef.current?.selectTab("assets");
          return;
        }

        // Copy / Paste / Cut — only when not in an editable target
        if (!event.shiftKey && !event.altKey && !isEditableTarget(event.target)) {
          if (key === "c") {
            if (cb.handleCopy()) event.preventDefault();
            return;
          }
          if (key === "v") {
            event.preventDefault();
            void cb.handlePaste();
            return;
          }
          if (key === "x") {
            const hasSelection =
              !!usePlayerStore.getState().selectedElementId || !!domEditSelectionRef.current;
            if (hasSelection) {
              event.preventDefault();
              void cb.handleCut();
            }
            return;
          }
        }
        return;
      }

      // ── Plain-key commands (no modifier) ──
      if (isEditableTarget(event.target)) return;

      if (key === "f" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else {
          document
            .querySelector<HTMLElement>("[data-studio-fullscreen-target]")
            ?.requestFullscreen();
        }
        return;
      }

      if (event.key === "s" && !event.altKey) {
        const { selectedElementId, elements, currentTime } = usePlayerStore.getState();
        if (selectedElementId) {
          const element = elements.find((el) => (el.key ?? el.id) === selectedElementId);
          if (
            element &&
            canSplitElement(element) &&
            currentTime > element.start &&
            currentTime < element.start + element.duration
          ) {
            event.preventDefault();
            void cb.handleTimelineElementSplit(element, currentTime);
            return;
          }
        }
      }

      if (STUDIO_RAZOR_TOOL_ENABLED && key === "b" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        const { activeTool, setActiveTool } = usePlayerStore.getState();
        setActiveTool(activeTool === "razor" ? "select" : "razor");
        return;
      }

      if (key === "v" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        usePlayerStore.getState().setActiveTool("select");
        return;
      }

      if (event.key === "Escape") {
        const { activeTool, selectedElementId, setActiveTool, setSelectedElementId } =
          usePlayerStore.getState();
        if (activeTool === "razor") {
          if (selectedElementId) {
            setSelectedElementId(null);
          } else {
            setActiveTool("select");
          }
          event.preventDefault();
          return;
        }
      }

      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        !event.altKey
      ) {
        const { selectedKeyframes } = usePlayerStore.getState();
        if (selectedKeyframes.size > 0) {
          cb.onDeleteSelectedKeyframes();
          usePlayerStore.getState().clearSelectedKeyframes();
          event.preventDefault();
          return;
        }

        if (event.key === "Backspace") {
          const { selectedElementId, keyframeCache } = usePlayerStore.getState();
          if (selectedElementId && keyframeCache.has(selectedElementId)) {
            if (cb.onResetKeyframes()) {
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
            void cb.handleTimelineElementDelete(element);
            return;
          }
        }
        const domSelection = domEditSelectionRef.current;
        if (domSelection) {
          event.preventDefault();
          void cb.handleDomEditElementDelete(domSelection);
        }
        return;
      }

      if (event.key === "r" && !event.shiftKey && !event.altKey && cb.onToggleRecording) {
        event.preventDefault();
        cb.onToggleRecording();
      }
    },
    [domEditSelectionRef, leftSidebarRef],
  );

  // ── Window keydown listener ──

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    window.addEventListener("keydown", handleAppKeyDown, true);
    return () => window.removeEventListener("keydown", handleAppKeyDown, true);
  }, [handleAppKeyDown]);

  // ── Preview iframe keydown forwarding ──

  const syncPreviewTimelineHotkey = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      const nextWindow = iframeContentWindow(iframe);
      if (previewHotkeyWindowRef.current === nextWindow) return;
      safeRemoveListener(previewHotkeyWindowRef.current, "keydown", handleAppKeyDown as EventListener);
      previewHotkeyWindowRef.current = nextWindow;
      safeAddListener(nextWindow, "keydown", handleAppKeyDown as EventListener, true);
    },
    [handleAppKeyDown],
  );

  useEffect(
    () => () => {
      safeRemoveListener(previewHotkeyWindowRef.current, "keydown", handleAppKeyDown as EventListener);
      previewHotkeyWindowRef.current = null;
    },
    [handleAppKeyDown],
  );

  // ── History hotkey for iframe forwarding ──

  const handleHistoryHotkey = useCallback((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (shouldIgnoreHistoryShortcut(event.target)) return;
    handleUndoRedoKey(
      event,
      () => void cbRef.current.handleUndo(),
      () => void cbRef.current.handleRedo(),
    );
  }, []);

  const syncPreviewHistoryHotkey = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      previewHistoryHotkeyCleanupRef.current?.();
      previewHistoryHotkeyCleanupRef.current = null;
      const win = iframeContentWindow(iframe);
      let doc: Document | null = null;
      try { doc = iframe?.contentDocument ?? null; } catch { doc = null; }
      if (!win && !doc) return;
      safeAddListener(win, "keydown", handleHistoryHotkey as EventListener, true);
      doc?.addEventListener("keydown", handleHistoryHotkey, true);
      previewHistoryHotkeyCleanupRef.current = () => {
        safeRemoveListener(win, "keydown", handleHistoryHotkey as EventListener);
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
