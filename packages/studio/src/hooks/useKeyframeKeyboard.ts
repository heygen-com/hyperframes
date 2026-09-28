import { useEffect, useCallback } from "react";
import { STUDIO_PLAIN_KEYS } from "../player/components/studioShortcuts";

interface KeyframeKeyboardOptions {
  enabled: boolean;
  onAddKeyframe?: () => void;
}

function isTextInput(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable === true;
}

export function useKeyframeKeyboard({ enabled, onAddKeyframe }: KeyframeKeyboardOptions): void {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled || !onAddKeyframe) return;
      if (isTextInput(document.activeElement)) return;
      if (e.metaKey || e.ctrlKey) return; // never shadow browser/system combos
      if (e.key.toLowerCase() !== STUDIO_PLAIN_KEYS.addKeyframe) return;
      // K is also playback's stop key: claiming it here keeps playback from also pausing.
      e.preventDefault();
      e.stopImmediatePropagation();
      onAddKeyframe();
    },
    [enabled, onAddKeyframe],
  );

  useEffect(() => {
    if (!enabled) return;
    // Capture phase: run before usePlaybackKeyboard's (bubble-phase) JKL handler
    // so an active keyframe shortcut can claim the key.
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [enabled, handler]);
}
