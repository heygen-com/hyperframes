import type { LintContext, HyperframeLintFinding } from "../context";
import { readJsonAttr } from "../utils";
import { isRegistrySourceFile } from "./composition";

const CONTRACT_TOKENS = [
  "--bg",
  "--fg",
  "--muted",
  "--surface",
  "--border",
  "--brand",
  "--accent",
  "--font-display",
  "--font-body",
  "--font-mono",
  "--radius",
  "--space-1",
  "--space-2",
  "--space-3",
  "--dur-beat",
  "--ease-standard",
  "--ease-emphasis",
];

const CONTRACT_TOKEN_SET = new Set(CONTRACT_TOKENS);
const ROOT_SELECTORS = new Set([":root", "html", "body"]);

function shouldEnforceThemeTokenContract(ctx: LintContext): boolean {
  return (
    ctx.options.enforceThemeTokenContract === true || isRegistrySourceFile(ctx.options.filePath)
  );
}

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, " ");
}

function rootSelectorsFromHeader(header: string): string[] {
  const selectors: string[] = [];
  for (const selector of header.split(",")) {
    const normalized = selector.trim().toLowerCase();
    if (ROOT_SELECTORS.has(normalized) && !selectors.includes(normalized)) {
      selectors.push(normalized);
    }
  }
  return selectors;
}

function contractDeclarations(block: string): string[] {
  const tokens: string[] = [];
  const declarationPattern = /(--[A-Za-z0-9-]+)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = declarationPattern.exec(block)) !== null) {
    const token = match[1] ?? "";
    if (CONTRACT_TOKEN_SET.has(token) && !tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

type RootRedeclaration = {
  selectors: string[];
  tokens: string[];
};

function collectRootRedeclarationsFromCss(cssText: string): RootRedeclaration[] {
  const redeclarations: RootRedeclaration[] = [];
  const css = stripCssComments(cssText);
  const ruleHeader = /([^{}]+)\{/g;
  let match: RegExpExecArray | null;

  while ((match = ruleHeader.exec(css)) !== null) {
    const header = (match[1] ?? "").trim();
    if (!header || header.startsWith("@")) continue;

    const selectors = rootSelectorsFromHeader(header);
    if (selectors.length === 0) continue;

    const blockEnd = css.indexOf("}", ruleHeader.lastIndex);
    if (blockEnd === -1) continue;

    const tokens = contractDeclarations(css.slice(ruleHeader.lastIndex, blockEnd));
    if (tokens.length > 0) {
      redeclarations.push({ selectors, tokens });
    }
  }

  return redeclarations;
}

function collectRootRedeclarations(styles: Array<{ content: string }>): RootRedeclaration {
  const selectors = new Set<string>();
  const tokens = new Set<string>();

  for (const style of styles) {
    for (const redeclaration of collectRootRedeclarationsFromCss(style.content)) {
      redeclaration.selectors.forEach((selector) => selectors.add(selector));
      redeclaration.tokens.forEach((token) => tokens.add(token));
    }
  }

  return { selectors: [...selectors], tokens: [...tokens] };
}

function collectInlineStyles(ctx: LintContext): string[] {
  const values: string[] = [];
  for (const tag of ctx.tags) {
    const style = readJsonAttr(tag.raw, "style");
    if (style) values.push(style);
  }
  return values;
}

function collectVarCallsWithoutFallback(cssTexts: string[]): string[] {
  const tokens: string[] = [];
  const varPattern = /\bvar\(\s*(--[A-Za-z0-9-]+)\s*([,)])/g;
  for (const cssText of cssTexts) {
    const css = stripCssComments(cssText);
    let match: RegExpExecArray | null;
    while ((match = varPattern.exec(css)) !== null) {
      const token = match[1] ?? "";
      const delimiter = match[2] ?? "";
      if (delimiter !== ")" || !CONTRACT_TOKEN_SET.has(token)) continue;
      if (!tokens.includes(token)) tokens.push(token);
    }
  }
  return tokens;
}

export const themeRules: Array<(ctx: LintContext) => HyperframeLintFinding[]> = [
  // theme_token_root_redeclare
  (ctx) => {
    if (!shouldEnforceThemeTokenContract(ctx)) return [];

    const { selectors, tokens } = collectRootRedeclarations(ctx.styles);
    if (tokens.length === 0) return [];

    return [
      {
        code: "theme_token_root_redeclare",
        severity: "error",
        message:
          `Contract theme token(s) ${tokens.join(", ")} are redeclared on ${selectors.join(", ")}. ` +
          "The composition scoper passes html/body/:root selectors through unscoped " +
          "(packages/core/src/compiler/compositionScoping.ts:115), so these declarations bypass per-composition scoping and leak document-global values.",
        selector: selectors.join(", "),
        fixHint:
          "Declare the token at point of use with var(--token, <fallback>) instead of redeclaring it at the document root; contract tokens are supplied by the host page, not owned by the primitive.",
      },
    ];
  },

  // theme_token_fallback_missing
  (ctx) => {
    if (!shouldEnforceThemeTokenContract(ctx)) return [];

    const cssTexts = [...ctx.styles.map((style) => style.content), ...collectInlineStyles(ctx)];
    const tokens = collectVarCallsWithoutFallback(cssTexts);
    if (tokens.length === 0) return [];

    return [
      {
        code: "theme_token_fallback_missing",
        severity: "warning",
        message: `Contract theme token var() usage is missing fallback value(s): ${tokens.join(", ")}.`,
        fixHint:
          "Always supply a fallback, e.g. var(--bg, #fff) - primitives must render acceptably even when a host page doesn't define the contract tokens.",
      },
    ];
  },
];
