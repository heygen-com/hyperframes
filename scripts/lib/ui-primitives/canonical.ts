import { createHash } from "node:crypto";
import { TOKEN_END, TOKEN_START } from "./tokens.js";

export const CANONICAL_START = "<!-- hf-ui:canonical:start -->";
export const CANONICAL_END = "<!-- hf-ui:canonical:end -->";

export function normalizeUiPrimitiveText(value: string): string {
  return `${value
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+$/gm, "")
    .trimEnd()}\n`;
}

export function normalizedSha256(value: string): string {
  return createHash("sha256").update(normalizeUiPrimitiveText(value)).digest("hex");
}

function occurrenceCount(value: string, marker: string): number {
  return value.split(marker).length - 1;
}

function assertMarkerPair(value: string, start: string, end: string, source: string): void {
  const starts = occurrenceCount(value, start);
  const ends = occurrenceCount(value, end);
  if (starts !== 1 || ends !== 1 || value.indexOf(start) >= value.indexOf(end)) {
    throw new Error(`${source} must contain exactly one ordered ${start} / ${end} pair`);
  }
}

interface RootOpening {
  start: number;
  end: number;
  depth: number;
  tagName: string;
  opening: string;
}

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function maskNonMarkupContent(html: string): string {
  return html.replace(
    /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,
    (match) => " ".repeat(match.length),
  );
}

