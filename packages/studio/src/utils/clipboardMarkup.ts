import { parseHTMLContent } from "@hyperframes/core/compiler/html-document";
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

const parsed = (html: string) => new DOMParser().parseFromString(html, "text/html");
// The page as served: the preview server and render compiler re-read a file with linkedom before a browser does.
const served = (html: string) => parsed(parseHTMLContent(html).toString());

const htmlTemplate = (node: Node): node is HTMLTemplateElement =>
  node instanceof Element && node.localName === "template" && node.namespaceURI === HTML_NS;
const HTML_NS = "http://www.w3.org/1999/xhtml";

function eachElement(nodes: ParentNode, visit: (el: Element) => void): void {
  for (const el of Array.from(nodes.querySelectorAll("*"))) {
    visit(el);
    if (htmlTemplate(el)) eachElement(el.content, visit);
  }
}

const signature = (el: Element) =>
  JSON.stringify([
    el.namespaceURI,
    el.localName,
    Array.from(el.attributes, (a) => JSON.stringify([a.namespaceURI, a.name, a.value])).sort(),
  ]);

function subtree(root: Element): Element[] {
  const elements = [root];
  eachElement(root, (el) => elements.push(el));
  return elements;
}

// Raw <style>/<script> text is the look copy's to extend; the allowlist reads it on the saved node.
function withoutRawText(node: Node): Node {
  const clone = node.cloneNode(true) as ParentNode & Node;
  const scope: Element[] = clone instanceof Element ? [clone] : [];
  eachElement(clone, (el) => scope.push(el));
  for (const el of scope) {
    if (el.namespaceURI === HTML_NS && (el.localName === "style" || el.localName === "script"))
      el.textContent = "";
  }
  return clone;
}

/** Equal by the DOM's own isEqualNode, template contents included, which it does not compare. */
function sameTree(a: Node, b: Node): boolean {
  if (!withoutRawText(a).isEqualNode(withoutRawText(b))) return false;
  const templates = (node: Node) =>
    [node, ...Array.from((node as ParentNode).querySelectorAll("*"))].filter(htmlTemplate);
  const left = templates(a);
  const right = templates(b);
  return (
    left.length === right.length && left.every((t, i) => sameTree(t.content, right[i].content))
  );
}

/** The file's ids and data-hf-ids as parsed values, so an id written with entities matches its copy's. */
export function idsInFile(content: string): { ids: Set<string>; hfIds: Set<string> } {
  const ids = new Set<string>();
  const hfIds = new Set<string>();
  eachElement(parsed(content), (el) => {
    const id = el.getAttribute("id");
    const hfId = el.getAttribute("data-hf-id");
    if (id) ids.add(id);
    if (hfId) hfIds.add(hfId);
  });
  return { ids, hfIds };
}

/** Last step of every clipboard write: the saved file gains exactly the copies, each allowed or read here. */
export function refuseAddedMarkup(
  before: string,
  after: string,
  copies: ReadonlyArray<{ html: string; readFrom?: string | null }>,
  writeTo: string | null,
): void {
  const saved = served(after);
  const counts = new Map<string, number>();
  const tally = (shape: string, sign: number) => counts.set(shape, (counts.get(shape) ?? 0) + sign);
  const candidatesBySignatureOfMintedRoot = new Map<string, Element[]>();
  eachElement(saved, (el) => {
    const shape = signature(el);
    tally(shape, 1);
    const bucket = candidatesBySignatureOfMintedRoot.get(shape);
    if (bucket) bucket.push(el);
    else candidatesBySignatureOfMintedRoot.set(shape, [el]);
  });
  eachElement(served(before), (el) => tally(signature(el), -1));
  const claimed = new Set<Element>();
  for (const copy of copies) {
    const expected = fragment(copy.html).content.firstElementChild;
    if (!expected) throw new Error(REFUSED);
    const found = (candidatesBySignatureOfMintedRoot.get(signature(expected)) ?? []).find(
      (el) => subtree(el).every((e) => !claimed.has(e)) && sameTree(el, expected),
    );
    if (!found) throw new Error(REFUSED);
    const exempt = !!copy.readFrom && copy.readFrom === writeTo;
    if (!exempt && markupOutsideAllowlist(found).length > 0) throw new Error(REFUSED);
    for (const el of subtree(found)) {
      claimed.add(el);
      tally(signature(el), -1);
    }
  }
  if (Array.from(counts.values()).some((count) => count !== 0)) throw new Error(REFUSED);
}
