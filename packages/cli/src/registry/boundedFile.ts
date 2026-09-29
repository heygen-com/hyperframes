import { closeSync, fstatSync, openSync, readSync } from "node:fs";

/** Read one regular file through a fixed descriptor without trusting a prior path stat. */
export function readBoundedRegistryFile(path: string, maxBytes: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("Registry file exceeds read limit");
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maxBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
      const count = readSync(fd, chunk);
      if (count === 0) return Buffer.concat(chunks, total);
      total += count;
      chunks.push(chunk.subarray(0, count));
    }
    throw new Error("Registry file exceeds read limit");
  } finally {
    closeSync(fd);
  }
}
