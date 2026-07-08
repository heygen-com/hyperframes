import type { ExportResult } from "./types.js";

export function suggestedFilename(result: ExportResult): string {
  const base = result.compositionId ?? "composition";
  const extension = result.mimeType === "video/webm" ? "webm" : "mp4";
  return `${base}.${extension}`;
}

/** Trigger a client-side download of the exported video. */
export function downloadExport(result: ExportResult, filename?: string): void {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename ?? suggestedFilename(result);
  anchor.click();
  URL.revokeObjectURL(url);
}
