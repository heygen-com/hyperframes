// fallow-ignore-file complexity
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(import.meta.dirname, "..");

export function listDirectProcessTermination(source, filename = "source.ts") {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const issues = [];

  // AST traversal mirrors the small set of process-termination spellings.
  // fallow-ignore-next-line complexity
  function visit(node) {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "process" &&
      (node.name.text === "exit" || node.name.text === "exitCode")
    ) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      issues.push(
        `${filename}:${position.line + 1}:${position.character + 1} uses process.${node.name.text}`,
      );
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return issues;
}

function listTypeScriptFiles(directory, rootCliPath) {
  // fallow-ignore-next-line complexity
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return listTypeScriptFiles(path, rootCliPath);
    if (!path.endsWith(".ts") || path.endsWith(".test.ts") || path === rootCliPath) return [];
    return [path];
  });
}

export function checkCliProcessOwnership(root = ROOT) {
  const sourceRoot = join(root, "packages/cli/src");
  if (!existsSync(sourceRoot)) return [];
  return listTypeScriptFiles(sourceRoot, join(sourceRoot, "cli.ts")).flatMap((path) =>
    listDirectProcessTermination(readFileSync(path, "utf8"), relative(root, path)),
  );
}

function main() {
  const issues = checkCliProcessOwnership();
  if (issues.length > 0) {
    console.error("CLI process ownership violations:");
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exitCode = 1;
    return;
  }
  console.log("CLI process ownership verified: only cli.ts terminates the process.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
