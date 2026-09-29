import { parse, type CallExpression } from "acorn";
import { simple } from "acorn-walk";
import type { ExtractedBlock } from "./utils";

// Blocks belong to a single lint context. Weak keys release AST evidence after the pass.
const callIndexes = new WeakMap<ExtractedBlock, CallExpression[]>();

function callsFor(script: ExtractedBlock): CallExpression[] {
  const cached = callIndexes.get(script);
  if (cached) return cached;
  const calls: CallExpression[] = [];
  try {
    const ast = parse(script.content, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowReturnOutsideFunction: true,
    });
    simple(ast, {
      CallExpression: (node) => {
        calls.push(node);
      },
    });
  } catch {
    // Syntax findings own malformed programs; never guess a call from comment text.
  }
  calls.sort((a, b) => a.start - b.start);
  callIndexes.set(script, calls);
  return calls;
}

/** AST offsets follow the same Acorn representation used by Studio's GSAP editor. */
export function gsapCallOffset(script: ExtractedBlock, method: string): number | undefined {
  return callsFor(script).find(
    ({ callee }) =>
      callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.object.type === "Identifier" &&
      callee.object.name === "gsap" &&
      callee.property.type === "Identifier" &&
      callee.property.name === method,
  )?.start;
}

/** The innermost call containing an already-detected token (for example repeat: -1). */
export function containingCallOffset(
  script: ExtractedBlock,
  tokenOffset: number,
): number | undefined {
  let start: number | undefined;
  for (const call of callsFor(script)) {
    if (call.start > tokenOffset) break;
    if (call.end > tokenOffset) start = call.start;
  }
  return start;
}
