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

function iframeContentWindow(iframe: HTMLIFrameElement | null): Window | null {
  try {
    return iframe?.contentWindow ?? null;
  } catch {
    return null;
  }
}

function safeAddListener(t: EventTarget | null, type: string, h: EventListener, capture = false) {
  try {
    t?.addEventListener(type, h, capture);
  } catch {
    /* cross-origin */
  }
}
function safeRemoveListener(t: EventTarget | null, type: string, h: EventListener) {
  try {
    t?.removeEventListener(type, h);
  } catch {
    /* cross-origin */
  }
}

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

// Beat edits live in an in-memory stack interleaved with file history by
// timestamp. Undo steps to the NEWER op (beatAt >= fileAt); redo replays the
// inverse, stepping to the OLDER op (beatAt <= fileAt). Returns true when it
// handled the keystroke (so the file-history path is skipped).
// fallow-ignore-next-line complexity
function tryApplyBeatHistory(
  direction: "undo" | "redo",
  fileState: {
    undo: ReadonlyArray<{ createdAt: number }>;
    redo: ReadonlyArray<{ createdAt: number }>;
  },
  showToast: (message: string, tone?: "error" | "info") => void,
): boolean {
  const ps = usePlayerStore.getState();
  const beatStack = direction === "undo" ? ps.beatUndo : ps.beatRedo;
  const beatAt = beatStack[beatStack.length - 1]?.at ?? null;
  if (beatAt === null) return false;
  const fileStack = fileState[direction];
  const fileAt = fileStack[fileStack.length - 1]?.createdAt ?? null;
  if (fileAt !== null && (direction === "undo" ? beatAt < fileAt : beatAt > fileAt)) return false;
  const label = direction === "undo" ? ps.undoBeatEdits() : ps.redoBeatEdits();
  if (label) showToast(`${direction === "undo" ? "Undid" : "Redid"} ${label}`, "info");
  return true;
}

// ── Types ──

interface HistoryResult {
  ok: boolean;
  reason?: string;
  label?: string;
  paths?: string[];
}
interface HistoryFileCallbacks {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
}
interface EditHistoryHandle {
  undo: (cb: HistoryFileCallbacks) => Promise<HistoryResult>;
  redo: (cb: HistoryFileCallbacks) => Promise<HistoryResult>;
  state: {
    undo: ReadonlyArray<{ createdAt: number }>;
    redo: ReadonlyArray<{ createdAt: number }>;
  };
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
  /** Active composition path — used to decide whether undo/redo must resync the SDK session. */
  activeCompPath?: string | null;
  /**
   * Force-reload the SDK session after undo/redo reverts the active comp file,
   * bypassing the self-write suppress window. Without this, the suppress window
   * blocks the file-change reload and the SDK session stays on pre-undo content.
   */
  forceReloadSdkSession?: () => void;
}

// ── Extracted keydown dispatch (pure function, no hooks) ──

interface HotkeyCallbacks {
  toggleTimelineVisibility: () => void;
  handleTimelineElementDelete: (element: TimelineElement) => Promise<void>;
  handleTimelineElementSplit: (element: TimelineElement, splitTime: number) => Promise<void>;
  handleDomEditElementDelete: (selection: DomEditSelection) => Promise<void>;
  handleUndo: () => Promise<void>;
  handleRedo: () => Promise<void>;
  handleCopy: () => boolean;
  handlePaste: () => Promise<void>;
  handleCut: () => Promise<boolean>;
  onResetKeyframes: () => boolean;
  onDeleteSelectedKeyframes: () => void;
  onToggleRecording?: () => void;
  leftSidebarRef: React.RefObject<LeftSidebarHandle | null>;
  domEditSelectionRef: React.MutableRefObject<DomEditSelection | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
}

function dispatchModifierKey(event: KeyboardEvent, key: string, cb: HotkeyCallbacks): boolean {
  if (
    !shouldIgnoreHistoryShortcut(event.target) &&
    handleUndoRedoKey(
      event,
      () => void cb.handleUndo(),
      () => void cb.handleRedo(),
    )
  )
    return true;

  if (event.key === "1") {
    event.preventDefault();
    cb.leftSidebarRef.current?.selectTab("compositions");
    return true;
  }
  if (event.key === "2") {
    event.preventDefault();
    cb.leftSidebarRef.current?.selectTab("assets");
    return true;
  }

  if (!event.shiftKey && !event.altKey && !isEditableTarget(event.target)) {
    if (key === "c") {
      if (cb.handleCopy()) event.preventDefault();
      return true;
    }
    if (key === "v") {
      event.preventDefault();
      void cb.handlePaste();
      return true;
    }
    if (key === "x") {
      if (usePlayerStore.getState().selectedElementId || cb.domEditSelectionRef.current) {
        event.preventDefault();
        void cb.handleCut();
      }
      return true;
    }
  }
  return false;
}

