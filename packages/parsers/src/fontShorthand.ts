const FONT_SIZE_KEYWORD =
  /^(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/i;
const FONT_SIZE_VALUE =
  /^(?:\d*\.?\d+(?!(?:deg|grad|rad|turn)$)[a-z%]+|(?:calc|min|max|clamp)\(.*\))$/i;
const PRE_SIZE_KEYWORD =
  /^(?:normal|italic|oblique|small-caps|bold|bolder|lighter|(?:ultra-|extra-|semi-)?(?:condensed|expanded)|[+-]?\d*\.?\d+(?:deg|grad|rad|turn)?)$/i;
const CUSTOM_PROPERTY = /^var\(.*\)$/i;
const NO_FAMILY =
  /^(?:caption|icon|menu|message-box|small-caption|status-bar|inherit|initial|unset|revert|revert-layer)$/i;

function maskGroups(value: string): string {
  let depth = 0;
  let quote: string | null = null;
  return value.replace(/[\s\S]/g, (char) => {
    if (quote) {
      if (char === quote) quote = null;
      return "_";
    }
    if (char === '"' || char === "'") {
      quote = char;
      return "_";
    }
    if (char === "(") depth += 1;
    const inside = depth > 0;
    if (char === ")") depth -= 1;
    return inside ? "_" : char;
  });
}

interface Token {
  text: string;
  masked: string;
  start: number;
}

function tokens(value: string): Token[] {
  return [...maskGroups(value).matchAll(/\S+/g)].map(({ 0: masked, index }) => ({
    text: value.slice(index, index + masked.length),
    masked,
    start: index,
  }));
}

const isSize = (text: string) => FONT_SIZE_KEYWORD.test(text) || FONT_SIZE_VALUE.test(text);

/** Index of the first family token after the size at `at`, skipping a `/ line-height` in any spacing. */
function familyStart(list: Token[], at: number): number {
  const size = list[at]!;
  const slash = size.masked.indexOf("/");
  if (slash >= 0) return slash === size.masked.length - 1 ? at + 2 : at + 1;
  const next = list[at + 1]?.masked;
  if (next === "/") return at + 3;
  return next?.startsWith("/") ? at + 2 : at + 1;
}

const carriesLineHeight = (list: Token[], at: number) =>
  list[at]!.masked.includes("/") || (list[at + 1]?.masked.startsWith("/") ?? false);

interface FontShorthandFamilies {
  families: string;
  /** False when the shorthand's size cannot be told from its family: `families` is a best guess. */
  certain: boolean;
}

const headOf = ({ text, masked }: Token) =>
  masked.includes("/") ? text.slice(0, masked.indexOf("/")) : text;

function findSize(list: Token[]): { at: number; unsure: boolean } {
  let unsure = false;
  for (let i = 0; i < list.length; i++) {
    const head = headOf(list[i]!);
    const isVar = CUSTOM_PROPERTY.test(head);
    if (isSize(head) || (isVar && carriesLineHeight(list, i))) return { at: i, unsure };
    if (!isVar && !PRE_SIZE_KEYWORD.test(head)) unsure = true;
  }
  return { at: -1, unsure };
}

function lastLeadingVar(list: Token[]): number {
  let last = -1;
  for (let i = 0; i < list.length - 1; i++) if (CUSTOM_PROPERTY.test(list[i]!.text)) last = i;
  return last;
}

/** The family list of a `font` shorthand, after its optional style/weight/width, size and line height. */
export function parseFontShorthand(value: string): FontShorthandFamilies {
  const list = tokens(value);
  if (list.length === 1 && NO_FAMILY.test(list[0]!.text)) return { families: "", certain: true };
  const rest = (from: number) => (list[from] ? value.slice(list[from].start).trim() : "");
  const size = findSize(list);
  if (size.at >= 0) return { families: rest(familyStart(list, size.at)), certain: !size.unsure };
  const lastVar = lastLeadingVar(list);
  if (lastVar < 0) return { families: "", certain: !size.unsure };
  return { families: rest(lastVar + 1), certain: false };
}

export function fontShorthandFamilies(value: string): string {
  return parseFontShorthand(value).families;
}
