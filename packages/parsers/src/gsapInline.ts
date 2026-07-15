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
 * source-slicing (raw extras, keyframes) stays correct. The substitution
 * primitives never mutate their input; `inlineComputedTimelines` rewrites the
 * Program body of the freshly-parsed AST it is handed (owned by the caller).
 */
import type { GsapProvenance } from "./gsapSerialize.js";

// acorn ESTree nodes are structurally untyped; mirror gsapParserAcorn.ts.
type Node = any;

/** Node keys that are metadata, not child AST to traverse/substitute. */
const SKIP_KEYS = new Set(["type", "start", "end", "loc", "range", "__hfProvenance", "__hfOrder"]);

const FUNCTION_TYPES = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "FunctionDeclaration",
]);
const GSAP_METHODS = new Set(["set", "to", "from", "fromTo"]);

// Bounds on synthetic expansion (recursion + iteration runaway guards).
const MAX_DEPTH = 8;
const MAX_ITERS = 512;

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

function boundPatterns(node: Node): Node[] {
  if (isFunctionNode(node)) return node.params ?? [];
  if (node.type === "VariableDeclarator") return [node.id];
  if (node.type === "CatchClause") return [node.param];
  if (node.type === "AssignmentExpression" && node.left?.type === "Identifier") return [node.left];
  return [];
}

/** Every identifier name bound anywhere inside the subtree (fn params, declared vars, catch params). */
function collectBoundNames(root: Node): Set<string> {
  const names = new Set<string>();
  const visit = (node: Node): Node => {
    if (!isNode(node)) return node;
    for (const pattern of boundPatterns(node)) collectPatternNames(pattern, names);
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

// ── Expansion engine (U2) ─────────────────────────────────────────────────────

/** Resolve an expression to a literal value (top-level consts in scope, arithmetic). */
type LiteralResolver = (node: Node) => number | string | boolean | undefined;

interface ExpandCtx {
  helpers: Map<string, Node>;
  timelineVar: string;
  resolve: LiteralResolver;
  depth: number;
  /** Mutable source-order counter for provenance call-site ordinals. */
  site: { n: number };
  /** Mutable counter stamping expansion order onto tweens (clones share source loc). */
  order: { n: number };
}

function walkNodes(node: Node, fn: (n: Node) => void): void {
  if (!isNode(node)) return;
  fn(node);
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const child = node[key];
    if (Array.isArray(child)) for (const c of child) walkNodes(c, fn);
    else walkNodes(child, fn);
  }
}

/** The identifier a (possibly chained) call's member expression is rooted at. */
function timelineRootName(call: Node): string | null {
  let obj = call.callee?.object;
  while (obj?.type === "CallExpression") obj = obj.callee?.object;
  return obj?.type === "Identifier" ? obj.name : null;
}

function isTimelineRooted(call: Node, timelineVar: string): boolean {
  if (timelineRootName(call) !== timelineVar) return false;
  return (
    call.callee?.property?.type === "Identifier" && GSAP_METHODS.has(call.callee.property.name)
  );
}

function containsTimelineCall(node: Node, timelineVar: string): boolean {
  let found = false;
  walkNodes(node, (n) => {
    if (n.type === "CallExpression" && isTimelineRooted(n, timelineVar)) found = true;
  });
  return found;
}

function rangeOf(node: Node): [number, number] | undefined {
  return typeof node.start === "number" && typeof node.end === "number"
    ? [node.start, node.end]
    : undefined;
}

/** Plain identifier params + block body (shape we can inline). Timeline content checked separately. */
function isShapeEligible(fn: Node): boolean {
  return (
    isFunctionNode(fn) &&
    fn.body?.type === "BlockStatement" &&
    !(fn.params ?? []).some((p: Node) => p.type !== "Identifier")
  );
}

/** True if the subtree calls any function named in `names`. */
function callsAny(node: Node, names: Set<string>): boolean {
  let hit = false;
  walkNodes(node, (n) => {
    if (
      n.type === "CallExpression" &&
      n.callee?.type === "Identifier" &&
      names.has(n.callee.name)
    ) {
      hit = true;
    }
  });
  return hit;
}

/** `[name, fnNode]` if a single-declarator `const f = fn` is an inlinable-shaped helper. */
function varDeclHelper(stmt: Node): [string, Node] | null {
  if (stmt.declarations?.length !== 1) return null;
  const d = stmt.declarations[0];
  return d.id?.type === "Identifier" && isShapeEligible(d.init) ? [d.id.name, d.init] : null;
}

/** `[name, fnNode]` if `stmt` declares an inlinable-shaped helper, else null. */
function helperFromStatement(stmt: Node): [string, Node] | null {
  if (stmt.type === "FunctionDeclaration") {
    return stmt.id && isShapeEligible(stmt) ? [stmt.id.name, stmt] : null;
  }
  if (stmt.type === "VariableDeclaration") return varDeclHelper(stmt);
  return null;
}

/** Top-level functions whose shape we can inline (Identifier params + block body). */
function gatherHelperCandidates(program: Node): Map<string, Node> {
  const candidates = new Map<string, Node>();
  for (const stmt of program.body ?? []) {
    const helper = helperFromStatement(stmt);
    if (helper) candidates.set(helper[0], helper[1]);
  }
  return candidates;
}

/** Names that build the timeline directly or by calling another builder (transitive closure). */
function timelineBuildingNames(candidates: Map<string, Node>, timelineVar: string): Set<string> {
  const building = new Set<string>();
  for (const [name, fn] of candidates) {
    if (containsTimelineCall(fn.body, timelineVar)) building.add(name);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, fn] of candidates) {
      if (!building.has(name) && callsAny(fn.body, building)) {
        building.add(name);
        changed = true;
      }
    }
  }
  return building;
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/**
 * Keep only candidates safe to drop: every reference to the name is its
 * declaration or a statement-level call. (1 decl id + 1 callee id per
 * statement-level call ⇒ total occurrences with no stray uses.)
 */
