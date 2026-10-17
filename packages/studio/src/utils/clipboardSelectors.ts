import {
  escapeCssAttributeValue,
  escapeCssIdentifier,
  parseAttributeSelector,
  parseAttributeSelectorPresence,
  replaceSelectorAttributeTokens,
  replaceSelectorIdTokens,
} from "@hyperframes/core/selector-id-tokens";

export interface ClipboardAttributeRewrite {
  name: string;
  afterName?: string;
  target?: string;
  element?: Element;
  before: string | null;
  after: string;
}

export function clipboardNodeSelector(node: Element, ids: ReadonlyMap<string, string>): string {
  if (node.id) return `#${escapeCssIdentifier(ids.get(node.id) ?? node.id)}`;
  const siblings = Array.from(node.parentNode?.childNodes ?? [node]).filter(
    (sibling): sibling is Element =>
      sibling instanceof Element && sibling.localName === node.localName,
  );
  const part = `${node.localName}:nth-of-type(${siblings.indexOf(node) + 1})`;
  return node.parentElement ? `${clipboardNodeSelector(node.parentElement, ids)} > ${part}` : part;
}

type ValuePredicate = NonNullable<ReturnType<typeof parseAttributeSelector>>;
type Predicate = ValuePredicate | NonNullable<ReturnType<typeof parseAttributeSelectorPresence>>;
const MATCHES = {
  "=": (actual, value) => actual === value,
  "~=": (actual, value) => !!value && actual.split(/[ \t\r\n\f]+/).includes(value),
  "|=": (actual, value) => actual === value || actual.startsWith(value + "-"),
  "^=": (actual, value) => !!value && actual.startsWith(value),
  "$=": (actual, value) => !!value && actual.endsWith(value),
  "*=": (actual, value) => !!value && actual.includes(value),
} satisfies Record<ValuePredicate["operator"], (actual: string, value: string) => boolean>;

function attributeMatches(parsed: Predicate, attributeName: string): boolean {
  const name = parsed.name.toLowerCase();
  if (parsed.namespace.kind === "any") return attributeName.split(":").at(-1) === name;
  if (parsed.namespace.kind === "named")
    return attributeName === `${parsed.namespace.prefix}:${name}`;
  return attributeName === name;
}

const DEFAULT_CASE_MATCHING = new WeakMap<Element, Map<string, boolean>>();

function defaultInsensitive(element: Element | undefined, name: string): boolean {
  if (!element) return false;
  let attributes = DEFAULT_CASE_MATCHING.get(element);
  if (!attributes) {
    attributes = new Map();
    DEFAULT_CASE_MATCHING.set(element, attributes);
  }
  const cached = attributes.get(name);
  if (cached !== undefined) return cached;
  const probe = element.ownerDocument.createElementNS(element.namespaceURI, element.localName);
  probe.setAttribute(name, "aA");
  const insensitive = probe.matches(`[${escapeCssIdentifier(name)}="aa"]`);
  attributes.set(name, insensitive);
  return insensitive;
}

function valueMatches(
  parsed: Predicate,
  value: string,
  reference: ClipboardAttributeRewrite,
  name: string,
): boolean {
  if (!("operator" in parsed)) return true;
  const insensitive = parsed.flag
    ? parsed.flag.toLowerCase() === "i"
    : defaultInsensitive(reference.element, name);
  const fold = insensitive
    ? (text: string) => text.replace(/[A-Z]/g, (char) => char.toLowerCase())
    : (text: string) => text;
  return MATCHES[parsed.operator](fold(value), fold(parsed.value));
}

function outputPredicate(parsed: Predicate, reference: ClipboardAttributeRewrite): string {
  const afterName = reference.afterName ?? reference.name;
  const name = attributeMatches(parsed, afterName)
    ? parsed.rawName
    : escapeCssIdentifier(afterName);
  const flag = "flag" in parsed && parsed.flag ? ` ${parsed.flag}` : "";
  const guard = reference.target ? `:where(${reference.target})` : "";
  return `${guard}[${name}="${escapeCssAttributeValue(reference.after)}"${flag}]`;
}

function attributeGroups(references: readonly ClipboardAttributeRewrite[]) {
  const nodes = new Map<string, ClipboardAttributeRewrite[]>();
  const groups: ClipboardAttributeRewrite[][] = [];
  for (const reference of references) {
    if (!reference.target) {
      groups.push([reference]);
      continue;
    }
    let group = nodes.get(reference.target);
    if (!group) {
      group = [];
      nodes.set(reference.target, group);
      groups.push(group);
    }
    group.push(reference);
  }
  return groups;
}

function predicateChanges(parsed: Predicate, references: readonly ClipboardAttributeRewrite[]) {
  const include = new Set<string>();
  const exclude = new Set<string>();
  for (const group of attributeGroups(references)) {
    const before = group.some(
      (reference) =>
        reference.before !== null &&
        attributeMatches(parsed, reference.name) &&
        valueMatches(parsed, reference.before, reference, reference.name),
    );
    const after = group.some(
      (reference) =>
        attributeMatches(parsed, reference.afterName ?? reference.name) &&
        valueMatches(parsed, reference.after, reference, reference.afterName ?? reference.name),
    );
    if (before !== after)
      (before ? include : exclude).add(
        outputPredicate(
          parsed,
          group.find(
            (reference) =>
              reference.before !== reference.after ||
              reference.name !== (reference.afterName ?? reference.name),
          ) ?? group[0]!,
        ),
      );
  }
  return { include, exclude };
}

function rewritePredicate(
  predicate: string,
  references: readonly ClipboardAttributeRewrite[],
): string {
  const parsed = parseAttributeSelector(predicate) ?? parseAttributeSelectorPresence(predicate);
  if (!parsed) return predicate;
  const { include, exclude } = predicateChanges(parsed, references);
  if (!include.size && !exclude.size) return predicate;
  const unchanged = exclude.size
    ? `${predicate}:where(:not(${[...exclude].join(", ")}))`
    : predicate;
  return include.size ? `:is(${unchanged}, ${[...include].join(", ")})` : unchanged;
}

export function rebindClipboardSelector(
  selector: string,
  ids: ReadonlyMap<string, string>,
  attributes: readonly ClipboardAttributeRewrite[] = [],
): string {
  const references = [
    ...attributes,
    ...Array.from(ids, ([before, after]) => ({ name: "id", before, after })),
  ];
  const rewritten = replaceSelectorIdTokens(
    selector,
    [...ids.keys()],
    (id) => `#${escapeCssIdentifier(ids.get(id) ?? id)}`,
  );
  return replaceSelectorAttributeTokens(rewritten, (predicate) =>
    rewritePredicate(predicate, references),
  );
}
