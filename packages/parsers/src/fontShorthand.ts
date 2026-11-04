const FONT_SIZE_KEYWORD =
  /^(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/i;
const FONT_SIZE_TOKEN = /^(?:\d*\.?\d+[a-z%]+|(?:calc|min|max|clamp|var)\(.*\))(?:\/\S+)?$/i;

function maskParens(value: string): string {
  let depth = 0;
  return value.replace(/[\s\S]/g, (char) => {
    if (char === "(") depth += 1;
    const inside = depth > 0;
    if (char === ")") depth -= 1;
    return inside ? "_" : char;
  });
}

/** The family list of a `font` shorthand: everything after its size, or "" when it names none. */
export function fontShorthandFamilies(value: string): string {
  for (const { 0: masked, index } of maskParens(value).matchAll(/\S+/g)) {
    const end = index + masked.length;
    const token = value.slice(index, end);
    const size = token.split("/")[0] ?? "";
    if (FONT_SIZE_KEYWORD.test(size) || FONT_SIZE_TOKEN.test(token)) {
      return value.slice(end).trim();
    }
  }
  return "";
}
