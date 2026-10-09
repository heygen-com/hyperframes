import { decodedUrlPath } from "@hyperframes/parsers";

function trimIdUnderscores(value: string): string {
  let start = 0;
  let end = value.length;
  while (value[start] === "_") start += 1;
  while (end > start && value[end - 1] === "_") end -= 1;
  return value.slice(start, end);
}

export function buildTimelineAssetId(assetPath: string, existingIds: Iterable<string>): string {
  const baseName = assetPath.slice(assetPath.lastIndexOf("/") + 1);
  const normalized = baseName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .toLowerCase();
  const baseId = trimIdUnderscores(normalized) || "asset";
  const ids = new Set(existingIds);
  if (!ids.has(baseId)) return baseId;
  let suffix = 2;
  while (ids.has(`${baseId}_${suffix}`)) suffix += 1;
  return `${baseId}_${suffix}`;
}

function referenceChildren(element: Element): Iterable<Element> {
  if (element.children.length > 0) return element.children;
  if (element.tagName.toLowerCase() !== "template") return [];
  const content = (element as HTMLTemplateElement).content;
  return content ? content.children : [];
}

function documentElements(document: Document): Element[] {
  const elements: Element[] = [];
  const visit = (element: Element): void => {
    elements.push(element);
    for (const child of referenceChildren(element)) visit(child);
  };
  if (document.documentElement) visit(document.documentElement);
  return elements;
}

function decodeIdEscape(original: string, hex: string): string {
  const codePoint = Number.parseInt(hex, 16);
  return codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : original;
}

function referencesId(value: string, id: string): boolean {
  const decoded = value
    .replace(/\\x([0-9a-f]{2})/gi, (original, hex) => decodeIdEscape(original, hex))
    .replace(/\\u\{([0-9a-f]+)\}|\\u([0-9a-f]{4})/gi, (original, braced, fixed) =>
      decodeIdEscape(original, braced ?? fixed),
    )
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (original, hex) => decodeIdEscape(original, hex))
    .replace(/\\([^\r\n])/g, "$1");
  return decoded.includes(id);
}

function decodeFragment(value: string): string {
  const fragment = value.split("#").slice(1).join("#");
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

function attributeReferencesId(attribute: Attr, id: string): boolean {
  if (["id", "data-hf-id"].includes(attribute.name)) return false;
  if (attribute.name === "src") return referencesId(decodeFragment(attribute.value), id);
  return referencesId(attribute.value, id);
}

function elementReferencesId(element: Element, id: string): boolean {
  const code = ["script", "style"].includes(element.tagName.toLowerCase());
  if (code && referencesId(element.textContent ?? "", id)) return true;
  return Array.from(element.attributes).some((attribute) => attributeReferencesId(attribute, id));
}

type MediaIdentity = { id: string; src: string };

function readMediaIdentity(element: Element): MediaIdentity | null {
  const media = ["video", "audio", "img"].includes(element.tagName.toLowerCase());
  const src = element.getAttribute("src");
  const id = element.getAttribute("id");
  if (!media || !src || !id) return null;
  return { id, src };
}

function matchesGeneratedId({ id, src }: MediaIdentity): boolean {
  const base = buildTimelineAssetId(decodedUrlPath(src), []);
  const suffix = id.slice(base.length);
  return id === base || (id.startsWith(base) && /^_(?:[2-9]\d*|1\d+)$/.test(suffix));
}

function canRenameMedia(element: Element, identity: MediaIdentity, newSrc: string): boolean {
  const authored = ["data-timeline-label", "data-label", "aria-label"].some((name) =>
    element.getAttribute(name)?.trim(),
  );
  return !authored && identity.src !== newSrc && matchesGeneratedId(identity);
}

export function replacementTimelineAssetId(
  document: Document,
  element: Element,
  newSrc: string,
): string | null {
  const identity = readMediaIdentity(element);
  if (!identity || !canRenameMedia(element, identity, newSrc)) return null;
  const elements = documentElements(document);
  if (elements.some((other) => elementReferencesId(other, identity.id))) return null;
  const ids = elements
    .filter((other) => other !== element)
    .map((other) => other.getAttribute("id"))
    .filter((value): value is string => value !== null);
  return buildTimelineAssetId(decodedUrlPath(newSrc), ids);
}
