import { isEditableTarget } from "../utils/timelineDiscovery";

const CAPTION_NUDGE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

type CaptionNudgeKeyEvent = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "key">;

export function shouldHandleCaptionNudgeKey(
  event: CaptionNudgeKeyEvent,
  target?: EventTarget | null,
): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (target != null && isEditableTarget(target)) return false;
  return CAPTION_NUDGE_KEYS.has(event.key);
}

// Single editable-target check for the caption surface — re-exported from the
// shared timeline helper so the two never diverge (it also covers ARIA
// textbox/searchbox/combobox roles and nested editors via closest()).
export { isEditableTarget as isEditableEventTarget };
