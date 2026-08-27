/**
 * `studio_set_text` and `studio_set_style`: the first tools that change the file.
 *
 * Both operate on the CURRENT selection and take no handle. That is not an
 * omission. `handleDomTextCommit(value, fieldKey?)` and
 * `handleDomStyleCommit(property, value)` read the ambient React selection, and
 * `applyDomSelection` only schedules a state update, so selecting and
 * committing inside one call would write to whatever was selected before.
 * Two tool calls are separated by a render. Select first, then edit.
 *
 * Every write here is guarded before dispatch and verified after. Studio has
 * several paths where a failed commit resolves anyway, so "the function did not
 * throw" proves nothing; the outcome the handler now returns is what proves it.
 */

import type { DomEditCommitOutcome } from "../../hooks/domEditCommitRunner";
import type { DomEditSelection } from "../../components/editor/domEditingTypes";
import { toolFailure, toolOk, type ToolFailure, type ToolResult } from "../toolResult";

export interface ContentToolDeps {
  getCurrentSelection: () => DomEditSelection | null;
  /** Why a write would be refused right now, or null. Checked BEFORE dispatch. */
  getWriteBlockedReason: () => string | null;
  setText: (value: string, fieldKey?: string) => Promise<DomEditCommitOutcome>;
  setStyle: (property: string, value: string) => Promise<DomEditCommitOutcome>;
}

/**
 * The reasons a commit declines, translated into something an agent can act on.
 * `persist-failed` is exogenous; the rest are states it should route around.
 */
const DECLINE_HINTS: Record<string, { kind: "blocked" | "invalid" | "failed"; hint?: string }> = {
  "no-selection": { kind: "invalid", hint: "Call studio_select first." },
  "no-project": { kind: "blocked" },
  "geometry-property": {
    kind: "blocked",
    hint: "Position and size are not editable as styles. Use the transform tools.",
  },
  "styles-not-editable": {
    kind: "blocked",
    hint: "studio_inspect reports why, in can.reasonIfDisabled.",
  },
  "not-text-editable": {
    kind: "blocked",
    hint: "This element has no editable text. studio_inspect lists its textFields.",
  },
  "persist-failed": { kind: "failed", hint: "The write did not reach the file. Check Studio." },
};

function fromOutcome(outcome: DomEditCommitOutcome, what: string): ToolFailure | null {
  if (outcome.ok) return null;
  const mapped = DECLINE_HINTS[outcome.reason] ?? { kind: "failed" as const };
  return toolFailure(mapped.kind, `${what} was not applied: ${outcome.reason}`, mapped.hint);
}

function guardWrite(deps: ContentToolDeps): ToolFailure | null {
  // Both blocked states are banners in Studio's UI with no lock behind them, so
  // nothing else stops a programmatic write from landing on top of a conflict
  // the user has been asked to adjudicate.
  const blocked = deps.getWriteBlockedReason();
  if (blocked) {
    return toolFailure("blocked", blocked, "Resolve it in Studio, then retry.");
  }
  if (!deps.getCurrentSelection()) {
    return toolFailure("invalid", "nothing is selected", "Call studio_select first.");
  }
  return null;
}

export interface StudioSetTextResult {
  text: string;
  changed: boolean;
}