function safelyDroppable(program: Node, candidates: Map<string, Node>): Map<string, Node> {
  const names = new Set(candidates.keys());
  const totalIds = new Map<string, number>();
  const stmtCalls = new Map<string, number>();
  walkNodes(program, (n) => {
    if (n.type === "Identifier" && names.has(n.name)) bump(totalIds, n.name);
    const e = n.type === "ExpressionStatement" ? n.expression : undefined;
    if (
      e?.type === "CallExpression" &&
      e.callee?.type === "Identifier" &&
      names.has(e.callee.name)
    ) {
      bump(stmtCalls, e.callee.name);
    }
  });
  const safe = new Map<string, Node>();
  for (const [name, fn] of candidates) {
    if ((totalIds.get(name) ?? 0) === 1 + (stmtCalls.get(name) ?? 0)) safe.set(name, fn);
  }
  return safe;
}

/** Top-level timeline-building helpers that are safe to inline-and-drop. */
function collectInlinableHelpers(program: Node, timelineVar: string): Map<string, Node> {
  const candidates = gatherHelperCandidates(program);
  if (candidates.size === 0) return candidates;
  const building = timelineBuildingNames(candidates, timelineVar);
  for (const name of [...candidates.keys()]) if (!building.has(name)) candidates.delete(name);
  if (candidates.size === 0) return candidates;
  return safelyDroppable(program, candidates);
}

function isHelperDecl(stmt: Node, helpers: Map<string, Node>): boolean {
  if (stmt.type === "FunctionDeclaration") return !!stmt.id && helpers.get(stmt.id.name) === stmt;
  if (stmt.type === "VariableDeclaration" && stmt.declarations?.length === 1) {
    const d = stmt.declarations[0];
    return d.id?.type === "Identifier" && helpers.get(d.id.name) === d.init;
  }
  return false;
}

function bodyStatements(node: Node): Node[] {
  if (node?.type === "BlockStatement") return node.body ?? [];
  return node ? [{ type: "ExpressionStatement", expression: node }] : [];
}

/** Tag this body's direct timeline tweens with provenance + a monotonic expansion-order stamp. */
function tagTimelineCalls(stmts: Node[], prov: GsapProvenance, ctx: ExpandCtx): void {
  for (const stmt of stmts) {
    walkNodes(stmt, (n) => {
      if (n.type === "CallExpression" && isTimelineRooted(n, ctx.timelineVar)) {
        tagProvenance(n, { ...prov });
        n.__hfOrder = ctx.order.n++;
      }
    });
  }
}

/** Clone a body as one scope, substitute the bindings, tag provenance, recurse. */
function expandBody(
  bodyStmts: Node[],
  bindings: Map<string, Node>,
  prov: GsapProvenance,
  ctx: ExpandCtx,
): Node[] {
  const block = substituteParams(cloneNode({ type: "BlockStatement", body: bodyStmts }), bindings);
  tagProvenance(block, prov);
  tagTimelineCalls(block.body, prov, ctx);
  block.body = expandStatements(block.body, { ...ctx, depth: ctx.depth + 1 });
  // Keep each synthetic expansion in its own lexical scope. Flattening repeated
  // loop/helper bodies into Program scope makes same-named local DOM bindings
  // overwrite one another during selector analysis.
  return [block];
}

