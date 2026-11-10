import type { KeyboardEvent as ReactKeyboardEvent } from "react";

// Safari ends the composition before its keydown and flags it only with keyCode 229.
export function isImeComposing(event: KeyboardEvent | ReactKeyboardEvent): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}

export function outsideImeComposition<E extends KeyboardEvent | ReactKeyboardEvent>(
  handler: (event: E) => void,
): (event: E) => void {
  return (event) => {
    if (!isImeComposing(event)) handler(event);
  };
}
