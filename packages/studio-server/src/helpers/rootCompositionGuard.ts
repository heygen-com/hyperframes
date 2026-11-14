import { parseHTML } from "linkedom";
import { querySelectorAllWithTemplates } from "./sourceMutation.js";

function hasComposition(html: string): boolean {
  if (!html.includes("data-composition-id")) return false;
  const shell = /<!doctype|<html[\s>]/i.test(html);
  const { document } = parseHTML(
    shell ? html : `<!DOCTYPE html><html><head></head><body>${html}</body></html>`,
  );
  return querySelectorAllWithTemplates(document, "[data-composition-id]").length > 0;
}

export function rootCompositionRemovedMessage(path: string): string {
  return `Refused to save ${path}: the change would remove its root composition and everything in it. The file was left as it was.`;
}

/** Why a write must not land, or null: it leaves an HTML file that had a composition with none. */
export function rootCompositionRefusal(path: string, before: string, after: string): string | null {
  if (!/\.html?$/i.test(path) || hasComposition(after) || !hasComposition(before)) return null;
  return rootCompositionRemovedMessage(path);
}

export class RootCompositionRemovedError extends Error {
  constructor(readonly sourceFile: string) {
    super(rootCompositionRemovedMessage(sourceFile));
  }
}
