import { closeSync, openSync, readFileSync, readSync } from "node:fs";

/** One face of a font file: where it starts and the family names written inside it. */
export interface SfntFace {
  offset: number;
  families: string[];
  weight: string;
  style: "normal" | "italic";
}

const NAME_FAMILY_IDS = new Set([1, 16, 21]);
const MAX_FACES = 64;

function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const read = readSync(fd, buf, 0, length, position);
  return read === length ? buf : buf.subarray(0, read);
}

function tableDirectory(
  fd: number,
  faceOffset: number,
): Map<string, { offset: number; length: number }> {
  const header = readAt(fd, faceOffset, 12);
  const count = header.length === 12 ? header.readUInt16BE(4) : 0;
  const dir = readAt(fd, faceOffset + 12, count * 16);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i + 16 <= dir.length; i += 16) {
    tables.set(dir.toString("latin1", i, i + 4), {
      offset: dir.readUInt32BE(i + 8),
      length: dir.readUInt32BE(i + 12),
    });
  }
  return tables;
}

function familiesIn(name: Buffer): string[] {
  if (name.length < 6) return [];
  const count = name.readUInt16BE(2);
  const strings = name.readUInt16BE(4);
  const found = new Set<string>();
  for (let i = 0; i < count && 6 + i * 12 + 12 <= name.length; i++) {
    const at = 6 + i * 12;
    const platform = name.readUInt16BE(at);
    const nameId = name.readUInt16BE(at + 6);
    if (!NAME_FAMILY_IDS.has(nameId)) continue;
    const length = name.readUInt16BE(at + 8);
    const raw = name.subarray(
      strings + name.readUInt16BE(at + 10),
      strings + name.readUInt16BE(at + 10) + length,
    );
    // Windows (3) and Unicode (0) names are UTF-16BE; Macintosh (1) names are single-byte.
    const text =
      platform === 1 ? raw.toString("latin1") : Buffer.from(raw).swap16().toString("utf16le");
    if (text.trim()) found.add(text.trim());
  }
  return [...found];
}

function readFace(fd: number, offset: number): SfntFace | null {
  const tables = tableDirectory(fd, offset);
  const nameTable = tables.get("name");
  if (!nameTable) return null;
  const families = familiesIn(readAt(fd, nameTable.offset, Math.min(nameTable.length, 1 << 20)));
  const os2Table = tables.get("OS/2");
  const os2 = os2Table
    ? readAt(fd, os2Table.offset, Math.min(os2Table.length, 64))
    : Buffer.alloc(0);
  const weightClass = os2.length >= 6 ? os2.readUInt16BE(4) : 400;
  const italic = os2.length >= 64 && (os2.readUInt16BE(62) & 1) === 1;
  return {
    offset,
    families,
    weight: String(weightClass >= 100 && weightClass <= 900 ? weightClass : 400),
    style: italic ? "italic" : "normal",
  };
}

/** Every face of a font file, with the family names inside it; a collection (.ttc) yields one per member. */
export function readSfntFaces(path: string): SfntFace[] {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const head = readAt(fd, 0, 12);
    if (head.length < 12) return [];
    const collection = head.toString("latin1", 0, 4) === "ttcf";
    const table = collection ? readAt(fd, 12, Math.min(head.readUInt32BE(8), MAX_FACES) * 4) : head;
    const offsets = collection
      ? Array.from({ length: Math.floor(table.length / 4) }, (_, i) => table.readUInt32BE(i * 4))
      : [0];
    return offsets.map((offset) => readFace(fd!, offset)).filter((f): f is SfntFace => f !== null);
  } catch {
    return [];
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** One face of a font file as a standalone font, which a browser can load; a collection cannot be loaded whole. */
export function extractSfntFace(
  path: string,
  faceOffset: number,
): { bytes: Buffer; format: "ttf" | "otf" } {
  const file = readFileSync(path);
  const count = file.readUInt16BE(faceOffset + 4);
  const records = Array.from({ length: count }, (_, i) => {
    const at = faceOffset + 12 + i * 16;
    return {
      tag: file.subarray(at, at + 4),
      checksum: file.readUInt32BE(at + 4),
      data: file.subarray(
        file.readUInt32BE(at + 8),
        file.readUInt32BE(at + 8) + file.readUInt32BE(at + 12),
      ),
    };
  });
  const dirEnd = 12 + count * 16;
  const parts: Buffer[] = [Buffer.alloc(dirEnd)];
  let next = dirEnd;
  const out = parts[0]!;
  file.copy(out, 0, faceOffset, faceOffset + 12);
  records.forEach((record, i) => {
    const at = 12 + i * 16;
    record.tag.copy(out, at);
    out.writeUInt32BE(record.checksum, at + 4);
    out.writeUInt32BE(next, at + 8);
    out.writeUInt32BE(record.data.length, at + 12);
    const padded = Buffer.alloc((record.data.length + 3) & ~3);
    record.data.copy(padded);
    parts.push(padded);
    next += padded.length;
  });
  const bytes = Buffer.concat(parts);
  return { bytes, format: bytes.toString("latin1", 0, 4) === "OTTO" ? "otf" : "ttf" };
}
