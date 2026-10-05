import * as acorn from "acorn";

type Shape = { type?: unknown; key?: { name?: unknown } };

type TaggedTemplate = { type: "TaggedTemplateExpression"; quasi: { quasis: { value: object }[] } };

const isTaggedTemplate = (value: unknown): value is TaggedTemplate =>
  (value as { type?: unknown } | null)?.type === "TaggedTemplateExpression";

/** What a re-print changes without changing behaviour; only a tag reads a template's raw text. */
const printOnly = (tagged: WeakSet<object>) =>
  new Map<string, (holder: Shape) => boolean>([
    ["start", () => true],
    ["end", () => true],
    ["raw", (holder) => !tagged.has(holder)],
    ["shorthand", (holder) => holder.key?.name !== "__proto__"],
  ]);

const isNumberLiteral = (holder: Shape, key: string, value: unknown) =>
  key === "value" && typeof value === "number" && holder.type === "Literal";

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
  const tagged = new WeakSet<object>();
  const dropped = printOnly(tagged);
  return JSON.stringify(tree, function (this: Shape, key: string, value: unknown) {
    if (dropped.get(key)?.(this)) return undefined;
    if (isTaggedTemplate(value)) for (const quasi of value.quasi.quasis) tagged.add(quasi.value);
    if (typeof value === "bigint") return `${value}n`;
    if (maskNumbers && isNumberLiteral(this, key, value)) return "num";
    return value;
  });
}
