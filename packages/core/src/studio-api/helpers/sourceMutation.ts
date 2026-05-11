import { parseHTML } from "linkedom";

export interface SourceMutationTarget {
  id?: string | null;
  selector?: string;
  selectorIndex?: number;
}

function parseSourceDocument(source: string): { document: Document; wrappedFragment: boolean } {
  const hasDocumentShell = /<!doctype|<html[\s>]/i.test(source);
  if (hasDocumentShell) {
    return { document: parseHTML(source).document, wrappedFragment: false };
  }
  return {
    document: parseHTML(`<!DOCTYPE html><html><head></head><body>${source}</body></html>`).document,
    wrappedFragment: true,
  };
}

function querySelectorAllWithTemplates(root: Document | Element, selector: string): Element[] {
  const matches = Array.from(root.querySelectorAll(selector));
  if (matches.length > 0) return matches;
  // querySelectorAll doesn't traverse <template> content in linkedom.
  // Search directly on each template element (NOT .content — removing from
  // .content's DocumentFragment doesn't update the serialized output).
  const templates = Array.from(root.querySelectorAll("template"));
  for (const tmpl of templates) {
    const inner = tmpl.querySelectorAll(selector);
    if (inner.length > 0) return Array.from(inner);
  }
  return [];
}

function findTargetElement(document: Document, target: SourceMutationTarget): Element | null {
  if (target.id) {
    const byId = document.getElementById(target.id);
    if (byId) return byId;
  }

  if (!target.selector) return null;
  try {
    const matches = querySelectorAllWithTemplates(document, target.selector);
    return matches[target.selectorIndex ?? 0] ?? null;
  } catch {
    return null;
  }
}

export function removeElementFromHtml(source: string, target: SourceMutationTarget): string {
  const { document, wrappedFragment } = parseSourceDocument(source);
  const element = findTargetElement(document, target);
  if (!element) return source;

  element.remove();
  return wrappedFragment ? document.body.innerHTML || "" : document.toString();
}
