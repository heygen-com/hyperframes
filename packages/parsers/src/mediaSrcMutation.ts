import * as acorn from "acorn";
import * as acornWalk from "acorn-walk";

export interface MediaSrcMutation {
  selector: string;
  operation: "src_assignment" | "set_attribute";
  raw: string;
}

interface Binding {
  initializer: acorn.Expression | null;
  scope: Scope;
}

interface Scope {
  parent?: Scope;
  bindings: Map<string, Binding>;
}

function parseProgram(script: string): acorn.Program {
  try {
    return acorn.parse(script, { ecmaVersion: "latest", sourceType: "script" });
  } catch {
    return acorn.parse(script, { ecmaVersion: "latest", sourceType: "module" });
  }
}

function literalString(node: acorn.AnyNode | null | undefined): string | undefined {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

function memberName(node: acorn.AnyNode | null | undefined): string | undefined {
  if (node?.type !== "MemberExpression") return undefined;
  if (!node.computed && node.property.type === "Identifier") return node.property.name;
  return literalString(node.property);
}

function isFunctionScope(node: acorn.AnyNode): boolean {
  return (
    node.type === "Program" ||
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression" ||
    node.type === "ArrowFunctionExpression" ||
    node.type === "StaticBlock"
  );
}

function isScope(node: acorn.AnyNode): boolean {
  return (
    isFunctionScope(node) ||
    node.type === "BlockStatement" ||
    node.type === "CatchClause" ||
    node.type === "ForStatement" ||
    node.type === "ForInStatement" ||
    node.type === "ForOfStatement" ||
    node.type === "SwitchStatement" ||
    node.type === "ClassDeclaration" ||
    node.type === "ClassExpression"
  );
}

function declarePattern(
  pattern: acorn.Pattern,
  initializer: acorn.Expression | null,
  scope: Scope,
  initializerScope = scope,
): void {
  switch (pattern.type) {
    case "Identifier":
      if (initializer || !scope.bindings.has(pattern.name)) {
        scope.bindings.set(pattern.name, { initializer, scope: initializerScope });
      }
      break;
    case "RestElement":
      declarePattern(pattern.argument, null, scope);
      break;
    case "AssignmentPattern":
      declarePattern(pattern.left, null, scope);
      break;
    case "ArrayPattern":
    case "ObjectPattern":
      declarePatterns(destructuredPatterns(pattern), scope);
      break;
  }
}

function declarePatterns(patterns: readonly acorn.Pattern[], scope: Scope): void {
  for (const pattern of patterns) declarePattern(pattern, null, scope);
}

function destructuredPatterns(pattern: acorn.ObjectPattern | acorn.ArrayPattern): acorn.Pattern[] {
  if (pattern.type === "ObjectPattern") {
    return pattern.properties.map((property) =>
      property.type === "RestElement" ? property.argument : property.value,
    );
  }
  return pattern.elements.filter((element): element is acorn.Pattern => element !== null);
}

function declareOptionalPattern(pattern: acorn.Pattern | null | undefined, scope: Scope): void {
  if (pattern) declarePattern(pattern, null, scope);
}

function declareScopedName(node: acorn.AnyNode, scope: Scope): void {
  switch (node.type) {
    case "FunctionExpression":
    case "FunctionDeclaration":
      declareOptionalPattern(node.id, scope);
      declarePatterns(node.params, scope);
      break;
    case "ArrowFunctionExpression":
      declarePatterns(node.params, scope);
      break;
    case "ClassDeclaration":
    case "ClassExpression":
      declareOptionalPattern(node.id, scope);
      break;
    case "CatchClause":
      declareOptionalPattern(node.param, scope);
      break;
    case "ImportDeclaration":
      declarePatterns(
        node.specifiers.map((specifier) => specifier.local),
        scope,
      );
      break;
  }
}

function lookupBinding(name: string, scope: Scope): Binding | undefined {
  for (let current: Scope | undefined = scope; current; current = current.parent) {
    const binding = current.bindings.get(name);
    if (binding) return binding;
  }
  return undefined;
}

function collectBindings(
  ast: acorn.Program,
): (ancestors: readonly acorn.AnyNode[], functionOnly?: boolean) => Scope {
  const root: Scope = { bindings: new Map() };
  const scopes = new WeakMap<acorn.AnyNode, Scope>([[ast, root]]);
  const scopeAt = (ancestors: readonly acorn.AnyNode[], functionOnly = false): Scope => {
    let parent = root;
    let selected = root;
    for (const node of ancestors) {
      if (!isScope(node)) continue;
      let scope = scopes.get(node);
      if (!scope) {
        scope = { parent, bindings: new Map() };
        scopes.set(node, scope);
      }
      parent = scope;
      if (!functionOnly || isFunctionScope(node)) selected = scope;
    }
    return selected;
  };

  acornWalk.fullAncestor(ast, (node, _state, ancestors) => {
    const scope = scopeAt(ancestors);
    if (node.type === "VariableDeclarator") {
      const declaration = ancestors.at(-2);
      const bindingScope = scopeAt(
        ancestors,
        declaration?.type === "VariableDeclaration" && declaration.kind === "var",
      );
      declarePattern(node.id, node.init ?? null, bindingScope, scope);
      return;
    }
    if ((node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") && node.id) {
      declarePattern(node.id, null, scopeAt(ancestors.slice(0, -1)));
    }
    declareScopedName(node, scope);
  });
  return scopeAt;
}

function lookupSelector(
  node: acorn.Expression | acorn.Super | null | undefined,
  scope: Scope,
  seen = new Set<Binding>(),
): string | undefined {
  if (node?.type === "Identifier") {
    const binding = lookupBinding(node.name, scope);
    if (!binding || seen.has(binding)) return undefined;
    seen.add(binding);
    return lookupSelector(binding.initializer, binding.scope, seen);
  }
  return selectorFromDomLookup(node);
}

function selectorFromDomLookup(
  node: acorn.Expression | acorn.Super | null | undefined,
): string | undefined {
  if (node?.type !== "CallExpression" || node.callee.type !== "MemberExpression") {
    return undefined;
  }
  const method = memberName(node.callee);
  if (method !== "getElementById" && method !== "querySelector") return undefined;
  const value = literalString(node.arguments[0]);
  if (!value) return undefined;
  return method === "getElementById" ? `#${value}` : value;
}

/** Find literal source writes whose target is a statically resolvable DOM lookup. */
export function extractMediaSrcMutations(script: string): MediaSrcMutation[] {
  try {
    const ast = parseProgram(script);
    const scopeAt = collectBindings(ast);
    const mutations: MediaSrcMutation[] = [];
    acornWalk.ancestor(ast, {
      AssignmentExpression(node, _state, ancestors) {
        if (
          node.operator !== "=" ||
          node.left.type !== "MemberExpression" ||
          memberName(node.left) !== "src"
        )
          return;
        const selector = lookupSelector(node.left.object, scopeAt(ancestors));
        if (!selector) return;
        mutations.push({
          selector,
          operation: "src_assignment",
          raw: script.slice(node.start, node.end),
        });
      },
      CallExpression(node, _state, ancestors) {
        if (node.callee.type !== "MemberExpression" || memberName(node.callee) !== "setAttribute")
          return;
        if (literalString(node.arguments[0])?.toLowerCase() !== "src") return;
        const selector = lookupSelector(node.callee.object, scopeAt(ancestors));
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
