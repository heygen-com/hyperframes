import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(import.meta.dirname, "..");

/** Loaded on first use, so a host may ship the CLI without them and commands that never need them still run. */
export const LAZY_PACKAGES = ["esbuild", "puppeteer-core", "sharp"];

function lazyPackage(specifier) {
  return LAZY_PACKAGES.find((name) => specifier === name || specifier.startsWith(`${name}/`));
}

export function listStaticLazyImports(source, filename = "chunk.js") {
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  return sourceFile.statements.flatMap((statement) => {
    const isImportOrExport = ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement);
    const specifier = isImportOrExport ? statement.moduleSpecifier : undefined;
    if (!specifier || !ts.isStringLiteral(specifier) || statement.importClause?.isTypeOnly)
      return [];
    const name = lazyPackage(specifier.text);
    if (!name) return [];
    const { line } = sourceFile.getLineAndCharacterOfPosition(statement.getStart(sourceFile));
    return [`${filename}:${line + 1} imports ${specifier.text} statically`];
  });
}

export function checkCliLazyDeps(root = ROOT) {
  const dist = join(root, "packages/cli/dist");
  if (!existsSync(dist)) return [`${relative(root, dist)} is missing; build the CLI first`];
  return readdirSync(dist, { recursive: true })
    .filter((name) => /\.m?js$/.test(name))
    .flatMap((name) =>
      listStaticLazyImports(
        readFileSync(join(dist, name), "utf8"),
        relative(root, join(dist, name)),
      ),
    );
}

function main() {
  const issues = checkCliLazyDeps();
  if (issues.length > 0) {
    console.error(`Load ${LAZY_PACKAGES.join(", ")} with a dynamic import where they are used:`);
    issues.forEach((issue) => console.error(`- ${issue}`));
    process.exitCode = 1;
    return;
  }
  console.log(`CLI build loads ${LAZY_PACKAGES.join(", ")} only on first use.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
