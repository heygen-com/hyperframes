import { parse, parseExpressionAt, type CallExpression, type Expression } from "acorn";
import { simple } from "acorn-walk";

export const GLSL_SCRIPT_TYPES = new Set(["x-shader/x-fragment", "x-shader/x-vertex", "text/glsl"]);

interface ShaderSource {
  text: string;
  start: number;
  exactOffsets: boolean;
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, (text) => text.replace(/[^\r\n]/g, " "));
}

function staticShaders(source: string): ShaderSource[] {
  const shaders: ShaderSource[] = [];
  try {
    const ast = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowReturnOutsideFunction: true,
    });
    simple(ast, {
      Literal(node) {
        if (typeof node.value !== "string") return;
        shaders.push({
          text: node.value,
          start: node.start + 1,
          exactOffsets: source.slice(node.start + 1, node.end - 1) === node.value,
        });
      },
      TemplateLiteral(node) {
        if (node.expressions.length !== 0) return;
        const value = node.quasis[0]?.value;
        if (value?.cooked == null) return;
        shaders.push({
          text: value.cooked,
          start: node.start + 1,
          exactOffsets: source.slice(node.start + 1, node.end - 1) === value.cooked,
        });
      },
    });
  } catch {
    // Syntax diagnostics own invalid JavaScript. Do not guess from comments or prose.
  }
  return shaders.filter(({ text }) => /\bvoid\s+main\s*\(/.test(withoutComments(text)));
}

function isNumber(node: Expression | undefined, value: number): boolean {
  return node?.type === "Literal" && node.value === value;
}

function isCall(node: Expression | undefined, name: string): boolean {
  return (
    node?.type === "CallExpression" &&
    node.callee.type === "Identifier" &&
    node.callee.name === name
  );
}

function unboundedCosine(node: Expression): boolean {
  if (node.type !== "CallExpression") return false;
  if (isCall(node, "dot")) return node.arguments.length === 2;
  if (!isCall(node, "max") || node.arguments.length !== 2) return false;
  const a = argumentAt(node, 0);
  const b = argumentAt(node, 1);
  return zeroFlooredDot(a, b) || zeroFlooredDot(b, a);
}

function argumentAt(call: CallExpression, index: number): Expression | undefined {
  const node = call.arguments[index];
  return node?.type === "SpreadElement" ? undefined : node;
}

function zeroFlooredDot(a: Expression | undefined, b: Expression | undefined): boolean {
  return isCall(a, "dot") && isNumber(b, 0);
}

function unsafeCosinePower(call: CallExpression): boolean {
  if (call.arguments.length !== 2) return false;
  const [base] = call.arguments;
  return (
    base?.type === "BinaryExpression" &&
    base.operator === "-" &&
    base.left.type !== "PrivateIdentifier" &&
    isNumber(base.left, 1) &&
    unboundedCosine(base.right)
  );
}

function unsafePowOffsets(source: string): number[] {
  const offsets: number[] = [];
  const masked = withoutComments(source);
  for (const match of masked.matchAll(/\bpow\s*\(/g)) {
    try {
      const expression = parseExpressionAt(masked, match.index, { ecmaVersion: "latest" });
      simple(expression, {
        CallExpression(node) {
          if (node.start === match.index && unsafeCosinePower(node)) offsets.push(node.start);
        },
      });
    } catch {
      // This is a narrow expression check, not a GLSL parser or compiler.
    }
  }
  return offsets;
}

/** Static GLSL blocks and complete static JS shader strings; no data-flow inference. */
export function shaderDomainOffsets(source: string, glsl = false): Array<number | undefined> {
  const shaders = glsl ? [{ text: source, start: 0, exactOffsets: true }] : staticShaders(source);
  return shaders.flatMap(({ text, start, exactOffsets }) =>
    unsafePowOffsets(text).map((offset) => (exactOffsets ? start + offset : undefined)),
  );
}
