import { markupOutsideAllowlist } from "@hyperframes/core/html-attr-safety";
import { EXCLUDED_TAGS, mintHfId, walkCompositionDescendants } from "@hyperframes/parsers/hf-ids";
import { knownCompositionFile } from "../components/editor/domEditingDom";

const REFUSED = "Couldn't paste: the copied element holds markup that can't be pasted here.";

export function copiedFile(
  claimed: string | undefined,
  activeCompositionPath: string | null,
): string {
  const file = knownCompositionFile(claimed, activeCompositionPath);
  if (file) return file;
  throw new Error("Couldn't use this element: its file isn't one of this project's compositions.");
}

export interface PreparedCopy {
  html: string;
  root: Element;
  originalHfId: string | null;
  renames: Map<string, string>;
}

function fragment(html: string): HTMLTemplateElement {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template;
}

/** Fresh data-hf-ids minted in the edit (else the server stamps them behind undo's back); taken ids renamed. */
export function prepareCopy(
  html: string,
  takenHfIds: Set<string>,
  takenIds: Set<string>,
  place?: (root: Element) => void,
): PreparedCopy {
  const root = fragment(html).content.firstElementChild;
  if (!root) throw new Error(REFUSED);
  const originalHfId = root.getAttribute("data-hf-id");
  const elements = [root];
  walkCompositionDescendants(root, (el) => elements.push(el));
  for (const el of elements) {
    if (EXCLUDED_TAGS.has(el.localName)) el.removeAttribute("data-hf-id");
    else el.setAttribute("data-hf-id", mintHfId(el, takenHfIds));
  }
  const renames = new Map<string, string>();
  for (const el of [root, ...Array.from(root.querySelectorAll("[id]"))]) {
    const id = el.getAttribute("id");
    if (!id) continue;
    if (takenIds.has(id)) {
      let counter = 2;
      while (takenIds.has(`${id}-${counter}`)) counter++;
      el.setAttribute("id", `${id}-${counter}`);
      renames.set(id, `${id}-${counter}`);
    }
    takenIds.add(el.getAttribute("id")!);
  }
  place?.(root);
  return { html: root.outerHTML, root, originalHfId, renames };
}

function countShapesWithTemplateContent(
  nodes: ParentNode,
  counts: Map<string, number>,
  sign: 1 | -1,
): void {
  for (const el of Array.from(nodes.querySelectorAll("*"))) {
    const shape = [el.localName, ...el.getAttributeNames().sort()].join(" ");
    counts.set(shape, (counts.get(shape) ?? 0) + sign);
    if (el.localName === "template")
      countShapesWithTemplateContent((el as HTMLTemplateElement).content, counts, sign);
  }
}

/** Last step of every clipboard write: the file gains only the copies' own elements, each allowed or read here. */
export function refuseAddedMarkup(
  before: string,
  after: string,
  copies: ReadonlyArray<{ html: string; readFrom?: string | null }>,
  writeTo: string | null,
): void {
  const parser = new DOMParser();
  const counts = new Map<string, number>();
  countShapesWithTemplateContent(parser.parseFromString(after, "text/html"), counts, 1);
  countShapesWithTemplateContent(parser.parseFromString(before, "text/html"), counts, -1);
  for (const copy of copies) {
    const template = fragment(copy.html);
    const exempt = !!copy.readFrom && copy.readFrom === writeTo;
    if (!exempt && markupOutsideAllowlist(template).length > 0) throw new Error(REFUSED);
    countShapesWithTemplateContent(template.content, counts, -1);
  }
  if (Array.from(counts.values()).some((count) => count !== 0)) throw new Error(REFUSED);
}
