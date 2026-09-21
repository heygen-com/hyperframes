// Source-only compiler pass. No renderer, browser, GPU, or simulation is started.
import ts from "typescript";
import { resolve } from "node:path";
const root = resolve("src");
const files = ts.sys.readDirectory(root, [".ts"], ["**/node_modules/**"]);
const program = ts.createProgram(files, {
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  resolveJsonModule: true,
  allowSyntheticDefaultImports: true,
});
const relevant = new Set([2304, 2552, 2448, 2454]);
const diagnostics = [
  ...program.getSyntacticDiagnostics(),
  ...program.getSemanticDiagnostics().filter((d) => relevant.has(d.code)),
].filter((d) => d.file?.fileName.startsWith(root));
if (diagnostics.length) {
  console.error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    }),
  );
  process.exitCode = 1;
} else
  console.log(
    "Source compilation: syntax, unresolved names and use-before-initialization passed. No GPU execution.",
  );
