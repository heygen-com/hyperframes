// A preview frame's CSS value, written into Studio's page, must load nothing there: a var() fallback can be a
// url(), and an escape or a comment can spell a function name.
const SPELLS = /\\|\/\*/;
const LOADS = /(?:src|image|image-set|cross-fade|element|paint)\s*\(/i;
const DEFERS = /(?:var|env|attr)\s*\(/i;
const URL_FUNCTION = /url\s*\(/i;
const LONGER_THAN_ANY_COMPUTED_VALUE = 4_096;

export function cssValueCanLoad(
  value: string,
  keep: { urlShownOnlyAsText?: boolean; varInsideOneClosedGradient?: boolean } = {},
): boolean {
  if (value.length > LONGER_THAN_ANY_COMPUTED_VALUE || SPELLS.test(value) || LOADS.test(value)) {
    return true;
  }
  if (!keep.varInsideOneClosedGradient && DEFERS.test(value)) return true;
  return !keep.urlShownOnlyAsText && URL_FUNCTION.test(value);
}

export function parensCloseInOrder(value: string): boolean {
  let depth = 0;
  for (const char of value) {
    if (char === "(") depth += 1;
    else if (char === ")" && --depth < 0) return false;
  }
  return depth === 0;
}
