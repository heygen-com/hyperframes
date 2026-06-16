/**
 * Static evaluation for computed GSAP timelines (browser-safe, acorn/ESTree).
 *
 * The read parser resolves only literals and top-level consts, so timelines
 * built by a helper called N times or by a bounded loop collapse to position 0.
 * This module expands those constructs into a synthetic analysis AST: each
 * helper invocation and each loop iteration becomes its own concrete set of
 * `tl.*` calls, with parameters/loop-vars substituted by the call's argument
 * (or element/index) AST nodes — after which the existing parse pipeline
 * resolves positions and `motionPath` arcs unchanged.
 *
 * Substituted nodes keep their original source offsets, so downstream
 * source-slicing (raw extras, keyframes) stays correct. No source is
 * regenerated here. Pure transform — input ASTs are never mutated.
 *
 * U1 (this section): clone + scope-aware parameter substitution primitives.
 */
import type { GsapProvenance } from "./gsapSerialize.js";

// acorn ESTree nodes are structurally untyped; mirror gsapParserAcorn.ts.
type Node = any;

/** Node keys that are metadata, not child AST to traverse/substitute. */
const SKIP_KEYS = new Set(["type", "start", "end", "loc", "range", "__hfProvenance"]);

const FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
]);

function isFunctionNode(node: Node): boolean {
  return !!node && FUNCTION_TYPES.has(node.type);
}

function isNode(x: Node): boolean {
  return !!x && typeof x === "object" && typeof x.type === "string";
}

/**
 * Apply `fn` to each child AST node, writing back its return value. Skips
 * metadata keys and key/member slots that must not be treated as values.
 * The one place array-vs-single child traversal lives, so walkers stay flat.
 */
function transformChildren(node: Node, fn: (child: Node) => Node): void {
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key) || isNonValueIdentifierSlot(node, key)) continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (let i = 0; i < child.length; i++) child[i] = fn(child[i]);
    } else {
      node[key] = fn(child);
    }
  }
}

/** Deep structural clone preserving `start`/`end`/`loc` (needed for source slicing). */
export function cloneNode<T extends Node>(node: T): T {
  return structuredClone(node);
}

// ponytail: Identifier + default + rest only. Destructured bindings (`{x}`, `[x]`)
// aren't inlined (U2 inlines Identifier-param helpers / loop vars only), so a
// destructuring shadow is a double-rare miss that just falls back. Add the
// pattern cases here if that ever bites.
function collectPatternNames(pattern: Node, out: Set<string>): void {
  if (pattern?.type === "Identifier") out.add(pattern.name);
  else if (pattern?.type === "AssignmentPattern") collectPatternNames(pattern.left, out);
  else if (pattern?.type === "RestElement") collectPatternNames(pattern.argument, out);
}

/** Every identifier name bound anywhere inside the subtree (fn params, declared vars, catch params). */
function collectBoundNames(root: Node): Set<string> {
  const names = new Set<string>();
  const visit = (node: Node): Node => {
    if (!isNode(node)) return node;
    if (isFunctionNode(node)) for (const p of node.params ?? []) collectPatternNames(p, names);
    else if (node.type === "VariableDeclarator") collectPatternNames(node.id, names);
    else if (node.type === "CatchClause") collectPatternNames(node.param, names);
    transformChildren(node, visit);
    return node;
  };
  visit(root);
  return names;
}

/** A child in key/property position that must not be treated as a value identifier. */
function isNonValueIdentifierSlot(node: Node, key: string): boolean {
  if (node.computed) return false;
  return (
    (node.type === "MemberExpression" && key === "property") ||
    (node.type === "Property" && key === "key")
  );
}

/**
 * Substitute bound identifiers in an already-cloned subtree, returning the
 * (possibly replaced) root. Names shadowed anywhere inside (nested function
 * params, declared vars) are dropped up front rather than tracked per scope —
 * worst case we under-substitute and the caller falls back to current behavior.
 * Never substitutes identifiers in key/member positions. Mutates the passed
 * clone in place — callers pass `cloneNode(...)`.
 */
export function substituteParams(node: Node, bindings: ReadonlyMap<string, Node>): Node {
  const shadowed = collectBoundNames(node);
  let effective = bindings;
  if (shadowed.size > 0) {
    effective = new Map(bindings);
    for (const name of shadowed) (effective as Map<string, Node>).delete(name);
  }
  if (effective.size === 0) return node;
  return replace(node, effective);
}

function replace(node: Node, bindings: ReadonlyMap<string, Node>): Node {
  if (!isNode(node)) return node;
  if (node.type === "Identifier" && bindings.has(node.name)) {
    return cloneNode(bindings.get(node.name));
  }
  transformChildren(node, (child) => replace(child, bindings));
  return node;
}

/** Tag a node (typically a `tl.*` CallExpression) with its construction provenance. */
export function tagProvenance(node: Node, provenance: GsapProvenance): Node {
  if (node && typeof node === "object") node.__hfProvenance = provenance;
  return node;
}

/** Read a provenance tag previously set by `tagProvenance`, if any. */
export function readProvenance(node: Node): GsapProvenance | undefined {
  return node?.__hfProvenance;
}

/** Synthesize a numeric `Literal` node (for loop indices, which have no source node). */
export function numericLiteral(value: number): Node {
  return { type: "Literal", value, raw: String(value) };
}
