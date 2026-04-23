export const TIMELINE_TOGGLE_SHORTCUT_LABEL = "Shift+T";
const TIMELINE_EDITOR_HINT_STORAGE_KEY = "hf-studio-timeline-editor-hint-dismissed";

type TimelineToggleHotkeyEvent = Pick<
  KeyboardEvent,
  "key" | "shiftKey" | "metaKey" | "ctrlKey" | "altKey" | "target"
>;

interface EditableTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
  getAttribute?: (name: string) => string | null;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;

  const element = target as EditableTargetLike;
  const tagName = element.tagName?.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") return true;
  if (element.isContentEditable) return true;

  const role = element.getAttribute?.("role");
  if (role === "textbox" || role === "searchbox" || role === "combobox") return true;

  return Boolean(
    element.closest?.(
      "input, textarea, select, [contenteditable='true'], [role='textbox'], .cm-editor",
    ),
  );
}

export function shouldHandleTimelineToggleHotkey(event: TimelineToggleHotkeyEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (!event.shiftKey) return false;
  if (event.key.toLowerCase() !== "t") return false;
  return !isEditableTarget(event.target);
}

export function getTimelineToggleTitle(timelineVisible: boolean): string {
  return `${timelineVisible ? "Hide" : "Show"} timeline editor (${TIMELINE_TOGGLE_SHORTCUT_LABEL})`;
}

export function getTimelineEditorHintDismissed(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(TIMELINE_EDITOR_HINT_STORAGE_KEY) === "1";
}

export function setTimelineEditorHintDismissed(dismissed: boolean): void {
  if (typeof window === "undefined") return;
  if (dismissed) {
    window.localStorage.setItem(TIMELINE_EDITOR_HINT_STORAGE_KEY, "1");
    return;
  }
  window.localStorage.removeItem(TIMELINE_EDITOR_HINT_STORAGE_KEY);
}
