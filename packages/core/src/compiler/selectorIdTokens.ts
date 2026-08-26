/**
 * Shared low-level scanner: walk a CSS selector and replace whole-token
 * `#id` occurrences that sit outside quotes and attribute-selector brackets.
 *
 * Extracted from `compositionScoping.ts`'s authored-root-id rewrite (the
 * original, single-id version of this scan) so `svgIdNamespacing.ts` can
 * reuse the exact same quote/bracket-tracking logic for its many-id rewrite
 * instead of a second, drifting copy of the same state machine.
 *
 * Split into two small passes rather than one branch-heavy loop: first mark
 * which offsets are outside a quoted string or an attribute-selector
 * bracket (`markUnguardedOffsets`), then walk the selector once more,
 * consulting that mask, to actually splice in replacements
 * (`replaceSelectorIdTokens`). Each pass stays simple enough to read at a
 * glance instead of one function juggling both jobs.
 */

/** A `#id` token boundary character — an id selector never spans one. */
function isSelectorNameChar(char: string | undefined): boolean {
  return !!char && /[\w-]/.test(char);
}

/**
 * A full attribute-selector bracket (`[data-x="a"]`, quotes optional, `]`
 * inside a quoted value tolerated) or a bare quoted string. Either is a
 * region where a literal `#` is never an id-selector prefix — the CSS parser
 * itself never looks for one there — so `markUnguardedOffsets` below can
 * find every such region with one pass of `matchAll` instead of a hand-rolled
 * character-by-character state machine.
 */
const GUARDED_SELECTOR_SEGMENT_RE =
  /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\]])*\]/g;

/**
 * `mask[i]` is `true` when `selector[i]` sits outside both a quoted string
 * and an attribute-selector bracket — the two places a literal `#` is never
 * an id selector prefix.
 */
function markUnguardedOffsets(selector: string): boolean[] {
  const mask = new Array<boolean>(selector.length).fill(true);
  for (const match of selector.matchAll(GUARDED_SELECTOR_SEGMENT_RE)) {
    const start = match.index;
    mask.fill(false, start, start + match[0].length);
  }
  return mask;
}

/** The longest candidate id starting at `selector[start]`, provided the
 *  match ends on a token boundary (so `#clip2` never matches `#clip`). */
function matchIdTokenAt(
  selector: string,
  start: number,
  formsLongestFirst: readonly string[],
): string | null {
  const form = formsLongestFirst.find((candidate) => selector.startsWith(candidate, start));
  if (!form) return null;
  return isSelectorNameChar(selector[start + form.length]) ? null : form;
}

/**
 * Replace every whole-token `#id` in `selector` whose id is in
 * `candidateIds`, skipping occurrences inside a quoted string or an
 * attribute-selector bracket.
 *
 * `candidateIds` is scanned longest-first so `#clip2` is never mistaken for
 * `#clip` followed by a literal `2`. `resolveReplacement` receives the
 * matched id and returns the full replacement text (including its own
 * leading `#`, if any) to splice in.
 */
export function replaceSelectorIdTokens(
  selector: string,
  candidateIds: readonly string[],
  resolveReplacement: (matchedId: string) => string,
): string {
  if (candidateIds.length === 0 || !selector.includes("#")) return selector;
  const forms = [...candidateIds].sort((a, b) => b.length - a.length);
  const unguarded = markUnguardedOffsets(selector);

  let result = "";
  let index = 0;
  while (index < selector.length) {
    const matchedForm =
      unguarded[index] && selector[index] === "#"
        ? matchIdTokenAt(selector, index + 1, forms)
        : null;
    if (matchedForm) {
      result += resolveReplacement(matchedForm);
      index += 1 + matchedForm.length;
    } else {
      result += selector[index];
      index += 1;
    }
  }

  return result;
}
