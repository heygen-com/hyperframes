export interface ExternalScriptAttributes {
  integrity?: string;
  crossorigin?: string;
}

export function readExternalScriptAttributes(el: Element): ExternalScriptAttributes {
  const attributes: ExternalScriptAttributes = {};
  if (el.hasAttribute("integrity")) attributes.integrity = el.getAttribute("integrity") || "";
  if (el.hasAttribute("crossorigin")) attributes.crossorigin = el.getAttribute("crossorigin") || "";
  return attributes;
}

/** Deduplicate scripts without discarding a nested composition's integrity requirement. */
export function ensureExternalScriptTag(
  doc: Document,
  src: string,
  attributes: ExternalScriptAttributes = {},
): void {
  const existing = [...doc.querySelectorAll("script[src]")].filter(
    (el) => el.getAttribute("src")?.trim() === src,
  );
  const requirements = new Set(
    [attributes.integrity, ...existing.map((el) => el.getAttribute("integrity"))]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  if (requirements.size > 1) {
    throw new Error(`Conflicting script integrity requirements for ${src}`);
  }
  const integrity = [...requirements][0];
  const elements = existing.length ? existing : [doc.createElement("script")];
  for (const el of elements) {
    if (integrity) el.setAttribute("integrity", integrity);
    if (attributes.crossorigin !== undefined)
      el.setAttribute("crossorigin", attributes.crossorigin);
  }
  if (!existing.length) {
    const el = elements[0]!;
    el.setAttribute("src", src);
    doc.body.appendChild(el);
  }
}
