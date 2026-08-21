/**
 * Occurrence index for a selector within its source document.
 *
 * The preview flattens multiple composition files into one DOM, so a raw
 * `querySelectorAll` index is not a stable source-file identity. Callers supply
 * their existing source resolver; this helper alone owns occurrence scoping.
 */
export function getSourceScopedSelectorIndex(
  doc: Document,
  el: Element,
  selector: string | undefined,
  sourceFile: string | undefined,
  resolveSourceFile: (candidate: Element) => string | undefined,
): number | undefined {
  if (!selector || selector.startsWith("#") || selector.startsWith("[data-composition-id=")) {
    return undefined;
  }

  try {
    const scope = sourceFile ?? "index.html";
    const matches = Array.from(doc.querySelectorAll(selector)).filter(
      (candidate) => (resolveSourceFile(candidate) ?? "index.html") === scope,
    );
    const matchIndex = matches.indexOf(el);
    return matchIndex >= 0 ? matchIndex : undefined;
  } catch {
    return undefined;
  }
}
