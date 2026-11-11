const PLAIN = /^[\p{L}\p{M}\p{N}_./@:+,=-]+$/u;
const PLAIN_WINDOWS_PATH = /^[\p{L}\p{M}\p{N}_./@:+,=\\-]+$/u;
const SPECIAL_IN_DOUBLE_QUOTES = /["$`\\!]/;

/** `text` as one word of a command printed for the person to paste into their shell. */
export function shellArg(text: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return PLAIN_WINDOWS_PATH.test(text) ? text : `"${text}"`;
  if (PLAIN.test(text)) return text;
  if (!SPECIAL_IN_DOUBLE_QUOTES.test(text)) return `"${text}"`;
  return `'${text.replaceAll("'", "'\\''")}'`;
}
