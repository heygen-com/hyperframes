import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));

// Chrome launches that never open a composition page, so PRODUCER_RESTRICT_PAGE_NETWORK's fence doesn't apply.
const OPENS_NO_COMPOSITION: Record<string, string> = {
  "browser/launch.ts": "defines the launch, and its GPU probe opens a blank page",
  "capture/launchCaptureBrowser.ts": "`capture` opens a website, not a composition",
  "measure/hands.ts":
    "`measure hands` opens its own page of pinned MediaPipe code; every request is answered from disk or aborted",
};

const WATCHED = new Set(["launchManagedBrowser", "acquireBrowser", "launchWithPageNetwork"]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const at = join(dir, entry.name);
    if (entry.isDirectory()) return sources(at);
    return /\.tsx?$/.test(entry.name) && !/\.(test|fixture|d)\.tsx?$/.test(entry.name) ? [at] : [];
  });
}

/** The called function's own name, so `engine.acquireBrowser(…)` reads as `acquireBrowser`. */
const calleeName = (call: ts.CallExpression) =>
  ts.isPropertyAccessExpression(call.expression)
    ? call.expression.name.text
    : call.expression.getText();

const usesProperty = (body: ts.Node, object: string, property: string): boolean =>
  (ts.isPropertyAccessExpression(body) &&
    body.expression.getText() === object &&
    body.name.text === property) ||
  !!ts.forEachChild(body, (child) => usesProperty(child, object, property) || undefined);

/** Whether `node` is inside a `launchWithPageNetwork` callback that passes on both its args and its profile. */
function fenced(node: ts.Node): boolean {
  for (let at = node.parent; at; at = at.parent) {
    const call = at.parent;
    if (!ts.isArrowFunction(at) && !ts.isFunctionExpression(at)) continue;
    if (!call || !ts.isCallExpression(call) || calleeName(call) !== "launchWithPageNetwork")
      continue;
    const network = at.parameters[0]?.name.getText();
    return (
      !!network &&
      usesProperty(at.body, network, "args") &&
      usesProperty(at.body, network, "userDataDir")
    );
  }
  return false;
}

const unsetValue = (value: ts.Expression) =>
  value.kind === ts.SyntaxKind.NullKeyword ||
  ts.isVoidExpression(value) ||
  (ts.isIdentifier(value) && value.text === "undefined");

const renamesWatched = (node: ts.Node): node is ts.ImportSpecifier | ts.BindingElement =>
  (ts.isImportSpecifier(node) || ts.isBindingElement(node)) &&
  !!node.propertyName &&
  WATCHED.has(node.propertyName.getText()) &&
  node.name.getText() !== node.propertyName.getText();

const setsPageServer = (property: ts.ObjectLiteralElementLike) =>
  property.name?.getText() === "pageServerUrl" &&
  (ts.isShorthandPropertyAssignment(property) ||
    (ts.isPropertyAssignment(property) && !unsetValue(property.initializer)));

/** A launch outside the fence: Chrome started directly, or an engine browser with no page server. */
function launchesUnfenced(call: ts.CallExpression): boolean {
  const called = calleeName(call);
  if (called === "launchManagedBrowser" || /puppeteer.*\.launch$/i.test(call.expression.getText()))
    return !fenced(call);
  return (
    called === "acquireBrowser" &&
    !call.arguments.some(
      (arg) => ts.isObjectLiteralExpression(arg) && arg.properties.some(setsPageServer),
    )
  );
}

/**
 * The Chrome launches in `text` that skip the page-network fence: a `launchManagedBrowser` or puppeteer `.launch`
 * not inside a `launchWithPageNetwork` callback that uses its network, an `acquireBrowser` without a set
 * `pageServerUrl`, or any of these under another name, which this check couldn't follow.
 */
function unfencedLaunches(name: string, text: string): string[] {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const at = (node: ts.Node) =>
    `${name}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const visit = (node: ts.Node) => {
    if (renamesWatched(node)) found.push(`${at(node)} renames ${node.propertyName!.getText()}`);
    if (ts.isCallExpression(node) && launchesUnfenced(node)) found.push(at(node));
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("the page-network fence", () => {
  it("is found missing on a bare, renamed or unused launch, and found on a fenced one", () => {
    expect(
      unfencedLaunches(
        "bare.ts",
        `const a = await launchManagedBrowser(puppeteer.default, { args });
const b = await puppeteer.default.launch({ args });
const c = await acquireBrowser(args, { forceScreenshot: true });
const d = await engine.acquireBrowser(args, { pageServerUrl: undefined });
import { launchManagedBrowser as launchIt } from "./launch.js";
const { acquireBrowser: acquire } = await import("@hyperframes/engine");
const e = await launchWithPageNetwork(url, (network) =>
  launchManagedBrowser(puppeteer.default, { args, userDataDir: network.userDataDir }),
);`,
      ),
    ).toEqual([
      "bare.ts:1",
      "bare.ts:2",
      "bare.ts:3",
      "bare.ts:4",
      "bare.ts:5 renames launchManagedBrowser",
      "bare.ts:6 renames acquireBrowser",
      "bare.ts:8",
    ]);
    expect(
      unfencedLaunches(
        "fenced.ts",
        `const a = await launchWithPageNetwork(url, (network) =>
  launchManagedBrowser(puppeteer.default, { args: [...args, ...network.args], userDataDir: network.userDataDir }),
);
const b = await launchWithPageNetwork(url, (network) => {
  const allArgs = [...args, ...network.args];
  return launchManagedBrowser(puppeteer.default, { userDataDir: network.userDataDir, args: allArgs });
});
const c = await acquireBrowser(args, { forceScreenshot: true, pageServerUrl: url });
const d = await acquireBrowser(args, { pageServerUrl });`,
      ),
    ).toEqual([]);
  });

  // fails without the fix: layout, validate and the motion shot launched Chrome with launchManagedBrowser alone, and
  // the Studio thumbnail browser called acquireBrowser with no page server; only the shared page-open path was tested.
  it("covers every Chrome launch in the CLI that opens a composition", () => {
    for (const file of Object.keys(OPENS_NO_COMPOSITION))
      expect(existsSync(join(SRC, file))).toBe(true);
    const unfenced = sources(SRC)
      .map((file) => relative(SRC, file).split(sep).join("/"))
      .filter((file) => !(file in OPENS_NO_COMPOSITION))
      .flatMap((file) => unfencedLaunches(file, readFileSync(join(SRC, file), "utf8")));
    expect(unfenced).toEqual([]);
  });
});
