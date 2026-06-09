import { useEffect, useCallback } from "react";
import { usePlayerStore } from "../player/store/playerStore";

interface KeyframeKeyboardOptions {
  enabled: boolean;
  onAddKeyframe?: () => void;
  onDeleteKeyframe?: () => void;
  onPrevKeyframe?: () => void;
  onNextKeyframe?: () => void;
  onToggleHold?: () => void;
  onToggleExpand?: () => void;
  onNudgeKeyframe?: (direction: -1 | 1, large: boolean) => void;
}

function isTextInput(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable === true;
}

export function useKeyframeKeyboard({
  enabled,
  onAddKeyframe,
  onDeleteKeyframe,
  onPrevKeyframe,
  onNextKeyframe,
  onToggleHold,
  onToggleExpand,
  onNudgeKeyframe,
}: KeyframeKeyboardOptions): void {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;
      if (isTextInput(document.activeElement)) return;

      const hasSelectedKeyframes = usePlayerStore.getState().selectedKeyframes.size > 0;

      switch (e.key.toLowerCase()) {
        case "k":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            onAddKeyframe?.();
          }
          break;
        case "delete":
        case "backspace":
          if (hasSelectedKeyframes) {
            e.preventDefault();
            onDeleteKeyframe?.();
          }
          break;
        case "j":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            if (e.shiftKey) onNextKeyframe?.();
            else onPrevKeyframe?.();
          }
          break;
        case "h":
          if (!e.metaKey && !e.ctrlKey && hasSelectedKeyframes) {
            e.preventDefault();
            onToggleHold?.();
          }
          break;
        case "u":
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault();
            onToggleExpand?.();
          }
          break;
        case "arrowleft":
          if (hasSelectedKeyframes && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            onNudgeKeyframe?.(-1, e.shiftKey);
          }
          break;
        case "arrowright":
          if (hasSelectedKeyframes && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            onNudgeKeyframe?.(1, e.shiftKey);
          }
          break;
      }
    },
    [
      enabled,
      onAddKeyframe,
      onDeleteKeyframe,
      onPrevKeyframe,
      onNextKeyframe,
      onToggleHold,
      onToggleExpand,
      onNudgeKeyframe,
    ],
  );

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, handler]);
}
