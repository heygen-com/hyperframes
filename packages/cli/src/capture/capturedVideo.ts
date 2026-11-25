import { bytesMatchExtension } from "../cloud/offloadSniff.js";

const decoded = (name: string): string => {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
};

export function videoStem(name: string): string {
  const last = decoded(name).split(/[\\/]/).pop() ?? "";
  const dot = last.lastIndexOf(".");
  return (dot > 0 ? last.slice(0, dot) : last).replace(/[^A-Za-z0-9_-]+/g, "_") || "video";
}

/** The container a captured video's first bytes are, as its extension: never a page's suffix. */
export function videoExtensionOf(head: Buffer): string | null {
  if (head.toString("latin1", 8, 12) === "qt  " && bytesMatchExtension(".mov", head)) return ".mov";
  return [".webm", ".mp4", ".mov"].find((ext) => bytesMatchExtension(ext, head)) ?? null;
}
