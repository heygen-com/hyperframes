import { ensureHfIds } from "@hyperframes/parsers/hf-ids";

// Stamped as the preview stamps the files it serves, so a live element's hf-id finds its source.
export function parseSavedSource(html: string): Document {
  return new DOMParser().parseFromString(ensureHfIds(html), "text/html");
}

function searchRoots(root: ParentNode): ParentNode[] {
  const templates = Array.from(root.querySelectorAll("template"));
  return [root, ...templates.flatMap((template) => searchRoots(template.content))];
}

function findByAttribute(roots: ParentNode[], name: string, value: string): Element | null {
  for (const root of roots) {
    const match = Array.from(root.querySelectorAll(`[${name}]`)).find(
      (el) => el.getAttribute(name) === value,
    );
    if (match) return match;
  }
  return null;
}

export function findAuthoredElement(doc: Document, live: Element): Element | null {
  const roots = searchRoots(doc);
  const hfId = live.getAttribute("data-hf-id");
  const byHfId = hfId ? findByAttribute(roots, "data-hf-id", hfId) : null;
  return byHfId ?? (live.id ? findByAttribute(roots, "id", live.id) : null);
}
