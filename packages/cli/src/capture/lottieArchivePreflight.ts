/** Bound raw central-directory names before adm-zip synthesizes their parent folders. */
export function preflightLottieArchive(bytes: Buffer): boolean {
  const end = findDirectoryEnd(bytes);
  if (end < 0) return false;
  if (!unambiguousFooter(bytes, end)) return false;
  const count = bytes.readUInt16LE(end + 10);
  if (count > 256 || bytes.readUInt16LE(end + 8) !== count) return false;
  if (bytes.readUInt32LE(end + 4) !== 0) return false; // no multi-disk archives
  let offset = bytes.readUInt32LE(end + 16);
  const directoryEnd = offset + bytes.readUInt32LE(end + 12);
  if (directoryEnd > end) return false;
  for (let i = 0; i < count; i++) {
    const next = nextBoundedEntry(bytes, offset, directoryEnd);
    if (next === null) return false;
    offset = next;
  }
  return offset === directoryEnd;
}

function unambiguousFooter(bytes: Buffer, end: number): boolean {
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  if (bytes.lastIndexOf(signature) !== end) return false;
  // adm-zip scans just before EOCD for alternate/ZIP64 records. This bounded
  // archive format does not need those; do not let it select another directory.
  const preceding = bytes.subarray(Math.max(0, end - 76), end);
  return ![
    signature,
    Buffer.from([0x50, 0x4b, 0x06, 0x06]),
    Buffer.from([0x50, 0x4b, 0x06, 0x07]),
  ].some((marker) => preceding.includes(marker));
}

function findDirectoryEnd(bytes: Buffer): number {
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (
      bytes.readUInt32LE(at) === 0x06054b50 &&
      at + 22 + bytes.readUInt16LE(at + 20) === bytes.length
    )
      return at;
  }
  return -1;
}

function nextBoundedEntry(bytes: Buffer, offset: number, end: number): number | null {
  if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) return null;
  const length = bytes.readUInt16LE(offset + 28);
  const next =
    offset + 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  if (length > 512 || next > end) return null;
  const name = bytes.toString("utf8", offset + 46, offset + 46 + length);
  return safeLottieArchivePath(name) ? next : null;
}

export function safeLottieArchivePath(path: string): boolean {
  if (path.length > 512 || path.split("/").length > 16) return false;
  if (path.startsWith("/") || /[\\:]/.test(path)) return false;
  if (Array.from(path).some((char) => char.charCodeAt(0) < 32)) return false;
  return path.split("/").every((segment) => segment !== ".." && segment !== ".");
}
