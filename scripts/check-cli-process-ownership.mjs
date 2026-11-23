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

// Each is the root of its own process: the CLI, the warm check process, and the check client in bin.
const PROCESS_ROOTS = ["cli.ts", "warmCheck.ts", "warmCheckClient.ts"];

function listTypeScriptFiles(directory, roots) {
  // fallow-ignore-next-line complexity
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return listTypeScriptFiles(path, roots);
    if (!path.endsWith(".ts") || /\.(test|fixture)\.ts$/.test(path) || roots.includes(path)) {
      return [];
    }
    return [path];
  });
}

export function checkCliProcessOwnership(root = ROOT) {
  const sourceRoot = join(root, "packages/cli/src");
  if (!existsSync(sourceRoot)) return [];
  const roots = PROCESS_ROOTS.map((name) => join(sourceRoot, name));
  return listTypeScriptFiles(sourceRoot, roots).flatMap((path) =>
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
  console.log("CLI process ownership verified: only process roots terminate the process.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
