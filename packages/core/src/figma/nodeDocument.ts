import type { FigmaNodeDocument } from "./client";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Narrow an unknown child entry to a node document, or null. */
function asNodeDocument(value: unknown): FigmaNodeDocument | null {
  if (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.type === "string"
  ) {
    return { ...value, id: value.id, name: value.name, type: value.type };
  }
  return null;
}

/** Typed children of a node document (unknown-shaped entries skipped). */
export function childDocuments(node: FigmaNodeDocument): FigmaNodeDocument[] {
  if (!Array.isArray(node.children)) return [];
  const out: FigmaNodeDocument[] = [];
  for (const child of node.children) {
    const doc = asNodeDocument(child);
    if (doc) out.push(doc);
  }
  return out;
}
