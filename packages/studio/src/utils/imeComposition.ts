import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Whether a key belongs to an input method (Korean, Japanese, Chinese) that is
 * still composing, so a field must leave it alone rather than commit, submit or
 * cancel on it.
 *
 * Chrome on macOS delivers a Korean Enter twice: once while the last syllable is
 * still composing, then again after the IME has committed it. A field that
 * submits and clears on the first gets that syllable typed back into the empty
 * field, and the second Enter submits it again: "분기" made two branches, "분기"
 * and "기". A Japanese or Chinese Enter only confirms a conversion and an
 * Escape only cancels it; neither means the user is done with the field.
 *
 * Safari ends the composition before its keydown and says so only through
 * keyCode 229, which is why that is checked too.
 */
export function isImeComposing(event: KeyboardEvent | ReactKeyboardEvent): boolean {
  const native = "nativeEvent" in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}

/** A keydown handler that never sees a key the IME is still composing with. */
export function outsideImeComposition<E extends KeyboardEvent | ReactKeyboardEvent>(
  handler: (event: E) => void,
): (event: E) => void {
  return (event) => {
    if (!isImeComposing(event)) handler(event);
  };
}
