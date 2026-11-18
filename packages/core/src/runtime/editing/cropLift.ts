/**
 * Studio's crop lift in a frame it cannot script. While an element's crop is edited, a rule hides
 * its clip-path so the cropped-away part shows; the element's own clip-path stays the saved record.
 */
import { elementForHandle } from "../editingHandles";
import type { EditingParams, EditingResult } from "../editingPort";

const lifts = new WeakMap<Element, HTMLStyleElement>();

/** The same selector Studio's own lift writes: only an element with a data-hf-id or an id is lifted. */
function liftSelector(element: Element): string | null {
  const quote = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;
  const hfId = element.getAttribute("data-hf-id");
  if (hfId) return `[data-hf-id=${quote(hfId)}]`;
  return element.id ? `[id=${quote(element.id)}]` : null;
}

export function cropLift({ handle, lift }: EditingParams<"crop-lift">): EditingResult<"crop-lift"> {
  const element = elementForHandle(handle);
  if (!element) return { lifted: false, clipPath: null };
  lifts.get(element)?.remove();
  lifts.delete(element);
  const clipPath = window.getComputedStyle(element).clipPath.trim();
  const selector = lift ? liftSelector(element) : null;
  if (!selector) return { lifted: false, clipPath };
  const rule = document.createElement("style");
  rule.textContent = `${selector}{clip-path:none!important}`;
  (document.head ?? document.documentElement).append(rule);
  lifts.set(element, rule);
  return { lifted: true, clipPath };
}
