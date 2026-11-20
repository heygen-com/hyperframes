// @vitest-environment node
import { parseHTML } from "linkedom";
import { describe, expect, it } from "vitest";
import { emitRootCompositionVariableStyles } from "./htmlBundler";
import { parseHostVariableValues, readDeclaredDefaults } from "../runtime/getVariables";
import { sanitizeCssValue } from "../runtime/applyVariableBindings";
import { cssVariableName } from "../tokenSlug";

function cssAttributeSelector(attr: string, value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/</g, "\\3c ");
  return `[${attr}="${escaped}"]`;
}

function cssSafeVariableValue(value: string | number): string {
  return sanitizeCssValue(String(value)).replace(/</g, "\\3c ");
}

function compositionVariablesCssBlock(
  variables: Record<string, unknown>,
  selector: string,
): string | null {
  const lines: string[] = [];
  for (const [id, value] of Object.entries(variables)) {
    if ((typeof value === "string" && value !== "") || typeof value === "number") {
      lines.push(`  ${cssVariableName(id)}: ${cssSafeVariableValue(value)};`);
    }
  }
  if (lines.length === 0) return null;
  return `${selector} {\n${lines.join("\n")}\n}`;
}

function oracleEmit(
  document: Document,
  variablesByComp: Record<string, Record<string, unknown>> = {},
  overrides: Record<string, unknown> = {},
  options: { chargeBytes?: (bytes: number) => void } = {},
): boolean {
  const charge = options.chargeBytes ?? defaultVariableStyleCharge();
  const authoredDefines = authoredDefinesPredicate(document);
  const layerFor = makeVariableLayer(authoredDefines, overrides);
  const rules = [
    ...hostScopedVariableRules(variablesByComp, overrides, authoredDefines, charge),
    ...rootDeclaredVariableRules(document, layerFor, charge),
    ...declarerVariableRules(document, layerFor, charge),
  ];
  if (rules.length === 0) return false;
  const style = document.createElement("style");
  style.setAttribute("data-hf-composition-variables", "");
  style.textContent = rules.join("\n\n");
  document.head.appendChild(style);
  return true;
}

const MAX_COMPOSITION_VARIABLE_STYLE_BYTES = 32 * 1024 * 1024;

class CompositionVariableStylesTooLargeError extends Error {
  readonly code = "COMPOSITION_TOO_LARGE" as const;

  constructor(bytes: number) {
    super(
      `Composition variable styles add up to ${(bytes / (1024 * 1024)).toFixed(1)} MB, over the ` +
        `${MAX_COMPOSITION_VARIABLE_STYLE_BYTES / (1024 * 1024)} MB limit. Shorten the variable ` +
        "values or declare them on fewer elements.",
    );
    this.name = "CompositionVariableStylesTooLargeError";
  }
}

function defaultVariableStyleCharge(): (bytes: number) => void {
  let total = 0;
  return (bytes) => {
    total += bytes;
    if (total > MAX_COMPOSITION_VARIABLE_STYLE_BYTES) {
      throw new CompositionVariableStylesTooLargeError(total);
    }
  };
}

type VariableLayer = (
  declared: Record<string, unknown>,
  hostValues: Record<string, unknown>,
) => Record<string, unknown>;

function authoredDefinesPredicate(document: Document): (id: string) => boolean {
  const authoredCss = [...document.querySelectorAll("style:not([data-hf-composition-variables])")]
    .map((s) => s.textContent || "")
    .join("\n");
  const defined = namesBeforeAColon(authoredCss);
  return (id) => defined.has(cssVariableName(id));
}

function namesBeforeAColon(css: string): Set<string> {
  const names = new Set<string>();
  const word = /[\w-]+/g;
  const colonNext = /\s*:/y;
  for (let match = word.exec(css); match; match = word.exec(css)) {
    colonNext.lastIndex = word.lastIndex;
    if (!colonNext.test(css)) continue;
    const text = match[0];
    for (let at = text.indexOf("--"); at !== -1; at = text.indexOf("--", at + 1))
      names.add(text.slice(at));
  }
  return names;
}

