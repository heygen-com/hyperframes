import * as acorn from "acorn";

type Shape = { type?: unknown; key?: { name?: unknown } };

/**
 * A script's syntax tree as one string, or null when it does not parse. Comments, layout, quote
 * style, parentheses and semicolons drop out; `maskNumbers` also hides every number literal.
 */
export function scriptShape(code: string, maskNumbers = false): string | null {
  let tree: acorn.Node;
  try {
    tree = acorn.parse(code, { ecmaVersion: "latest", allowHashBang: true });
  } catch {
    return null;
  }
  return JSON.stringify(tree, function (this: Shape, key: string, value: unknown) {
    // What a re-print changes without changing behaviour; a tagged template reads its raw text.
    if (key === "start" || key === "end") return undefined;
    if (key === "raw" && this.type === "Literal") return undefined;
    if (key === "shorthand" && this.key?.name !== "__proto__") return undefined;
    if (typeof value === "bigint") return `${value}n`;
    if (maskNumbers && key === "value" && typeof value === "number" && this.type === "Literal")
      return "num";
    return value;
  });
}
