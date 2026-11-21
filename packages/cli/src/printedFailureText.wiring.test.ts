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
  if (target === "clack.log") return true;
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
      "work().catch((error) => clack.log.warn(`Not saved: ${error.message}`));",
    ].join("\n"),
  );
  expect(found).toEqual(["sample.ts:3", "sample.ts:7", "sample.ts:9"]);
});

const ENTRY_PATH_NAMES_WRITTEN_BY_CLI: Record<string, string[]> = {
  "cli.ts": ["VERSION", "MEASURE_OPS", "group", "label"],
  "utils/reject-unknown-flags.ts": ["c"],
  "utils/reject-extra-positionals.ts": [],
};

const handsOverAHelper = (node: ts.Node) =>
  ts.isCallExpression(node) &&
  node.arguments.some((each) => ts.isIdentifier(each) && SHOWS_TEXT_AS_WRITTEN.has(each.text));

const countOf = (node: ts.Node) =>
  ts.isPropertyAccessExpression(node) && node.name.text === "length";

function readsAnyValue(node: ts.Node, written: Set<string>): boolean {
  if (shownAsWritten(node) || handsOverAHelper(node) || countOf(node)) return false;
  if (ts.isConditionalExpression(node))
    return readsAnyValue(node.whenTrue, written) || readsAnyValue(node.whenFalse, written);
  if (ts.isIdentifier(node))
    return (
      !written.has(node.text) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    );
  return !!ts.forEachChild(node, (child) => readsAnyValue(child, written) || undefined);
}

function functionsNamed(file: ts.SourceFile, names: readonly string[]): ts.Node[] {
  const found: ts.FunctionDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text))
      found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  expect(found.map((each) => each.name?.text).sort()).toEqual([...names].sort());
  return found;
}

function valuesPrintedAsTheyCame(
  name: string,
  text: string,
  writtenByCli: string[],
  within?: readonly string[],
): string[] {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const written = new Set(writtenByCli);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      printsToTerminal(node) &&
      node.arguments.some((argument) => readsAnyValue(argument, written))
    )
      found.push(`${name}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
    ts.forEachChild(node, visit);
  };
  for (const root of within ? functionsNamed(file, within) : [file]) visit(root);
  return found;
}

it("prints a value in the files that run before a command only through the text helpers", () => {
  const sites = Object.entries(ENTRY_PATH_NAMES_WRITTEN_BY_CLI).flatMap(([name, written]) =>
    valuesPrintedAsTheyCame(name, readFileSync(join(SRC, name), "utf8"), written),
  );
  expect(sites).toEqual([]);
});

const MEDIA_COPY_PRINTERS = ["startCopyHeartbeat", "preResolveHostileMediaProxies"];
const MEDIA_COPY_NAMES_WRITTEN_BY_CLI = [
  "Date",
  "Math",
  "done",
  "doneSeconds",
  "elapsedText",
  "finished",
  "settled",
  "startedAt",
  "toMake",
  "total",
];

it("prints the media-copy progress lines only through the text helpers", () => {
  const name = "utils/checkBrowser.ts";
  const text = readFileSync(join(SRC, name), "utf8");
  expect(
    valuesPrintedAsTheyCame(name, text, MEDIA_COPY_NAMES_WRITTEN_BY_CLI, MEDIA_COPY_PRINTERS),
  ).toEqual([]);
});

it("finds a value printed as it came in a file that runs before a command", () => {
  const found = valuesPrintedAsTheyCame(
    "sample.ts",
    [
      "console.error(`Unknown command: ${word}`);",
      "console.error(`Unknown command: ${terminalText(word)}`);",
      "console.error(`Run '${group} --help' to list every command.`);",
      "console.error(build(terminalText));",
      "console.error(short ? terminalText(text) : text);",
      "console.log(JSON.stringify({ error: text }));",
      "console.error(`${files.length} copies; ${files[0].file} first`);",
      "console.error(`${files.length} copies`);",
    ].join("\n"),
    ["group"],
  );
  expect(found).toEqual(["sample.ts:1", "sample.ts:5", "sample.ts:7"]);
});
