#!/usr/bin/env tsx
/**
 * Generate primitive detail pages, the primitive index, and docs navigation.
 *
 * Run from any directory:
 *   npx tsx scripts/generate-primitive-pages.ts
 *   npx tsx scripts/generate-primitive-pages.ts --skip-navigation
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface PrimitiveVariable {
  name: string;
  type: string;
  default?: unknown;
  description: string;
  options?: string[];
}

interface Primitive {
  group: string;
  use_when?: string;
  avoid_when?: string;
  pairs_with?: string[];
  variables?: PrimitiveVariable[];
  aspects: string[];
  what: string;
  source: string;
}

interface Dimensions {
  width: number;
  height: number;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const catalogPath = join(repoRoot, ".scratch", "video-primitives", "catalog-index.json");
const docsDir = join(repoRoot, "docs");
const primitivesDir = join(docsDir, "primitives");
const docsJsonPath = join(docsDir, "docs.json");

// Derived from: git ls-tree -d --name-only HEAD registry/components/
const PUBLISHED_PRIMITIVES = new Set([
  "echo-trail",
  "focus-rack",
  "halftone-dissolve",
  "kinetic-type-swap",
  "marker-highlight",
  "match-cut",
  "particle-text-dissolve",
  "press-ripple",
  "state-chip-rail",
  "whiteboard-ink",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isVariable(value: unknown): value is PrimitiveVariable {
  if (!isRecord(value)) return false;
  return (
    typeof value.name === "string" &&
    typeof value.type === "string" &&
    typeof value.description === "string" &&
    (value.options === undefined || isStringArray(value.options))
  );
}

function isPrimitive(value: unknown): value is Primitive {
  if (!isRecord(value)) return false;
  return (
    typeof value.group === "string" &&
    typeof value.what === "string" &&
    typeof value.source === "string" &&
    isStringArray(value.aspects) &&
    (value.use_when === undefined || typeof value.use_when === "string") &&
    (value.avoid_when === undefined || typeof value.avoid_when === "string") &&
    (value.pairs_with === undefined || isStringArray(value.pairs_with)) &&
    (value.variables === undefined ||
      (Array.isArray(value.variables) && value.variables.every(isVariable)))
  );
}

function readCatalog(): Record<string, Primitive> {
  const value: unknown = JSON.parse(readFileSync(catalogPath, "utf8"));
  if (!isRecord(value)) throw new Error("Primitive catalog must be a JSON object");

  const catalog: Record<string, Primitive> = {};
  for (const [name, primitive] of Object.entries(value)) {
    if (!isPrimitive(primitive)) throw new Error(`Invalid primitive catalog entry: ${name}`);
    // The catalog stores groups as sentences ("Motion trails."), but every
    // consumer here renders them as labels: nav entries, section headings, page
    // eyebrows. Strip the terminal period once, at the source, so no consumer
    // has to remember to do it.
    catalog[name] = { ...primitive, group: primitive.group.replace(/\.$/, "") };
  }
  return catalog;
}

function titleFor(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function dimensionsFor(name: string): Dimensions {
  const sourcePath = join(docsDir, "public", "primitives", name, "index.html");
  const source = readFileSync(sourcePath, "utf8");
  const width = Number(source.match(/data-width=["'](\d+)["']/)?.[1]);
  const height = Number(source.match(/data-height=["'](\d+)["']/)?.[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Composition source has no valid dimensions: ${sourcePath}`);
  }
  return { width, height };
}

function aspectLabel({ width, height }: Dimensions): string {
  function greatestCommonDivisor(a: number, b: number): number {
    return b === 0 ? a : greatestCommonDivisor(b, a % b);
  }
  const divisor = greatestCommonDivisor(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function tableCell(value: unknown): string {
  if (value === undefined) return "";
  const text = value === "" ? '""' : String(value);
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function groupCatalog(catalog: Record<string, Primitive>): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const [name, primitive] of Object.entries(catalog)) {
    const names = groups.get(primitive.group) ?? [];
    names.push(name);
    groups.set(primitive.group, names);
  }
  return [...groups];
}

function generatePrimitivePage(name: string, primitive: Primitive): string {
  const title = titleFor(name);
  const dimensions = dimensionsFor(name);
  const isPortrait = dimensions.height > dimensions.width;
  const lines = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(primitive.what)}`,
    "---",
    "",
    'import { PrimitivePlayer } from "/snippets/PrimitivePlayer.jsx";',
    "",
    // Mintlify already renders the frontmatter title as the H1 and the
    // description as the standfirst, so repeating them here printed every page
    // twice. The group is a category, not code, so it is not a code span.
    `<span className="hf-primitive-eyebrow">${primitive.group}</span>`,
    "",
  ];

  if (isPortrait) {
    lines.push(`This primitive is composed for a ${aspectLabel(dimensions)} portrait canvas.`, "");
  }
  lines.push(
    `<PrimitivePlayer name="${name}" width={${dimensions.width}} height={${dimensions.height}} />`,
    "",
  );

  if (primitive.variables && primitive.variables.length > 0) {
    lines.push(
      "## Variables",
      "",
      "| Name | Type | Default | Description |",
      "| --- | --- | --- | --- |",
    );
    for (const variable of primitive.variables) {
      lines.push(
        `| \`${tableCell(variable.name)}\` | \`${tableCell(variable.type)}\` | ${
          variable.default === undefined ? "" : `\`${tableCell(variable.default)}\``
        } | ${tableCell(variable.description)} |`,
      );
    }
    lines.push("");
  }

  if (primitive.use_when !== undefined) {
    lines.push("## When to use it", "", primitive.use_when, "");
  }

  if (primitive.avoid_when !== undefined) {
    lines.push("## When to avoid it", "", primitive.avoid_when, "");
  }

  if (primitive.pairs_with && primitive.pairs_with.length > 0) {
    lines.push("## Pairs with", "");
    for (const pair of primitive.pairs_with) {
      lines.push(`- [${pair}](/primitives/${pair})`);
    }
    lines.push("");
  }

  if (PUBLISHED_PRIMITIVES.has(name)) {
    lines.push(
      "## Install",
      "",
      "<CodeGroup>",
      "",
      "```bash Terminal",
      `npx hyperframes add ${name}`,
      "```",
      "",
      "</CodeGroup>",
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function generateIndex(catalog: Record<string, Primitive>): string {
  const lines = [
    "---",
    'title: "Video Primitives"',
    'description: "An index of the certified video primitives and their live previews"',
    "---",
    "",
    'import { PrimitivePlayer } from "/snippets/PrimitivePlayer.jsx";',
    "",
    // No h1 and no restatement of the description here: Mintlify already renders
    // both from the frontmatter above, so repeating them printed the page title
    // twice.
    '<div className="not-prose hf-primitive-hero">',
    '  <span className="hf-primitive-eyebrow">Motion catalog</span>',
    `  <p>Explore ${Object.keys(catalog).length} production-ready motion patterns. Each preview is live, seekable, and ready to tune.</p>`,
    "</div>",
    "",
    '<div className="not-prose hf-primitive-sections">',
    "",
  ];

  for (const [groupIndex, [group, names]] of groupCatalog(catalog).entries()) {
    lines.push(
      '  <section className="hf-primitive-section">',
      '    <header className="hf-primitive-section-header">',
      `      <span className="hf-primitive-section-index">${String(groupIndex + 1).padStart(2, "0")}</span>`,
      "      <div>",
      `        <h2>${group}</h2>`,
      `        <p>${names.length} ${names.length === 1 ? "primitive" : "primitives"}</p>`,
      "      </div>",
      "    </header>",
      '    <div className="hf-primitive-grid">',
      "",
    );
    for (const name of names) {
      const primitive = catalog[name];
      const dimensions = dimensionsFor(name);
      const orientation = dimensions.height > dimensions.width ? "portrait" : "landscape";
      lines.push(
        `      <a href="/primitives/${name}" className="hf-primitive-card" data-orientation="${orientation}">`,
        `        <PrimitivePlayer name="${name}" width={${dimensions.width}} height={${dimensions.height}} preview />`,
        '        <div className="hf-primitive-card-body">',
        '          <div className="hf-primitive-card-heading">',
        // A card title is a label, not a document heading. Using a real heading
        // here made Mintlify inject its "navigate to header" anchor inside the
        // card's own anchor, and nested anchors are invalid, so the browser
        // reparsed the DOM and React hydration failed with error 418. It also
        // pushed all 25 cards into the page table of contents.
        `            <span className="hf-primitive-card-title">${titleFor(name)}</span>`,
        `            <span className="hf-primitive-card-aspect">${aspectLabel(dimensions)}</span>`,
        "          </div>",
        `          <p>${primitive.what}</p>`,
        "        </div>",
        "      </a>",
        "",
      );
    }
    lines.push("    </div>", "  </section>", "");
  }

  lines.push("</div>");
  return `${lines.join("\n").trimEnd()}\n`;
}

function updateNavigation(catalog: Record<string, Primitive>): void {
  const docsJson: unknown = JSON.parse(readFileSync(docsJsonPath, "utf8"));
  if (!isRecord(docsJson) || !isRecord(docsJson.navigation)) {
    throw new Error("docs.json has no navigation object");
  }
  const tabs = docsJson.navigation.tabs;
  if (!Array.isArray(tabs)) throw new Error("docs.json has no navigation.tabs array");

  const primitiveTab = {
    tab: "Primitives",
    groups: [
      { group: "Overview", pages: ["primitives/index"] },
      ...groupCatalog(catalog).map(([group, names]) => ({
        group,
        pages: names.map((name) => `primitives/${name}`),
      })),
    ],
  };

  const existingIndex = tabs.findIndex((tab) => isRecord(tab) && tab.tab === "Primitives");
  if (existingIndex >= 0) tabs.splice(existingIndex, 1);
  const catalogIndex = tabs.findIndex((tab) => isRecord(tab) && tab.tab === "Catalog");
  tabs.splice(catalogIndex >= 0 ? catalogIndex + 1 : 1, 0, primitiveTab);

  writeFileSync(docsJsonPath, `${JSON.stringify(docsJson, null, 2)}\n`, "utf8");
}

function main(): void {
  const catalog = readCatalog();
  const names = new Set(Object.keys(catalog));

  for (const name of PUBLISHED_PRIMITIVES) {
    if (!names.has(name)) throw new Error(`Published primitive is missing from catalog: ${name}`);
  }
  for (const [name, primitive] of Object.entries(catalog)) {
    for (const pair of primitive.pairs_with ?? []) {
      if (!names.has(pair)) throw new Error(`${name} pairs with missing primitive: ${pair}`);
    }
  }

  rmSync(primitivesDir, { force: true, recursive: true });
  mkdirSync(primitivesDir, { recursive: true });

  for (const [name, primitive] of Object.entries(catalog)) {
    writeFileSync(
      join(primitivesDir, `${name}.mdx`),
      generatePrimitivePage(name, primitive),
      "utf8",
    );
  }
  writeFileSync(join(primitivesDir, "index.mdx"), generateIndex(catalog), "utf8");
  if (!process.argv.includes("--skip-navigation")) updateNavigation(catalog);

  console.log(`Generated ${Object.keys(catalog).length} primitive pages and the index.`);
}

main();
