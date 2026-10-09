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
function isNameChar(char: string | undefined): char is string {
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
  if (next === undefined || /[\n\r\f]/.test(next)) return null;
  const hex = HEX_ESCAPE_RE.exec(text.slice(index + 1, index + 7));
  if (!hex) return { value: next, end: index + 2 };
  const codePoint = sanitizeCodePoint(Number.parseInt(hex[0], 16));
  return {
    value: String.fromCodePoint(codePoint),
    end: skipEscapeWhitespace(text, index + 1 + hex[0].length),
  };
}

function startsCssIdentifier(text: string, start: number): boolean {
  const isStart = (char: string | undefined) => isNameChar(char) && !/[0-9-]/.test(char);
  const escape = (index: number) => text[index] === "\\" && consumeCssEscape(text, index) !== null;
  if (text[start] === "-")
    return text[start + 1] === "-" || isStart(text[start + 1]) || escape(start + 1);
  return isStart(text[start]) || escape(start);
}

function skipCssComments(text: string, start: number): number {
  let index = start;
  while (text.startsWith("/*", index)) {
    const end = text.indexOf("*/", index + 2);
    index = end < 0 ? text.length : end + 2;
  }
  return index;
}

function skipCssTrivia(text: string, start: number): number {
  let index = skipCssComments(text, start);
  while (isCssWhitespace(text[index])) index = skipCssComments(text, index + 1);
  return index;
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
  if (!startsCssIdentifier(text, start)) return null;
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
  /\/\*(?:[^*]|\*(?!\/))*\*\/|\\(?:[0-9a-fA-F]{1,6}(?:\r\n|[ \t\r\n\f])?|[\s\S])|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|\[(?:\/\*(?:[^*]|\*(?!\/))*\*\/|\\[\s\S]|"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|[^\]"'\\/]|\/(?!\*))*\]/g;

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

function decodeCssString(value: string): string {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\") {
      const next = value[index + 1];
      if (next !== undefined && /[\n\r\f]/.test(next)) {
        index = skipEscapeWhitespace(value, index + 1) - 1;
        continue;
      }
      const escaped = consumeCssEscape(value, index);
      if (escaped) {
        result += escaped.value;
        index = escaped.end - 1;
        continue;
      }
    }
    result += value[index];
  }
  return result;
}

export function escapeCssAttributeValue(value: string): string {
  return Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    if (code === 0) return "\uFFFD";
    if (code < 0x20 || code === 0x7f) return `\\${code.toString(16)} `;
    return char === '"' || char === "\\" ? `\\${char}` : char;
  }).join("");
}

type AttributeNamespace = { kind: "any" } | { kind: "none" } | { kind: "named"; prefix: string };

function attributeNamespace(wildcard: boolean, prefix: string | undefined): AttributeNamespace {
  if (wildcard) return { kind: "any" };
  return prefix === undefined ? { kind: "none" } : { kind: "named", prefix };
}

function isNamespaceSeparator(text: string, offset: number): boolean {
  return text[offset] === "|" && text[offset + 1] !== "=";
}

function readQualifiedAttributeName(text: string, start: number) {
  const wildcard = text[start] === "*";
  const first = wildcard ? { value: "*", end: start + 1 } : decodeCssIdentifierAt(text, start);
  const separator = skipCssComments(text, first?.end ?? start);
  if (!isNamespaceSeparator(text, separator)) {
    if (wildcard) return null;
    return first ? { token: first, namespace: { kind: "none" } as AttributeNamespace } : null;
  }
  const token = decodeCssIdentifierAt(text, skipCssComments(text, separator + 1));
  if (!token) return null;
  return { token, namespace: attributeNamespace(wildcard, first?.value) };
}

function readAttributeName(predicate: string) {
  if (predicate[0] !== "[") return null;
  const start = skipCssTrivia(predicate, 1);
  const qualified = readQualifiedAttributeName(predicate, start);
  if (!qualified) return null;
  const { token, namespace } = qualified;
  return {
    name: token.value,
    rawName: predicate.slice(start, token.end),
    namespace,
    end: token.end,
  };
}

function readAttributeValue(predicate: string, start: number) {
  const quoted = /^(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)')/.exec(
    predicate.slice(start),
  );
  if (quoted)
    return { value: decodeCssString(quoted[1] ?? quoted[2]!), end: start + quoted[0].length };
  return decodeCssIdentifierAt(predicate, start);
}

function readAttributeEnding(predicate: string, start: number) {
  let offset = skipCssTrivia(predicate, start);
  const token = decodeCssIdentifierAt(predicate, offset);
  if (token) {
    if (!/^[is]$/i.test(token.value)) return null;
    offset = skipCssTrivia(predicate, token.end);
  }
  if (predicate[offset] !== "]" || offset !== predicate.length - 1) return null;
  return { flag: token?.value };
}

export function parseAttributeSelector(predicate: string) {
  const name = readAttributeName(predicate);
  if (!name) return null;
  const offset = skipCssTrivia(predicate, name.end);
  const operators = ["=", "~=", "|=", "^=", "$=", "*="] as const;
  const operator = operators.find((candidate) => predicate.startsWith(candidate, offset));
  if (!operator) return null;
  const value = readAttributeValue(predicate, skipCssTrivia(predicate, offset + operator.length));
  if (!value) return null;
  const ending = readAttributeEnding(predicate, value.end);
  if (!ending) return null;
  return {
    name: name.name,
    rawName: name.rawName,
    namespace: name.namespace,
    operator,
    value: value.value,
    flag: ending.flag,
  };
}

export function replaceSelectorAttributeTokens(
  selector: string,
  rewrite: (predicate: string) => string,
): string {
  return selector.replace(GUARDED_SELECTOR_SEGMENT_RE, (segment) =>
    segment.startsWith("[") ? rewrite(segment) : segment,
  );
}
