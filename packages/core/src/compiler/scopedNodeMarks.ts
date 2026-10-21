import { parse } from "acorn";

const HF_MARK_RE = /\b__hf[A-Z]\w*\b/g;
const HF_NAME_RE = /^__hf[A-Z]\w*$/;

type AstNode = { type: string; start: number; [key: string]: unknown };
type Visit = [node: AstNode, parent: AstNode | null];
type Parents = Map<AstNode, AstNode | null>;

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" && value !== null && typeof (value as AstNode).type === "string";

const isIdentifier = (value: unknown, name?: string): value is AstNode =>
  isNode(value) && value.type === "Identifier" && (name === undefined || value.name === name);

const nameOf = (node: AstNode) => String(node.name);

const children = (node: AstNode): AstNode[] =>
  Object.values(node)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .filter(isNode);

function* walk(node: AstNode, parent: AstNode | null): Generator<Visit> {
  yield [node, parent];
  for (const child of children(node)) yield* walk(child, node);
}

const nodesIn = (value: unknown): AstNode[] =>
  (Array.isArray(value) ? value : [value]).filter(isNode);

const isMember = (node: unknown, computed: boolean): node is AstNode =>
  isNode(node) && node.type === "MemberExpression" && Boolean(node.computed) === computed;

const isStringLiteral = (node: unknown) =>
  isNode(node) && node.type === "Literal" && typeof node.value === "string";

/** Only a literal string selector is sure to take the scoped query's filtering path; anything else may not. */
const isScopedQuery = (init: unknown): boolean =>
  isNode(init) &&
  init.type === "CallExpression" &&
  isMember(init.callee, false) &&
  isIdentifier(init.callee.object, "document") &&
  isIdentifier(init.callee.property, "querySelectorAll") &&
  nodesIn(init.arguments).length === 1 &&
  isStringLiteral(nodesIn(init.arguments)[0]);

const patternNames = (pattern: AstNode | undefined): AstNode[] => {
  if (!pattern || pattern.type === "MemberExpression") return [];
  return isIdentifier(pattern) ? [pattern] : children(pattern).flatMap(patternNames);
};

/** Identifiers each node binds: declarators, parameters, function and class names, catch parameters. */
function boundBy(node: AstNode): AstNode[] {
  if (node.type === "VariableDeclarator" || node.type === "CatchClause")
    return nodesIn(node.id ?? node.param).flatMap(patternNames);
  const own = /^(Function|Class)/.test(node.type) ? nodesIn(node.id) : [];
  const params = node.type.includes("Function") ? nodesIn(node.params) : [];
  return [...own, ...params].flatMap(patternNames);
}

const isPropertyName = (node: AstNode, parent: AstNode | null) =>
  (isMember(parent, false) && parent.property === node) ||
  (parent?.type === "Property" && parent.key === node && !parent.computed && !parent.shorthand);

const PATTERN_TYPES = new Set([
  "ArrayPattern",
  "ObjectPattern",
  "Property",
  "AssignmentPattern",
  "RestElement",
]);

/** The pattern or expression a target sits at the top of, climbing out of destructuring. */
function patternTop(node: AstNode, parents: Parents): [AstNode, AstNode | null] {
  let top = node;
  let parent = parents.get(node) ?? null;
  while (
    parent &&
    PATTERN_TYPES.has(parent.type) &&
    !(parent.type === "AssignmentPattern" && parent.right === top)
  ) {
    top = parent;
    parent = parents.get(parent) ?? null;
  }
  return [top, parent];
}

/** Whether `node` is written: assigned (destructured too), a for-in/of target, updated or deleted. */
function isWritten(node: AstNode, parents: Parents): boolean {
  const [top, parent] = patternTop(node, parents);
  if (!parent) return false;
  if (parent.type === "AssignmentExpression" || /^For(In|Of)Statement$/.test(parent.type))
    return parent.left === top;
  return (
    parent.type === "UpdateExpression" ||
    (parent.type === "UnaryExpression" && parent.operator === "delete")
  );
}

const isIndexLiteral = (node: unknown) =>
  isNode(node) &&
  node.type === "Literal" &&
  Number.isInteger(node.value) &&
  Number(node.value) >= 0;

/** `list[n]` with a proven numeric `n`, or a `list.length` read: what reads a node; never a method or an entry write. */
const isListUse = (node: AstNode, parent: AstNode | null, parents: Parents, indexes: Set<string>) =>
  parent?.type === "MemberExpression" &&
  parent.object === node &&
  !isWritten(parent, parents) &&
  (parent.computed
    ? isIndexLiteral(parent.property) ||
      (isIdentifier(parent.property) && indexes.has(nameOf(parent.property)))
    : isIdentifier(parent.property, "length"));

