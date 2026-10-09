/**
 * PNG chunk CRC32, shared by the encoder and the metadata reader.
 *
 * node:zlib's crc32 is native and takes a running seed, so the chunk type and the chunk
 * data can be CRC'd in sequence without concatenating them into a throwaway buffer:
 * ~210 ms to ~1.3 ms on a 12 MiB PNG.
 *
 * It landed in Node 22.2.0, and this repo declares `"node": ">=22"` with a major-only
 * runtime gate, so 22.0 and 22.1 are still supported. A NAMED import of a missing export
 * throws at module evaluation, i.e. the importing module would fail to load at all on
 * those, long before any PNG is touched, so the namespace import plus the capability
 * check below is deliberate. Raising the floor to 22.2.0 instead would be a user-facing
 * support change.
 */
import * as zlib from "node:zlib";

const nativeCrc32 = typeof zlib.crc32 === "function" ? zlib.crc32 : undefined;

/** Bit-at-a-time fallback for Node 22.0/22.1. Correct, just slower. */
function crc32Fallback(data: Buffer, seed: number): number {
  let crc = seed ^ 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] ?? 0;
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function chunkCrc32(chunkType: string, chunkData: Buffer): number {
  const typeBytes = Buffer.from(chunkType, "ascii");
  if (nativeCrc32) return nativeCrc32(chunkData, nativeCrc32(typeBytes));
  return crc32Fallback(chunkData, crc32Fallback(typeBytes, 0));
}