export async function studioSetText(
  deps: ContentToolDeps,
  input: { text?: unknown; field?: unknown },
): Promise<ToolResult<StudioSetTextResult>> {
  if (typeof input.text !== "string") {
    return toolFailure("invalid", "text must be a string");
  }

  const blocked = guardWrite(deps);
  if (blocked) return blocked;

  const selection = deps.getCurrentSelection();
  if (!selection) return toolFailure("invalid", "nothing is selected");

  const fields = selection.textFields;
  const requested = typeof input.field === "string" && input.field ? input.field : undefined;
  if (requested && !fields.some((candidate) => candidate.key === requested)) {
    return toolFailure(
      "invalid",
      `this element has no text field "${requested}"`,
      `Its fields are: ${fields.map((candidate) => candidate.key).join(", ") || "none"}.`,
    );
  }

  // Resolving the field is NOT optional. An element's text usually lives in a
  // child field keyed like `child:0:h1`, not in one called `self`, and passing
  // no key plans zero operations. The server then rejects the empty patch with
  // "target and operations required", which surfaces as a persist failure that
  // looks like a server problem and is not.
  const field = requested ?? (fields.length === 1 ? fields[0]?.key : undefined);
  if (!field) {
    if (fields.length === 0) {
      return toolFailure(
        "blocked",
        "this element has no editable text field",
        "studio_inspect lists an element's textFields.",
      );
    }
    return toolFailure(
      "invalid",
      `this element has ${fields.length} text fields, so one must be named`,
      `Pass field as one of: ${fields.map((candidate) => candidate.key).join(", ")}.`,
    );
  }

  const before = selection.textContent ?? null;
  const outcome = await deps.setText(input.text, field);
  const failure = fromOutcome(outcome, "the text");
  if (failure) return failure;

  return toolOk<StudioSetTextResult>({ text: input.text, changed: before !== input.text });
}

export interface StudioSetStyleResult {
  applied: Record<string, string>;
  /** Properties the element refused, with the reason. Empty when all landed. */
  rejected: Record<string, string>;
}

export async function studioSetStyle(
  deps: ContentToolDeps,
  input: { styles?: unknown },
): Promise<ToolResult<StudioSetStyleResult>> {
  const styles = input.styles;
  if (typeof styles !== "object" || styles === null || Array.isArray(styles)) {
    return toolFailure("invalid", "styles must be an object of CSS property to value");
  }
  const entries = Object.entries(styles).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  if (entries.length === 0) {
    // An empty commit would report success having done nothing.
    return toolFailure("invalid", "styles must contain at least one string value");
  }

  const blocked = guardWrite(deps);
  if (blocked) return blocked;

  // `handleDomStyleCommit` is one property per call, so N properties are N
  // commits and N undo entries. Sequential, not concurrent: two commits racing
  // through Studio's client-side read-modify-write can record undo entries that
  // both claim the same starting content.
  const applied: Record<string, string> = {};
  const rejected: Record<string, string> = {};
  for (const [property, value] of entries) {
    const outcome = await deps.setStyle(property, value);
    if (outcome.ok) applied[property] = value;
    else rejected[property] = outcome.reason;
  }

  if (Object.keys(applied).length === 0) {
    const reasons = Object.entries(rejected)
      .map(([property, reason]) => `${property}: ${reason}`)
      .join(", ");
    return toolFailure("blocked", `no style was applied (${reasons})`);
  }

  return toolOk<StudioSetStyleResult>({ applied, rejected });
}

export const STUDIO_SET_TEXT_INPUT_SCHEMA = {
  type: "object",
  properties: {
    text: { type: "string", description: "The new text content." },
    field: {
      type: "string",
      description:
        "Which text field to write, from studio_inspect. Omit for the element's own text.",
    },
  },
  required: ["text"],
  additionalProperties: false,
} as const;

export const STUDIO_SET_TEXT_DESCRIPTION = [
  "Set the text of the CURRENTLY SELECTED element. Call studio_select first.",
  "This is the edit a synthetic double-click cannot reach, because Studio's canvas",
  "takes pointer capture and recognises the double press itself.",
  "Returns `ok: true` with the resulting text and whether it changed, or `ok: false`",
  "with `kind`, `reason` and usually a `hint` naming what to do instead.",
].join(" ");

export const STUDIO_SET_STYLE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    styles: {
      type: "object",
      description: 'CSS property to value, for example {"color": "red", "font-size": "48px"}.',
      additionalProperties: { type: "string" },
    },
  },
  required: ["styles"],
  additionalProperties: false,
} as const;

export const STUDIO_SET_STYLE_DESCRIPTION = [
  "Set inline styles on the CURRENTLY SELECTED element. Call studio_select first.",
  "Each property is a separate commit, so N properties produce N undo entries.",
  "Position and size properties (left, top, width, height) are refused here on purpose;",
  "they belong to the transform tools.",
  "Returns `ok: true` with `applied` and `rejected` maps, so a partial success is visible",
  "as a partial success rather than reported as a whole one.",
].join(" ");
