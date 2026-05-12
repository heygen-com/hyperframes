/**
 * Keyboard shortcut filtering logic for playback controls.
 *
 * Determines whether a keydown event should be handled as a playback shortcut
 * or ignored (e.g. when focus is in an input field, or when caption edit mode
 * is active and the user is navigating caption segments).
 */

const PLAYBACK_FRAME_STEP_CODES = new Set(["ArrowLeft", "ArrowRight"]);

const PLAYBACK_SHORTCUT_IGNORED_SELECTOR = [
  "input",
  "textarea",
  "select",
  "button",
  "a[href]",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='combobox']",
  "[role='menuitem']",
  "[role='radio']",
  "[role='slider']",
  "[role='spinbutton']",
  "[role='switch']",
  "[role='textbox']",
].join(",");

export function shouldIgnorePlaybackShortcutTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const candidate = target as { closest?: unknown };
  if (typeof candidate.closest !== "function") return false;
  return (
    (candidate.closest as (selector: string) => Element | null).call(
      target,
      PLAYBACK_SHORTCUT_IGNORED_SELECTOR,
    ) !== null
  );
}

interface PlaybackShortcutCaptionState {
  isCaptionEditMode: boolean;
  selectedCaptionSegmentCount: number;
}

type PlaybackShortcutEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "metaKey" | "code" | "target"
>;

export function shouldIgnorePlaybackShortcutEvent(
  event: PlaybackShortcutEvent,
  captionState: PlaybackShortcutCaptionState = {
    isCaptionEditMode: false,
    selectedCaptionSegmentCount: 0,
  },
): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  if (shouldIgnorePlaybackShortcutTarget(event.target)) return true;
  return (
    PLAYBACK_FRAME_STEP_CODES.has(event.code) &&
    captionState.isCaptionEditMode &&
    captionState.selectedCaptionSegmentCount > 0
  );
}

/** JKL shuttle speeds (×1, ×2, ×4). */
export const SHUTTLE_SPEEDS = [1, 2, 4] as const;
