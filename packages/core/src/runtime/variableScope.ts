/**
 * Resolve the composition-variable values an element should see: the scoped
 * per-instance table for inlined sub-compositions, then the top-level merged
 * getVariables(), then the raw render-injection global. Shared by every
 * runtime consumer of variables (color grading, declarative bindings) so the
 * scope chain can never diverge between channels.
 */

type VariablesWindow = Window & {
  __hfVariables?: Record<string, unknown>;
  __hfVariablesByComp?: Record<string, Record<string, unknown>>;
  __hyperframes?: { getVariables?: () => Record<string, unknown> };
};

/** The per-instance values of the inlined sub-composition an element belongs to, if any. */
export function scopedVariablesFor(element: Element): Record<string, unknown> | undefined {
  const scope = element.closest("[data-composition-id]");
  const compositionId = scope?.getAttribute("data-composition-id")?.trim() ?? "";
  return compositionId
    ? (window as VariablesWindow).__hfVariablesByComp?.[compositionId]
    : undefined;
}

export function readVariablesForElement(element: Element): Record<string, unknown> {
  const win = window as VariablesWindow;
  const scoped = scopedVariablesFor(element);
  if (scoped) return scoped;
  const fromHelper = win.__hyperframes?.getVariables?.();
  if (fromHelper && typeof fromHelper === "object") {
    return fromHelper;
  }
  return win.__hfVariables ?? {};
}
