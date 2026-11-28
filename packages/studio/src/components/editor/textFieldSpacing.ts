import type { DomEditTextField } from "./domEditingTypes";

/** Names the edges of a text layer added from the panel whose separator Studio writes: before, after or both. */
const ADDED_SPACE_ATTR = "data-hf-space";

type Edge = "before" | "after";

const NO_SPACE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

export function separatorFor(before: string, after: string): "" | " " {
  const last = before.slice(-1);
  const first = after.charAt(0);
  if (!last || !first || /\s/.test(last) || /\s/.test(first)) return "";
  if (/[\p{Ps}\p{Pi}]/u.test(last) || /[\p{Pe}\p{Pf}\p{Po}]/u.test(first)) return "";
  if (NO_SPACE_SCRIPT.test(last) || NO_SPACE_SCRIPT.test(first)) return "";
  return " ";
}

const edgesOf = (value: string | null): Edge[] =>
  value === "both" ? ["before", "after"] : value === "before" || value === "after" ? [value] : [];

const edgesValue = (edges: Edge[]): string | null =>
  edges.length === 2 ? "both" : (edges[0] ?? null);

function addedSpaceEdges(field: DomEditTextField): Edge[] {
  return edgesOf(field.attributes.find((a) => a.name === ADDED_SPACE_ATTR)?.value ?? null);
}

const owns = (field: DomEditTextField | undefined, edge: Edge) =>
  Boolean(field && addedSpaceEdges(field).includes(edge));

function withEdges(field: DomEditTextField, edges: Edge[]): DomEditTextField {
  const value = edgesValue((["before", "after"] as const).filter((edge) => edges.includes(edge)));
  const attributes = field.attributes.filter((a) => a.name !== ADDED_SPACE_ATTR);
  return {
    ...field,
    attributes: value ? [...attributes, { name: ADDED_SPACE_ATTR, value }] : attributes,
  };
}

const without = (field: DomEditTextField, edge: Edge) =>
  withEdges(
    field,
    addedSpaceEdges(field).filter((owned) => owned !== edge),
  );

/**
 * Marks the edges of a just-added field that have no whitespace, so Studio owns their separators. Splitting a gap
 * whose separator Studio wrote moves that separator past the new field, so the new field owns it from then on.
 */
export function markAddedSpaceEdges(fields: DomEditTextField[], key: string): DomEditTextField[] {
  const at = fields.findIndex((field) => field.key === key);
  if (at < 0) return fields;
  const [left, right] = [fields[at - 1], fields[at + 1]];
  const inherits = owns(left, "after");
  const edges: Edge[] = [];
  if (left && !fields[at]!.spaceBefore) edges.push("before");
  if (right && (!right.spaceBefore || inherits)) edges.push("after");
  return fields.map((field, index) =>
    index === at
      ? withEdges(field, edges)
      : index === at - 1 && inherits
        ? without(field, "after")
        : field,
  );
}

/** A plain-text run's edge whitespace is the separator beside it, so editing the run cannot join two words. */
export function withTextNodeEdgesAsSeparators(fields: DomEditTextField[]): DomEditTextField[] {
  return fields.map((field, index) => {
    const next = { ...field };
    if (field.source === "text-node") {
      const lead = /^\s*/.exec(field.value)![0];
      next.value = field.value.slice(lead.length);
      if (lead) next.spaceBefore = lead;
      if (index < fields.length - 1) next.value = next.value.trimEnd();
    }
    const previous = fields[index - 1];
    const trail = previous?.source === "text-node" ? /\s*$/.exec(previous.value)![0] : "";
    if (trail) next.spaceBefore = trail + (next.spaceBefore ?? "");
    return next;
  });
}

/**
 * Removes a field and joins the gaps on its two sides into one, so the text reads as before the add. The joined gap
 * is Studio's only when both gaps were; a separator the person wrote on either side stays.
 */
