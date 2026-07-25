/**
 * CSS-wide keywords are values, not installable font family names. Keep this
 * list shared so linting, deterministic injection, and plan validation make
 * the same decision about them.
 */
export const CSS_WIDE_FONT_FAMILY_KEYWORDS: ReadonlySet<string> = new Set([
  "inherit",
  "initial",
  "revert",
  "revert-layer",
  "unset",
]);

export type FontFamilyCustomPropertyDeclaration = {
  name: string;
  value: string;
  /** True only for an unconditional, top-level rule whose selector is exactly `:root`. */
  staticRoot: boolean;
  important?: boolean;
};

type StaticRootCandidate = {
  value: string;
  important: boolean;
};

/**
 * Reduce CSS custom-property declarations to values that are safe to resolve
 * without selector matching or runtime style computation.
 *
 * A property is intentionally omitted when it has any scoped/dynamic
 * declaration. Exact top-level `:root` declarations retain normal source-order
 * and `!important` precedence.
 */
export function collectStaticRootFontFamilyCustomProperties(
  declarations: Iterable<FontFamilyCustomPropertyDeclaration>,
): Map<string, string> {
  const candidates = new Map<string, StaticRootCandidate>();
  const ambiguous = new Set<string>();

  for (const declaration of declarations) {
    if (!/^--[A-Za-z0-9_-]+$/.test(declaration.name)) continue;

    if (!declaration.staticRoot) {
      ambiguous.add(declaration.name);
      candidates.delete(declaration.name);
      continue;
    }
    if (ambiguous.has(declaration.name)) continue;

    const existing = candidates.get(declaration.name);
    const important = declaration.important === true;
    if (existing?.important && !important) continue;
    candidates.set(declaration.name, { value: declaration.value, important });
  }

  return new Map(Array.from(candidates, ([name, candidate]) => [name, candidate.value]));
}

// The state machine is intentionally explicit so comments inside quoted family
// names and escaped delimiters cannot be confused with CSS syntax.
// fallow-ignore-next-line complexity
function stripCssCommentsOutsideStrings(value: string): string | null {
  let result = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }
    if (quote) {
      result += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      result += char;
      continue;
    }
    if (char === "/" && value[index + 1] === "*") {
      const end = value.indexOf("*/", index + 2);
      if (end === -1) return null;
      result += " ";
      index = end + 1;
      continue;
    }
    result += char;
  }

  return result;
}

type SplitResult = {
  parts: string[];
  valid: boolean;
};

export type FontFamilyValueToken = {
  value: string;
  kind: "family" | "function";
  quoted: boolean;
};

// Quote, escape, and parenthesis states are all required to avoid splitting
// commas inside var() fallbacks or quoted family names.
// fallow-ignore-next-line complexity
function splitTopLevelCommas(value: string): SplitResult {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let valid = true;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      if (depth === 0) {
        valid = false;
      } else {
        depth -= 1;
      }
      continue;
    }
    if (char === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(value.slice(start));
  return {
    parts,
    valid: valid && depth === 0 && quote === null && !escaped,
  };
}

