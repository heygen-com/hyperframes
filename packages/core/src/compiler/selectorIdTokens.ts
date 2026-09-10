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
 *
 * The `#id` token is read as a CSS identifier per CSS Syntax Level 3
 * (`decodeCssIdentifierAt`): `\.`-style and `\HEX `-style escapes are
 * decoded before the id is compared against the candidate list, so a
 * stylesheet spelling `#fx\.1` matches the element whose raw `id` attribute
 * is `fx.1`. Callers emit replacement selectors through
 * `escapeCssIdentifier`, the inverse operation.
 */

/** Unescaped name code points: `[A-Za-z0-9_-]` plus any non-ASCII. */
function isNameChar(char: string | undefined): boolean {
  if (!char) return false;
  return /[\w-]/.test(char) || char.charCodeAt(0) >= 0x80;
}

/** CSS whitespace as defined by CSS Syntax Level 3 (`\r\n` handled by the caller). */
function isCssWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

const HEX_ESCAPE_RE = /^[0-9a-fA-F]{1,6}/;

/** Out-of-range and surrogate code points decode to U+FFFD, as the spec requires. */
function sanitizeCodePoint(codePoint: number): number {
  const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
  return codePoint === 0 || codePoint > 0x10ffff || isSurrogate ? 0xfffd : codePoint;
}

/** A hex escape swallows ONE following whitespace; `\r\n` counts as one. */
function skipEscapeWhitespace(text: string, index: number): number {
  if (text[index] === "\r" && text[index + 1] === "\n") return index + 2;
  return isCssWhitespace(text[index]) ? index + 1 : index;
}

/**
 * "Consume an escaped code point" (CSS Syntax Level 3) with `text[index]`
 * being the backslash: 1-6 hex digits plus one optional trailing whitespace
 * decode to that code point, any other non-newline character decodes to
 * itself. Returns `null` for an invalid escape (trailing backslash or a
 * backslash before a newline), which ends the identifier.
 */
function consumeCssEscape(text: string, index: number): { value: string; end: number } | null {
  const next = text[index + 1];
  if (next === undefined || next === "\n") return null;
  const hex = HEX_ESCAPE_RE.exec(text.slice(index + 1, index + 7));
  if (!hex) return { value: next, end: index + 2 };
  const codePoint = sanitizeCodePoint(Number.parseInt(hex[0], 16));
  return {
    value: String.fromCodePoint(codePoint),
    end: skipEscapeWhitespace(text, index + 1 + hex[0].length),
  };
}

/**
 * Read one CSS identifier starting at `start` and return its decoded value
 * plus the offset just past it, or `null` when no identifier starts there.
 * Follows the "consume an ident sequence" algorithm of CSS Syntax Level 3.
 */
export function decodeCssIdentifierAt(
  text: string,
  start: number,
): { value: string; end: number } | null {
  let index = start;
  let value = "";
  while (index < text.length) {
    const char = text[index]!;
    if (char === "\\") {
      const escape = consumeCssEscape(text, index);
      if (!escape) break;
      value += escape.value;
      index = escape.end;
      continue;
    }
    if (!isNameChar(char)) break;
    value += char;
    index += 1;
  }
  return index === start ? null : { value, end: index };
}

const CODE_UNIT_HYPHEN = 0x2d;

function isDigitCodeUnit(codeUnit: number): boolean {
  return codeUnit >= 0x30 && codeUnit <= 0x39;
}

/** Code units `CSS.escape` copies through verbatim: `[A-Za-z0-9_-]` and non-ASCII. */
function isPlainNameCodeUnit(codeUnit: number): boolean {
  return (
    codeUnit >= 0x80 ||
    codeUnit === CODE_UNIT_HYPHEN ||
    codeUnit === 0x5f ||
    isDigitCodeUnit(codeUnit) ||
    (codeUnit >= 0x41 && codeUnit <= 0x5a) ||
    (codeUnit >= 0x61 && codeUnit <= 0x7a)
  );
}

/** Code units `CSS.escape` writes as a hex escape: control characters, and a
 *  digit in a position where it would otherwise start a number. */
function needsHexEscape(value: string, index: number): boolean {
  const codeUnit = value.charCodeAt(index);
  if ((codeUnit >= 0x01 && codeUnit <= 0x1f) || codeUnit === 0x7f) return true;
  if (!isDigitCodeUnit(codeUnit)) return false;
  return index === 0 || (index === 1 && value.charCodeAt(0) === CODE_UNIT_HYPHEN);
}

/**
 * Serialize `value` as a CSS identifier — the `CSS.escape()` algorithm from
 * CSSOM, implemented here because Node has no `CSS` global. Every output is
 * a valid `#ident` selector body that `decodeCssIdentifierAt` round-trips
 * back to `value`.
 */
export function escapeCssIdentifier(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    const char = value[index]!;
    if (codeUnit === 0) result += "\uFFFD";
    else if (needsHexEscape(value, index)) result += `\\${codeUnit.toString(16)} `;
    else if (index === 0 && value.length === 1 && codeUnit === CODE_UNIT_HYPHEN)
      result += `\\${char}`;
    else if (isPlainNameCodeUnit(codeUnit)) result += char;
    else result += `\\${char}`;
  }
  return result;
}

/**
 * A full attribute-selector bracket (`[data-x="a"]`, quotes optional, `]`
 * inside a quoted value tolerated) or a bare quoted string. Either is a
 * region where a literal `#` is never an id-selector prefix — the CSS parser
 * itself never looks for one there — so `markUnguardedOffsets` below can
 * find every such region with one pass of `matchAll` instead of a hand-rolled
 * character-by-character state machine. Inside the bracket alternative, bare
 * characters exclude the quote marks so each position matches exactly one
 * branch (no ambiguous backtracking).
 */
const GUARDED_SELECTOR_SEGMENT_RE =
  /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\]"'])*\]/g;

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

/**
 * Replace every whole-token `#id` in `selector` whose DECODED identifier is
 * in `candidateIds`, skipping occurrences inside a quoted string or an
 * attribute-selector bracket.
 *
 * Because the whole identifier is consumed before comparing, `#clip2` is
 * never mistaken for `#clip`, and `#fx\.1` matches the candidate `fx.1`.
 * `resolveReplacement` receives the matched (decoded) id and returns the
 * full replacement text (including its own leading `#`, if any) to splice
 * in.
 */
export function replaceSelectorIdTokens(
  selector: string,
  candidateIds: readonly string[],
  resolveReplacement: (matchedId: string) => string,
): string {
  if (candidateIds.length === 0 || !selector.includes("#")) return selector;
  const candidates = new Set(candidateIds);
  const unguarded = markUnguardedOffsets(selector);

  let result = "";
  let index = 0;
  while (index < selector.length) {
    const token =
      unguarded[index] && selector[index] === "#"
        ? decodeCssIdentifierAt(selector, index + 1)
        : null;
    if (token && candidates.has(token.value)) {
      result += resolveReplacement(token.value);
      index = token.end;
    } else {
      result += selector[index];
      index += 1;
    }
  }

  return result;
}
