// Text a person reads in Studio carries no em or en dash: use a colon, comma, period or parentheses.
// Covers Studio and every package whose messages it shows; the CLI's terminal-only output is out.
// Reads the TypeScript AST, so strings, template text and JSX text count and comments never do.
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(import.meta.dirname, "..");
const PACKAGES = [
  "core",
  "engine",
  "lint",
  "parsers",
  "player",
  "producer",
  "sdk",
  "shader-transitions",
  "studio",
  "studio-server",
];
// JSX keeps HTML entities raw in the AST, and React renders them as dashes.
const DASH = /[\u2013\u2014]|&[mn]dash;|&#821[12];|&#x201[34];/i;
// Dashes no person sees in Studio, each matched as narrowly as the text allows.
const EXEMPT = [
  // A comment in injected runtime JS, copied byte for byte into producer goldens and catalog payloads.
  {
    file: "packages/core/src/compiler/compositionScoping.ts",
    contains: "Swallow \u2014 the scoped root",
  },
  // The empty cell of .media/index.md, an agent file kept identical to the media-use copies.
  { file: "packages/core/src/figma/mediaIndex.ts", equals: "\u2014" },
];
const isExempt = (filename, text) =>
  EXEMPT.some(
    (rule) =>
      rule.file === filename &&
      (rule.equals === undefined ? text.includes(rule.contains) : text === rule.equals),
  );
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
    if (TEXT_KINDS.has(node.kind) && DASH.test(node.text) && !isExempt(filename, node.text)) {
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
  return PACKAGES.flatMap((name) => {
    const sourceRoot = join(root, "packages", name, "src");
    return readdirSync(sourceRoot, { recursive: true })
      .filter(isShippedSource)
      .sort()
      .flatMap((path) =>
        listDashedText(
          readFileSync(join(sourceRoot, path), "utf8"),
          relative(root, join(sourceRoot, path)),
        ),
      );
  });
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
