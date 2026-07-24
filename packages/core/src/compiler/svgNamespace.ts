const SVG_XMLNS = 'xmlns="http://www.w3.org/2000/svg"';

/** Ensure a standalone SVG document has the namespace browsers require in image contexts. */
export function ensureSvgNamespace(source: string): string {
  const root = source.match(/<svg\b[^>]*>/i)?.[0];
  if (!root || /\sxmlns\s*=/.test(root)) return source;
  return source.replace(/<svg\b/i, `<svg ${SVG_XMLNS}`);
}
