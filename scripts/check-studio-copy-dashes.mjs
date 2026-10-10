// Text a person reads in Studio carries no em or en dash: use a colon, comma, period or parentheses.
// Reads the TypeScript AST, so strings, template text and JSX text count and comments never do.
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(import.meta.dirname, "..");
// JSX keeps HTML entities raw in the AST, and React renders them as dashes.
const DASH = /[\u2013\u2014]|&[mn]dash;|&#821[12];|&#x201[34];/i;
const TEXT_KINDS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
]);

export function listDashedText(source, filename = "source.tsx") {
  const kind = extname(filename) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, kind);
  const issues = [];
  function visit(node) {
    if (TEXT_KINDS.has(node.kind) && DASH.test(node.text)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      issues.push(`${filename}:${line + 1} ${node.text.trim().slice(0, 100)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return issues;
}

export const isShippedSource = (path) =>
  /\.tsx?$/.test(path) && !/\.d\.ts$|\.(test|spec)\.tsx?$/.test(path);

export function checkStudioCopyDashes(root = ROOT) {
  const sourceRoot = join(root, "packages/studio/src");
  return readdirSync(sourceRoot, { recursive: true })
    .filter(isShippedSource)
    .sort()
    .flatMap((path) =>
      listDashedText(
        readFileSync(join(sourceRoot, path), "utf8"),
        relative(root, join(sourceRoot, path)),
      ),
    );
}

function main() {
  const issues = checkStudioCopyDashes();
  if (issues.length > 0) {
    console.error("Studio text with an em or en dash (use a colon, comma, period or parentheses):");
    issues.forEach((issue) => console.error(`- ${issue}`));
    console.error(`${issues.length} hit(s).`);
    process.exitCode = 1;
    return;
  }
  console.log("Studio copy verified: no em or en dash in shipped text.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
