import type { CompositionVariable } from "../core.types";

export type VariableValidationIssue =
  | { kind: "undeclared"; variableId: string }
  | { kind: "type-mismatch"; variableId: string; expected: string; actual: string }
  | { kind: "enum-out-of-range"; variableId: string; allowed: string[]; actual: string };

/**
 * Compare a flat values map (from `--variables` / `data-variable-values`) to
 * the declared schema (`data-composition-variables`). Returns issues for keys
 * that aren't declared, plus per-key type mismatches against the declared
 * type. Pure / sync — caller decides how to surface them (warning vs render
 * failure under `--strict-variables`).
 */
export function validateVariables(
  values: Record<string, unknown>,
  declarations: readonly CompositionVariable[],
): VariableValidationIssue[] {
  const decls = new Map<string, CompositionVariable>();
  for (const decl of declarations) decls.set(decl.id, decl);

  const issues: VariableValidationIssue[] = [];
  for (const [id, value] of Object.entries(values)) {
    const decl = decls.get(id);
    if (!decl) {
      issues.push({ kind: "undeclared", variableId: id });
      continue;
    }
    const mismatch = checkType(value, decl);
    if (mismatch) issues.push(mismatch);
  }
  return issues;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// fallow-ignore-next-line complexity
function checkType(value: unknown, decl: CompositionVariable): VariableValidationIssue | null {
  switch (decl.type) {
    case "string":
    case "color":
      if (typeof value !== "string") {
        return {
          kind: "type-mismatch",
          variableId: decl.id,
          expected: decl.type,
          actual: jsTypeOf(value),
        };
      }
      return null;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return {
          kind: "type-mismatch",
          variableId: decl.id,
          expected: "number",
          actual: jsTypeOf(value),
        };
      }
      return null;
    case "boolean":
      if (typeof value !== "boolean") {
        return {
          kind: "type-mismatch",
          variableId: decl.id,
          expected: "boolean",
          actual: jsTypeOf(value),
        };
      }
      return null;
    case "enum": {
      if (typeof value !== "string") {
        return {
          kind: "type-mismatch",
          variableId: decl.id,
          expected: "enum (string)",
          actual: jsTypeOf(value),
        };
      }
      const allowed = decl.options.map((o) => o.value);
      if (!allowed.includes(value)) {
        return { kind: "enum-out-of-range", variableId: decl.id, allowed, actual: value };
      }
      return null;
    }
    case "font": {
      // Font value is an object {name: string, source: string} OR a fallback string.
      if (typeof value === "string") return null;
      if (!isPlainObject(value)) {
        return {
          kind: "type-mismatch",
          variableId: decl.id,
          expected: "font (object {name, source} or string)",
          actual: jsTypeOf(value),
        };
      }
      // Object form: require the discriminant fields so a malformed brand-kit
      // value ({name: 42} / {}) is caught here rather than surfacing as a bogus
      // font-family at render time.
      if (typeof value.name !== "string" || typeof value.source !== "string") {
        return {
          kind: "type-mismatch",
          variableId: decl.id,
          expected: "font object {name: string, source: string}",
          actual: "object missing string name/source",
        };
      }
      return null;
    }
    case "image": {
      // Image value is an object {url: string} OR a fallback string.
      if (typeof value === "string") return null;
      if (!isPlainObject(value)) {
        return {
          kind: "type-mismatch",
          variableId: decl.id,
          expected: "image (object {url} or string)",
          actual: jsTypeOf(value),
        };
      }
      // Object form: require the discriminant field.
      if (typeof value.url !== "string") {
        return {
          kind: "type-mismatch",
          variableId: decl.id,
          expected: "image object {url: string}",
          actual: "object missing string url",
        };
      }
      return null;
    }
  }
}

function jsTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function formatVariableValidationIssue(issue: VariableValidationIssue): string {
  switch (issue.kind) {
    case "undeclared":
      return `Variable "${issue.variableId}" is not declared in data-composition-variables.`;
    case "type-mismatch":
      return `Variable "${issue.variableId}" expected ${issue.expected}, got ${issue.actual}.`;
    case "enum-out-of-range":
      return `Variable "${issue.variableId}" must be one of ${issue.allowed.map((v) => `"${v}"`).join(", ")} (got "${issue.actual}").`;
  }
}
