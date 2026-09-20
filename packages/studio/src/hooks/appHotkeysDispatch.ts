import { automationOwnsKey } from "./useAutomationSelectionKeyboard";
import { usePlayerStore } from "../player";
import type { TimelineElement } from "../player";
import type { DomEditSelection } from "../components/editor/domEditing";
import { useDockLayoutStore } from "../components/dock/dockLayoutStore";
import { isTypingTarget } from "../utils/typingTarget";
import { isEditableTarget } from "../utils/timelineDiscovery";
import { shouldIgnoreHistoryShortcut } from "../utils/studioHelpers";
import { canSplitElement } from "../utils/timelineElementSplit";
import { trackStudioEvent } from "../utils/studioTelemetry";

// Extracted from useAppHotkeys.ts to keep it under the studio 600-line cap,
// following useTimelineDeleteOps's precedent. Pure functions, no hooks — the
// hook still owns the actual keydown listeners and calls into these.

/** Exported so useAppHotkeys's own history-only preview listener can reuse
 *  the same undo/redo key arbitration without duplicating it. */
export function handleUndoRedoKey(
  event: KeyboardEvent,
  onUndo: () => void,
  onRedo: () => void,
): boolean {
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

export interface HotkeyCallbacks {
  handleTimelineElementsDelete: (elements: TimelineElement[]) => Promise<void>;
  handleTimelineElementSplit: (element: TimelineElement, splitTime: number) => Promise<void>;
  handleDomEditElementDelete: (
    selection: DomEditSelection,
    options?: { expandGroup?: boolean },
  ) => Promise<void>;
  handleUndo: () => Promise<void>;
  handleRedo: () => Promise<void>;
  handleCopy: () => boolean;
  handlePaste: () => Promise<void>;
  handleCut: () => Promise<boolean>;
  handleDuplicate: () => Promise<boolean>;
  onResetKeyframes: () => boolean;
  onDeleteSelectedKeyframes: () => void;
  onToggleRecording?: () => void;
  onGroupSelection?: () => void;
  onUngroupSelection?: () => void;
  domEditSelectionRef: React.MutableRefObject<DomEditSelection | null>;
  showToast: (message: string, tone?: "error" | "info") => void;
  readOnlyPreview: boolean;
}

function timelineOwnsKey(event: KeyboardEvent): boolean {
  return event.target instanceof Element && event.target.closest("[data-studio-timeline]") !== null;
}

/** Exported for tests, like dispatchPlainKey below: lets the Cmd+C/Cmd+V
 *  arbitration between an automation range and the clip clipboard be asserted
 *  without standing up the whole hook. */
export function dispatchModifierKey(
  event: KeyboardEvent,
  key: string,
  cb: HotkeyCallbacks,
): boolean {
  if (
    !shouldIgnoreHistoryShortcut(event.target) &&
    handleUndoRedoKey(
      event,
      () => {
        trackStudioEvent("keyboard_shortcut", { action: "undo" });
        void cb.handleUndo();
      },
      () => {
        trackStudioEvent("keyboard_shortcut", { action: "redo" });
        void cb.handleRedo();
      },
    )
  )
    return true;

  if (event.key === "1") {
    event.preventDefault();
    trackStudioEvent("keyboard_shortcut", { action: "tab_compositions" });
    useDockLayoutStore.getState().activatePanel("compositions");
    return true;
  }
  if (event.key === "2") {
    event.preventDefault();
    trackStudioEvent("keyboard_shortcut", { action: "tab_assets" });
    useDockLayoutStore.getState().activatePanel("assets");
    return true;
  }

  if (key === "g" && !event.altKey && !isTypingTarget(event.target)) {
    event.preventDefault();
    if (cb.readOnlyPreview) return true;
    if (event.shiftKey) cb.onUngroupSelection?.();
    else cb.onGroupSelection?.();
    return true;
  }

  if (!event.shiftKey && !event.altKey && !isEditableTarget(event.target)) {
    // An active automation range owns Cmd+C/Cmd+V, same as Delete below: this
    // capture listener runs before useAutomationSelectionKeyboard's, so without
    // this both clipboards raced the same key. No preventDefault, so the
    // downstream handler still sees it.
    if (automationOwnsKey(event)) return true;
    if (key === "c") {
      if (cb.handleCopy()) {
        event.preventDefault();
        trackStudioEvent("keyboard_shortcut", { action: "copy" });
      }
      return true;
    }
    const previewOwnsMutation =
      cb.readOnlyPreview && cb.domEditSelectionRef.current !== null && !timelineOwnsKey(event);
    if (previewOwnsMutation && ["v", "x", "d"].includes(key)) {
      event.preventDefault();
      return true;
    }
    if (key === "v") {
      event.preventDefault();
      trackStudioEvent("keyboard_shortcut", { action: "paste" });
      void cb.handlePaste();
      return true;
    }
    if (key === "x") {
      if (usePlayerStore.getState().selectedElementId || cb.domEditSelectionRef.current) {
        event.preventDefault();
        trackStudioEvent("keyboard_shortcut", { action: "cut" });
        void cb.handleCut();
      }
      return true;
    }
    if (key === "d") {
      // Always own this key here, even with nothing selected — otherwise the
      // browser's own Cmd+D (bookmark this page) fires over the editor.
      event.preventDefault();
      if (usePlayerStore.getState().selectedElementId) {
        trackStudioEvent("keyboard_shortcut", { action: "duplicate" });
        void cb.handleDuplicate();
      }
      return true;
    }
  }
  return false;
}

// fallow-ignore-next-line complexity
/** Exported for tests: the unmodified-key half of the dispatcher, so the
 *  Delete arbitration between keyframes, an automation range and the clip can
 *  be asserted without standing up the whole hook. */
export function dispatchPlainKey(event: KeyboardEvent, key: string, cb: HotkeyCallbacks): void {
  if (key === "f" && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    if (document.fullscreenElement) void document.exitFullscreen();
    else
      document.querySelector<HTMLElement>("[data-studio-fullscreen-target]")?.requestFullscreen();
    return;
  }

  if (event.key === "s" && !event.altKey) {
    // Reserve bare `s` for Split even when the current selection cannot split,
    // so secondary listeners do not reinterpret the same key as Snap toggle.
    event.preventDefault();
    const { selectedElementId, elements, currentTime } = usePlayerStore.getState();
    if (selectedElementId) {
      const el = elements.find((e) => (e.key ?? e.id) === selectedElementId);
      if (
        el &&
        canSplitElement(el) &&
        currentTime > el.start &&
        currentTime < el.start + el.duration
      ) {
        void cb.handleTimelineElementSplit(el, currentTime);
        return;
      }
      // Expanded sub-comp children carry a qualified `sourceFile#id` selection
      // that isn't in the raw `elements` list, so the s-key can't resolve them.
      // Nudge toward the razor tool instead of failing silently.
      if (!el && selectedElementId.includes("#")) {
        cb.showToast("Use the razor tool (B) to split clips inside a sub-composition", "info");
        return;
      }
    }
  }

  if (key === "b" && !event.shiftKey && !event.altKey) {
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

  // CapCut returns to the select tool with "A". Scoped to the razor being
  // armed; usePlaybackKeyboard.ts's own "A" (seek to in-point) checks the
  // same activeTool to stay out of the way.
  if (key === "a" && !event.shiftKey && !event.altKey) {
    const { activeTool, setActiveTool } = usePlayerStore.getState();
    if (activeTool === "razor") {
      event.preventDefault();
      setActiveTool("select");
      return;
    }
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
    // An active automation range owns Delete (empties the range in place).
    // No preventDefault: this capture listener runs first, so falling through
    // is what lets the document-level handler still see the key instead of
    // the press reaching the clip delete below.
    if (usePlayerStore.getState().automationSelection) return;
    if (event.key === "Backspace") {
      const { selectedElementId, keyframeCache } = usePlayerStore.getState();
      if (selectedElementId && keyframeCache.has(selectedElementId) && cb.onResetKeyframes()) {
        event.preventDefault();
        return;
      }
    }
    // The canvas selection owns Delete first: the timeline mirror of it is
    // lossy (drops a member with no timeline row of its own), so deleting via
    // the timeline left other selected elements behind. Timeline stays as the
    // fallback for rows with no canvas node (audio, an inactive comp).
    const domSel = cb.domEditSelectionRef.current;
    const timelineOwnsDelete = timelineOwnsKey(event);
    if (domSel && !timelineOwnsDelete) {
      event.preventDefault();
      if (cb.readOnlyPreview) return;
      // The whole marquee group, not just the primary the ref holds.
      void cb.handleDomEditElementDelete(domSel, { expandGroup: true });
      return;
    }
    // Takes the WHOLE selection: `find` returned the first match, so selecting
    // every clip and pressing Delete removed exactly one of them.
    const { selectedElementId, selectedElementIds, elements } = usePlayerStore.getState();
    const selectionKeys = new Set(selectedElementIds);
    if (selectedElementId) selectionKeys.add(selectedElementId);
    const selected = elements.filter((e) => selectionKeys.has(e.key ?? e.id));
    if (selected.length > 0) {
      event.preventDefault();
      void cb.handleTimelineElementsDelete(selected);
    }
    return;
  }

  if (event.key === "r" && !event.shiftKey && !event.altKey && cb.onToggleRecording) {
    event.preventDefault();
    cb.onToggleRecording();
  }
}
