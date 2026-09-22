import { useCallback, useEffect, useRef } from "react";
import { usePlayerStore } from "../player";
import type { TimelineElement } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";
import { isTypingTarget } from "../utils/typingTarget";
import { useCaptionStore } from "../captions/store";
import {
  applyCaptionModelToIframe,
  isCaptionPreviewVisible,
} from "../captions/components/CaptionOverlayUtils";
import { shouldIgnoreHistoryShortcut } from "../utils/studioHelpers";
import {
  type HotkeyCallbacks,
  dispatchModifierKey,
  dispatchPlainKey,
  handleUndoRedoKey,
} from "./appHotkeysDispatch";
import {
  useEditHistoryActions,
  type EditHistoryHandle,
  type UseEditHistoryActionsOptions,
} from "./useEditHistoryActions";

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

interface UseAppHotkeysParams {
  handleTimelineElementsDelete: (elements: TimelineElement[]) => Promise<void>;
  handleTimelineElementSplit: (element: TimelineElement, splitTime: number) => Promise<void>;
  handleDomEditElementDelete: (
    selection: DomEditSelection,
    options?: { expandGroup?: boolean },
  ) => Promise<void>;
  domEditSelectionRef: React.MutableRefObject<DomEditSelection | null>;
  clearDomSelectionRef: React.MutableRefObject<() => void>;
  editHistory: EditHistoryHandle;
  readOptionalProjectFile: (path: string) => Promise<string>;
  readProjectFile: (path: string) => Promise<string>;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  showToast: (message: string, tone?: "error" | "info") => void;
  syncHistoryPreviewAfterApply: UseEditHistoryActionsOptions["syncHistoryPreviewAfterApply"];
  waitForPendingDomEditSaves: () => Promise<void>;
  handleCopy: () => boolean;
  handlePaste: () => Promise<void>;
  handleCut: () => Promise<boolean>;
  handleDuplicate: () => Promise<boolean>;
  onResetKeyframes: () => boolean;
  onDeleteSelectedKeyframes: () => void;
  onAfterUndoRedo?: () => void;
  onToggleRecording?: () => void;
  /** Group the current multi-selection into a data-hf-group wrapper (⌘G). */
  onGroupSelection?: () => void;
  /** Ungroup the selected group wrapper (⌘⇧G). */
  onUngroupSelection?: () => void;
  /** Active composition path — used to decide whether undo/redo must resync the SDK session. */
  activeCompPath?: string | null;
  /** Clicks still select and report; the preview cannot move, edit or delete anything. */
  readOnlyPreview: boolean;
  /**
   * Force-reload the SDK session after undo/redo reverts the active comp file,
   * bypassing the self-write suppress window. Without this, the suppress window
   * blocks the file-change reload and the SDK session stays on pre-undo content.
   */
  forceReloadSdkSession?: () => void;
}

// ── Hook ──

