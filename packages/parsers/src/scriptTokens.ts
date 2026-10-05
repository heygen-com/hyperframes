import * as acorn from "acorn";

/**
 * A script's tokens as one string, or null when it does not tokenize. Comments, layout, quote style
 * and `;`/`,` drop out, so a script re-printed by a bundler keeps its tokens; `maskNumbers` also
 * hides every number.
 */
export function codeTokens(code: string, maskNumbers = false): string | null {
  try {
    const out: string[] = [];
    for (const token of acorn.tokenizer(code, { ecmaVersion: "latest", allowHashBang: true })) {
      const label = token.type.label;
      const value = (token as { value?: unknown }).value;
      if (label === ";" || label === ",") continue;
      if (label === "num") out.push(maskNumbers ? "num" : `num:${String(value)}`);
      else if (label === "string" || label === "name" || label === "template" || label === "regexp")
        out.push(`${label}:${String(value)}`);
      else out.push(label);
    }
    return out.join("\u0000");
  } catch {
    return null;
  }
}
