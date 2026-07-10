/**
 * Pure parser for the `data-start` timing expression grammar, shared by the
 * browser runtime resolver (`createRuntimeStartTimeResolver`) and the Node-side
 * video-frame extractor (`parseVideoElements`) so both agree on exactly what a
 * relative reference means. No DOM/browser dependencies — safe to import in
 * Node.
 *
 * Grammar (matches the docs' "Relative Timing" section):
 *   - `"12.5"`            -> absolute seconds
 *   - `"intro"`           -> start when clip `intro` ends
 *   - `"intro + 2"`       -> 2s after `intro` ends
 *   - `"intro - 0.5"`     -> 0.5s before `intro` ends (overlap)
 */

export {
  parseNumeric,
  parseStartExpression,
  type ReferenceExpression,
} from "@hyperframes/parsers/composition-contract";
