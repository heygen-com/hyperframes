const CLIPBOARD_MARKER = "hyperframes-clipboard:v1";

export interface ClipboardPayload {
  kind: "timeline-clip" | "dom-element";
  html: string;
  sourceFile: string;
}

interface SerializedPayload {
  _marker: string;
  kind: "timeline-clip" | "dom-element";
  html: string;
  sourceFile: string;
}

export function serializeClipboardPayload(payload: ClipboardPayload): string {
  const data: SerializedPayload = {
    _marker: CLIPBOARD_MARKER,
    kind: payload.kind,
    html: payload.html,
    sourceFile: payload.sourceFile,
  };
  return JSON.stringify(data);
}

export function deserializeClipboardPayload(json: string): ClipboardPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (obj._marker !== CLIPBOARD_MARKER) return null;
  if (obj.kind !== "timeline-clip" && obj.kind !== "dom-element") return null;
  if (typeof obj.html !== "string" || typeof obj.sourceFile !== "string") return null;
  return { kind: obj.kind, html: obj.html, sourceFile: obj.sourceFile };
}

export function deduplicateIds(html: string, existingIds: string[]): string {
  const existingSet = new Set(existingIds);
  return html.replace(/\bid="([^"]+)"/g, (full, id: string) => {
    if (!existingSet.has(id)) return full;
    let counter = 2;
    while (existingSet.has(`${id}-${counter}`)) counter++;
    const newId = `${id}-${counter}`;
    existingSet.add(newId);
    return `id="${newId}"`;
  });
}
