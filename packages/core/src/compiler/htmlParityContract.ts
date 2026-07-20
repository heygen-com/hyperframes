import { parseHTML } from "linkedom";

export interface HtmlParityComposition {
  id: string;
  originalId: string | null;
  start: number;
  duration: number | null;
  trackIndex: number | null;
  width: number | null;
  height: number | null;
  variableValues: string | null;
}

export interface HtmlParityTimedElement {
  identity: string;
  start: number;
  duration: number | null;
  trackIndex: number | null;
}

export interface HtmlParityResource {
  identity: string;
  attribute: "src" | "href" | "poster";
  locality: "local" | "remote";
}

export interface CompiledHtmlParityContract {
  compositions: HtmlParityComposition[];
  timedElements: HtmlParityTimedElement[];
  authoredStyleSignatures: string[];
  parityFontFamilies: string[];
  resources: HtmlParityResource[];
  runtimeBootstrap: boolean;
  variableBootstrap: boolean;
}

function finiteAttribute(element: Element, name: string): number | null {
  const raw = element.getAttribute(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function timing(element: Element): {
  start: number;
  duration: number | null;
  trackIndex: number | null;
} {
  const start = finiteAttribute(element, "data-start") ?? 0;
  const duration =
    finiteAttribute(element, "data-duration") ??
    (() => {
      const end = finiteAttribute(element, "data-end");
      return end === null ? null : Math.max(0, end - start);
    })();
  return {
    start,
    duration,
    trackIndex:
      finiteAttribute(element, "data-track-index") ?? finiteAttribute(element, "data-layer"),
  };
}

function normalizeJson(value: string | null): string | null {
  if (value === null) return null;
  try {
    return JSON.stringify(canonicalizeJson(JSON.parse(value) as unknown));
  } catch {
    return value.trim();
  }
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalizeJson(nested)]),
  );
}

function styleSignatures(document: Document): string[] {
  return [...document.querySelectorAll("style")]
    .map((style) => style.textContent ?? "")
    .flatMap((css) => css.match(/[^{}]+\{[^{}]*--parity-contract\s*:[^{}]+\}/g) ?? [])
    .map((rule) =>
      rule
        .replace(/\s+/g, " ")
        .replace(/\s*([:;{},])\s*/g, "$1")
        .trim(),
    )
    .sort();
}

function parityFontFamilies(html: string): string[] {
  const families = new Set<string>();
  for (const match of html.matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    for (const family of match[1]!.split(",")) {
      const normalized = family.trim().replace(/^['"]|['"]$/g, "");
      if (normalized.startsWith("Parity")) families.add(normalized);
    }
  }
  return [...families].sort();
}

function resources(document: Document): HtmlParityResource[] {
  const resources: HtmlParityResource[] = [];
  for (const [index, element] of [
    ...document.querySelectorAll("[src], [href], [poster]"),
  ].entries()) {
    for (const attribute of ["src", "href", "poster"] as const) {
      const value = element.getAttribute(attribute)?.trim();
      if (!value) continue;
      if (element.tagName.toLowerCase() === "script" && /hyperframes|runtime/i.test(value))
        continue;
      resources.push({
        identity:
          element.getAttribute("data-hf-id") ??
          element.getAttribute("id") ??
          `${element.tagName.toLowerCase()}[${index}]`,
        attribute,
        locality: /^https?:\/\//i.test(value) ? "remote" : "local",
      });
    }
  }
  return resources.sort((left, right) =>
    `${left.identity}:${left.attribute}`.localeCompare(`${right.identity}:${right.attribute}`),
  );
}

/** Extract the browser-visible contract shared by preview and render compilation. */
export function extractCompiledHtmlParityContract(html: string): CompiledHtmlParityContract {
  const { document } = parseHTML(html);
  const compositions = [...document.querySelectorAll("[data-composition-id]")].map((element) => {
    const resolved = timing(element);
    return {
      id: element.getAttribute("data-composition-id") ?? "",
      originalId: element.getAttribute("data-hf-original-composition-id"),
      ...resolved,
      width: finiteAttribute(element, "data-width"),
      height: finiteAttribute(element, "data-height"),
      variableValues: normalizeJson(element.getAttribute("data-variable-values")),
    };
  });
  const timedElements = [
    ...document.querySelectorAll(
      "[data-start], [data-duration], [data-end], [data-track-index], [data-layer]",
    ),
  ]
    .filter((element) => !element.hasAttribute("data-composition-id"))
    .map((element, index) => ({
      identity:
        element.getAttribute("data-hf-id") ??
        element.getAttribute("id") ??
        `${element.tagName.toLowerCase()}[${index}]`,
      ...timing(element),
    }));
  return {
    compositions,
    timedElements,
    authoredStyleSignatures: styleSignatures(document),
    parityFontFamilies: parityFontFamilies(html),
    resources: resources(document),
    runtimeBootstrap: /__hyperframes|data-hyperframes-(?:preview-)?runtime/i.test(html),
    variableBootstrap: /__hfVariables(?:ByComp)?/.test(html),
  };
}
