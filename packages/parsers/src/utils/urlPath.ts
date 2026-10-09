export function decodeUrlPathVariants(path: string): string[] {
  const decoded = decodeWellFormedEscapes(path);
  return decoded === path ? [path] : [decoded, path];
}

// A browser sends src="100%.png" as-is, so a % without two hex digits after it is the file's own.
export function decodeWellFormedEscapes(path: string): string {
  return path.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

export function splitUrlSuffix(urlValue: string): { basePath: string; suffix: string } {
  const queryIdx = urlValue.indexOf("?");
  const hashIdx = urlValue.indexOf("#");
  if (queryIdx < 0 && hashIdx < 0) return { basePath: urlValue, suffix: "" };
  let cutIdx = urlValue.length;
  if (queryIdx >= 0) cutIdx = Math.min(cutIdx, queryIdx);
  if (hashIdx >= 0) cutIdx = Math.min(cutIdx, hashIdx);
  return { basePath: urlValue.slice(0, cutIdx), suffix: urlValue.slice(cutIdx) };
}

export function decodedUrlPath(url: string): string {
  return decodeWellFormedEscapes(splitUrlSuffix(url).basePath);
}

export function encodeUrlPath(path: string): string {
  return encodeURIComponent(path)
    .replace(/%2F/g, "/")
    .replace(/['()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function decodeCssEscapes(text: string): string {
  return text
    .replaceAll("\0", "\uFFFD")
    .replace(
      /\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\r\n\f])?|(\r\n|[\n\r\f])|([\s\S]))/gi,
      (
        _escaped,
        hex: string | undefined,
        lineBreak: string | undefined,
        char: string | undefined,
      ) => {
        if (hex === undefined) return lineBreak === undefined ? char! : "";
        const code = Number.parseInt(hex, 16);
        if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return "\uFFFD";
        return String.fromCodePoint(code);
      },
    );
}
