const SCRIPT_STYLE_OR_IMG = /(<(script|style)\b[\s\S]*?<\/\2\s*>)|<img\b(?![^>]*\sloading\s*=)/gi;

export function lazyPreviewImages(html: string): string {
  return html.replace(
    SCRIPT_STYLE_OR_IMG,
    (_match, block?: string) => block ?? '<img loading="lazy"',
  );
}
