import { type HdrTransfer } from "@hyperframes/engine";
export interface HdrImageTransferCache {
    getConverted(imageId: string, sourceTransfer: HdrTransfer, targetTransfer: HdrTransfer, source: Buffer): Buffer;
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
export declare function createHdrImageTransferCache(options?: HdrImageTransferCacheOptions): HdrImageTransferCache;
//# sourceMappingURL=hdrImageTransferCache.d.ts.map