export function useAppHotkeys({
  handleTimelineElementsDelete,
  handleTimelineElementSplit,
  handleDomEditElementDelete,
  domEditSelectionRef,
  editHistory,
  readOptionalProjectFile,
  readProjectFile,
  writeProjectFile,
  showToast,
  syncHistoryPreviewAfterApply,
  waitForPendingDomEditSaves,
  handleCopy,
  handlePaste,
  handleCut,
  handleDuplicate,
  onResetKeyframes,
  onDeleteSelectedKeyframes,
  onAfterUndoRedo,
  onToggleRecording,
  onGroupSelection,
  onUngroupSelection,
  activeCompPath,
  forceReloadSdkSession,
  readOnlyPreview,
}: UseAppHotkeysParams) {
  const previewHistoryCleanupRef = useRef<(() => void) | null>(null);

  // ── Undo / Redo ──

  const fileHistory = useEditHistoryActions({
    editHistory,
    readOptionalProjectFile,
    readProjectFile,
    writeProjectFile,
    showToast,
    syncHistoryPreviewAfterApply,
    waitForPendingDomEditSaves,
    onAfterUndoRedo,
    activeCompPath,
    forceReloadSdkSession,
  });

  const applyHistory = useCallback(
    async (direction: "undo" | "redo") => {
      // Caption edits live in their own in-memory stack. While caption edit
      // mode is active, ⌘Z must revert the caption edit — not an unrelated
      // earlier file edit (which would ALSO leave the caption change intact).
      const captionState = useCaptionStore.getState();
      // Only when the caption preview is actually visible: isEditMode stays
      // true while the preview is hidden, and eating ⌘Z
      // there would pop invisible caption edits instead of file history.
      if (captionState.isEditMode && isCaptionPreviewVisible()) {
        const restored = direction === "undo" ? captionState.undo() : captionState.redo();
        if (restored) {
          applyCaptionModelToIframe(restored);
          showToast(`${direction === "undo" ? "Undid" : "Redid"} caption edit`, "info");
          return;
        }
        // Empty caption stack: fall through to beat/file history as usual.
      }

      // Beat edits interleave with file history by timestamp; handle them first.
      if (tryApplyBeatHistory(direction, editHistory.state, showToast)) return;

      await fileHistory[direction]();
    },
    [editHistory.state, fileHistory, showToast],
  );

  const handleUndo = useCallback(() => applyHistory("undo"), [applyHistory]);
  const handleRedo = useCallback(() => applyHistory("redo"), [applyHistory]);

  // ── Stable callback ref (one ref replaces fifteen) ──

  const cbRef = useRef<HotkeyCallbacks>(null!);
  cbRef.current = {
    handleTimelineElementsDelete,
    handleTimelineElementSplit,
    handleDomEditElementDelete,
    handleUndo,
    handleRedo,
    handleCopy,
    handlePaste,
    handleCut,
    handleDuplicate,
    onResetKeyframes,
    onDeleteSelectedKeyframes,
    onToggleRecording,
    onGroupSelection,
    onUngroupSelection,
    domEditSelectionRef,
    showToast,
    readOnlyPreview,
  };

  // ── Keydown dispatch ──

  const handleAppKeyDown = useCallback((event: KeyboardEvent) => {
    const cb = cbRef.current;
    const key = event.key.toLowerCase();
    if (event.metaKey || event.ctrlKey) {
      dispatchModifierKey(event, key, cb);
      return;
    }
    if (!isTypingTarget(event.target)) dispatchPlainKey(event, key, cb);
  }, []);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    window.addEventListener("keydown", handleAppKeyDown, true);
    return () => window.removeEventListener("keydown", handleAppKeyDown, true);
  }, [handleAppKeyDown]);

  // ── Preview iframe forwarding ──

  const handleHistoryHotkey = useCallback((event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || shouldIgnoreHistoryShortcut(event.target)) return;
    handleUndoRedoKey(
      event,
      () => void cbRef.current.handleUndo(),
      () => void cbRef.current.handleRedo(),
    );
  }, []);

  /**
   * Give the preview iframe the app's hotkeys, because a keypress lands in
   * whichever document has focus and clicking the canvas puts focus in there.
   *
   * Must run on every iframe LOAD, not once when the element mounts: a reload
   * keeps the same element (so no ref callback) and the same WindowProxy (so an
   * identity check sees no change) while replacing the inner window that holds
   * the listeners. Attaching once left Delete dead in the canvas after the first
   * reload — press it with a selection and nothing happened, no toast, nothing
   * to explain it — while undo/redo kept working because they re-attached here.
   */
  const syncPreviewHotkeys = useCallback(
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
      const appHandler = handleAppKeyDown as EventListener;
      safeAddListener(win, "keydown", handler, true);
      // Window only: the history pair also listens on the document, and a
      // capture listener on both would run the app handler twice per press.
      safeAddListener(win, "keydown", appHandler, true);
      doc?.addEventListener("keydown", handleHistoryHotkey, true);
      previewHistoryCleanupRef.current = () => {
        safeRemoveListener(win, "keydown", handler);
        safeRemoveListener(win, "keydown", appHandler);
        doc?.removeEventListener("keydown", handleHistoryHotkey, true);
      };
    },
    [handleAppKeyDown, handleHistoryHotkey],
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
    syncPreviewHotkeys,
  };
}
