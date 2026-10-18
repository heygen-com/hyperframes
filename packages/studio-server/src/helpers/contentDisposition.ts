/** RFC 6266 header with an ASCII fallback plus the UTF-8 `filename*` form. */
export function contentDispositionHeader(
  disposition: "inline" | "attachment",
  filename: string,
): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
