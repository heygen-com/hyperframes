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
};

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const at = join(dir, entry.name);
    if (entry.isDirectory()) return sources(at);
    return /\.tsx?$/.test(entry.name) && !/\.(test|fixture|d)\.tsx?$/.test(entry.name) ? [at] : [];
  });
}

const callee = (call: ts.CallExpression) => call.expression.getText();

/**
 * The Chrome launches in `text` that skip the page-network fence: a `launchManagedBrowser` or puppeteer `.launch`
 * not inside a `launchWithPageNetwork` call, or an engine `acquireBrowser` given no `pageServerUrl`.
 */
function unfencedLaunches(name: string, text: string): string[] {
  const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const at = (node: ts.Node) =>
    `${name}:${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const fenced = (node: ts.Node): boolean =>
    !!node.parent &&
    ((ts.isCallExpression(node.parent) && callee(node.parent) === "launchWithPageNetwork") ||
      fenced(node.parent));
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = callee(node);
      if ((name === "launchManagedBrowser" || /puppeteer.*\.launch$/i.test(name)) && !fenced(node))
        found.push(at(node));
      if (
        name === "acquireBrowser" &&
        !node.arguments.some(
          (arg) =>
            ts.isObjectLiteralExpression(arg) &&
            arg.properties.some((property) => property.name?.getText() === "pageServerUrl"),
        )
      )
        found.push(at(node));
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

describe("the page-network fence", () => {
  it("is found missing on a bare launch, and found on a fenced one", () => {
    expect(
      unfencedLaunches(
        "bare.ts",
        `const a = await launchManagedBrowser(puppeteer.default, { args });
const b = await puppeteer.default.launch({ args });
const c = await acquireBrowser(args, { forceScreenshot: true });`,
      ),
    ).toEqual(["bare.ts:1", "bare.ts:2", "bare.ts:3"]);
    expect(
      unfencedLaunches(
        "fenced.ts",
        `const a = await launchWithPageNetwork(url, (network) =>
  launchManagedBrowser(puppeteer.default, { args: [...args, ...network.args] }),
);
const c = await acquireBrowser(args, { forceScreenshot: true, pageServerUrl: url });`,
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
