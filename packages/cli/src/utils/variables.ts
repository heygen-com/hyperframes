import { failCommand, failUsage } from "./commandResult.js";
/**
 * Shared `--variables` / `--variables-file` / `--strict-variables` parsing
 * and validation helpers used by both `hyperframes render` (in-process) and
 * `hyperframes lambda render` (distributed). The Lambda CLI mirrors the
 * local UX exactly — same flag names, same parse-error messages, same
 * strict-mode behavior — so users who learned the local flow can drive
 * Lambda renders without re-learning the surface.
 *
 * Side-effecting wrappers (`resolveVariablesArg`) call `process.exit(1)`
 * on validation failure after rendering an `errorBox`; the pure parsers
 * (`parseVariablesArg`) return a discriminated result so unit tests can
 * exercise the validation paths without process termination.
 */

import { readFileSync } from "node:fs";
import {
  extractCompositionMetadata,
  formatVariableValidationIssue,
  validateVariables,
  type VariableValidationIssue,
} from "@hyperframes/core";
import { ensureDOMParser } from "./dom.js";
import { c } from "../ui/colors.js";
import { errorBox } from "../ui/format.js";
import {
  inlineJsonHint,
  unreadableJsonHint,
  JsonFlagReadError,
  readJsonFlagText,
  type JsonFlagIO,
} from "./jsonFlag.js";

export type VariablesParseError =
  | { kind: "conflict" }
  | { kind: "read-error"; path: string; cause: string }
  | { kind: "parse-error"; source: "inline" | "file"; cause: string }
  | { kind: "shape-error" };

export type VariablesParseResult =
  | { ok: true; value: Record<string, unknown> | undefined }
  | { ok: false; error: VariablesParseError };

/**
 * Pure parser for the `--variables` / `--variables-file` flag pair. Splits
 * out from `resolveVariablesArg` so validation paths are unit-testable
 * without triggering `process.exit`. Reports failures via a structured
 * `kind` discriminant so the side-effecting wrapper owns all UI strings.
 */
// Exported for tests in `./variables.test.ts`; not consumed outside the
// package. Suppressed so fallow's unused-exports audit doesn't flag a
// type-discriminated parser whose value is exactly testability.
// fallow-ignore-next-line unused-export complexity
export function parseVariablesArg(
  inline: string | undefined,
  filePath: string | undefined,
  readFile?: JsonFlagIO["readFile"],
  readStdin?: JsonFlagIO["readStdin"],
): VariablesParseResult {
  if (inline != null && filePath != null) {
    return { ok: false, error: { kind: "conflict" } };
  }
  const value = inline ?? filePath;
  const source = inline != null ? "inline" : "file";
  let raw: string | undefined;
  if (value != null) {
    try {
      raw = readJsonFlagText(value, { readFile, readStdin });
    } catch (error: unknown) {
      if (!(error instanceof JsonFlagReadError)) throw error;
      return { ok: false, error: { kind: "read-error", path: error.path, cause: error.cause } };
    }
  }
  if (raw == null) return { ok: true, value: undefined };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    return {
      ok: false,
      error: {
        kind: "parse-error",
        source,
        cause: error instanceof Error ? error.message : String(error),
      },
    };
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: { kind: "shape-error" } };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

export function variablesErrorMessage(error: VariablesParseError): {
  title: string;
  message: string;
} {
  switch (error.kind) {
    case "conflict":
      return {
        title: "Conflicting variables flags",
        message: "Use either --variables or --variables-file, not both.",
      };
    case "read-error":
      return {
        title: "Could not read the variables JSON",
        message: `${error.path}: ${error.cause}${unreadableJsonHint("--variables", error.path)}`,
      };
    case "parse-error":
      return {
        title:
          error.source === "file"
            ? "Invalid JSON in --variables-file"
            : "Invalid JSON in --variables",
        message:
          error.source === "inline"
            ? `${error.cause} (${inlineJsonHint("--variables")})`
            : error.cause,
      };
    case "shape-error":
      return {
        title: "Invalid variables payload",
        message: 'Variables must be a JSON object (e.g. {"title":"Hello"}).',
      };
  }
}