function findTagEnd(html: string, start: number): number {
  let quote = "";
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index] ?? "";
    if (quote) {
      if (character === quote && html[index - 1] !== "\\") quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

// fallow-ignore-next-line complexity
function uiRootOpenings(html: string, source: string): RootOpening[] {
  const structural = maskNonMarkupContent(html);
  const candidates: RootOpening[] = [];
  let depth = 0;

  for (let index = 0; index < structural.length; index += 1) {
    if (structural[index] !== "<") continue;
    const end = findTagEnd(structural, index);
    if (end < 0) throw new Error(`${source} has an unterminated HTML tag`);
    const opening = html.slice(index, end + 1);
    const closing = /^<\s*\/\s*([a-z][\w-]*)/i.exec(opening);
    if (closing) {
      depth = Math.max(0, depth - 1);
      index = end;
      continue;
    }
    const tag = /^<\s*([a-z][\w-]*)/i.exec(opening);
    const tagName = tag?.[1]?.toLowerCase();
    if (!tagName) {
      index = end;
      continue;
    }
    const classAttribute = /\bclass\s*=\s*(["'])([\s\S]*?)\1/i.exec(opening);
    const classes = (classAttribute?.[2] ?? "").split(/\s+/);
    if (classes.some((name) => /^hf-(?:ui|remocn)-/.test(name))) {
      candidates.push({ start: index, end, depth, tagName, opening });
    }
    if (!/\/\s*>$/.test(opening) && !VOID_ELEMENTS.has(tagName)) depth += 1;
    index = end;
  }

  if (candidates.length === 0) throw new Error(`${source} has no hf-ui/hf-remocn root element`);
  const shallowest = Math.min(...candidates.map((candidate) => candidate.depth));
  const roots = candidates.filter((candidate) => candidate.depth === shallowest);
  if (roots.length !== 1) {
    throw new Error(`${source} has ${roots.length} ambiguous top-level hf-ui/hf-remocn roots`);
  }
  return roots;
}

function ensureUiRootAttribute(canonical: string, source: string): string {
  const [root] = uiRootOpenings(canonical, source);
  if (!root) throw new Error(`${source} root element could not be read`);
  if (/\bdata-hf-ui-root(?:\s|=|>)/.test(root.opening)) return canonical;
  const updatedOpening = root.opening.replace(
    new RegExp(`^<\\s*${root.tagName}`, "i"),
    `<${root.tagName} data-hf-ui-root`,
  );
  const updated = `${canonical.slice(0, root.start)}${updatedOpening}${canonical.slice(root.end + 1)}`;
  const [verified] = uiRootOpenings(updated, source);
  if (!verified || !/\bdata-hf-ui-root(?:\s|=|>)/.test(verified.opening)) {
    throw new Error(`${source} root attribute injection could not be verified`);
  }
  return updated;
}

export function injectOperatorBlackTokens(
  canonicalInput: string,
  tokenBlock: string,
  source = "canonical",
): string {
  let canonical = ensureUiRootAttribute(normalizeUiPrimitiveText(canonicalInput), source);
  const starts = occurrenceCount(canonical, TOKEN_START);
  const ends = occurrenceCount(canonical, TOKEN_END);

  if (starts === 0 && ends === 0) {
    const styleOpening = /<style(?:\s[^>]*)?>/i.exec(canonical);
    if (!styleOpening) throw new Error(`${source} has no style element for the token block`);
    const insertAt = (styleOpening.index ?? 0) + styleOpening[0].length;
    canonical = `${canonical.slice(0, insertAt)}\n${tokenBlock}\n${canonical.slice(insertAt).replace(/^\s*\n/, "")}`;
  } else {
    assertMarkerPair(canonical, TOKEN_START, TOKEN_END, source);
    const start = canonical.indexOf(TOKEN_START);
    const end = canonical.indexOf(TOKEN_END) + TOKEN_END.length;
    const lineStart = canonical.lastIndexOf("\n", start) + 1;
    const lineEndIndex = canonical.indexOf("\n", end);
    const lineEnd = lineEndIndex < 0 ? canonical.length : lineEndIndex + 1;
    canonical = `${canonical.slice(0, lineStart)}${tokenBlock}\n${canonical.slice(lineEnd)}`;
  }

  return normalizeUiPrimitiveText(canonical);
}

export function extractCanonicalRegion(demo: string, source = "demo"): string {
  assertMarkerPair(demo, CANONICAL_START, CANONICAL_END, source);
  const start = demo.indexOf(CANONICAL_START) + CANONICAL_START.length;
  const end = demo.indexOf(CANONICAL_END);
  return normalizeUiPrimitiveText(demo.slice(start, end).replace(/^\n/, ""));
}

function titleize(id: string): string {
  return id
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export function buildUiPrimitiveDemo(id: string, canonicalInput: string): string {
  const canonical = normalizeUiPrimitiveText(canonicalInput).trimEnd();
  const title = titleize(id);
  return normalizeUiPrimitiveText(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>${title} — Operator Black</title>
    <script src="../../ui-primitives/vendor/gsap-3.14.2.min.js"></script>
    <style>
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; }
      body { background: #0a0a0a; }
      .hf-ui-demo-canvas {
        width: 1920px;
        height: 1080px;
        box-sizing: border-box;
        display: grid;
        grid-template-rows: 1fr auto;
        place-items: center;
        padding: 96px;
        background: #0a0a0a;
        color: #e5e5e5;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .hf-ui-demo-stage { display: grid; place-items: center; min-width: 0; max-width: 100%; }
      .hf-ui-demo-caption {
        justify-self: start;
        color: #929292;
        font: 500 18px/1.4 ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
        letter-spacing: 0.01em;
      }
    </style>
  </head>
  <body>
    <main
      class="hf-ui-demo-canvas"
      data-composition-id="${id}-demo"
      data-start="0"
      data-width="1920"
      data-height="1080"
      data-duration="4"
      data-hf-rendering="true"
      data-hf-theme="dark"
    >
      <!-- prettier-ignore -->
      <section class="hf-ui-demo-stage" aria-label="${title} specimen" inert>
${CANONICAL_START}
${canonical}
${CANONICAL_END}
      </section>
      <p class="hf-ui-demo-caption">${title}</p>
      <script>
        const tl = gsap.timeline({ paused: true });
        tl.set(".hf-ui-demo-stage", { opacity: 1 }, 0);
        window.__timelines = window.__timelines || {};
        window.__timelines["${id}-demo"] = tl;
      </script>
    </main>
  </body>
</html>`);
}

export function replaceCanonicalRegion(
  demoInput: string,
  canonicalInput: string,
  id: string,
  source = "demo",
): string {
  let demo = normalizeUiPrimitiveText(demoInput);
  demo = demo.replace(
    /\s*tl\.fromTo\(\s*"\.hf-ui-demo-stage",\s*\{ opacity: 0 \},\s*\{ opacity: 1, duration: 0\.21, ease: "power3\.out" \},\s*0,\s*\);/,
    '\n        tl.set(".hf-ui-demo-stage", { opacity: 1 }, 0);',
  );
  const canonical = normalizeUiPrimitiveText(canonicalInput).trimEnd();
  const starts = occurrenceCount(demo, CANONICAL_START);
  const ends = occurrenceCount(demo, CANONICAL_END);
  if (starts === 0 && ends === 0) return buildUiPrimitiveDemo(id, canonical);
  demo = demo.replace("<!-- oxfmt-ignore -->", "<!-- prettier-ignore -->");
  if (!demo.includes("<!-- prettier-ignore -->")) {
    demo = demo.replace(
      /(\s*)(<section class="hf-ui-demo-stage")/,
      "$1<!-- prettier-ignore -->$1$2",
    );
  }
  assertMarkerPair(demo, CANONICAL_START, CANONICAL_END, source);
  const start = demo.indexOf(CANONICAL_START) + CANONICAL_START.length;
  const end = demo.indexOf(CANONICAL_END);
  return normalizeUiPrimitiveText(`${demo.slice(0, start)}\n${canonical}\n${demo.slice(end)}`);
}

function canonicalClassNames(canonical: string): Set<string> {
  const names = new Set<string>();
  for (const match of canonical.matchAll(/\bclass=["']([^"']+)["']/g)) {
    for (const name of (match[1] ?? "").split(/\s+/)) if (name) names.add(name);
  }
  return names;
}

function demoCssSelectors(css: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const flattenedAtRules = withoutComments.replace(
    /@(?:media|supports|container|layer)[^{]+\{/gi,
    "",
  );
  const selectors: string[] = [];
  for (const match of flattenedAtRules.matchAll(/([^{}]+)\{/g)) {
    const prelude = (match[1] ?? "").trim();
    if (!prelude || prelude.startsWith("@")) continue;
    selectors.push(
      ...prelude
        .split(",")
        .map((selector) => selector.trim())
        .filter(Boolean),
    );
  }
  return selectors;
}

// fallow-ignore-next-line complexity
export function validateDemoOnlyCss(demo: string, canonical: string, source = "demo"): void {
  assertMarkerPair(demo, CANONICAL_START, CANONICAL_END, source);
  const start = demo.indexOf(CANONICAL_START);
  const end = demo.indexOf(CANONICAL_END) + CANONICAL_END.length;
  const outside = `${demo.slice(0, start)}${demo.slice(end)}`;
  if (/<[a-z][^>]*\sstyle\s*=/i.test(outside)) {
    throw new Error(`${source} demo-only markup may not use inline style attributes`);
  }
  const classes = canonicalClassNames(canonical);
  const styles = [...outside.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)].map(
    (match) => match[1] ?? "",
  );

  for (const css of styles) {
    if (/--[A-Za-z_][\w-]*/.test(css)) {
      throw new Error(`${source} demo-only CSS may not assign or consume custom properties`);
    }
    for (const selector of demoCssSelectors(css)) {
      if (selector.includes("*")) {
        throw new Error(`${source} demo-only selector may not use the universal selector`);
      }
      if (/\[data-hf-ui-root\]|\.hf-(?:ui(?!-demo-)|remocn)-/i.test(selector)) {
        throw new Error(`${source} demo-only selector targets the canonical root: ${selector}`);
      }
      if (/#[-_A-Za-z]|\[[^\]]+\]/.test(selector)) {
        throw new Error(`${source} demo-only selector may not use IDs or attributes: ${selector}`);
      }
      for (const classMatch of selector.matchAll(/\.([A-Za-z_][\w-]*)/g)) {
        const name = classMatch[1];
        if (name && classes.has(name) && !name.startsWith("hf-ui-demo-")) {
          throw new Error(`${source} demo-only selector targets canonical class .${name}`);
        }
      }
      for (const typeMatch of selector.matchAll(
        /(?:^|[\s>+~,])([a-z][\w-]*)(?=$|[\s.#:[>+~,])/gi,
      )) {
        const type = typeMatch[1]?.toLowerCase();
        if (type && type !== "html" && type !== "body") {
          throw new Error(`${source} demo-only selector uses element ${type}: ${selector}`);
        }
      }
    }
  }
}
