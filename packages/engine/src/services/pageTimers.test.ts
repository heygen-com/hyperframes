import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Code the engine runs in the page must keep its waits and deadlines off the render's film-time timers:
// a page timer set after a ready seek fires only at the next seek, which waits for it.
const PAGE_CALLS = new Set([
  "evaluate",
  "evaluateOnNewDocument",
  "evaluateHandle",
  "$eval",
  "$$eval",
  "waitForFunction",
]);
const TIMERS = new Set(["setTimeout", "setInterval"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__fixtures__" ? [] : sources(path);
    return /\.ts$/.test(name) && !/\.(test|d)\.ts$/.test(name) ? [path] : [];
  });
}

/** Bare page-side timer calls: in functions handed to the page, and in page-script strings. */
export function barePageTimers(files: Record<string, string>): string[] {
  const parsed = Object.entries(files).map(([name, text]) => ({
    name,
    file: ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true),
  }));
  const declared = new Map<string, ts.Node>();
  for (const { file } of parsed) {
    const visit = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name) declared.set(node.name.text, node);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  const found = new Set<string>();
  const at = (file: ts.SourceFile, node: ts.Node) =>
    `${file.fileName}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
  const isTimer = (callee: ts.Expression): boolean =>
    (ts.isIdentifier(callee) && TIMERS.has(callee.text)) ||
    (ts.isPropertyAccessExpression(callee) &&
      TIMERS.has(callee.name.text) &&
      ts.isIdentifier(callee.expression) &&
      ["window", "globalThis", "self"].includes(callee.expression.text));
  const scanPage = (file: ts.SourceFile, root: ts.Node): void => {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isTimer(node.expression)) found.add(at(file, node));
      ts.forEachChild(node, visit);
    };
    visit(root);
  };
  const timerInScript = (file: ts.SourceFile, node: ts.Node): boolean => {
    if (
      !ts.isStringLiteral(node) &&
      !ts.isNoSubstitutionTemplateLiteral(node) &&
      !ts.isTemplateExpression(node)
    )
      return false;
    const code = node.getText(file).replace(/\/\*[\s\S]*?\*\/|(^|[\s`'"])\/\/.*$/gm, "$1");
    return /\bset(?:Timeout|Interval)\s*\(/.test(code);
  };
  const pageArguments = (node: ts.Node): readonly ts.Expression[] =>
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    PAGE_CALLS.has(node.expression.name.text)
      ? node.arguments
      : [];
  const scanArgument = (file: ts.SourceFile, arg: ts.Expression): void => {
    const fn = ts.isIdentifier(arg) ? declared.get(arg.text) : undefined;
    if (fn) scanPage(fn.getSourceFile(), fn);
    else if (!ts.isIdentifier(arg)) scanPage(file, arg);
  };
  for (const { file } of parsed) {
    const visit = (node: ts.Node): void => {
      if (timerInScript(file, node)) found.add(at(file, node));
      for (const arg of pageArguments(node)) scanArgument(file, arg);
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return [...found].sort();
}

const engineSrc = join(__dirname, "..");
const engineFiles = (): Record<string, string> =>
  Object.fromEntries(
    sources(engineSrc).map((path) => [relative(engineSrc, path), readFileSync(path, "utf8")]),
  );

describe("page-side timers", () => {
  it("use the render shim's original timers in every function and script the engine runs in the page", () => {
    expect(barePageTimers(engineFiles())).toEqual([]);
  });

  it("finds a bare timer in a page function, a function passed by name, and a page-script string", () => {
    const found = barePageTimers({
      "a.ts": [
        "export function onNewDocument() { setTimeout(() => {}, 5); }",
        "async function run(page) {",
        "  await page.evaluate(() => new Promise((r) => window.setTimeout(r, 250)));",
        "  await page.evaluateOnNewDocument(onNewDocument);",
        "  await page.evaluate(`new Promise(function (r) { setTimeout(r, 0); })`);",
        "  await page.evaluate(`// waits on setTimeout(0)\\nPromise.resolve()`);",
        "  await page.evaluate(() => (window.__HF_VIRTUAL_TIME__?.originalSetTimeout ?? setTimeout)(() => {}, 1));",
        "  setTimeout(() => {}, 10);",
        "}",
      ].join("\n"),
    });
    expect(found).toEqual(["a.ts:1", "a.ts:3", "a.ts:5"]);
  });
});
