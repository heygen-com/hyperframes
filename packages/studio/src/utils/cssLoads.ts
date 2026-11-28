// A preview frame's CSS value, written into Studio's page, must load nothing there: a var() fallback can be a
// url(), and an escape or a comment can spell a function name.
const SPELLS = /\\|\/\*/;
const callTo = (names: string) => new RegExp(`(?<![\\w-])(?:-webkit-|-moz-)?(?:${names})\\(`, "i");
const LOADS = callTo("src|image|image-set|cross-fade|element|paint");
const DEFERS = callTo("var|env|attr");
const URL_FUNCTION = callTo("url");

export function cssValueCanLoad(
  value: string,
  keep: { urlShownOnlyAsText?: boolean; varInsideOneClosedGradient?: boolean } = {},
): boolean {
  if (SPELLS.test(value) || LOADS.test(value)) return true;
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
