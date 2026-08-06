import type { DomEditSelection } from "./domEditingTypes";
import { isTextEditableSelection } from "./domEditingLayers";

/**
 * Whether this element's text can be edited where it sits.
 *
 * Its own function rather than a condition inside a handler, because this is
 * the rule most likely to change: it is the whole answer to "why did nothing
 * happen when I double-clicked that".
 *
 * The bar is deliberately the same as the design panel's, plus one thing the
 * panel can do that editing in place cannot. An element with several text
 * fields is edited a field at a time there, and making the whole element
 * editable would flatten its children into one string, so those keep the panel.
 */
export function canEditTextInline(selection: DomEditSelection | null): boolean {
  if (!selection) return false;
  if (!isTextEditableSelection(selection)) return false;
  // The composition host is the document, not a piece of copy in it.
  if (selection.isCompositionHost) return false;
  if (selection.isInsideLockedComposition) return false;
  return selection.textFields.length <= 1;
}