/** Counters: bound once to a whole number literal, then only read or stepped with `++`/`--`. */
function provenIndexes(
  visits: Visit[],
  bindings: Map<string, AstNode[]>,
  parents: Parents,
): Set<string> {
  const counters = [...bindings].filter(
    ([, [binding, ...more]]) =>
      more.length === 0 &&
      binding?.type === "VariableDeclarator" &&
      isIdentifier(binding.id) &&
      isIndexLiteral(binding.init),
  );
  const indexes = new Set(counters.map(([name]) => name));
  for (const [node, parent] of visits) {
    const stepped = parent?.type === "UpdateExpression";
    if (isIdentifier(node) && indexes.has(nameOf(node)) && !stepped && isWritten(node, parents))
      indexes.delete(nameOf(node));
  }
  return indexes;
}

function bindingsByName(visits: Visit[]) {
  const bindings = new Map<string, AstNode[]>();
  const declared = new Set<AstNode>();
  for (const [node] of visits)
    for (const id of boundBy(node)) {
      declared.add(id);
      bindings.set(nameOf(id), [...(bindings.get(nameOf(id)) ?? []), node]);
    }
  return { bindings, declared };
}

const isSoleScopedQuery = ([binding, ...more]: AstNode[]) =>
  more.length === 0 &&
  binding?.type === "VariableDeclarator" &&
  isIdentifier(binding.id) &&
  isScopedQuery(binding.init);

const rebindsDocument = ([node, parent]: Visit, parents: Parents) =>
  node.type === "WithStatement" ||
  (isIdentifier(node, "document") && !isPropertyName(node, parent) && isWritten(node, parents));

/** `document` is the scene's scoped one only when the script never binds, writes or `with`-shadows that name. */
const trustsDocument = (visits: Visit[], bindings: Map<string, AstNode[]>, parents: Parents) =>
  !bindings.has("document") && !visits.some((visit) => rebindsDocument(visit, parents));

/** `eval` hides writes; `arguments` can rebind the wrapper's document. Neither permits a scoped-list proof. */
const namesDynamicScope = ([node, parent]: Visit) =>
  (isIdentifier(node, "eval") || isIdentifier(node, "arguments")) && !isPropertyName(node, parent);

/** Names bound once, to the scoped `document.querySelectorAll(...)`, and only ever indexed or measured. */
function scopedLists(visits: Visit[]): Set<string> {
  const { bindings, declared } = bindingsByName(visits);
  const parents: Parents = new Map(visits);
  if (!trustsDocument(visits, bindings, parents) || visits.some(namesDynamicScope))
    return new Set();
  const indexes = provenIndexes(visits, bindings, parents);
  const lists = new Set([...bindings].filter(([, b]) => isSoleScopedQuery(b)).map(([n]) => n));
  for (const [node, parent] of visits) {
    const otherUse = !declared.has(node) && !isPropertyName(node, parent);
    if (isIdentifier(node) && otherUse && !isListUse(node, parent, parents, indexes))
      lists.delete(nameOf(node));
  }
  return lists;
}

/** Where `list[i].__hfX` names its mark, when `list` is a scoped query's result; else null. */
function scopedMarkStart(node: AstNode, lists: Set<string>): number | null {
  const { object, property } = node;
  if (!isMember(node, false) || !isIdentifier(property) || !HF_NAME_RE.test(nameOf(property)))
    return null;
  const indexed = isMember(object, true) && isIdentifier(object.object);
  return indexed && lists.has(nameOf(object.object as AstNode)) ? property.start : null;
}

function parsed(script: string): AstNode | null {
  try {
    return parse(script, { ecmaVersion: "latest", sourceType: "script" }) as unknown as AstNode;
  } catch {
    return null;
  }
}

/** The first `__hf` mark a scene script shares with other scenes: every one but a scoped query node's own. */
export function sharedHfMark(script: string): { index: number; text: string } | null {
  const marks = [...script.matchAll(HF_MARK_RE)];
  const program = marks.length > 0 ? parsed(script) : null;
  const visits = program ? [...walk(program, null)] : [];
  const lists = scopedLists(visits);
  const scoped = new Set(visits.map(([node]) => scopedMarkStart(node, lists)));
  const shared = marks.find((mark) => !scoped.has(mark.index));
  return shared ? { index: shared.index, text: shared[0] } : null;
}
