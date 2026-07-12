import type { AssetSnippet, FigmaManifestRecord } from "./types";

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildAssetSnippet(record: FigmaManifestRecord): AssetSnippet {
  // Every interpolated attribute is escaped — path and nodeId are
  // system-generated today, but defense-in-depth is free here.
  const alt = escapeAttr(record.description ?? record.id);
  const src = escapeAttr(record.path);
  const w = record.width !== undefined ? ` width="${record.width}"` : "";
  const h = record.height !== undefined ? ` height="${record.height}"` : "";
  const html = `<img src="${src}" alt="${alt}"${w}${h} data-figma-id="${escapeAttr(record.provenance.nodeId)}" />`;
  return { path: record.path, html };
}
