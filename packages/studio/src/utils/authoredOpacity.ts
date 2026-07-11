/**
 * Authored-opacity contract, studio side. The runtime stamps every graded
 * element's authored inline opacity at document parse time (see
 * installAuthoredOpacityCapture in @hyperframes/core); studio code that makes
 * GSAP re-initialize tweens (soft reload, in-place patches) restores it so
 * re-captures never bake a runtime transient in as a tween bound.
 */
import { COLOR_GRADING_AUTHORED_OPACITY_ATTR } from "@hyperframes/core/color-grading";

interface AttributeReader {
  getAttribute(name: string): string | null;
}

/**
 * The stamped authored inline opacity. Three-state:
 *   "0.98" — the authored value; "" — captured, authored none;
 *   null — never captured (unknown).
 * Duck-typed so iframe-realm elements (no shared HTMLElement) work.
 */
export function readStampedAuthoredOpacity(element: AttributeReader): string | null {
  return element.getAttribute(COLOR_GRADING_AUTHORED_OPACITY_ATTR);
}

/** Write an authored inline opacity back: "" removes the property, a value sets it. */
export function applyAuthoredInlineOpacity(style: CSSStyleDeclaration, authored: string): void {
  if (authored === "") style.removeProperty("opacity");
  else style.setProperty("opacity", authored);
}
