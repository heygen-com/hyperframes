import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const srcDir = dirname(fileURLToPath(import.meta.url));

// Inputs that are not escaped by name but cannot carry text from a document.
const ALLOWED: Record<string, string[]> = {
  // One of the fixed PROTECTED_NAMES words, read back from the opener match.
  "linearScans.ts": ["name"],
  // The timeline names, each passed through escapeRegExp before the join.
  "rules/gsap.ts": ["receivers"],
  // A fixed tag alternation such as "video|img|source" from mediaSrcTagRe's callers.
  "utils.ts": ["tagAlternation"],
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

function isEscaped(expr: ts.Expression): boolean {
  if (ts.isCallExpression(expr) && ts.isIdentifier(expr.expression))
    return expr.expression.text === "escapeRegExp";
  if (ts.isIdentifier(expr))
    return /^escaped/i.test(expr.text) || /^[A-Z][A-Z0-9_]*$/.test(expr.text);
  return false;
}

function unescapedInputs(pattern: ts.Expression): ts.Node[] {
  if (ts.isStringLiteral(pattern) || ts.isNoSubstitutionTemplateLiteral(pattern)) return [];
  if (ts.isPropertyAccessExpression(pattern) && pattern.name.text === "source") return [];
  const template = ts.isTaggedTemplateExpression(pattern) ? pattern.template : pattern;
  if (ts.isNoSubstitutionTemplateLiteral(template)) return [];
  if (!ts.isTemplateExpression(template)) return [pattern];
  return template.templateSpans.map((span) => span.expression).filter((e) => !isEscaped(e));
}

it("the linter builds no regular expression from unescaped text", () => {
  const offenders = sources(srcDir).flatMap((file) => {
    const rel = relative(srcDir, file).split("\\").join("/");
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const found: string[] = [];
    const visit = (node: ts.Node): void => {
      const isRegExp =
        (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "RegExp";
      const pattern = isRegExp ? (node as ts.NewExpression).arguments?.[0] : undefined;
      for (const input of pattern ? unescapedInputs(pattern) : []) {
        if (ALLOWED[rel]?.includes(input.getText(source))) continue;
        const { line } = source.getLineAndCharacterOfPosition(input.getStart(source));
        found.push(`${rel}:${line + 1} ${input.getText(source)}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
  });
  expect(
    offenders,
    "pass text from a page through escapeRegExp before it goes into a RegExp",
  ).toEqual([]);
});
