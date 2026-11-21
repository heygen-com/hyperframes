import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

const SRC = fileURLToPath(new URL(".", import.meta.url));

const SHOWS_TEXT_AS_WRITTEN = new Set([
  "terminalText",
  "terminalLines",
  "terminalTextDeep",
  "errorBox",
  "stringify",
  "formatJson",
]);
const WRITTEN_BY_CLI = new Set(["stepsWrittenByCli"]);
const NAMES_A_FAILURE = /^(e|err|error)$/;
const WRITES_TO_A_PIPE_ITS_PARENT_READS: Record<string, string> = {
  "renderSetupWorker.ts": "its last line is the failure record `cancellableProcess.ts` parses",
  "utils/cancellableProcess.ts": "passes on its own worker's stderr, as an inherited stream would",
  "whisper/sherpaWorker.ts": "`whisper/sherpa.ts` reads the prefixed line and builds the failure",
};
const CONSOLE_PRINTS = new Set(["log", "error", "warn", "info", "debug"]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const at = join(dir, entry.name);
    if (entry.isDirectory()) return sources(at);
    return /\.tsx?$/.test(entry.name) && !/\.(test|fixture|d)\.tsx?$/.test(entry.name) ? [at] : [];
  });
}

const calleeName = (call: ts.CallExpression) =>
  ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : call.expression.getText();

function printsToTerminal(call: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  const target = call.expression.expression.getText();
  const method = call.expression.name.text;
  if (target === "console") return CONSOLE_PRINTS.has(method);
  return method === "write" && (target === "process.stderr" || target === "process.stdout");
}

const shownAsWritten = (node: ts.Node) =>
  (ts.isCallExpression(node) && SHOWS_TEXT_AS_WRITTEN.has(calleeName(node))) ||
  (ts.isPropertyAccessExpression(node) && WRITTEN_BY_CLI.has(node.name.text));

const namesValue = (node: ts.Node, names: Set<string>) =>
  ts.isIdentifier(node) &&
  names.has(node.text) &&
  !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node);

function readsRaw(node: ts.Node, names: Set<string>): boolean {
  if (shownAsWritten(node)) return false;
  if (ts.isConditionalExpression(node))
    return readsRaw(node.whenTrue, names) || readsRaw(node.whenFalse, names);
  if (namesValue(node, names)) return true;
  return !!ts.forEachChild(node, (child) => readsRaw(child, names) || undefined);
}

function caughtName(node: ts.Node): { name: string; body: ts.Node } | undefined {
  if (ts.isCatchClause(node) && node.variableDeclaration)
    return { name: node.variableDeclaration.name.getText(), body: node.block };
  if (!ts.isFunctionLike(node) || !("body" in node) || !node.body) return undefined;
  const parameter = node.parameters.find(
    (each) => ts.isIdentifier(each.name) && NAMES_A_FAILURE.test(each.name.text),
  );
  return parameter && { name: parameter.name.getText(), body: node.body };
}

function rawPrints(body: ts.Node, caught: string, file: ts.SourceFile): number[] {
  const names = new Set([caught]);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      readsRaw(node.initializer, names)
    )
      names.add(node.name.text);
    if (
      ts.isCallExpression(node) &&
      printsToTerminal(node) &&
      node.arguments.some((argument) => readsRaw(argument, names))
    )
      lines.push(file.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    ts.forEachChild(node, visit);
  };
  visit(body);
  return lines;
}

function rawPrintsOfCaughtFailures(name: string, text: string): string[] {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    const caught = caughtName(node);
    if (caught)
      for (const line of rawPrints(caught.body, caught.name, file)) found.add(`${name}:${line}`);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...found];
}

const fileOf = (site: string) => site.slice(0, site.lastIndexOf(":"));

it("prints a caught failure only through terminalText, terminalLines or errorBox", () => {
  const sites = sources(SRC).flatMap((path) =>
    rawPrintsOfCaughtFailures(relative(SRC, path).split(sep).join("/"), readFileSync(path, "utf8")),
  );
  const files = new Set(sites.map(fileOf));
  expect(sites.filter((site) => !(fileOf(site) in WRITES_TO_A_PIPE_ITS_PARENT_READS))).toEqual([]);
  expect(Object.keys(WRITES_TO_A_PIPE_ITS_PARENT_READS).filter((file) => !files.has(file))).toEqual(
    [],
  );
});

it("finds a caught failure printed as it came, directly or through a local name", () => {
  const found = rawPrintsOfCaughtFailures(
    "sample.ts",
    [
      "try { run(); } catch (err) {",
      "  const message = err instanceof Error ? err.message : String(err);",
      "  console.error(`Failed: ${message}`);",
      "  console.error(`Failed: ${terminalText(message)}`);",
      "  console.log(JSON.stringify({ error: message }));",
      "}",
      "work().catch((error) => process.stderr.write(String(error)));",
      "work().catch((error) => process.stderr.write(terminalLines(String(error))));",
    ].join("\n"),
  );
  expect(found).toEqual(["sample.ts:3", "sample.ts:7"]);
});
