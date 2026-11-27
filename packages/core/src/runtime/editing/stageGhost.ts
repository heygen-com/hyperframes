// A removed element's ghost: its subtree, written out by the frame it leaves and stood back by the one replacing it.
// Studio relays the markup as an opaque string; only the receiving frame parses it, inert, with active parts stripped.
import { locateStageKey } from "./stageMeasure";
import type { StageActTarget } from "./stageAct";

export const MAX_STAGE_GHOST_MARKUP = 65_536;

export interface StageActGhost {
  key: string;
  markup: string;
}

// Never run in the frame it lands in: active content, frames, navigation and imports.
const STRIPPED = "script,iframe,object,embed,frame,frameset,base,meta,link";
const ACTIVE_URL = /javascript:|data:text\/html/i;
// Its own look, read while the document it left still answers; the new one's stylesheet may have dropped its rules.
const GHOST_LOOK = [
  "color",
  "background-color",
  "border",
  "border-radius",
  "font",
  "letter-spacing",
  "rotate",
  "box-shadow",
  "padding",
  "display",
  "place-items",
  "align-items",
  "justify-content",
  "text-align",
] as const;

/** Each target's subtree as markup, its computed look written on its root; one over the cap is left out. */
export function captureStageGhosts(
  doc: Document,
  targets: readonly StageActTarget[],
): StageActGhost[] {
  const view = doc.defaultView;
  const ghosts: StageActGhost[] = [];
  for (const target of targets) {
    const element = locateStageKey(doc, target);
    if (!element || !view) continue;
    const clone = element.cloneNode(true) as HTMLElement;
    if (!clone.style) continue;
    const look = view.getComputedStyle(element);
    for (const name of GHOST_LOOK) clone.style.setProperty(name, look.getPropertyValue(name));
    clone.removeAttribute("data-hf-id");
    clone.removeAttribute("id");
    const markup = clone.outerHTML;
    if (markup.length <= MAX_STAGE_GHOST_MARKUP) ghosts.push({ key: target.key, markup });
  }
  return ghosts;
}

/** Parses relayed markup inert and strips what could run, navigate or load as a document; null unless one element. */
export function inertStageGhost(doc: Document, markup: string): HTMLElement | null {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  const root = parsed.body.firstElementChild;
  if (!root || parsed.body.children.length !== 1 || root.matches(STRIPPED)) return null;
  for (const node of [...root.querySelectorAll(STRIPPED)]) node.remove();
  for (const element of [root, ...root.querySelectorAll("*")])
    for (const { name, value } of [...element.attributes]) {
      // URL parsing ignores spaces and control characters: `java\nscript:` still runs.
      const plain = [...value].filter((c) => c.charCodeAt(0) > 32).join("");
      if (/^on/i.test(name) || name.toLowerCase() === "srcdoc" || ACTIVE_URL.test(plain))
        element.removeAttribute(name);
    }
  const ghost = doc.importNode(root, true) as HTMLElement;
  return ghost.style ? ghost : null;
}
