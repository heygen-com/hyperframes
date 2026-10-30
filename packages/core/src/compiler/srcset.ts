function skipSrcsetDescriptors(srcset: string, position: number): number {
  let inParens = false;
  while (position < srcset.length) {
    const char = srcset.charAt(position++);
    if (char === "(") inParens = true;
    else if (char === ")") inParens = false;
    else if (char === "," && !inParens) break;
  }
  return position;
}

function readSrcsetUrl(srcset: string, position: number) {
  while (position < srcset.length && /[ \t\n\r\f,]/.test(srcset.charAt(position))) position++;
  const start = position;
  while (position < srcset.length && !/[ \t\n\r\f]/.test(srcset.charAt(position))) position++;
  let end = position;
  while (end > start && srcset.charAt(end - 1) === ",") end--;
  return { start, end, next: position };
}

export function rewriteSrcsetUrls(srcset: string, rewriteUrl: (url: string) => string): string {
  const parts: string[] = [];
  let position = 0;
  let written = 0;

  // Preserve URL commas per https://html.spec.whatwg.org/multipage/images.html#parse-a-srcset-attribute
  while (position < srcset.length) {
    const { start, end, next } = readSrcsetUrl(srcset, position);
    position = next;
    if (end > start) {
      const url = srcset.slice(start, end);
      const rewritten = rewriteUrl(url);
      if (rewritten !== url) {
        parts.push(srcset.slice(written, start), rewritten);
        written = end;
      }
    }
    if (end < position) continue;

    position = skipSrcsetDescriptors(srcset, position);
  }
  return parts.length > 0 ? parts.join("") + srcset.slice(written) : srcset;
}
