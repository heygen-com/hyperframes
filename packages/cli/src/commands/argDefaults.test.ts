import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const commandsDir = dirname(fileURLToPath(import.meta.url));

function commandSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return commandSources(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

function propertyNamed(node: ts.ObjectLiteralExpression, name: string) {
  return node.properties.find(
    (p): p is ts.PropertyAssignment =>
      ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === name,
  );
}

// citty's help appends "(Default: <value>)" to every arg whose `default` is set.
function argsStatingTheirDefault(path: string): string[] {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    const fallback = ts.isObjectLiteralExpression(node)
      ? propertyNamed(node, "default")
      : undefined;
    if (fallback && fallback.initializer.getText(source) !== "undefined") {
      const description =
        propertyNamed(node as ts.ObjectLiteralExpression, "description")?.initializer.getText(
          source,
        ) ?? "";
      if (/\(default:/i.test(description)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        found.push(`${relative(commandsDir, path)}:${line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe("command arg descriptions", () => {
  it("leave the default of an arg that has one to citty's help", () => {
    expect(commandSources(commandsDir).flatMap(argsStatingTheirDefault)).toEqual([]);
  });
});