function makeVariableLayer(
  authoredDefines: (id: string) => boolean,
  overrides: Record<string, unknown>,
): VariableLayer {
  return (declared, hostValues) => {
    const out: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(declared)) {
      if (!authoredDefines(id)) out[id] = value;
    }
    for (const [id, value] of Object.entries(hostValues)) {
      if (id in declared) out[id] = value;
    }
    for (const [id, value] of Object.entries(overrides)) {
      if (id in declared || id in hostValues) out[id] = value;
    }
    return out;
  };
}

function hostScopedVariableRules(
  variablesByComp: Record<string, Record<string, unknown>>,
  overrides: Record<string, unknown>,
  authoredDefines: (id: string) => boolean,
  charge: (bytes: number) => void,
): string[] {
  const rules: string[] = [];
  for (const [compId, vars] of Object.entries(variablesByComp)) {
    const withOverrides: Record<string, unknown> = {};
    for (const [id, value] of Object.entries(vars)) {
      if (!authoredDefines(id)) withOverrides[id] = value;
    }
    for (const [id, value] of Object.entries(overrides)) {
      if (id in vars) withOverrides[id] = value;
    }
    const rule = compositionVariablesCssBlock(
      withOverrides,
      cssAttributeSelector("data-composition-id", compId),
    );
    if (!rule) continue;
    charge(rule.length);
    rules.push(rule);
  }
  return rules;
}

function rootDeclaredVariableRules(
  document: Document,
  layerFor: VariableLayer,
  charge: (bytes: number) => void,
): string[] {
  const htmlDeclared = readDeclaredDefaults(document.documentElement);
  const htmlRule = compositionVariablesCssBlock(layerFor(htmlDeclared, {}), ":root");
  if (!htmlRule) return [];
  charge(htmlRule.length);
  return [htmlRule];
}

function declarerVariableRules(
  document: Document,
  layerFor: VariableLayer,
  charge: (bytes: number) => void,
): string[] {
  const rules: string[] = [];
  const hostValuesByEl = new Map<Element, Record<string, unknown>>();
  let markerSeq = 0;
  for (const el of [...document.querySelectorAll("[data-composition-variables]")]) {
    const declared = readDeclaredDefaults(el);
    const hostEl =
      typeof el.closest === "function" ? el.parentElement?.closest("[data-variable-values]") : null;
    let hostValues: Record<string, unknown> = {};
    if (hostEl) {
      const cached = hostValuesByEl.get(hostEl);
      hostValues = cached ?? parseHostVariableValues(hostEl);
      if (!cached) hostValuesByEl.set(hostEl, hostValues);
    }
    const vars = layerFor(declared, hostValues);
    if (Object.keys(vars).length === 0) continue;
    markerSeq += 1;
    el.setAttribute("data-hf-var-scope", String(markerSeq));
    const rule = compositionVariablesCssBlock(vars, `[data-hf-var-scope="${markerSeq}"]`);
    if (!rule) continue;
    charge(rule.length);
    rules.push(rule);
  }
  return rules;
}

function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const IDS = ["a", "b", "c", "d", "7", "accent color", "accent-color", "x_y"];
const LAYER_VALUES: unknown[] = ["v1", 3, "", null, true, {}, "v2", 0];

