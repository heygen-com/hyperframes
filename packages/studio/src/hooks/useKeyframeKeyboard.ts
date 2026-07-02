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
      if (e.metaKey || e.ctrlKey) return; // never shadow browser/system combos

      const hasSelectedKeyframes = usePlayerStore.getState().selectedKeyframes.size > 0;

      // Only consume a key we can actually act on. The fall-through matters:
      // these keys (k/j/arrows) double as JKL playback shortcuts in
      // usePlaybackKeyboard, so when a handler is absent we must let the event
      // continue. When we DO act, stopImmediatePropagation prevents the playback
      // handler from also firing (e.g. K pausing instead of adding a keyframe).
      // The listener is registered in the capture phase so it runs first.
      const consume = (run: () => void) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        run();
      };

      switch (e.key.toLowerCase()) {
        case "k":
          if (onAddKeyframe) consume(onAddKeyframe);
          break;
        case "delete":
        case "backspace":
          if (onDeleteKeyframe && hasSelectedKeyframes) consume(onDeleteKeyframe);
          break;
        case "j": {
          const nav = e.shiftKey ? onNextKeyframe : onPrevKeyframe;
          if (nav) consume(nav);
          break;
        }
        case "h":
          if (onToggleHold && hasSelectedKeyframes) consume(onToggleHold);
          break;
        case "u":
          if (onToggleExpand) consume(onToggleExpand);
          break;
        case "arrowleft":
          if (onNudgeKeyframe && hasSelectedKeyframes && !e.altKey)
            consume(() => onNudgeKeyframe(-1, e.shiftKey));
          break;
        case "arrowright":
          if (onNudgeKeyframe && hasSelectedKeyframes && !e.altKey)
            consume(() => onNudgeKeyframe(1, e.shiftKey));
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
    // Capture phase: run before usePlaybackKeyboard's (bubble-phase) JKL handler
    // so an active keyframe shortcut can claim the key.
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [enabled, handler]);
}