// fallow-ignore-next-line complexity
function dispatchPlainKey(event: KeyboardEvent, key: string, cb: HotkeyCallbacks): void {
  if (key === "f" && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      document.querySelector<HTMLElement>("[data-studio-fullscreen-target]")?.requestFullscreen();
    return;
  }

  if (event.key === "s" && !event.altKey) {
    const { selectedElementId, elements, currentTime } = usePlayerStore.getState();
    if (selectedElementId) {
      const el = elements.find((e) => (e.key ?? e.id) === selectedElementId);
      if (
        el &&
        canSplitElement(el) &&
        currentTime > el.start &&
        currentTime < el.start + el.duration
      ) {
        event.preventDefault();
        void cb.handleTimelineElementSplit(el, currentTime);
        return;
      }
      // Expanded sub-comp children carry a qualified `sourceFile#id` selection
      // that isn't in the raw `elements` list, so the s-key can't resolve them.
      // Nudge toward the razor tool instead of failing silently.
      if (!el && selectedElementId.includes("#")) {
        event.preventDefault();
        cb.showToast("Use the razor tool (B) to split clips inside a sub-composition", "info");
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
      if (selectedElementId) setSelectedElementId(null);
      else setActiveTool("select");
      event.preventDefault();
      return;
    }
  }

  if ((event.key === "Delete" || event.key === "Backspace") && !event.altKey) {
    if (usePlayerStore.getState().selectedKeyframes.size > 0) {
      cb.onDeleteSelectedKeyframes();
      usePlayerStore.getState().clearSelectedKeyframes();
      event.preventDefault();
      return;
    }
    if (event.key === "Backspace") {
      const { selectedElementId, keyframeCache } = usePlayerStore.getState();
      if (selectedElementId && keyframeCache.has(selectedElementId) && cb.onResetKeyframes()) {
        event.preventDefault();
        return;
      }
    }
    const { selectedElementId, elements } = usePlayerStore.getState();
    if (selectedElementId) {
      const el = elements.find((e) => (e.key ?? e.id) === selectedElementId);
      if (el) {
        event.preventDefault();
        void cb.handleTimelineElementDelete(el);
        return;
      }
    }
    const domSel = cb.domEditSelectionRef.current;
    if (domSel) {
      event.preventDefault();
      void cb.handleDomEditElementDelete(domSel);
    }
    return;
  }

  if (event.key === "r" && !event.shiftKey && !event.altKey && cb.onToggleRecording) {
    event.preventDefault();
    cb.onToggleRecording();
  }
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
  activeCompPath,
  forceReloadSdkSession,
}: UseAppHotkeysParams) {
  const previewHotkeyWindowRef = useRef<Window | null>(null);
  const previewHistoryCleanupRef = useRef<(() => void) | null>(null);

  const handleTimelineToggleHotkey = useCallback(
    (event: KeyboardEvent) => {
      if (!shouldHandleTimelineToggleHotkey(event)) return;
      event.preventDefault();
      toggleTimelineVisibility();
    },
    [toggleTimelineVisibility],
  );

  // ── Undo / Redo ──

  const readHistoryFile = useCallback(
    (path: string): Promise<string> =>
      path === STUDIO_MOTION_PATH ? readOptionalProjectFile(path) : readProjectFile(path),
    [readOptionalProjectFile, readProjectFile],
  );
  const writeHistoryFile = useCallback(
    async (path: string, content: string): Promise<void> => {
      domEditSaveTimestampRef.current = Date.now();
      await writeProjectFile(path, content);
    },
    [domEditSaveTimestampRef, writeProjectFile],
  );

  const applyHistory = useCallback(
    async (direction: "undo" | "redo") => {
      // Beat edits interleave with file history by timestamp; handle them first.
      if (tryApplyBeatHistory(direction, editHistory.state, showToast)) return;

      await waitForPendingDomEditSaves();
      const result = await editHistory[direction]({
        readFile: readHistoryFile,
        writeFile: writeHistoryFile,
      });
      if (!result.ok && result.reason === "content-mismatch") {
        showToast(
          `File changed outside Studio. ${direction === "undo" ? "Undo" : "Redo"} history was not applied.`,
          "info",
        );
        return;
      }
      if (result.ok && result.label) {
        onAfterUndoRedo?.();
        // If the active composition was among the written files, force-reload
        // the SDK session so its in-memory doc matches the reverted content.
        // writeHistoryFile sets domEditSaveTimestampRef which activates the
        // 2 s suppress window — without this call the file-change event would
        // be swallowed and the SDK session would stay on stale pre-undo content.
        if (activeCompPath && result.paths?.includes(activeCompPath)) {
          forceReloadSdkSession?.();
        }
        await syncHistoryPreviewAfterApply(result.paths);
        showToast(`${direction === "undo" ? "Undid" : "Redid"} ${result.label}`, "info");
      }
    },
    [
      editHistory,
      readHistoryFile,
      showToast,
      syncHistoryPreviewAfterApply,
      waitForPendingDomEditSaves,
      writeHistoryFile,
      onAfterUndoRedo,
      activeCompPath,
      forceReloadSdkSession,
    ],
  );

  const handleUndo = useCallback(() => applyHistory("undo"), [applyHistory]);
  const handleRedo = useCallback(() => applyHistory("redo"), [applyHistory]);

  // ── Stable callback ref (one ref replaces fifteen) ──

  const cbRef = useRef<HotkeyCallbacks>(null!);
  cbRef.current = {
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
    leftSidebarRef,
    domEditSelectionRef,
    showToast,
  };

  // ── Keydown dispatch ──

  const handleAppKeyDown = useCallback((event: KeyboardEvent) => {
    const cb = cbRef.current;
    if (shouldHandleTimelineToggleHotkey(event)) {
      event.preventDefault();
      cb.toggleTimelineVisibility();
      return;
    }
    const key = event.key.toLowerCase();
    if (event.metaKey || event.ctrlKey) {
      dispatchModifierKey(event, key, cb);
      return;
    }
    if (!isEditableTarget(event.target)) dispatchPlainKey(event, key, cb);
  }, []);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    window.addEventListener("keydown", handleAppKeyDown, true);
    return () => window.removeEventListener("keydown", handleAppKeyDown, true);
  }, [handleAppKeyDown]);

  // ── Preview iframe forwarding ──

  const syncPreviewTimelineHotkey = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      const nextWindow = iframeContentWindow(iframe);
      if (previewHotkeyWindowRef.current === nextWindow) return;
      safeRemoveListener(
        previewHotkeyWindowRef.current,
        "keydown",
        handleAppKeyDown as EventListener,
      );
      previewHotkeyWindowRef.current = nextWindow;
      safeAddListener(nextWindow, "keydown", handleAppKeyDown as EventListener, true);
    },
    [handleAppKeyDown],
  );

  useEffect(
    () => () => {
      safeRemoveListener(
        previewHotkeyWindowRef.current,
        "keydown",
        handleAppKeyDown as EventListener,
      );
      previewHotkeyWindowRef.current = null;
    },
    [handleAppKeyDown],
  );

  const handleHistoryHotkey = useCallback((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || shouldIgnoreHistoryShortcut(event.target)) return;
    handleUndoRedoKey(
      event,
      () => void cbRef.current.handleUndo(),
      () => void cbRef.current.handleRedo(),
    );
  }, []);

  const syncPreviewHistoryHotkey = useCallback(
    (iframe: HTMLIFrameElement | null) => {
      previewHistoryCleanupRef.current?.();
      previewHistoryCleanupRef.current = null;
      const win = iframeContentWindow(iframe);
      let doc: Document | null = null;
      try {
        doc = iframe?.contentDocument ?? null;
      } catch {
        doc = null;
      }
      if (!win && !doc) return;
      const handler = handleHistoryHotkey as EventListener;
      safeAddListener(win, "keydown", handler, true);
      doc?.addEventListener("keydown", handleHistoryHotkey, true);
      previewHistoryCleanupRef.current = () => {
        safeRemoveListener(win, "keydown", handler);
        doc?.removeEventListener("keydown", handleHistoryHotkey, true);
      };
    },
    [handleHistoryHotkey],
  );

  useEffect(
    () => () => {
      previewHistoryCleanupRef.current?.();
      previewHistoryCleanupRef.current = null;
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
