import type { Page } from "puppeteer-core";
import { readCompositionVariables } from "@hyperframes/parsers/composition";
import { validateVariables, type VariableValidationIssue } from "@hyperframes/core";

const MAX_ISSUES = 10;
const MAX_ID_CHARS = 64;

/** One reason a render's variables were refused. Never carries a value the caller supplied. */
export type VariablesIssue =
  | { kind: "undeclared"; variableId: string }
  | { kind: "type-mismatch"; variableId: string; expected: string; actual: string }
  | { kind: "enum-out-of-range"; variableId: string }
  | { kind: "declarations-unreadable" };

export interface VariablesInvalidMetadata {
  issues: VariablesIssue[];
  /** How many issues there were before the list was cut to its bound. */
  total: number;
}

/** The render's variables do not match what the page declares, or the declarations could not be read. */
export class VariablesInvalidError extends Error {
  readonly code = "VARIABLES_INVALID" as const;
  // The producer server reads these off the error for the wire envelope.
  readonly owner = "user" as const;
  readonly retryable = false as const;
  readonly publicMetadata: VariablesInvalidMetadata;

  constructor(issues: readonly [VariablesIssue, ...VariablesIssue[]]) {
    const shown = issues.slice(0, MAX_ISSUES);
    super(describeIssue(issues[0]));
    this.name = "VariablesInvalidError";
    this.publicMetadata = { issues: shown, total: issues.length };
  }
}

function describeIssue(issue: VariablesIssue): string {
  switch (issue.kind) {
    case "undeclared":
      return `Variable "${issue.variableId}" is not declared in data-composition-variables.`;
    case "type-mismatch":
      return `Variable "${issue.variableId}" expected ${issue.expected}, got ${issue.actual}.`;
    case "enum-out-of-range":
      return `Variable "${issue.variableId}" is not one of its declared options.`;
    case "declarations-unreadable":
      return "The page's data-composition-variables could not be read, so the variables cannot be checked.";
    default:
      return issue satisfies never;
  }
}

/** A name the caller chose, cut and stripped of control characters before it is echoed anywhere. */
function boundedId(id: string): string {
  return Array.from(id.slice(0, MAX_ID_CHARS), (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127 ? "?" : ch;
  }).join("");
}

function toIssue(issue: VariableValidationIssue): VariablesIssue {
  const variableId = boundedId(issue.variableId);
  switch (issue.kind) {
    case "undeclared":
      return { kind: "undeclared", variableId };
    case "type-mismatch":
      return { kind: "type-mismatch", variableId, expected: issue.expected, actual: issue.actual };
    case "enum-out-of-range":
      return { kind: "enum-out-of-range", variableId };
  }
}

/**
 * Issues between `overrides` and the page's declarations (`getDeclaredVariableSources`). Declarations that cannot
 * all be read never yield "undeclared". Empty overrides need no check.
 */
export function variablesIssues(
  overrides: Record<string, unknown>,
  sources: readonly string[] | null,
): VariablesIssue[] {
  if (Object.keys(overrides).length === 0) return [];
  if (sources === null) return [{ kind: "declarations-unreadable" }];
  const read = sources.map(readCompositionVariables);
  const byId = new Map(read.flatMap((r) => r.declarations).map((decl) => [decl.id, decl]));
  const issues = validateVariables(overrides, [...byId.values()]).map(toIssue);
  if (read.every((r) => r.complete)) return issues;
  return issues.map((issue) =>
    issue.kind === "undeclared" ? { kind: "declarations-unreadable" } : issue,
  );
}

/** Read the page's declaration sources through its runtime; null when the runtime does not offer them. */
async function readDeclaredVariableSources(page: Page): Promise<string[] | null> {
  const sources: unknown = await page.evaluate(
    `window.__hyperframes?.getDeclaredVariableSources?.() ?? null`,
  );
  return Array.isArray(sources) && sources.every((s) => typeof s === "string") ? sources : null;
}

/** Throws `VariablesInvalidError` when the render's variables do not match the page; run once the page is ready. */
export async function assertVariablesMatchPage(
  page: Page,
  overrides: Record<string, unknown> | undefined,
): Promise<void> {
  const values = overrides ?? {};
  if (Object.keys(values).length === 0) return;
  const [first, ...rest] = variablesIssues(values, await readDeclaredVariableSources(page));
  if (first) throw new VariablesInvalidError([first, ...rest]);
}
