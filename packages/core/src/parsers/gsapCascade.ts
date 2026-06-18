import { parseGsapScriptAcornForWrite } from "./gsapParserAcorn.js";
import { removeAnimationFromScript } from "./gsapWriterAcorn.js";

/** Minimal structural shape for collectSubtreeHfIds — satisfied by both linkedom and DOMParser elements. */
export interface HfIdElement {
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): ArrayLike<{ getAttribute(name: string): string | null }>;
}

export function selectorMatchesId(selector: string, id: string): boolean {
  return (
    selector === `[data-hf-id="${id}"]` ||
    selector === `[data-hf-id='${id}']` ||
    selector === `#${id}`
  );
}

// v1 limitation: selectorMatchesId uses bare-id matching across the whole script, so a
// selector targeting "hf-leaf" will cascade-remove animations for both "hf-parent/hf-leaf"
// and any other element whose scoped or bare id matches "hf-leaf". Acceptable for typical
// single-comp use; sub-composition authors with leaf-id collisions should use
// fully-qualified selectors.

/** Collect all bare data-hf-id values from el and all its [data-hf-id] descendants. */
export function collectSubtreeHfIds(el: HfIdElement): string[] {
  const ids: string[] = [];
  const own = el.getAttribute("data-hf-id");
  if (own) ids.push(own);
  for (const child of Array.from(el.querySelectorAll("[data-hf-id]"))) {
    const id = child.getAttribute("data-hf-id");
    if (id) ids.push(id);
  }
  return ids;
}

export function cascadeRemoveAnimations(script: string, id: string): string {
  // Re-parse after each removal: animation ids are positional, so removing one
  // tween renumbers the survivors — ids from a single up-front parse go stale and
  // no-op, orphaning later tweens on the removed element. Same fix as
  // stripGsapForId in htmlParser.ts (R3 #3); this is its SDK-side twin.
  let current = script;
  for (;;) {
    const parsedGsap = parseGsapScriptAcornForWrite(current);
    if (!parsedGsap) return current;
    const match = parsedGsap.located.find((l) => selectorMatchesId(l.animation.targetSelector, id));
    if (!match) return current;
    const next = removeAnimationFromScript(current, match.id);
    if (next === current) return current;
    current = next;
  }
}

/** Minimal interface for a document with queryable, mutable script elements. */
export interface ScriptDocument {
  querySelectorAll(selector: string): ArrayLike<{ textContent: string | null }>;
}

/** Strip tweens for each id from every GSAP script element in the document. */
export function cascadeRemoveAnimationsFromDocument(doc: ScriptDocument, ids: string[]): void {
  if (ids.length === 0) return;
  for (const script of Array.from(doc.querySelectorAll("script"))) {
    const text = script.textContent ?? "";
    if (!text.includes("gsap") && !text.includes("ScrollTrigger")) continue;
    let current = text;
    for (const id of ids) {
      current = cascadeRemoveAnimations(current, id);
    }
    if (current !== text) script.textContent = current;
  }
}
