import { FEEDBACK_RATING_SCALE } from "./feedbackRating.js";

/**
 * Keywords that suggest the reporter is describing a visual defect (as opposed
 * to a build failure, missing feature, or plain workflow friction). When these
 * appear in a non-10 feedback comment, the reporter should include a
 * `COMPOSITION_STRUCTURE:` block so maintainers can pattern-match against
 * known bug families without receiving the composition ZIP. Matched
 * case-insensitively, word-bounded against the raw comment (so "black" fires
 * on "black frame" but not "blackboard" / "no black frame at all").
 *
 * `"render"` intentionally omitted: `hyperframes render` is the CLI's primary
 * command, so build/perf/hang reports mention it constantly and would drown
 * the structure warning in false positives. Rely on the more specific tokens
 * ("black", "blank", "flicker", "corrupt", "wrong frame") to identify actual
 * visual defects.
 */
export const VISUAL_DEFECT_KEYWORDS: readonly string[] = [
  "black",
  "flicker",
  "corrupt",
  "wrong frame",
  "blank",
  "visual",
] as const;

/**
 * Ratings that should mandate `COMPOSITION_STRUCTURE:` when the comment
 * contains a visual-defect keyword. 7 and below covers "clearly broken" —
 * 8-9 are usually "worked, but noticed a nit" which doesn't need the full
 * structural anatomy.
 */
export const COMPOSITION_STRUCTURE_RATING_CEILING = 7;

const REPRO_MARKER = "REPRO COMMAND:";
const STRUCTURE_MARKER = "COMPOSITION_STRUCTURE:";

export interface FeedbackLintInput {
  rating: number;
  comment: string | undefined;
}

export interface FeedbackLintWarning {
  code: "missing-repro-command" | "missing-composition-structure";
  message: string;
}

/**
 * Soft-warn lint on the `hyperframes feedback` comment body. Never blocks
 * submission — some legitimate reports (a one-line "cloudrun quota bumped
 * yesterday, fine now") won't fit the mold. The warning is just a nudge and
 * a pointer to the auto-census helper.
 *
 * Rules:
 *  1. `rating === 10` — no check. A perfect run doesn't need a repro packet.
 *  2. Comment missing / empty — no check. `feedback --rating 6` with no
 *     comment is a valid quick vote; the maintainer sees rating drift without
 *     the reporter having to synthesize a fake repro.
 *  3. Comment present + rating < 10 + no `REPRO COMMAND:` — warn.
 *  4. Comment present + rating ≤ 7 + visual-defect keyword + no
 *     `COMPOSITION_STRUCTURE:` — warn (in addition to any #3 warning).
 */
export function lintFeedbackComment(input: FeedbackLintInput): FeedbackLintWarning[] {
  const { rating, comment } = input;
  if (rating === FEEDBACK_RATING_SCALE) return [];
  const trimmed = comment?.trim();
  if (!trimmed) return [];

  // Marker checks are case-insensitive to match `mentionsVisualDefect`'s
  // normalization. A reporter who writes `Repro command:` shouldn't get warned
  // for compliance just because they lowercased the marker.
  const upperTrimmed = trimmed.toUpperCase();
  const warnings: FeedbackLintWarning[] = [];

  if (!upperTrimmed.includes(REPRO_MARKER)) {
    warnings.push({
      code: "missing-repro-command",
      message: [
        `Comment on a ${rating}/${FEEDBACK_RATING_SCALE} report is missing a "${REPRO_MARKER}" block —`,
        "maintainers can't rerun the failure from a symptom summary alone.",
        "See `references/preview-render.md` → feedback for the required packet shape.",
      ].join(" "),
    });
  }

  if (
    rating <= COMPOSITION_STRUCTURE_RATING_CEILING &&
    mentionsVisualDefect(trimmed) &&
    !upperTrimmed.includes(STRUCTURE_MARKER)
  ) {
    warnings.push({
      code: "missing-composition-structure",
      message: [
        `Comment describes a visual defect at ${rating}/${FEEDBACK_RATING_SCALE} but omits a`,
        `"${STRUCTURE_MARKER}" block. Agents can auto-fill this via the composition-census helper`,
        "(`buildCompositionCensus`/`renderCompositionCensusBlock` in `packages/cli/src/utils/compositionCensus.ts`)",
        "so maintainers can pattern-match against known bug families without the composition ZIP.",
      ].join(" "),
    });
  }

  return warnings;
}

// Compile once. Word-boundary at both sides prevents "black" matching
// "blackboard", "blank" matching "blanket", "visual" matching "visualize".
// Plural forms (e.g. "flickers") won't match — accepted tradeoff for a soft
// warn: false negatives skip the nudge, false positives waste the reporter's
// attention.
function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const VISUAL_DEFECT_REGEX = new RegExp(
  `(^|[^A-Za-z0-9_])(?:${VISUAL_DEFECT_KEYWORDS.map(escapeRegex).join("|")})(?![A-Za-z0-9_])`,
  "i",
);

/**
 * Case-insensitive word-bounded probe against `VISUAL_DEFECT_KEYWORDS`.
 * Exposed for tests and reuse. Word boundaries are enforced on both sides so
 * partial-word false positives ("blackboard", "visualize", "corruptible")
 * don't trigger the structure-block nudge.
 */
export function mentionsVisualDefect(comment: string): boolean {
  return VISUAL_DEFECT_REGEX.test(comment);
}