function randomCase(rand: () => number) {
  const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)];
  const subset = () => IDS.filter(() => rand() < 0.5).sort(() => rand() - 0.5);
  const map = () => Object.fromEntries(subset().map((id) => [id, pick(LAYER_VALUES)]));
  const declarer = (extra = "") => {
    const decls = subset().map((id) => ({ id, type: "string", default: pick(LAYER_VALUES) }));
    return `<div ${extra} data-composition-variables='${JSON.stringify(decls)}'></div>`;
  };
  const authored = subset()
    .filter(() => rand() < 0.4)
    .map((id) => `${cssVariableName(id)}: authored;`)
    .join(" ");
  const parts: string[] = [];
  for (let i = Math.floor(rand() * 5); i > 0; i--) parts.push(declarer());
  for (let i = Math.floor(rand() * 3); i > 0; i--) {
    const inner = Array.from({ length: Math.floor(rand() * 4) }, () => declarer()).join("");
    const nested = rand() < 0.3 ? `<section>${inner}</section>` : inner;
    const outer = `<div data-variable-values='${JSON.stringify(map())}'>${nested}</div>`;
    parts.push(rand() < 0.3 ? `<div data-variable-values='{"a":"outer"}'>${outer}</div>` : outer);
  }
  const rootDecls =
    rand() < 0.5 ? JSON.stringify(subset().map((id) => ({ id, default: "r" }))) : "";
  const htmlAttr = rootDecls ? ` data-composition-variables='${rootDecls}'` : "";
  const html =
    `<!doctype html><html${htmlAttr}><head><style>:root { ${authored} }</style></head>` +
    `<body>${parts.join("")}</body></html>`;
  const variablesByComp = Object.fromEntries(
    ["c1", "c2", "c3"].filter(() => rand() < 0.7).map((comp) => [comp, map()]),
  );
  return { html, variablesByComp, overrides: map() };
}

function snapshot(
  run: (document: Document) => boolean,
  html: string,
): { returned: boolean; css: string | null; scopes: Array<string | null> } {
  const { document } = parseHTML(html);
  const returned = run(document as unknown as Document);
  const style = document.querySelector("style[data-hf-composition-variables]");
  const scopes = [...document.querySelectorAll("[data-composition-variables]")].map((el) =>
    el.getAttribute("data-hf-var-scope"),
  );
  return { returned, css: style ? style.textContent : null, scopes };
}

describe("composition variable layering", () => {
  it("matches the previous layering for random inputs", () => {
    const rand = prng(2901);
    let emitted = 0;
    for (let n = 0; n < 400; n++) {
      const { html, variablesByComp, overrides } = randomCase(rand);
      const next = snapshot(
        (doc) => emitRootCompositionVariableStyles(doc, variablesByComp, overrides),
        html,
      );
      const previous = snapshot((doc) => oracleEmit(doc, variablesByComp, overrides), html);
      expect(next).toEqual(previous);
      if (next.css) emitted++;
    }
    expect(emitted).toBeGreaterThan(300);
  });

  const timed = (fn: () => void): number => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };
  const keys = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

  it("does not walk a huge host value map once per declarer", () => {
    const host = Object.fromEntries(keys(50_000, "k").map((id) => [id, "v"]));
    const none = `<div data-composition-variables='[{"id":"z","type":"string","default":"d"}]'></div>`;
    const empty = `<div data-composition-variables='[]'></div>`;
    const html =
      `<!doctype html><html><head></head><body><div data-variable-values='${JSON.stringify(host)}'>` +
      `${(none + empty).repeat(1000)}</div></body></html>`;
    const { document } = parseHTML(html);
    expect(timed(() => emitRootCompositionVariableStyles(document))).toBeLessThan(5000);
  });

  it("does not walk a huge overrides map once per composition", () => {
    const overrides = Object.fromEntries(keys(50_000, "o").map((id) => [id, "v"]));
    const variablesByComp = Object.fromEntries(
      keys(2000, "comp").map((comp) => [comp, { a: "x", b: "y" }]),
    );
    const { document } = parseHTML("<!doctype html><html><head></head><body></body></html>");
    expect(
      timed(() => emitRootCompositionVariableStyles(document, variablesByComp, overrides)),
    ).toBeLessThan(5000);
  });

  it("does not walk host ids whose override emits nothing once per declarer", () => {
    const ids = keys(5000, "h");
    const host = Object.fromEntries(ids.map((id) => [id, "v"]));
    const overrides = Object.fromEntries(ids.map((id) => [id, ""]));
    const html =
      `<!doctype html><html><head></head><body><div data-variable-values='${JSON.stringify(host)}'>` +
      `${`<div data-composition-variables='[]'></div>`.repeat(2000)}</div></body></html>`;
    const { document } = parseHTML(html);
    expect(timed(() => emitRootCompositionVariableStyles(document, {}, overrides))).toBeLessThan(
      5000,
    );
    expect(document.querySelectorAll("[data-hf-var-scope]").length).toBe(2000);
  });
});
