import * as acorn from "acorn";
import * as acornWalk from "acorn-walk";

export interface MediaSrcMutation {
  selector: string;
  operation: "src_assignment" | "set_attribute";
  raw: string;
}

function parseProgram(script: string): any {
  try {
    return acorn.parse(script, { ecmaVersion: "latest", sourceType: "script" });
  } catch {
    return acorn.parse(script, { ecmaVersion: "latest", sourceType: "module" });
  }
}

function literalString(node: any): string | undefined {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions?.length === 0) {
    return node.quasis?.[0]?.value?.cooked;
  }
  return undefined;
}

function memberName(node: any): string | undefined {
  if (node?.type !== "MemberExpression") return undefined;
  if (!node.computed && node.property?.type === "Identifier") return node.property.name;
  return literalString(node.property);
}

function lookupSelector(node: any, bindings: ReadonlyMap<string, string>): string | undefined {
  if (node?.type === "Identifier") return bindings.get(node.name);
  if (node?.type !== "CallExpression" || node.callee?.type !== "MemberExpression") {
    return undefined;
  }
  const method = memberName(node.callee);
  if (method !== "getElementById" && method !== "querySelector") return undefined;
  const value = literalString(node.arguments?.[0]);
  if (!value) return undefined;
  return method === "getElementById" ? `#${value}` : value;
}

/** Find literal source writes whose target is a statically resolvable DOM lookup. */
export function extractMediaSrcMutations(script: string): MediaSrcMutation[] {
  try {
    const ast = parseProgram(script);
    const bindings = new Map<string, string>();
    acornWalk.simple(ast, {
      VariableDeclarator(node: any) {
        if (node.id?.type !== "Identifier") return;
        const selector = lookupSelector(node.init, bindings);
        if (selector) bindings.set(node.id.name, selector);
      },
    });

    const mutations: MediaSrcMutation[] = [];
    acornWalk.simple(ast, {
      AssignmentExpression(node: any) {
        if (node.operator !== "=" || memberName(node.left) !== "src") return;
        const selector = lookupSelector(node.left.object, bindings);
        if (!selector) return;
        mutations.push({
          selector,
          operation: "src_assignment",
          raw: script.slice(node.start, node.end),
        });
      },
      CallExpression(node: any) {
        if (memberName(node.callee) !== "setAttribute") return;
        if (literalString(node.arguments?.[0])?.toLowerCase() !== "src") return;
        const selector = lookupSelector(node.callee.object, bindings);
        if (!selector) return;
        mutations.push({
          selector,
          operation: "set_attribute",
          raw: script.slice(node.start, node.end),
        });
      },
    });
    return mutations;
  } catch {
    return [];
  }
}
