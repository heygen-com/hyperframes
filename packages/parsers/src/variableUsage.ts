/**
 * Browser-safe static scan for composition-variable reads in script text.
 *
 * Compositions read variables by calling the runtime API — `getVariables()`
 * bare (sub-comp scoped shadow) or via `__hyperframes.getVariables()` /
 * `window.__hyperframes.getVariables()` — and there is no DOM-attribute
 * binding to scan, so "which variables does this composition use" can only be
 * derived from the scripts. This is a best-effort static analysis: the
 * patterns agents actually write (destructuring, member access, a single
 * alias variable) resolve to ids; anything opaque flips `scanIncomplete`
 * so consumers can present usage as a lower bound instead of a fact.
 *
 * AST nodes are handled untyped (same convention as gsapParserAcorn.ts) —
 * acorn's structural types don't survive acorn-walk's visitor signatures.
 */

import * as acorn from "acorn";
import * as acornWalk from "acorn-walk";

export interface VariableUsageScan {
  /** Variable ids statically read by the script, in first-seen order. */
  usedIds: string[];
  /**
   * True when the script accesses variables in a way the scan cannot resolve
   * (computed keys, rest spreads, the values object escaping into a call…) or
   * when the script fails to parse — usedIds is then a lower bound.
   */
  scanIncomplete: boolean;
}

interface Sink {
  use(id: string): void;
  incomplete(): void;
}

// oxlint-disable no-explicit-any -- untyped acorn AST traversal, see header

function isGetVariablesCallee(callee: any): boolean {
  if (callee?.type === "Identifier") return callee.name === "getVariables";
  if (callee?.type === "MemberExpression" && !callee.computed) {
    return callee.property?.type === "Identifier" && callee.property.name === "getVariables";
  }
  return false;
}

/** Collect ids from an ObjectPattern destructuring of the values object. */
// Exhaustive AST-node classification — branchy by nature, same as gsapParserAcorn.
// fallow-ignore-next-line complexity
function collectFromObjectPattern(pattern: any, out: Sink): void {
  for (const prop of pattern.properties ?? []) {
    if (prop?.type === "RestElement") {
      out.incomplete();
      continue;
    }
    if (prop?.type !== "Property") continue;
    if (prop.computed === true) {
      out.incomplete();
    } else if (prop.key?.type === "Identifier") {
      out.use(String(prop.key.name));
    } else if (prop.key?.type === "Literal" && typeof prop.key.value === "string") {
      out.use(prop.key.value);
    } else {
      out.incomplete();
    }
  }
}

/** Collect an id from a MemberExpression reading the values object. */
function collectFromMemberAccess(member: any, out: Sink): void {
  if (member.computed !== true && member.property?.type === "Identifier") {
    out.use(String(member.property.name));
  } else if (
    member.computed === true &&
    member.property?.type === "Literal" &&
    typeof member.property.value === "string"
  ) {
    out.use(member.property.value);
  } else {
    out.incomplete();
  }
}

/**
 * Classify one read of the values object (a getVariables() call result or an
 * alias holding it) by its immediate syntactic context. Returns the alias
 * name when the value is bound to a plain variable (`const vars = …`).
 */
// fallow-ignore-next-line complexity
function classifyValueRead(parent: any, valueNode: any, out: Sink): string | null {
  if (!parent || parent.type === "ExpressionStatement") {
    // Bare statement — value unused, nothing read.
    return null;
  }
  if (parent.type === "MemberExpression" && parent.object === valueNode) {
    collectFromMemberAccess(parent, out);
    return null;
  }
  if (parent.type === "VariableDeclarator" && parent.init === valueNode) {
    if (parent.id?.type === "ObjectPattern") {
      collectFromObjectPattern(parent.id, out);
      return null;
    }
    if (parent.id?.type === "Identifier") return String(parent.id.name);
    out.incomplete();
    return null;
  }
  // The values object escapes (argument, return, spread, assignment…) —
  // reads beyond this point are invisible to the scan.
  out.incomplete();
  return null;
}

export function scanVariableUsage(scriptText: string): VariableUsageScan {
  const usedIds: string[] = [];
  const seen = new Set<string>();
  let scanIncomplete = false;

  const sink: Sink = {
    use(id: string) {
      if (!seen.has(id)) {
        seen.add(id);
        usedIds.push(id);
      }
    },
    incomplete() {
      scanIncomplete = true;
    },
  };

  let ast: any;
  try {
    ast = acorn.parse(scriptText, { ecmaVersion: "latest", sourceType: "script" });
  } catch {
    return { usedIds: [], scanIncomplete: true };
  }

  const aliases = new Set<string>();

  // Pass 1: classify every getVariables() call by its parent context.
  acornWalk.ancestor(ast, {
    CallExpression(node: any, _: unknown, ancestors: any[]) {
      if (!isGetVariablesCallee(node.callee)) return;
      const parent = ancestors[ancestors.length - 2];
      const alias = classifyValueRead(parent, node, sink);
      if (alias) aliases.add(alias);
    },
  } as any);

  // Pass 2: classify every reference to an alias of the values object.
  // Scope-naive by design: an unrelated same-named identifier can only make
  // the scan report extra ids or flip scanIncomplete, never miss a read.
  if (aliases.size > 0) {
    acornWalk.ancestor(ast, {
      // fallow-ignore-next-line complexity
      Identifier(node: any, _: unknown, ancestors: any[]) {
        if (!aliases.has(String(node.name))) return;
        const parent = ancestors[ancestors.length - 2];
        if (!parent) return;
        // Skip the declarator that introduced the alias and property-position
        // identifiers that merely share the name.
        if (parent.type === "VariableDeclarator" && parent.id === node) return;
        if (parent.type === "MemberExpression" && parent.property === node) return;
        if (parent.type === "Property" && parent.key === node && parent.computed !== true) return;
        // Chained aliases (const v2 = vars) are not followed — flag instead
        // of silently missing reads through the second name.
        if (classifyValueRead(parent, node, sink)) sink.incomplete();
      },
    } as any);
  }

  return { usedIds, scanIncomplete };
}
