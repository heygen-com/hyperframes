import { type HdrTransfer, convertTransfer } from "@hyperframes/engine";

export interface HdrImageTransferCache {
  getConverted(
    imageId: string,
    sourceTransfer: HdrTransfer,
    targetTransfer: HdrTransfer,
    source: Buffer,
  ): Buffer;

  size(): number;

  bytesUsed(): number;
}

export interface HdrImageTransferCacheOptions {
  /**
   * Maximum bytes of converted buffers to retain before evicting the
   * least-recently-used entries. Defaults to 200 MB. At 1080p (~12 MB/entry)
   * that fits ~16 entries; at 4K (~50 MB/entry) it naturally caps at ~4.
   * Set to `0` to disable caching entirely (every call allocates fresh).
   */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 200 * 1024 * 1024;

export function createHdrImageTransferCache(
  options: HdrImageTransferCacheOptions = {},
): HdrImageTransferCache {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isInteger(maxBytes) || maxBytes < 0) {
    throw new Error(
      `createHdrImageTransferCache: maxBytes must be a non-negative integer, got ${String(maxBytes)}`,
    );
  }

  const entries = new Map<string, Buffer>();
  let totalBytes = 0;

  function makeKey(imageId: string, targetTransfer: HdrTransfer): string {
    return `${imageId}|${targetTransfer}`;
  }

  function evictUntilRoom(needed: number): void {
    while (totalBytes + needed > maxBytes && entries.size > 0) {
      const lruKey = entries.keys().next().value;
      if (lruKey === undefined) break;
      const evicted = entries.get(lruKey);
      if (evicted) totalBytes -= evicted.byteLength;
      entries.delete(lruKey);
    }
  }

  return {
    getConverted(imageId, sourceTransfer, targetTransfer, source) {
      if (sourceTransfer === targetTransfer) {
        return source;
      }

      if (maxBytes === 0) {
        const fresh = Buffer.from(source);
        convertTransfer(fresh, sourceTransfer, targetTransfer);
        return fresh;
      }

      const key = makeKey(imageId, targetTransfer);
      const existing = entries.get(key);
      if (existing) {
        entries.delete(key);
        entries.set(key, existing);
        return existing;
      }

      const converted = Buffer.from(source);
      convertTransfer(converted, sourceTransfer, targetTransfer);

      if (converted.byteLength > maxBytes) {
        return converted;
      }

      evictUntilRoom(converted.byteLength);
      entries.set(key, converted);
      totalBytes += converted.byteLength;
      return converted;
    },

    size() {
      return entries.size;
    },

    bytesUsed() {
      return totalBytes;
    },
  };
}