function inlineHelper(call: Node, ctx: ExpandCtx): Node[] {
  const fn = ctx.helpers.get(call.callee.name);
  const bindings = new Map<string, Node>();
  (fn.params ?? []).forEach((p: Node, i: number) => {
    const arg = call.arguments?.[i];
    if (arg) bindings.set(p.name, arg);
  });
  const prov: GsapProvenance = {
    kind: "helper",
    fn: call.callee.name,
    callSite: ++ctx.site.n,
    sourceRange: rangeOf(call),
  };
  return expandBody(fn.body.body, bindings, prov, ctx);
}

function assignStep(update: Node, resolve: LiteralResolver): number | undefined {
  if (update.operator === "+=") return asNum(resolve(update.right));
  if (update.operator === "-=") {
    const s = asNum(resolve(update.right));
    return s === undefined ? undefined : -s;
  }
  // `i = i + S` — the step is the right operand of the addition.
  if (update.operator === "=" && update.right?.type === "BinaryExpression") {
    return asNum(resolve(update.right.right));
  }
  return undefined;
}

/** The loop variable a `for` update clause mutates (`i++` or `i += S`), or null. */
function updatedVarName(update: Node): string | null {
  if (update?.type === "UpdateExpression") return update.argument?.name ?? null;
  if (update?.type === "AssignmentExpression") return update.left?.name ?? null;
  return null;
}

function loopStep(update: Node, varName: string, resolve: LiteralResolver): number | undefined {
  if (updatedVarName(update) !== varName) return undefined;
  if (update.type === "UpdateExpression") return update.operator === "++" ? 1 : -1;
  return assignStep(update, resolve);
}