/**
 * Resolve `--variables` / `--variables-file` into a plain object, or
 * `undefined` when neither flag is set. Exits the process with a friendly
 * error box on any validation failure.
 */
export function resolveVariablesArg(
  inline: string | undefined,
  filePath: string | undefined,
): Record<string, unknown> | undefined {
  const result = parseVariablesArg(inline, filePath);
  if (!result.ok) {
    const { title, message } = variablesErrorMessage(result.error);
    errorBox(title, message);
    const { kind } = result.error;
    const flagsAreWrong = kind === "conflict" || (inline != null && kind !== "read-error");
    if (flagsAreWrong) failUsage();
    failCommand();
  }
  return result.value;
}

/**
 * Validate `--variables` values against the project's top-level
 * `data-composition-variables` declarations. Returns an empty array when
 * the index has no declarations or when every key is declared with a
 * matching type. Errors reading the index are silently treated as "no
 * declarations" — the lint pass owns malformed-HTML diagnostics, render
 * shouldn't fail just because the schema is unreadable.
 *
 * One-shot variant: parses the index every call. Batch callers that
 * pre-validate N entries against the same project should reuse
 * {@link loadProjectVariableSchema} + {@link validateVariablesAgainstSchema}
 * to amortise the read + DOM parse.
 */
export function validateVariablesAgainstProject(
  indexPath: string,
  values: Record<string, unknown>,
): VariableValidationIssue[] {
  const schema = loadProjectVariableSchema(indexPath);
  return validateVariablesAgainstSchema(values, schema);
}

/** Cached schema returned by {@link loadProjectVariableSchema}. */
export type ProjectVariableSchema = ReturnType<typeof extractCompositionMetadata>["variables"];

/**
 * Read + parse the composition's `data-composition-variables` declaration
 * once. Returns an empty array on missing/unreadable index — the lint
 * pass owns malformed-HTML diagnostics.
 *
 * Batch callers pair this with {@link validateVariablesAgainstSchema} to
 * avoid the per-entry file read + DOMParser cost.
 */
export function loadProjectVariableSchema(indexPath: string): ProjectVariableSchema {
  let html: string;
  try {
    html = readFileSync(indexPath, "utf8");
  } catch {
    return [];
  }
  // extractCompositionMetadata uses DOMParser, which Node doesn't ship.
  // Same pattern as `compositions.ts` and other CLI commands that touch
  // @hyperframes/core's HTML parsers.
  ensureDOMParser();
  return extractCompositionMetadata(html).variables;
}

/**
 * Validate `values` against a pre-loaded schema. Empty schema means the
 * project didn't declare variables — return no issues.
 */
export function validateVariablesAgainstSchema(
  values: Record<string, unknown>,
  schema: ProjectVariableSchema,
): VariableValidationIssue[] {
  if (schema.length === 0) return [];
  return validateVariables(values, schema);
}

/**
 * Print a uniform warning block for variable validation issues; in
 * `strict` mode, render an errorBox and exit(1). Used by both
 * `hyperframes render` and `hyperframes lambda render` so the UX is
 * identical across the two surfaces. Pass `quiet: true` to suppress the
 * warning block (the errorBox in strict mode still prints).
 */
export function reportVariableIssues(
  issues: readonly VariableValidationIssue[],
  options: { strict: boolean; quiet?: boolean },
): void {
  if (issues.length === 0) return;
  const { strict, quiet } = options;
  if (!quiet) {
    console.log("");
    console.log(
      c.warn(
        `Variable ${issues.length === 1 ? "issue" : "issues"} (${issues.length}) — values may not render as expected:`,
      ),
    );
    for (const issue of issues) {
      console.log("  " + c.dim(formatVariableValidationIssue(issue)));
    }
    console.log("");
  }
  if (strict) {
    errorBox(
      "Variable validation failed",
      "Aborting render due to variable issues (--strict-variables mode).",
    );
    failCommand();
  }
}
