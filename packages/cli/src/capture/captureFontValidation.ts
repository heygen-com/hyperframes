import { createHash } from "node:crypto";
import { create } from "fontkit";

const MAX_FONT_BYTES = 75 * 1024 * 1024;

/** Identify the container from bytes and require readable font metrics before publication. */
function fontContainerExtension(bytes: Buffer): string | null {
  if (bytes.length < 12 || bytes.length > MAX_FONT_BYTES) return null;
  const signature = bytes.toString("ascii", 0, 4);
  let extension: string;
  if (signature === "wOFF" || signature === "wOF2") {
    return woffExtension(bytes, signature);
  } else if (signature === "OTTO") {
    extension = ".otf";
  } else if (bytes.readUInt32BE(0) === 0x00010000 || signature === "true") {
    extension = ".ttf";
  } else {
    return null;
  }
  return extension;
}

function woffExtension(bytes: Buffer, signature: string): string | null {
  const headerSize = signature === "wOFF" ? 44 : 48;
  if (bytes.length < headerSize || bytes.readUInt32BE(8) !== bytes.length) return null;
  const expandedSize = bytes.readUInt32BE(16);
  if (expandedSize < 12 || expandedSize > MAX_FONT_BYTES) return null;
  return signature === "wOFF" ? ".woff" : ".woff2";
}

export function captureFontExtension(bytes: Buffer): string | null {
  const extension = fontContainerExtension(bytes);
  if (!extension) return null;
  try {
    const font = create(bytes);
    if (!("numGlyphs" in font) || font.numGlyphs <= 0 || font.numGlyphs > 65535) return null;
    if (!Number.isFinite(font.unitsPerEm) || font.unitsPerEm <= 0) return null;
    // Exercise the character map too: fontkit creates several containers lazily.
    if (!Array.isArray(font.characterSet)) return null;
    return extension;
  } catch {
    return null;
  }
}

/** Preserve ordinary names; remote URL spelling must never select a Windows device or stream. */
function preferredFontFilename(url: string, extension: string): string {
  const basename = new URL(url).pathname.split("/").pop() ?? "";
  const dot = basename.lastIndexOf(".");
  const stem = dot > 0 ? basename.slice(0, dot) : basename;
  if (
    /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,119}$/.test(stem) &&
    !/[. ]$/.test(stem) &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)
  ) {
    return `${stem}${extension}`;
  }
  return `font-${createHash("sha256").update(url).digest("hex").slice(0, 16)}${extension}`;
}

export function captureFontFilename(
  url: string,
  extension: string,
  used = new Set<string>(),
): string {
  const preferred = preferredFontFilename(url, extension);
  const stem = preferred.slice(0, -extension.length);
  let name = preferred;
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${stem}-${n}${extension}`;
  used.add(name.toLowerCase());
  return name;
}