export function withoutAddedField(fields: DomEditTextField[], key: string): DomEditTextField[] {
  const at = fields.findIndex((field) => field.key === key);
  if (at < 0) return fields;
  const [left, gone, right] = [fields[at - 1], fields[at]!, fields[at + 1]];
  const leftMade = owns(gone, "before") || owns(left, "after");
  const rightMade = owns(gone, "after") || owns(right, "before");
  let [nextLeft, nextRight] = [left && owns(left, "after") ? without(left, "after") : left, right];
  if (right && rightMade) {
    if (!leftMade) nextRight = without({ ...right, spaceBefore: gone.spaceBefore }, "before");
    else if (owns(right, "before")) nextRight = right;
    else if (left && addedSpaceEdges(left).length)
      nextLeft = withEdges(left, [...addedSpaceEdges(left), "after"]);
    else nextRight = without({ ...right, spaceBefore: undefined }, "before");
  }
  return fields.flatMap((field, index) => {
    if (index === at) return [];
    if (index === at - 1) return nextLeft ? [nextLeft] : [];
    if (index === at + 1) return nextRight ? [nextRight] : [];
    return [field];
  });
}

const isText = (node: Node | null): node is Text => node?.nodeType === 3;

function edgeSpace(span: Element, edge: Edge): Text[] {
  const step = (node: Node) => (edge === "before" ? node.previousSibling : node.nextSibling);
  const space: Text[] = [];
  for (let node = step(span); isText(node); node = step(node)) {
    const text = node.data;
    if (text.trim()) {
      if (/\s/.test(edge === "before" ? text.slice(-1) : text.charAt(0))) space.push(node);
      break;
    }
    space.push(node);
  }
  return space;
}

function neighbourText(span: Element, edge: Edge): string {
  const step = (node: Node) => (edge === "before" ? node.previousSibling : node.nextSibling);
  let node = step(span);
  while (isText(node) && !node.data.trim()) node = step(node);
  const text = node?.textContent ?? "";
  if (!isText(node)) return text;
  return edge === "before" ? text.trimEnd() : text.trimStart();
}

/** The whitespace on an edge; Studio only ever writes one plain space there. */
function whitespaceOf(nodes: Text[], edge: Edge): string {
  const run = edge === "before" ? /\s*$/ : /^\s*/;
  return nodes.map((node) => (node.data.trim() ? run.exec(node.data)![0] : node.data)).join("");
}

function clearSpace(nodes: Text[], edge: Edge): void {
  for (const node of nodes) {
    if (node.data.trim())
      node.data = edge === "before" ? node.data.trimEnd() : node.data.trimStart();
    else node.remove();
  }
}

function hadSpace(previous: ParentNode | null, key: string | null, edge: Edge): boolean {
  if (!previous || !key) return false;
  const span = Array.from(previous.children).find(
    (el) => el.getAttribute("data-hf-text-key") === key,
  );
  return Boolean(span && edgeSpace(span, edge).length);
}

function parse(html: string): HTMLTemplateElement {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template;
}

/**
 * Writes the separators Studio owns around added text layers, from the text on each side. With the markup the
 * element held before a canvas edit, a separator the person deleted there leaves Studio's hands for good.
 */
export function respaceAddedFields(html: string, previousHtml?: string): string {
  if (!html.includes(ADDED_SPACE_ATTR)) return html;
  const root = parse(html).content;
  const previous = previousHtml === undefined ? null : parse(previousHtml).content;
  for (const span of Array.from(root.children)) {
    const owned = edgesOf(span.getAttribute(ADDED_SPACE_ATTR));
    if (!owned.length) continue;
    const kept = owned.filter((edge) => {
      const space = edgeSpace(span, edge);
      const key = span.getAttribute("data-hf-text-key");
      if (!space.length && hadSpace(previous, key, edge)) return false;
      // Any other whitespace there (a nonbreaking space, a line break) was typed by the person and is theirs.
      if (space.length && whitespaceOf(space, edge) !== " ") return false;
      const own = span.textContent ?? "";
      const wanted =
        edge === "before"
          ? separatorFor(neighbourText(span, edge), own)
          : separatorFor(own, neighbourText(span, edge));
      clearSpace(space, edge);
      if (wanted) span[edge === "before" ? "before" : "after"](wanted);
      return true;
    });
    const value = edgesValue(kept);
    if (value) span.setAttribute(ADDED_SPACE_ATTR, value);
    else span.removeAttribute(ADDED_SPACE_ATTR);
  }
  const out = document.createElement("div");
  out.append(root);
  return out.innerHTML;
}
