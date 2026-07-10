import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type AuditCategory =
  | "backdrop-filter"
  | "bounce-easing"
  | "decorative-dot"
  | "entry-scale-zero"
  | "font-weight"
  | "gradient"
  | "nested-demo-card"
  | "remote-font-or-style"
  | "remote-script"
  | "transition-all"
  | "unbounded-loop";

interface Scope {
  items: string[];
}

interface StyleRegion {
  css: string;
  offset: number;
}

interface Violation {
  id: string;
  source: "canonical" | "demo";
  category: AuditCategory;
  line: number;
  excerpt: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const scope = JSON.parse(
  readFileSync(resolve(repoRoot, "registry/ui-primitives/operator-black.scope.json"), "utf8"),
) as Scope;

function preserveLines(value: string): string {
  return value.replace(/[^\n]/g, " ");
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, preserveLines);
}

function stripHtmlComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, preserveLines);
}

function styleRegions(source: string): StyleRegion[] {
  const regions: StyleRegion[] = [];
  for (const match of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const css = match[1];
    if (css === undefined || match.index === undefined) continue;
    const relativeOffset = match[0].indexOf(css);
    regions.push({ css: stripCssComments(css), offset: match.index + relativeOffset });
  }
  return regions;
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, Math.max(offset, 0)).split("\n").length;
}

function excerptAt(source: string, offset: number): string {
  return (source.slice(offset).split("\n", 1)[0] ?? "").trim().slice(0, 140);
}

function addPatternViolations(
  violations: Violation[],
  sourceText: string,
  searchText: string,
  offset: number,
  pattern: RegExp,
  context: Omit<Violation, "line" | "excerpt">,
): void {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  for (const match of searchText.matchAll(matcher)) {
    if (match.index === undefined) continue;
    const absoluteOffset = offset + match.index;
    violations.push({
      ...context,
      line: lineAt(sourceText, absoluteOffset),
      excerpt: excerptAt(sourceText, absoluteOffset),
    });
  }
}

