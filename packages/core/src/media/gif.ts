export interface AnimatedGifMetadata {
  width: number;
  height: number;
  frameCount: number;
  delaysCentiseconds: number[];
  durationSeconds: number;
  /** Netscape loop count. 0 means infinite; null means no loop extension was present. */
  loopCount: number | null;
  animated: boolean;
}

function readAscii(bytes: Uint8Array, start: number, length: number): string {
  if (start + length > bytes.length) return "";
  let value = "";
  for (let i = start; i < start + length; i++) {
    value += String.fromCharCode(bytes[i] ?? 0);
  }
  return value;
}

function readU16LE(bytes: Uint8Array, offset: number): number | null {
  if (offset + 1 >= bytes.length) return null;
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function colorTableByteLength(packed: number): number {
  return 3 * 2 ** ((packed & 0b0000_0111) + 1);
}

function skipSubBlocks(bytes: Uint8Array, offset: number): number | null {
  let pos = offset;
  while (pos < bytes.length) {
    const size = bytes[pos];
    if (size === undefined) return null;
    pos += 1;
    if (size === 0) return pos;
    pos += size;
  }
  return null;
}

function parseApplicationExtension(
  bytes: Uint8Array,
  offset: number,
): {
  nextOffset: number;
  loopCount: number | null;
} | null {
  const blockSize = bytes[offset];
  if (blockSize === undefined || offset + 1 + blockSize > bytes.length) return null;

  const appId = readAscii(bytes, offset + 1, blockSize);
  let pos = offset + 1 + blockSize;
  let loopCount: number | null = null;

  while (pos < bytes.length) {
    const size = bytes[pos];
    if (size === undefined) return null;
    pos += 1;
    if (size === 0) return { nextOffset: pos, loopCount };
    if (pos + size > bytes.length) return null;
    if ((appId === "NETSCAPE2.0" || appId === "ANIMEXTS1.0") && size >= 3 && bytes[pos] === 1) {
      loopCount = readU16LE(bytes, pos + 1);
    }
    pos += size;
  }

  return null;
}

export function parseAnimatedGifMetadata(bytes: Uint8Array): AnimatedGifMetadata | null {
  if (bytes.length < 13) return null;
  const signature = readAscii(bytes, 0, 6);
  if (signature !== "GIF87a" && signature !== "GIF89a") return null;

  const width = readU16LE(bytes, 6);
  const height = readU16LE(bytes, 8);
  if (width == null || height == null || width <= 0 || height <= 0) return null;

  const packed = bytes[10] ?? 0;
  let pos = 13;
  if ((packed & 0b1000_0000) !== 0) {
    pos += colorTableByteLength(packed);
  }

  let frameCount = 0;
  const delaysCentiseconds: number[] = [];
  let loopCount: number | null = null;

  while (pos < bytes.length) {
    const introducer = bytes[pos];
    if (introducer === undefined) return null;
    pos += 1;

    if (introducer === 0x3b) break;

    if (introducer === 0x21) {
      const label = bytes[pos];
      if (label === undefined) return null;
      pos += 1;

      if (label === 0xf9) {
        const blockSize = bytes[pos];
        if (blockSize !== 4 || pos + 6 > bytes.length) return null;
        const delay = readU16LE(bytes, pos + 2);
        if (delay == null) return null;
        delaysCentiseconds.push(delay);
        pos += 1 + blockSize;
        if (bytes[pos] !== 0) return null;
        pos += 1;
        continue;
      }

      if (label === 0xff) {
        const parsed = parseApplicationExtension(bytes, pos);
        if (!parsed) return null;
        if (parsed.loopCount != null) loopCount = parsed.loopCount;
        pos = parsed.nextOffset;
        continue;
      }

      const next = skipSubBlocks(bytes, pos);
      if (next == null) return null;
      pos = next;
      continue;
    }

    if (introducer === 0x2c) {
      if (pos + 9 > bytes.length) return null;
      const imagePacked = bytes[pos + 8] ?? 0;
      pos += 9;
      if ((imagePacked & 0b1000_0000) !== 0) {
        pos += colorTableByteLength(imagePacked);
      }
      if (pos >= bytes.length) return null;
      pos += 1; // LZW minimum code size
      const next = skipSubBlocks(bytes, pos);
      if (next == null) return null;
      pos = next;
      frameCount += 1;
      continue;
    }

    return null;
  }

  const durationSeconds =
    delaysCentiseconds.reduce((total, delay) => total + Math.max(0, delay), 0) / 100;

  return {
    width,
    height,
    frameCount,
    delaysCentiseconds,
    durationSeconds,
    loopCount,
    animated: frameCount > 1,
  };
}
