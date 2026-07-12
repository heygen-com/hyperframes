import type { FigmaRef } from "./types";

const FILE_KEY_RE = /\/(?:design|file|proto)\/([A-Za-z0-9]+)/;

function normalizeNodeId(raw: string): string {
  return raw.replaceAll("-", ":");
}

export function parseFigmaRef(input: string): FigmaRef {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new Error("parseFigmaRef: empty input");

  if (!trimmed.includes("/")) {
    const colon = trimmed.indexOf(":");
    if (colon === -1) return { fileKey: trimmed };
    const fileKey = trimmed.slice(0, colon);
    const node = trimmed.slice(colon + 1);
    if (fileKey.length === 0) throw new Error(`parseFigmaRef: invalid ref "${input}"`);
    return node.length > 0 ? { fileKey, nodeId: normalizeNodeId(node) } : { fileKey };
  }

  const keyMatch = trimmed.match(FILE_KEY_RE);
  const fileKey = keyMatch?.[1];
  if (fileKey === undefined) throw new Error(`parseFigmaRef: no fileKey in "${input}"`);

  const q = trimmed.indexOf("?");
  if (q !== -1) {
    const raw = new URLSearchParams(trimmed.slice(q + 1)).get("node-id");
    if (raw !== null && raw.length > 0) return { fileKey, nodeId: normalizeNodeId(raw) };
  }
  return { fileKey };
}
