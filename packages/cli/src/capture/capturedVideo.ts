import { bytesMatchExtension } from "../cloud/offloadSniff.js";

/** A page's name for a video as one file-name stem: decoded, its last extension dropped, only [A-Za-z0-9_-] kept, so
 * it can't name a dotfile or carry an extension of its own. */
export function videoStem(name: string): string {
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    /* malformed percent-encoding */
  }
  const last = decoded.split(/[\\/]/).pop() ?? "";
  const dot = last.lastIndexOf(".");
  return (dot > 0 ? last.slice(0, dot) : last).replace(/[^A-Za-z0-9_-]+/g, "_") || "video";
}

/** The video container a file's first bytes are, as its extension; null for anything else. Never a page's suffix. */
export function videoExtensionOf(head: Buffer): string | null {
  if (head.toString("latin1", 8, 12) === "qt  " && bytesMatchExtension(".mov", head)) return ".mov";
  return [".webm", ".mp4", ".mov"].find((ext) => bytesMatchExtension(ext, head)) ?? null;
}
