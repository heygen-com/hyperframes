/**
 * planHash — content-addressed hash for distributed render plans.
 *
 * See DISTRIBUTED-RENDERING-PLAN.md §4.2 for the contract:
 *
 *   planHash = sha256(
 *     SCHEMA_PREFIX
 *     ⊕ composition_html_bytes
 *     ⊕ asset_shas (sorted by relative path)
 *     ⊕ font_snapshot_sha
 *     ⊕ encoder_config_canonical_json
 *     ⊕ producer_version
 *     ⊕ ffmpeg_version
 *     ⊕ fps ⊕ width ⊕ height ⊕ format
 *   )
 *
 * Two invocations with identical inputs MUST produce the same hash. Adapters
 * use this to short-circuit `plan()` on workflow replay and to detect
 * cross-version mismatches (§9.3 PLAN_HASH_MISMATCH).
 *
 * Pure utility; no caller exists yet — the distributed-render
 * `services/distributed/plan.ts` will compose it.
 *
 * ## Encoding contract
 *
 * Every string-typed component (`fontSnapshotSha`,
 * `encoderConfigCanonicalJson`, `producerVersion`, `ffmpegVersion`, asset
 * paths and shas, the dimensions tuple) is hashed as UTF-8. External
 * verifiers must encode the same way. Binary fields (`compositionHtml`)
 * are hashed verbatim.
 */
/**
 * SHA-256 hex digest of an asset, paired with its plan-relative path. Sort
 * order across an asset list is by `path` (byte-wise ascending) to keep the
 * digest deterministic regardless of filesystem walk order.
 */
export interface PlanAssetHash {
    /** Plan-relative path. Stable across machines (no absolute paths). */
    path: string;
    /** Hex-encoded sha256 of the asset bytes. */
    sha256: string;
}
/**
 * Render dimensions + frame rate that affect the encoded output. Kept as a
 * separate type so callers can reuse it for log lines and adapter payloads.
 */
export interface PlanDimensions {
    /** Frame rate numerator (e.g. 30 or 30000 for NTSC). */
    fpsNum: number;
    /** Frame rate denominator (e.g. 1 or 1001 for NTSC). */
    fpsDen: number;
    width: number;
    height: number;
    format: "mp4" | "mov" | "png-sequence" | "webm";
}
export interface PlanHashInput {
    /** Raw bytes of `compiled/index.html` after recompile. */
    compositionHtml: Uint8Array;
    /** All non-HTML assets referenced from the composition, in any order. */
    assets: readonly PlanAssetHash[];
    /** Hash of the deterministic-font snapshot used to render. */
    fontSnapshotSha: string;
    /** Canonical-JSON serialization of `meta/encoder.json` (LockedRenderConfig). */
    encoderConfigCanonicalJson: string;
    /** `@hyperframes/producer` package version that produced the plan. */
    producerVersion: string;
    /** ffmpeg `--version` line (e.g. "ffmpeg version 6.1.1"). */
    ffmpegVersion: string;
    dimensions: PlanDimensions;
}
/**
 * Compute the content-addressed planHash for a frozen plan.
 *
 * The hash incorporates each component as a separate `update()` call after a
 * fixed delimiter byte; that prevents two distinct inputs from accidentally
 * sharing a hash if their concatenation happens to collide (e.g. asset count
 * vs. asset bytes).
 */
export declare function computePlanHash(input: PlanHashInput): string;
/**
 * Canonical-JSON serialization helper. JSON keys are emitted in
 * byte-wise-sorted order recursively, with no whitespace. Used to feed the
 * encoder config into `computePlanHash` such that semantically-equal configs
 * produce equal hashes regardless of source key ordering.
 *
 * Supports the subset that LockedRenderConfig values use: primitives, plain
 * objects, and arrays. Throws on functions, symbols, BigInts, and Maps.
 */
export declare function canonicalJsonStringify(value: unknown): string;
/**
 * Convenience helper: sha256 a file path or buffer, return hex digest. Used
 * by the eventual `freezePlan` to hash assets on disk.
 */
export declare function sha256Hex(bytes: Uint8Array | string): string;
//# sourceMappingURL=planHash.d.ts.map