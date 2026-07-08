import type { ExportFormat } from "./types.js";

export interface FormatCodecs {
  video: "avc" | "vp9";
  audio: "aac" | "opus";
  mimeType: string;
  extension: string;
}

const FORMAT_CODECS: Record<ExportFormat, FormatCodecs> = {
  mp4: { video: "avc", audio: "aac", mimeType: "video/mp4", extension: "mp4" },
  webm: { video: "vp9", audio: "opus", mimeType: "video/webm", extension: "webm" },
};

export function codecsForFormat(format: ExportFormat): FormatCodecs {
  return FORMAT_CODECS[format];
}
