/** Case-insensitive HTML token scans, with no DOM: the player inlines scripts with these too. */

/** Marks the runtime script a preview or bundle puts in a page. */
export const RUNTIME_BOOTSTRAP_ATTR = "data-hyperframes-preview-runtime";

/** ASCII-only chunks bound match arrays; starting at uppercase preserves unchanged spans. */
export function lowerAscii(text: string): string {
  return text.replace(/[A-Z][\s\S]{0,65535}/g, (chunk) =>
    chunk.replace(/[A-Z]+/g, (letters) => letters.toLowerCase()),
  );
}

export function startsWithLower(text: string, token: string, at: number): boolean {
  if (at < 0 || at + token.length > text.length) return false;
  for (let i = 0; i < token.length; i += 1) {
    const code = text.charCodeAt(at + i);
    if ((code >= 65 && code <= 90 ? code + 32 : code) !== token.charCodeAt(i)) return false;
  }
  return true;
}

export function indexOfLower(text: string, token: string, from: number): number {
  for (
    let at = text.indexOf(token.charAt(0), from);
    at !== -1;
    at = text.indexOf(token.charAt(0), at + 1)
  ) {
    if (startsWithLower(text, token, at)) return at;
  }
  return -1;
}

export function escapeInlineScriptSource(source: string): string {
  return escapeCaseInsensitiveToken(
    escapeCaseInsensitiveToken(source, "</script", (match) => `<\\/${match.slice(2)}`),
    "<!--",
    () => "\\x3C!--",
  );
}

function escapeCaseInsensitiveToken(
  source: string,
  token: string,
  replacement: (match: string) => string,
): string {
  const loweredToken = lowerAscii(token);
  let output = "";
  let cursor = 0;

  while (cursor < source.length) {
    const tokenStart = indexOfLower(source, loweredToken, cursor);
    if (tokenStart === -1) {
      output += source.slice(cursor);
      break;
    }
    output +=
      source.slice(cursor, tokenStart) +
      replacement(source.slice(tokenStart, tokenStart + token.length));
    cursor = tokenStart + token.length;
  }

  return output;
}
