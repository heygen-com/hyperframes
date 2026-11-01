import { isEditableTarget } from "../utils/timelineDiscovery";
import { ownsPlainKeys } from "../utils/typingTarget";
import { resolveCanvasNudgeDelta } from "../components/editor/domEditNudge";

type CaptionNudgeKeyEvent = Parameters<typeof resolveCanvasNudgeDelta>[0];

/** The nudge delta for this key, or null when it is not a nudge or the target owns its keys. */
export function resolveCaptionNudge(event: CaptionNudgeKeyEvent, target?: EventTarget | null) {
  if (target != null && ownsPlainKeys(target)) return null;
  return resolveCanvasNudgeDelta(event);
}

export const shouldHandleCaptionNudgeKey = (
  event: CaptionNudgeKeyEvent,
  target?: EventTarget | null,
): boolean => resolveCaptionNudge(event, target) !== null;

// Single editable-target check for the caption surface — re-exported from the
// shared timeline helper so the two never diverge (it also covers ARIA
// textbox/searchbox/combobox roles and nested editors via closest()).
export { isEditableTarget as isEditableEventTarget };
