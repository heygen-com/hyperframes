export interface InlineScriptRun {
  members: Element[];
  /** First later script that executes on its own; the merged run must stay before it. Null: end of body. */
  anchor: Element | null;
}

function isClassicInline(el: Element): boolean {
  const type = (el.getAttribute("type") || "").trim().toLowerCase();
  return !type || type === "text/javascript" || type === "application/javascript";
}

function isSeparateExecution(el: Element, isPinned: (el: Element) => boolean): boolean {
  return (
    el.hasAttribute("src") ||
    isPinned(el) ||
    (el.getAttribute("type") || "").trim().toLowerCase() === "module"
  );
}

/** Groups body scripts into runs of classic inline scripts split by any script that executes
 * separately (src, module, or one the caller pins in place), so merging a run never reorders it past one. */
export function inlineScriptRuns(
  scripts: readonly Element[],
  isPinned: (el: Element) => boolean = () => false,
): InlineScriptRun[] {
  const runs: InlineScriptRun[] = [];
  let members: Element[] = [];
  for (const el of scripts) {
    if (isSeparateExecution(el, isPinned)) {
      if (members.length === 0) continue;
      runs.push({ members, anchor: el });
      members = [];
    } else if (isClassicInline(el)) {
      members.push(el);
    }
  }
  if (members.length > 0) runs.push({ members, anchor: null });
  return runs;
}