function auditFontWeights(
  violations: Violation[],
  sourceText: string,
  region: StyleRegion,
  context: Pick<Violation, "id" | "source">,
): void {
  const declarations = [
    /(?:^|[;{])\s*font-weight\s*:\s*(\d{3,4})\b/gim,
    /(?:^|[;{])\s*font\s*:\s*(?:(?:normal|italic|oblique)\s+)*(\d{3,4})\b/gim,
  ];
  for (const pattern of declarations) {
    for (const match of region.css.matchAll(pattern)) {
      if (match.index === undefined || Number(match[1]) <= 600) continue;
      const absoluteOffset = region.offset + match.index;
      violations.push({
        ...context,
        category: "font-weight",
        line: lineAt(sourceText, absoluteOffset),
        excerpt: excerptAt(sourceText, absoluteOffset),
      });
    }
  }
}

function auditEntryScaleZero(
  violations: Violation[],
  sourceText: string,
  context: Pick<Violation, "id" | "source">,
): void {
  for (const region of styleRegions(sourceText)) {
    addPatternViolations(
      violations,
      sourceText,
      region.css,
      region.offset,
      /\bscale\(\s*0(?:\.0+)?\s*(?:,\s*0(?:\.0+)?\s*)?\)/gi,
      { ...context, category: "entry-scale-zero" },
    );
  }

  // `scaleX(0)` and `scaleY(0)` remain valid for progress/data reveals. Only a
  // zero uniform scale in a GSAP from-state is prohibited.
  const fromStatePatterns = [
    /\.fromTo\s*\(\s*(?:["'`][\s\S]*?["'`]|[^,]+)\s*,\s*\{([\s\S]{0,800}?)\}\s*,\s*\{/gi,
    /\.from\s*\(\s*(?:["'`][\s\S]*?["'`]|[^,]+)\s*,\s*\{([\s\S]{0,800}?)\}\s*[,)]/gi,
  ];
  for (const pattern of fromStatePatterns) {
    for (const match of sourceText.matchAll(pattern)) {
      if (
        match.index === undefined ||
        !/\bscale\s*:\s*0(?:\.0+)?(?=\s*[,}])/i.test(match[1] ?? "")
      ) {
        continue;
      }
      violations.push({
        ...context,
        category: "entry-scale-zero",
        line: lineAt(sourceText, match.index),
        excerpt: excerptAt(sourceText, match.index),
      });
    }
  }
}

function auditNestedDemoCards(
  violations: Violation[],
  sourceText: string,
  context: Pick<Violation, "id" | "source">,
): void {
  const markup = stripHtmlComments(sourceText);
  for (const match of markup.matchAll(/\bclass\s*=\s*["']([^"']+)["']/gi)) {
    if (match.index === undefined) continue;
    const classes = (match[1] ?? "").split(/\s+/);
    const genericCard = classes.some((className) =>
      /(?:^|-)(?:demo|page|preview|showcase|component)-(?:card|panel|surface)(?:-|$)/i.test(
        className,
      ),
    );
    if (!genericCard) continue;
    violations.push({
      ...context,
      category: "nested-demo-card",
      line: lineAt(sourceText, match.index),
      excerpt: excerptAt(sourceText, match.index),
    });
  }
}

function isDecorativeDot(attributes: string): boolean {
  const className = attributes.match(/\bclass\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
  const hasDotClass = className
    .split(/\s+/)
    .some((token) => /(?:^|[-_])dot(?:$|[-_])/i.test(token));

  // Functional indicators are exempt when their contract is explicit. An
  // empty non-interactive element named only as a dot is decorative UI.
  const hasSemanticAttribute =
    /\b(?:role|aria-label|aria-current|aria-selected)\s*=/i.test(attributes) ||
    /\bdata-(?:index|selected|state|status|value)\s*=/i.test(attributes);
  const hasFunctionalClass = /(?:radio|indicator|thumb|carousel|pagination)/i.test(className);
  return hasDotClass && !hasSemanticAttribute && !hasFunctionalClass;
}

function auditDecorativeDots(
  violations: Violation[],
  sourceText: string,
  context: Pick<Violation, "id" | "source">,
): void {
  const markup = stripHtmlComments(sourceText);
  for (const match of markup.matchAll(/<(span|div|i)\b([^>]*)>\s*<\/\1>/gi)) {
    if (match.index === undefined || !isDecorativeDot(match[2] ?? "")) continue;
    violations.push({
      ...context,
      category: "decorative-dot",
      line: lineAt(sourceText, match.index),
      excerpt: excerptAt(sourceText, match.index),
    });
  }
}

function auditDocument(
  id: string,
  sourceKind: Violation["source"],
  sourceText: string,
): Violation[] {
  const violations: Violation[] = [];
  const context = { id, source: sourceKind };

  for (const region of styleRegions(sourceText)) {
    addPatternViolations(
      violations,
      sourceText,
      region.css,
      region.offset,
      /\b(?:-webkit-)?(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/gi,
      { ...context, category: "gradient" },
    );
    addPatternViolations(
      violations,
      sourceText,
      region.css,
      region.offset,
      /(?:^|[;{])\s*(?:-webkit-)?backdrop-filter\s*:/gim,
      { ...context, category: "backdrop-filter" },
    );
    addPatternViolations(
      violations,
      sourceText,
      region.css,
      region.offset,
      /(?:^|[;{])\s*transition\s*:[^;{}]*\ball\b/gim,
      { ...context, category: "transition-all" },
    );
    addPatternViolations(
      violations,
      sourceText,
      region.css,
      region.offset,
      /(?:^|[;{])\s*animation(?:-iteration-count)?\s*:[^;{}]*\binfinite\b/gim,
      { ...context, category: "unbounded-loop" },
    );
    addPatternViolations(
      violations,
      sourceText,
      region.css,
      region.offset,
      /@keyframes\s+[\w-]*bounce[\w-]*/gi,
      { ...context, category: "bounce-easing" },
    );
    auditFontWeights(violations, sourceText, region, context);
  }

  addPatternViolations(
    violations,
    sourceText,
    sourceText,
    0,
    /\bease\s*:\s*["'`](?:back\.out(?:\([^"'`]*\))?|bounce(?:\.[\w-]+)?)["'`]/gi,
    { ...context, category: "bounce-easing" },
  );
  for (const pattern of [
    /\brepeat\s*:\s*-1\b/gi,
    /\.repeat\(\s*-1\s*\)/gi,
    /\biterations\s*:\s*Infinity\b/gi,
    /\bwhile\s*\(\s*true\s*\)/gi,
  ]) {
    addPatternViolations(violations, sourceText, sourceText, 0, pattern, {
      ...context,
      category: "unbounded-loop",
    });
  }

  const uncommented = stripHtmlComments(sourceText);
  addPatternViolations(
    violations,
    sourceText,
    uncommented,
    0,
    /<script\b[^>]*\bsrc\s*=\s*["'](?:https?:)?\/\//gi,
    { ...context, category: "remote-script" },
  );
  for (const link of uncommented.matchAll(/<link\b[^>]*>/gi)) {
    if (
      link.index === undefined ||
      !/\bhref\s*=\s*["'](?:https?:)?\/\//i.test(link[0]) ||
      !/(?:\brel\s*=\s*["'][^"']*stylesheet|\bas\s*=\s*["']font)/i.test(link[0])
    ) {
      continue;
    }
    violations.push({
      ...context,
      category: "remote-font-or-style",
      line: lineAt(sourceText, link.index),
      excerpt: excerptAt(sourceText, link.index),
    });
  }
  for (const region of styleRegions(sourceText)) {
    addPatternViolations(
      violations,
      sourceText,
      region.css,
      region.offset,
      /@import\s+(?:url\(\s*)?["']?(?:https?:)?\/\//gi,
      { ...context, category: "remote-font-or-style" },
    );
    addPatternViolations(
      violations,
      sourceText,
      region.css,
      region.offset,
      /@font-face\s*\{[\s\S]{0,1200}?url\(\s*["']?(?:https?:)?\/\//gi,
      { ...context, category: "remote-font-or-style" },
    );
  }

  if (sourceKind === "demo") {
    // The semantic `card` primitive and the allowed `.hf-ui-demo-stage` scaling
    // wrapper are not generic demo cards. Only card/panel/surface wrappers whose
    // class explicitly identifies them as demo decoration are rejected.
    auditNestedDemoCards(violations, sourceText, context);
  }

  auditEntryScaleZero(violations, sourceText, context);
  auditDecorativeDots(violations, sourceText, context);
  return violations;
}

function formatViolationReport(violations: Violation[]): string {
  const byCategory = new Map<AuditCategory, Map<string, Set<Violation["source"]>>>();
  for (const violation of violations) {
    const ids = byCategory.get(violation.category) ?? new Map();
    const sources = ids.get(violation.id) ?? new Set();
    sources.add(violation.source);
    ids.set(violation.id, sources);
    byCategory.set(violation.category, ids);
  }

  const summary = [...byCategory.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([category, ids]) => {
      const entries = [...ids.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([id, sources]) => `${id}[${[...sources].sort().join("+")}]`);
      return `${category}: ${entries.join(", ")}`;
    });
  const firstLocationById = new Map<string, Violation>();
  for (const violation of violations) {
    const key = `${violation.category}\0${violation.id}`;
    const current = firstLocationById.get(key);
    if (!current || (current.source === "demo" && violation.source === "canonical")) {
      firstLocationById.set(key, violation);
    }
  }
  const details = [...firstLocationById.values()]
    .sort(
      (left, right) =>
        left.category.localeCompare(right.category) ||
        left.id.localeCompare(right.id) ||
        left.source.localeCompare(right.source) ||
        left.line - right.line,
    )
    .map(
      ({ id, source, category, line, excerpt }) =>
        `  ${category} ${id}/${source}:${line} ${excerpt}`,
    );
  return `\n${summary.join("\n")}\n\nFirst location per ID/category:\n${details.join("\n")}`;
}

describe("Operator Black static style scanner", () => {
  it("detects every prohibited pattern without conflating progress or functional indicators", () => {
    const prohibited = `
      <script src="https://example.com/runtime.js"></script>
      <link rel="stylesheet" href="https://example.com/font.css">
      <div class="demo-card"><span class="status-dot"></span></div>
      <style>
        .a { background: linear-gradient(red, blue); backdrop-filter: blur(8px); }
        .b { transition: all 200ms; font-weight: 700; animation: pulse 1s infinite; }
        .c { transform: scale(0); }
      </style>
      <script>
        tl.fromTo(".c", { scale: 0 }, { scale: 1, ease: "back.out(1.2)" });
      </script>
    `;
    expect(
      new Set(auditDocument("fixture", "demo", prohibited).map(({ category }) => category)),
    ).toEqual(
      new Set<AuditCategory>([
        "backdrop-filter",
        "bounce-easing",
        "decorative-dot",
        "entry-scale-zero",
        "font-weight",
        "gradient",
        "nested-demo-card",
        "remote-font-or-style",
        "remote-script",
        "transition-all",
        "unbounded-loop",
      ]),
    );

    const allowed = `
      <script src="../../ui-primitives/vendor/gsap-3.14.2.min.js"></script>
      <button class="carousel-dot" data-index="1" aria-label="Slide 2"></button>
      <span class="radio-dot" data-state="checked"></span>
      <style>
        .progress { transform: scaleX(0); transition: opacity 160ms ease; font-weight: 600; }
        .spinner { animation: spin 900ms linear 3; }
      </style>
      <script>tl.fromTo(".panel", { scale: 0.98 }, { scale: 1 });</script>
    `;
    expect(auditDocument("fixture", "demo", allowed)).toEqual([]);
  });
});

describe("Operator Black frozen-scope style audit", () => {
  it("scans exactly the approved 66 canonical snippets and demos", () => {
    expect(scope.items).toHaveLength(66);
    expect(scope.items).toEqual([...new Set(scope.items)].sort());
  });

  it("contains no prohibited static style or dependency pattern", () => {
    const violations: Violation[] = [];
    for (const id of scope.items) {
      const componentRoot = resolve(repoRoot, "registry/components", id);
      violations.push(
        ...auditDocument(
          id,
          "canonical",
          readFileSync(resolve(componentRoot, `${id}.html`), "utf8"),
        ),
        ...auditDocument(id, "demo", readFileSync(resolve(componentRoot, "demo.html"), "utf8")),
      );
    }

    if (violations.length > 0) throw new Error(formatViolationReport(violations));
  });
});
