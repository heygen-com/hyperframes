import { readdirSync, readFileSync, writeFileSync } from "node:fs";
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

// Every print call in the CLI, counted per file.
//
// A print call is "plain" when all it prints is text the CLI wrote, by shape: literals, counts,
// numbers and their formatting, constants set from those, colour helpers around those, and anything
// passed through a text helper. Every other print call is counted, and the counts are kept in
// `printedValues.baseline.json` so a count only moves in a reviewed change.
//
// To write the baseline again after a deliberate change, from packages/cli:
//   UPDATE_PRINTED_VALUES_BASELINE=1 npx vitest run src/printedFailureText.wiring.test.ts

const BASELINE = join(SRC, "printedValues.baseline.json");

/** Print calls whose output another program reads, so it stays byte for byte as it is. */
const PRINTS_FOR_ANOTHER_PROGRAM: Record<string, { calls: number; why: string }> = {
  "browser/installRun.ts": { calls: 3, why: "progress lines the parent process parses" },
  "commands/browser.ts": { calls: 2, why: "`browser path` answers with the path alone" },
  "commands/history.ts": { calls: 1, why: "`history peek` writes the stored file's own bytes" },
  "commands/render.ts": { calls: 1, why: "passes on the container's stderr as it arrives" },
  "fontLocalizeCli.ts": { calls: 2, why: "a pipe tool: what it was handed goes back out" },
  "renderSetupWorker.ts": { calls: 2, why: "the result and failure lines its parent parses" },
  "utils/cancellableProcess.ts": { calls: 2, why: "passes on its own worker's stderr" },
  "whisper/sherpaWorker.ts": { calls: 3, why: "prefixed lines `whisper/sherpa.ts` parses" },
};

const KEEPS_TEXT_PLAIN = new Set([
  "join",
  "padEnd",
  "padStart",
  "repeat",
  "toLowerCase",
  "toUpperCase",
  "trim",
  "trimEnd",
]);
const GIVES_A_NUMBER_AS_TEXT = new Set(["toFixed", "toLocaleString", "toPrecision"]);
const CONVERTS = new Set(["Boolean", "Number", "String", "parseFloat", "parseInt"]);
const GIVES_A_NUMBER_OR_A_TRUTH = new Set([
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanToken,
]);

type Constants = Map<string, ts.Expression[] | null>;

const constInitializer = (node: ts.VariableDeclaration) =>
  (node.parent.flags & ts.NodeFlags.Const) !== 0 ? node.initializer : undefined;

/** Each name's initializers when every declaration of it in the file is a `const`; else null. */
function constantsOf(file: ts.SourceFile): Constants {
  const found: Constants = new Map();
  const declare = (name: ts.Node, initializer: ts.Expression | undefined) => {
    if (!ts.isIdentifier(name)) return;
    const before = found.get(name.text);
    found.set(name.text, initializer && before !== null ? [...(before ?? []), initializer] : null);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) || ts.isBindingElement(node)) declare(node.name, undefined);
    if (ts.isVariableDeclaration(node)) declare(node.name, constInitializer(node));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function callIsNotPlain(call: ts.CallExpression, constants: Constants, seen: Set<string>): boolean {
  const anyArgument = () => call.arguments.some((each) => isNotPlain(each, constants, seen));
  const name = calleeName(call);
  if (!ts.isPropertyAccessExpression(call.expression)) return !CONVERTS.has(name) || anyArgument();
  const target = call.expression.expression;
  if (target.getText() === "c" || target.getText() === "Math") return anyArgument();
  if (GIVES_A_NUMBER_AS_TEXT.has(name)) return false;
  if (KEEPS_TEXT_PLAIN.has(name)) return isNotPlain(target, constants, seen) || anyArgument();
  return true;
}

const plainByShape = (node: ts.Node) =>
  shownAsWritten(node) ||
  handsOverAHelper(node) ||
  countOf(node) ||
  (ts.isBinaryExpression(node) && GIVES_A_NUMBER_OR_A_TRUTH.has(node.operatorToken.kind));

function nameIsNotPlain(name: string, constants: Constants, seen: Set<string>): boolean {
  if (name === "undefined") return false;
  const initializers = constants.get(name);
  if (!initializers || seen.has(name)) return true;
  const within = new Set(seen).add(name);
  return initializers.some((each) => isNotPlain(each, constants, within));
}

function isNotPlain(node: ts.Node, constants: Constants, seen = new Set<string>()): boolean {
  if (plainByShape(node)) return false;
  if (ts.isCallExpression(node)) return callIsNotPlain(node, constants, seen);
  if (ts.isConditionalExpression(node))
    return (
      isNotPlain(node.whenTrue, constants, seen) || isNotPlain(node.whenFalse, constants, seen)
    );
  if (ts.isPropertyAccessExpression(node)) return true;
  if (ts.isIdentifier(node)) return nameIsNotPlain(node.text, constants, seen);
  return !!ts.forEachChild(node, (child) => isNotPlain(child, constants, seen) || undefined);
}