function hasEscapedTerminalQuote(value: string): boolean {
  let backslashes = 0;
  for (let index = value.length - 2; index >= 0 && value[index] === "\\"; index -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function normalizeFontFamilyPart(part: string): FontFamilyValueToken | null {
  let normalized = part
    .trim()
    .replace(/\s*!important\s*$/i, "")
    .trim();
  if (!normalized) return null;

  const first = normalized[0];
  let quoted = false;
  if (first === "'" || first === '"') {
    if (normalized.at(-1) !== first || hasEscapedTerminalQuote(normalized)) return null;
    normalized = normalized.slice(1, -1).trim();
    quoted = true;
  }

  if (!normalized) return null;
  return {
    value: normalized,
    kind: !quoted && /^-?[_a-zA-Z][-_a-zA-Z0-9]*\(/.test(normalized) ? "function" : "family",
    quoted,
  };
}

/**
 * Parse a CSS `font-family` value into declaration-order entries.
 *
 * Commas inside quotes and functions are not separators. Backslash escapes
 * protect the following character. Syntactically incomplete values are
 * ignored instead of manufacturing names such as `Montserrat Bold")` or
 * `serif)` from a `var()` fallback.
 */
export function parseFontFamilyValueTokens(value: string): FontFamilyValueToken[] {
  const withoutComments = stripCssCommentsOutsideStrings(value);
  if (withoutComments === null) return [];
  const split = splitTopLevelCommas(withoutComments);
  if (!split.valid) return [];
  return split.parts
    .map(normalizeFontFamilyPart)
    .filter((part): part is FontFamilyValueToken => part !== null);
}

export function parseFontFamilyValue(value: string): string[] {
  return parseFontFamilyValueTokens(value).map((token) => token.value);
}

export function isCssWideFontFamilyKeyword(value: string): boolean {
  return CSS_WIDE_FONT_FAMILY_KEYWORDS.has(value.trim().toLowerCase());
}

type VarExpression = {
  name: string;
  fallback: string | null;
};

function parseVarExpression(token: FontFamilyValueToken): VarExpression | null {
  if (token.kind !== "function") return null;
  const trimmed = token.value.trim();
  if (!/^var\(/i.test(trimmed) || trimmed.at(-1) !== ")") return null;

  const inner = trimmed.slice(trimmed.indexOf("(") + 1, -1);
  const split = splitTopLevelCommas(inner);
  if (!split.valid) return null;

  const name = split.parts[0]?.trim() ?? "";
  if (!/^--[A-Za-z0-9_-]+$/.test(name)) return null;
  const fallback = split.parts.length > 1 ? split.parts.slice(1).join(",").trim() || null : null;
  return { name, fallback };
}

function appendUnique(
  target: FontFamilyValueToken[],
  values: Iterable<FontFamilyValueToken>,
): void {
  for (const value of values) {
    if (
      !target.some(
        (existing) =>
          existing.value === value.value &&
          existing.kind === value.kind &&
          existing.quoted === value.quoted,
      )
    ) {
      target.push(value);
    }
  }
}

// Recursive var() resolution keeps fallback candidates and cycle state
// explicit so no scoped or dynamic value is guessed.
// fallow-ignore-next-line complexity
function resolveStaticValue(
  value: string,
  customProperties: ReadonlyMap<string, string>,
  resolving: ReadonlySet<string>,
): FontFamilyValueToken[] {
  const resolved: FontFamilyValueToken[] = [];
  for (const family of parseFontFamilyValueTokens(value)) {
    const expression = parseVarExpression(family);
    if (!expression) {
      appendUnique(resolved, [family]);
      continue;
    }

    if (resolving.has(expression.name)) {
      appendUnique(resolved, [family]);
      if (expression.fallback) {
        appendUnique(
          resolved,
          resolveFallbackCandidates(expression.fallback, customProperties, resolving),
        );
      }
      continue;
    }

    const definition = customProperties.get(expression.name);
    if (definition !== undefined) {
      const nextResolving = new Set(resolving);
      nextResolving.add(expression.name);
      const definitionFamilies = resolveStaticValue(definition, customProperties, nextResolving);
      if (definitionFamilies[0]?.kind === "family") {
        appendUnique(resolved, definitionFamilies);
        continue;
      }
      appendUnique(resolved, [family]);
      appendUnique(resolved, definitionFamilies);
      if (expression.fallback) {
        appendUnique(
          resolved,
          resolveFallbackCandidates(expression.fallback, customProperties, resolving),
        );
      }
      continue;
    }

    if (expression.fallback) {
      const fallbackFamilies = resolveStaticValue(expression.fallback, customProperties, resolving);
      if (fallbackFamilies[0]?.kind === "family") {
        appendUnique(resolved, fallbackFamilies);
        continue;
      }
    }

    appendUnique(resolved, [family]);
    if (expression.fallback) {
      appendUnique(
        resolved,
        resolveFallbackCandidates(expression.fallback, customProperties, resolving),
      );
    }
  }
  return resolved;
}

function resolveFallbackCandidates(
  fallback: string,
  customProperties: ReadonlyMap<string, string>,
  resolving: ReadonlySet<string>,
): FontFamilyValueToken[] {
  const candidates: FontFamilyValueToken[] = [];
  for (const family of parseFontFamilyValueTokens(fallback)) {
    const expression = parseVarExpression(family);
    if (!expression) {
      appendUnique(candidates, [family]);
      continue;
    }

    appendUnique(candidates, [family]);
    if (!resolving.has(expression.name)) {
      const definition = customProperties.get(expression.name);
      if (definition !== undefined) {
        const nextResolving = new Set(resolving);
        nextResolving.add(expression.name);
        appendUnique(candidates, resolveStaticValue(definition, customProperties, nextResolving));
      }
    }
    if (expression.fallback) {
      appendUnique(
        candidates,
        resolveFallbackCandidates(expression.fallback, customProperties, resolving),
      );
    }
  }
  return candidates;
}

/**
 * Resolve only custom properties proven to be static `:root` values.
 *
 * Unknown/scoped/dynamic/cyclic variables remain in the first position so
 * plan validation never guesses their runtime primary. Their explicit
 * fallback families are appended as candidates for deterministic injection
 * and linting.
 */
export function resolveFontFamilyDeclarationFamilies(
  declaration: string,
  customProperties: ReadonlyMap<string, string>,
): string[] {
  return resolveFontFamilyDeclarationCandidates(declaration, customProperties).map(
    (candidate) => candidate.value,
  );
}

export function resolveFontFamilyDeclarationCandidates(
  declaration: string,
  customProperties: ReadonlyMap<string, string>,
): FontFamilyValueToken[] {
  const families = parseFontFamilyValueTokens(declaration);
  const primary = families[0];
  if (!primary) return [];

  const expression = parseVarExpression(primary);
  if (!expression) return families;

  const definition = customProperties.get(expression.name);
  if (definition !== undefined) {
    const resolved = resolveStaticValue(definition, customProperties, new Set([expression.name]));
    if (resolved[0]?.kind === "family") {
      return [...resolved, ...families.slice(1)];
    }
    const unresolved = [primary];
    appendUnique(unresolved, resolved);
    if (expression.fallback) {
      appendUnique(
        unresolved,
        resolveFallbackCandidates(expression.fallback, customProperties, new Set()),
      );
    }
    appendUnique(unresolved, families.slice(1));
    return unresolved;
  }

  const unresolved = [primary];
  if (expression.fallback) {
    appendUnique(
      unresolved,
      resolveFallbackCandidates(expression.fallback, customProperties, new Set()),
    );
  }
  appendUnique(unresolved, families.slice(1));
  return unresolved;
}
