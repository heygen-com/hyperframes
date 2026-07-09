import { parseHTML } from "linkedom";
import postcss from "postcss";

export interface SelectorContract {
  selector: string;
  matchCount: number;
}

export interface ManifestFileContract {
  path: string;
  target: string;
  type: string;
}

export interface ManifestContract {
  name: string;
  type: string;
  tags: string[];
  files: ManifestFileContract[];
  previewPoster: string;
}

export interface PrimitiveContract {
  classes: string[];
  ids: string[];
  roles: string[];
  ariaAttributes: string[];
  dataAttributes: string[];
  cssSelectors: SelectorContract[];
  relationSelectors: string[];
  unsupportedSelectors: string[];
  customProperties: string[];
  timelineSelectors: string[];
  manifest: ManifestContract;
}

interface RegistryManifest {
  name?: unknown;
  type?: unknown;
  tags?: unknown;
  files?: unknown;
  preview?: unknown;
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareCodePoints);
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected non-empty manifest string at ${field}`);
  }
  return value;
}

function parseManifest(raw: string): ManifestContract {
  const manifest = JSON.parse(raw) as RegistryManifest;
  if (!Array.isArray(manifest.tags) || !manifest.tags.every((tag) => typeof tag === "string")) {
    throw new Error("Expected manifest.tags to contain only strings");
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error("Expected manifest.files to be an array");
  }

  const files = manifest.files.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      throw new Error(`Expected manifest.files[${index}] to be an object`);
    }
    const record = entry as Record<string, unknown>;
    return {
      path: requireString(record.path, `files[${index}].path`),
      target: requireString(record.target, `files[${index}].target`),
      type: requireString(record.type, `files[${index}].type`),
    };
  });

  if (typeof manifest.preview !== "object" || manifest.preview === null) {
    throw new Error("Expected manifest.preview to be an object");
  }
  const preview = manifest.preview as Record<string, unknown>;

  return {
    name: requireString(manifest.name, "name"),
    type: requireString(manifest.type, "type"),
    tags: [...manifest.tags].sort(compareCodePoints),
    files: files.sort((left, right) => compareCodePoints(left.path, right.path)),
    previewPoster: requireString(preview.poster, "preview.poster"),
  };
}

function extractCssSelectors(css: string): string[] {
  const selectors: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    selectors.push(
      ...rule.selectors.filter((selector) => !/^(?:from|to|\d+(?:\.\d+)?%)$/.test(selector.trim())),
    );
  });

  return sortedUnique(selectors);
}

function extractTimelineSelectors(html: string): string[] {
  const selectors: string[] = [];
  const comments = html.match(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//g) ?? [];
  for (const comment of comments) {
    if (!/(?:timeline|gsap|animate|selector)/i.test(comment)) continue;
    for (const match of comment.matchAll(/(?:^|[\s'"`(,])([.#][A-Za-z_][\w-]*)/g)) {
      if (match[1]) selectors.push(match[1]);
    }
  }
  return sortedUnique(selectors);
}

function hasRelationshipCombinator(selector: string): boolean {
  const withoutQuotedValues = selector.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");
  return /[>+~]|\s/.test(withoutQuotedValues);
}

function extractMarkupContracts(
  document: Document,
): Pick<PrimitiveContract, "classes" | "ids" | "roles" | "ariaAttributes" | "dataAttributes"> {
  const classes: string[] = [];
  const ids: string[] = [];
  const roles: string[] = [];
  const ariaAttributes: string[] = [];
  const dataAttributes: string[] = [];

  for (const element of document.querySelectorAll("*")) {
    classes.push(...element.classList);
    if (element.id) ids.push(element.id);
    for (const attribute of element.attributes) {
      const pair = `${attribute.name}=${attribute.value}`;
      if (attribute.name === "role") roles.push(attribute.value);
      if (attribute.name.startsWith("aria-")) ariaAttributes.push(pair);
      if (attribute.name.startsWith("data-")) dataAttributes.push(pair);
    }
  }

  return {
    classes: sortedUnique(classes),
    ids: sortedUnique(ids),
    roles: sortedUnique(roles),
    ariaAttributes: sortedUnique(ariaAttributes),
    dataAttributes: sortedUnique(dataAttributes),
  };
}

function countCssSelectors(
  document: Document,
  selectors: string[],
): Pick<PrimitiveContract, "cssSelectors" | "unsupportedSelectors"> {
  const cssSelectors: SelectorContract[] = [];
  const unsupportedSelectors: string[] = [];

  for (const selector of selectors) {
    try {
      cssSelectors.push({ selector, matchCount: document.querySelectorAll(selector).length });
    } catch {
      unsupportedSelectors.push(selector);
    }
  }

  return {
    cssSelectors: cssSelectors.sort((left, right) =>
      compareCodePoints(left.selector, right.selector),
    ),
    unsupportedSelectors: sortedUnique(unsupportedSelectors),
  };
}

export function extractPrimitiveContract(
  canonicalHtml: string,
  manifestJson: string,
): PrimitiveContract {
  const { document } = parseHTML(canonicalHtml);
  const markup = extractMarkupContracts(document);
  const css = [...document.querySelectorAll("style")]
    .map((style) => style.textContent ?? "")
    .join("\n");
  const selectors = extractCssSelectors(css);
  const selectorContracts = countCssSelectors(document, selectors);

  const customProperties = sortedUnique(
    [...canonicalHtml.matchAll(/--[A-Za-z_][\w-]*/g)]
      .map((match) => match[0])
      .filter((property) => !property.startsWith("--_hf-ui-")),
  );

  return {
    ...markup,
    ...selectorContracts,
    relationSelectors: selectors.filter(hasRelationshipCombinator),
    customProperties,
    timelineSelectors: extractTimelineSelectors(canonicalHtml),
    manifest: parseManifest(manifestJson),
  };
}

export function findContractRemovals(
  baseline: PrimitiveContract,
  current: PrimitiveContract,
): string[] {
  const removals: string[] = [];
  const compareList = (category: string, expected: string[], actual: string[]) => {
    const currentValues = new Set(actual);
    for (const value of expected) {
      if (!currentValues.has(value)) removals.push(`${category}: ${value}`);
    }
  };

  compareList("class", baseline.classes, current.classes);
  compareList("id", baseline.ids, current.ids);
  compareList("role", baseline.roles, current.roles);
  compareList("aria", baseline.ariaAttributes, current.ariaAttributes);
  compareList("data", baseline.dataAttributes, current.dataAttributes);
  compareList("relation-selector", baseline.relationSelectors, current.relationSelectors);
  compareList("unsupported-selector", baseline.unsupportedSelectors, current.unsupportedSelectors);
  compareList("custom-property", baseline.customProperties, current.customProperties);
  compareList("timeline-selector", baseline.timelineSelectors, current.timelineSelectors);

  const currentSelectors = new Map(
    current.cssSelectors.map(({ selector, matchCount }) => [selector, matchCount]),
  );
  for (const { selector, matchCount } of baseline.cssSelectors) {
    const currentCount = currentSelectors.get(selector);
    if (currentCount === undefined) {
      removals.push(`css-selector: ${selector}`);
    } else if (currentCount !== matchCount) {
      removals.push(`css-selector-count: ${selector} (${matchCount} -> ${currentCount})`);
    }
  }

  if (JSON.stringify(current.manifest) !== JSON.stringify(baseline.manifest)) {
    removals.push("manifest: identity changed");
  }

  return removals;
}