function asNum(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function loopSatisfied(op: string, x: number, end: number): boolean {
  if (op === "<") return x < end;
  if (op === "<=") return x <= end;
  if (op === ">") return x > end;
  if (op === ">=") return x >= end;
  return false;
}

interface ForHeader {
  v: string;
  start: number;
  end: number;
  op: string;
  step: number;
}

/** The single `let v = <init>` of a for-loop init clause, or null. */
function forInitVar(init: Node): { name: string; initExpr: Node } | null {
  if (init?.type !== "VariableDeclaration" || init.declarations?.length !== 1) return null;
  const d = init.declarations[0];
  return d.id?.type === "Identifier" ? { name: d.id.name, initExpr: d.init } : null;
}

/** Parse `for (let v = A; v <op> B; v += S)` into resolved bounds, or null if not statically bounded. */
function parseForHeader(stmt: Node, resolve: LiteralResolver): ForHeader | null {
  const iv = forInitVar(stmt.init);
  const test = stmt.test;
  if (!iv || test?.type !== "BinaryExpression" || test.left?.name !== iv.name) return null;
  const start = asNum(resolve(iv.initExpr));
  const end = asNum(resolve(test.right));
  const step = loopStep(stmt.update, iv.name, resolve);
  if (start === undefined || end === undefined || !step) return null;
  return { v: iv.name, start, end, op: test.operator, step };
}

function unrollFor(stmt: Node, ctx: ExpandCtx): Node[] | null {
  const h = parseForHeader(stmt, ctx.resolve);
  if (!h) return null;
  const body = bodyStatements(stmt.body);
  const out: Node[] = [];
  const site = ++ctx.site.n;
  let iteration = 0;
  for (let x = h.start; loopSatisfied(h.op, x, h.end); x += h.step) {
    if (iteration >= MAX_ITERS) return null;
    const prov: GsapProvenance = {
      kind: "loop",
      callSite: site,
      iteration,
      sourceRange: rangeOf(stmt),
    };
    out.push(...expandBody(body, new Map([[h.v, numericLiteral(x)]]), prov, ctx));
    iteration++;
  }
  return out;
}

function forOfVarName(left: Node): string | null {
  if (left?.type === "VariableDeclaration") {
    const id = left.declarations?.[0]?.id;
    return id?.type === "Identifier" ? id.name : null;
  }
  return left?.type === "Identifier" ? left.name : null;
}

/** Expand `for (const el of [literal array]) {...}` and `[literal array].forEach((el, i) => {...})`. */
function unrollOverArray(
  elements: Node[],
  body: Node[],
  elName: string | null,
  idxName: string | null,
  range: [number, number] | undefined,
  ctx: ExpandCtx,
): Node[] {
  const out: Node[] = [];
  const site = ++ctx.site.n;
  elements.forEach((el, i) => {
    if (!el) return;
    const bindings = new Map<string, Node>();
    if (elName) bindings.set(elName, el);
    if (idxName) bindings.set(idxName, numericLiteral(i));
    const prov: GsapProvenance = { kind: "loop", callSite: site, iteration: i, sourceRange: range };
    out.push(...expandBody(body, bindings, prov, ctx));
  });
  return out;
}

function unrollForOf(stmt: Node, ctx: ExpandCtx): Node[] | null {
  if (stmt.right?.type !== "ArrayExpression") return null;
  const elName = forOfVarName(stmt.left);
  if (!elName) return null;
  return unrollOverArray(
    stmt.right.elements ?? [],
    bodyStatements(stmt.body),
    elName,
    null,
    rangeOf(stmt),
    ctx,
  );
}

/** The (element, index) param names of a callback, or null if either is non-Identifier. */
function callbackParamNames(cb: Node): { el: string | null; idx: string | null } | null {
  const names: Array<string | null> = [];
  for (const p of [cb.params?.[0], cb.params?.[1]]) {
    if (!p) names.push(null);
    else if (p.type !== "Identifier") return null;
    else names.push(p.name);
  }
  return { el: names[0]!, idx: names[1]! };
}

/** True for `[arrayLiteral].forEach` member callees. */
function isForEachCall(callee: Node): boolean {
  return (
    callee?.type === "MemberExpression" &&
    callee.property?.name === "forEach" &&
    callee.object?.type === "ArrayExpression"
  );
}

/** The element array + callback of `[...].forEach(cb)`, or null. */
function forEachTarget(call: Node): { elements: Node[]; cb: Node } | null {
  if (!isForEachCall(call.callee)) return null;
  const cb = call.arguments?.[0];
  return isFunctionNode(cb) ? { elements: call.callee.object.elements ?? [], cb } : null;
}

function unrollForEach(call: Node, ctx: ExpandCtx): Node[] | null {
  const target = forEachTarget(call);
  if (!target) return null;
  const params = callbackParamNames(target.cb);
  if (!params) return null;
  return unrollOverArray(
    target.elements,
    bodyStatements(target.cb.body),
    params.el,
    params.idx,
    rangeOf(call),
    ctx,
  );
}

function expandCall(call: Node, ctx: ExpandCtx): Node[] | null {
  if (call.callee?.type === "Identifier" && ctx.helpers.has(call.callee.name)) {
    return inlineHelper(call, ctx);
  }
  return unrollForEach(call, ctx);
}

function expandStatement(stmt: Node, ctx: ExpandCtx): Node[] | null {
  if (ctx.depth >= MAX_DEPTH) return null;
  if (stmt.type === "ForStatement") return unrollFor(stmt, ctx);
  if (stmt.type === "ForOfStatement") return unrollForOf(stmt, ctx);
  if (stmt.type === "ExpressionStatement" && stmt.expression?.type === "CallExpression") {
    return expandCall(stmt.expression, ctx);
  }
  return null;
}

function expandStatements(stmts: Node[], ctx: ExpandCtx): Node[] {
  const out: Node[] = [];
  for (const stmt of stmts) {
    const expanded = expandStatement(stmt, ctx);
    if (expanded) out.push(...expanded);
    else out.push(stmt);
  }
  return out;
}

/**
 * Rewrite the Program body so helper invocations and bounded loops that build
 * the timeline are expanded into concrete per-call / per-iteration `tl.*`
 * statements, each tagged with provenance. Mutates `ast` in place (caller owns
 * the freshly-parsed tree). Constructs it can't statically resolve are left
 * untouched, so the parser falls back to current behavior for them.
 */
export function inlineComputedTimelines(
  ast: Node,
  timelineVar: string,
  resolve: LiteralResolver,
): void {
  const helpers = collectInlinableHelpers(ast, timelineVar);
  const ctx: ExpandCtx = {
    helpers,
    timelineVar,
    resolve,
    depth: 0,
    site: { n: 0 },
    order: { n: 0 },
  };
  const body = (ast.body ?? []).filter((stmt: Node) => !isHelperDecl(stmt, helpers));
  ast.body = expandStatements(body, ctx);
}