function countedPrints(name: string, text: string): number {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const constants = constantsOf(file);
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      printsToTerminal(node) &&
      node.arguments.some((argument) => isNotPlain(argument, constants))
    )
      count += 1;
    ts.forEachChild(node, visit);
  };
  visit(file);
  return count;
}

type Counts = Record<string, number>;

/** What to tell the person whose change moved a count, one line per file. */
function movedCounts(counted: Counts, baseline: Counts, forAnotherProgram: Counts): string[] {
  const files = [...new Set([...Object.keys(counted), ...Object.keys(baseline)])].sort();
  return files.flatMap((file) => {
    const now = (counted[file] ?? 0) - (forAnotherProgram[file] ?? 0);
    const kept = baseline[file] ?? 0;
    if (now > kept)
      return [
        `${file}: ${now - kept} more print call(s) with a value that is not plainly the CLI's own text. ` +
          "Pass the value through terminalText or terminalLines. If the CLI wrote the value itself, " +
          `raise this file's number to ${now} in printedValues.baseline.json in the same change.`,
      ];
    if (now < kept)
      return [
        `${file}: ${kept - now} fewer such print call(s) than recorded. ` +
          `Lower this file's number to ${now} in printedValues.baseline.json in the same change.`,
      ];
    return [];
  });
}

function countsOfEveryFile(): Counts {
  const counts: Counts = {};
  for (const path of sources(SRC)) {
    const name = relative(SRC, path).split(sep).join("/");
    const count = countedPrints(name, readFileSync(path, "utf8"));
    if (count > 0) counts[name] = count;
  }
  return counts;
}

const callsOf = (list: typeof PRINTS_FOR_ANOTHER_PROGRAM): Counts =>
  Object.fromEntries(Object.entries(list).map(([file, { calls }]) => [file, calls]));

it("keeps each file's count of print calls with a value that is not plainly the CLI's own", () => {
  const counted = countsOfEveryFile();
  const forAnotherProgram = callsOf(PRINTS_FOR_ANOTHER_PROGRAM);
  if (process.env.UPDATE_PRINTED_VALUES_BASELINE) {
    const kept = Object.entries(counted)
      .map(([file, count]) => [file, count - (forAnotherProgram[file] ?? 0)] as const)
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    writeFileSync(BASELINE, `${JSON.stringify(Object.fromEntries(kept), null, 2)}\n`);
  }
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as Counts;
  expect(movedCounts(counted, baseline, forAnotherProgram)).toEqual([]);
  for (const [file, calls] of Object.entries(forAnotherProgram))
    expect(counted[file] ?? 0, file).toBeGreaterThanOrEqual(calls);
});

it("counts a print call by what it prints", () => {
  const count = (line: string) => countedPrints("sample.ts", `const total = 3;\n${line}`);
  expect(
    count("console.log(`${total} of ${files.length} done in ${(ms / 1000).toFixed(1)}s`);"),
  ).toBe(0);
  expect(count("console.log(c.dim(`Saved ${terminalText(path)}`));")).toBe(0);
  expect(count("console.log(c.dim(`Saved ${path}`));")).toBe(1);
  expect(count("console.log(row.name);")).toBe(1);
  expect(count("console.log(describe(total));")).toBe(1);
  expect(count("process.stdout.write(bytes);")).toBe(1);
  expect(count("function show(total: string) { console.log(total); }")).toBe(1);
});

it("says what to do when a file's count moves, and counts output meant for another program", () => {
  const moved = (counted: Counts, forAnotherProgram: Counts = {}) =>
    movedCounts(counted, { "a.ts": 2 }, forAnotherProgram);
  expect(moved({ "a.ts": 2 })).toEqual([]);
  expect(moved({ "a.ts": 3 })).toEqual([
    expect.stringMatching(/^a\.ts: 1 more .*terminalText.*raise this file's number to 3 /),
  ]);
  expect(moved({ "a.ts": 1 })).toEqual([
    expect.stringMatching(/^a\.ts: 1 fewer .*Lower this file's number to 1 /),
  ]);
  expect(moved({})).toEqual([expect.stringMatching(/^a\.ts: 2 fewer /)]);
  expect(moved({ "a.ts": 2, "tool.ts": 1 })).toEqual([expect.stringMatching(/^tool\.ts: 1 more /)]);
  expect(moved({ "a.ts": 2, "tool.ts": 1 }, { "tool.ts": 1 })).toEqual([]);
});
