import * as acorn from "acorn";

/** Source details a bundler's re-print changes without changing what the code does. */
const PRINT_ONLY = new Set(["start", "end", "raw", "shorthand"]);

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
  return JSON.stringify(tree, function (this: { type?: unknown }, key: string, value: unknown) {
    if (PRINT_ONLY.has(key)) return undefined;
    if (typeof value === "bigint") return `${value}n`;
    if (maskNumbers && key === "value" && typeof value === "number" && this.type === "Literal")
      return "num";
    return value;
  });
}
